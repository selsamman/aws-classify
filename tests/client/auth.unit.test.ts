/** @jest-environment node */
import {ClassifyServerless} from 'aws-classify-server';
import {Public} from 'aws-classify-common';
import {attachAuthenticatedSocket, detachAuthenticatedSocket} from '../../aws-classify-server/lib/cjs/AuthenticatedSessions';
import {serialize, deserialize, serializable} from 'js-freeze-dry';
jest.mock('@aws-sdk/lib-dynamodb', () => {
    const database = {get: jest.fn(), update: jest.fn(), put: jest.fn(), transactWrite: jest.fn(), delete: jest.fn()};
    return {database, DynamoDBDocument: {from: () => database}};
});
const db = jest.requireMock('@aws-sdk/lib-dynamodb').database;
class AuthUnitRequest {
    static interfaceName = 'AuthUnit';
    async run(): Promise<any> {}
    @Public()
    async runPublic(): Promise<any> {}
    async delayed(_wait: Promise<void>): Promise<any> {}
}
let server: ClassifyServerless;
let invoked = 0;
let retained: object | undefined;
class AuthUnitResponse extends AuthUnitRequest {
    value = 0;
    async run() { invoked++; retained=this; return server.getRequestContext(this); }
    async runPublic() { return this.run(); }
    async hiddenPublic() { invoked++; }
    async delayed(wait: Promise<void>) { await wait; return server.getRequestContext(this); }
}
serializable({AuthUnitResponse});
const context = {awsRequestId: 'request'} as any;
function event(method = 'run', sessionId = '', subject = 'alice', issuer = 'https://issuer', args: any[] = []) {
    return {body: serialize({interfaceName:'AuthUnit', methodName:method, args, sessionId}), requestContext:{authorizer:{jwt:{claims:{sub:subject, iss:issuer, custom:'claim'}, scopes:['invoke']}}}} as any;
}
beforeEach(() => {
    jest.clearAllMocks(); invoked = 0;
    delete process.env.IS_OFFLINE;
    db.get.mockResolvedValue({}); db.put.mockResolvedValue({}); db.update.mockResolvedValue({}); db.transactWrite.mockResolvedValue({});
    server = new ClassifyServerless(); server.configureAuthentication({}); server.registerResponse(AuthUnitResponse);
});
afterEach(() => {delete process.env.IS_OFFLINE; jest.useRealTimers();});
it('uses immutable Gateway identity in methods and callbacks without persisting context', async () => {
    const authorize = jest.fn(async (_endpoint, _method, _args, ctx) => {
        expect(Object.isFrozen(ctx)).toBe(true); expect(Object.isFrozen(ctx.identity.claims)).toBe(true); expect(Object.isFrozen(ctx.identity.scopes)).toBe(true);
        expect(ctx.hasScope('invoke')).toBe(true); return true;
    });
    server.registerResponse(AuthUnitResponse, authorize);
    const response = deserialize(await server.dispatch(event(), context));
    expect(response.data.identity).toEqual({subject:'alice', issuer:'https://issuer', scopes:['invoke'], claims:{sub:'alice', iss:'https://issuer', custom:'claim'}});
    expect(authorize).toHaveBeenCalledWith('AuthUnit','run',[],expect.objectContaining({dispatch:'protected'}));
    expect(db.put.mock.calls[0][0].Item.authOwner).toBe(JSON.stringify(['https://issuer','alice']));
    expect(db.update.mock.calls[0][0].ExpressionAttributeValues[':data']).not.toContain('identity');
    expect(server.getRequestContext()).toBeUndefined();
});
it('resets context between different subjects and public dispatch', async () => {
    expect(deserialize(await server.dispatch(event('run','','bob'),context)).data.identity.subject).toBe('bob');
    expect(deserialize(await server.dispatch(event(),context)).data.identity.subject).toBe('alice');
    const pub = deserialize(await server.dispatch(event('runPublic'),context,{},'public')).data;
    expect(pub.identity).toBeUndefined(); expect(pub.dispatch).toBe('public'); expect(server.getRequestContext()).toBeUndefined();
});
it('isolates overlapping request contexts', async () => {
    const seen: string[] = [];
    server.registerResponse(AuthUnitResponse, async () => {const before = server.getRequestContext()!.identity!.subject; await new Promise(resolve => setTimeout(resolve, before === 'alice' ? 10 : 1)); seen.push(server.getRequestContext()!.identity!.subject); return true;});
    await Promise.all([server.dispatch(event(),context),server.dispatch(event('run','','bob'),context)]);
    expect(seen.sort()).toEqual(['alice','bob']); expect(server.getRequestContext()).toBeUndefined();
});
it.each(['run','constructor','toString','hiddenPublic'])('refuses unexposed or protected member %s on public route', async method => {
    await expect(server.dispatch(event(method),context,{},'public')).rejects.toThrow();
    expect(invoked).toBe(0); expect(db.get).not.toHaveBeenCalled(); expect(db.put).not.toHaveBeenCalled();
});
it('refuses public members on protected route and public socket authorization', async () => {
    await expect(server.dispatch(event('runPublic'),context)).rejects.toThrow('not permitted');
    const ev=event(); ev.body=serialize({interfaceName:'$WebSocket',methodName:'$authorize',sessionId:'',args:[]});
    await expect(server.dispatch(ev,context,{},'public')).rejects.toThrow('protected dispatch'); expect(db.put).not.toHaveBeenCalled();
});
it('fails closed without trusted identity regardless of client claims', async () => {
    const ev=event(); delete ev.requestContext.authorizer;
    ev.body=serialize({interfaceName:'AuthUnit',methodName:'run',sessionId:'',args:[],identity:{sub:'fake'}});
    await expect(server.dispatch(ev,context)).rejects.toThrow('Validated identity'); expect(invoked).toBe(0);
});
it('allows explicit offline functionality without synthesizing identity', async () => {
    process.env.IS_OFFLINE='true'; const ev=event(); // Even identity-looking offline authorizer fields are unvalidated.
    expect(deserialize(await server.dispatch(ev,context)).data.identity).toBeUndefined();
    expect(db.put.mock.calls[0][0].Item.authOwner).toBe('offline-unvalidated');
});
it.each([
    ['legacy',undefined,Math.floor(Date.now()/1000)+100],
    ['other subject',JSON.stringify(['https://issuer','bob']),Math.floor(Date.now()/1000)+100],
    ['other issuer',JSON.stringify(['https://other','alice']),Math.floor(Date.now()/1000)+100],
    ['expired',JSON.stringify(['https://issuer','alice']),Math.floor(Date.now()/1000)-1],
    ['missing expiry',JSON.stringify(['https://issuer','alice']),undefined],
])('rejects %s sessions before invocation', async (_name, authOwner, expires) => {
    db.get.mockResolvedValue({Item:{sessionId:'existing',authOwner,expires}});
    await expect(server.dispatch(event('run','existing'),context)).rejects.toThrow('not owned');
    expect(invoked).toBe(0); expect(db.update).not.toHaveBeenCalled(); expect(db.put).not.toHaveBeenCalled();
});
it('adapts Lambda-authorizer context only through application configuration', async () => {
    server.configureAuthentication({identityAdapter:(auth:any) => auth?.lambda ? {subject:auth.lambda.principal,issuer:'app-authorizer',scopes:['custom'],claims:{}} : undefined});
    const ev=event(); ev.requestContext.authorizer={lambda:{principal:'trusted'}};
    expect(deserialize(await server.dispatch(ev,context)).data.identity.subject).toBe('trusted');
});
it('stores only a credential hash and binds consumption and connection recording atomically', async () => {
    const ev=event(); ev.body=serialize({interfaceName:'$WebSocket',methodName:'$authorize',args:[],sessionId:''});
    const response=deserialize(await server.dispatch(ev,context));
    expect(response.data.credential).toMatch(/^ac1\./); expect(JSON.stringify(db.update.mock.calls)).not.toContain(response.data.credential);
    db.get.mockResolvedValue({Item:{sessionId:response.sessionId,authOwner:JSON.stringify(['https://issuer','alice']),expires:Math.floor(Date.now()/1000)+100}});
    await attachAuthenticatedSocket(response.data.credential,'connection');
    const transaction=db.transactWrite.mock.calls[0][0].TransactItems;
    expect(transaction[0].Update.ConditionExpression).toContain('credentialExpires > :now'); expect(transaction[0].Update.UpdateExpression).toContain('REMOVE credentialHash'); expect(transaction[1].Put.Item.targetSessionId).toBe(response.sessionId);
    db.transactWrite.mockRejectedValueOnce(new Error('conditional failure'));
    await expect(attachAuthenticatedSocket(response.data.credential,'replay')).rejects.toThrow('conditional failure');
});
it('old disconnect cannot clear a replacement connection', async () => {
    db.get.mockResolvedValue({Item:{targetSessionId:'session'}});
    db.update.mockRejectedValueOnce(Object.assign(new Error('replaced'),{name:'ConditionalCheckFailedException'}));
    await detachAuthenticatedSocket('old');
    expect(db.update.mock.calls[0][0].ConditionExpression).toBe('connectionId = :connection');
    expect(db.delete).toHaveBeenCalledWith(expect.objectContaining({Key:{sessionId:'connection#old'}}));
});

it('does not expose an old response context after completion or during another invocation',async () => {
    await server.dispatch(event(),context); const prior=retained!;
    expect(server.getRequestContext(prior)).toBeUndefined();
    server.registerResponse(AuthUnitResponse,async () => {
        expect(server.getRequestContext()!.identity!.subject).toBe('bob');
        expect(server.getRequestContext(prior)).toBeUndefined(); return true;
    });
    await server.dispatch(event('run','','bob'),context);
});
