/** @jest-environment node */
import {ClassifyServerless} from 'aws-classify-server';
import {saveSessionData, getSessionData} from '../../aws-classify-server/lib/cjs/ClassifyServerless';
import {serialize, serializable} from 'js-freeze-dry';
jest.mock('@aws-sdk/lib-dynamodb', () => {
    const database = {get: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn()};
    return {database, DynamoDBDocument: {from: () => database}};
});
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => {
    const send = jest.fn();
    return {send, ApiGatewayManagementApiClient: class {send = send;}, PostToConnectionCommand: class {constructor(public input: unknown) {}}};
});
const db = jest.requireMock('@aws-sdk/lib-dynamodb').database;
const send = jest.requireMock('@aws-sdk/client-apigatewaymanagementapi').send as jest.Mock;
beforeEach(() => { jest.clearAllMocks(); db.get.mockResolvedValue({}); db.update.mockResolvedValue({}); });
afterEach(() => jest.useRealTimers());
it('stores TTL in epoch seconds using the configured lifetime', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await saveSessionData('session', 'Example', 'state', undefined, 'user', 30);
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
        Key: {sessionId: 'session'},
        ExpressionAttributeValues: expect.objectContaining({':time': Date.now(), ':expires': Math.floor(Date.now() / 1000) + 1800}),
    }));
});
it('does not overwrite TTL when updating only a connection', async () => {
    await saveSessionData('session', undefined, undefined, 'connection');
    expect(db.update.mock.calls[0][0].ExpressionAttributeValues).not.toHaveProperty(':expires');
});
it('uses a strongly consistent read when restoring session data', async () => {
    await getSessionData('session', 'Example');
    expect(db.get).toHaveBeenCalledWith(expect.objectContaining({ConsistentRead: true, Key: {sessionId: 'session'}}));
});
it('denies the authorization hook before member invocation or database access', async () => {
    const member = jest.fn();
    class Request {static interfaceName = 'DeniedUnit'; async run() {}}
    class Response extends Request {async run() {member();}}
    const framework = new ClassifyServerless(); framework.setLogger(() => {});
    const authorize = jest.fn().mockResolvedValue(false);
    framework.registerResponse(Response, authorize);
    await expect(framework.dispatch({body: serialize({interfaceName: 'DeniedUnit', methodName: 'run', args: [1], sessionId: 'session'})} as any, {awsRequestId: 'new'} as any)).rejects.toThrow('Not Authorized');
    expect(authorize).toHaveBeenCalledWith('DeniedUnit', 'run', [1]);
    expect(member).not.toHaveBeenCalled(); expect(db.get).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
});
it('propagates database read failures before member invocation', async () => {
    const member = jest.fn();
    class Request {static interfaceName = 'ReadFailureUnit'; async run() {}}
    class Response extends Request {async run() {member();}}
    const framework = new ClassifyServerless(); framework.registerResponse(Response);
    db.get.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(framework.dispatch({body: serialize({interfaceName: 'ReadFailureUnit', methodName: 'run', args: [], sessionId: 'session'})} as any, {awsRequestId: 'new'} as any)).rejects.toThrow('database unavailable');
    expect(member).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
});
it('does not report success when persisting response state fails', async () => {
    class Request {static interfaceName = 'WriteFailureUnit'; async run() {}}
    class Response extends Request {async run() {}}
    serializable({WriteFailureUnitResponse: Response});
    const framework = new ClassifyServerless(); framework.registerResponse(Response);
    db.update.mockRejectedValueOnce(new Error('write unavailable'));
    await expect(framework.dispatch({body: serialize({interfaceName: 'WriteFailureUnit', methodName: 'run', args: [], sessionId: ''})} as any, {awsRequestId: 'new'} as any)).rejects.toThrow('write unavailable');
});
it('propagates a real callback transport failure to its caller', async () => {
    class Notification {static interfaceName = 'NotificationUnit'; async deliver() {}}
    const framework = new ClassifyServerless(); framework.registerRequest(Notification);
    send.mockRejectedValueOnce(new Error('gateway unavailable'));
    const request = framework.createRequest({__sessionId__: 'session', __connectionId__: 'connection'}, Notification);
    await expect(request.deliver()).rejects.toThrow('Unable to send message via Websocket gateway unavailable');
    expect(send).toHaveBeenCalledTimes(1);
});
it('keeps legacy session enumeration intact while authentication hides reverse connection records', async () => {
    db.scan.mockResolvedValue({Items:[{sessionId:'connection#legacy-app-id'},{sessionId:'ordinary'}]});
    const framework=new ClassifyServerless();
    expect(await framework.getSessions()).toEqual(['connection#legacy-app-id','ordinary']);
    framework.configureAuthentication({publicSuffix:'Public'});
    expect(await framework.getSessions()).toEqual(['ordinary']);
});
