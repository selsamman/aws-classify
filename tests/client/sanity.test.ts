import {ClassifyClient} from 'aws-classify-client';
import {ServerRequest, AlternateRequest, TestPayload} from '@aws-classify-tests/requests';
import {ClientResponse} from './client-responses/ClientResponse';
import axios from 'axios';
import {serialize, deserialize} from 'js-freeze-dry';

jest.setTimeout(60000);
const clients: ClassifyClient[] = [];
function fixture(session = '') {
    const client = new ClassifyClient(async () => session, async value => { session = value; }, process.env.__API__);
    client.setLogger(() => {});
    clients.push(client);
    return {client, request: client.createRequest(ServerRequest), session: () => session};
}
async function closeSocket(client: ClassifyClient) {
    const socket = client.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out closing WebSocket')), 5000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, {once: true});
        socket.close();
    });
}
// Only retry reads: real DynamoDB's secondary index is eventually consistent.
async function eventually<T>(read: () => Promise<T>, assert: (value: T) => void) {
    const deadline = Date.now() + 10000;
    while (true) {
        const value = await read();
        try { assert(value); return; }
        catch (error) { if (Date.now() >= deadline) throw error; }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
async function receive<T>(response: ClientResponse, method: 'setCount' | 'setPayload', send: () => Promise<void>): Promise<T> {
    const original = response[method];
    let timer: ReturnType<typeof setTimeout>;
    const message = new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 10000);
        (response as any)[method] = resolve;
    });
    try { return (await Promise.all([message, send()]))[0]; }
    finally { clearTimeout(timer!); (response as any)[method] = original; }
}
let admin: ReturnType<typeof fixture>;
beforeEach(async () => {
    admin = fixture();
    await admin.request.clearSessions();
    await eventually(() => admin.request.getSessions(), ids => expect(ids).toEqual([admin.session()]));
});
afterEach(async () => {
    const results = await Promise.allSettled(clients.splice(0).map(closeSocket));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
});

it('creates a session and persists state between HTTP requests', async () => {
    const f = fixture();
    await f.request.setCount(5);
    expect(f.session().length).toBeGreaterThan(10);
    expect(await f.request.getSessionId()).toBe(f.session());
    expect(await f.request.getCount()).toBe(5);
});
it('restores state in a recreated client with the same session', async () => {
    const f = fixture();
    await f.request.setCount(7);
    const restored = fixture(f.session());
    expect(await restored.request.getCount()).toBe(7);
    expect(restored.session()).toBe(f.session());
});
it('keeps different sessions independent', async () => {
    const a = fixture(), b = fixture();
    await a.request.setCount(1); await b.request.setCount(2);
    expect(a.session()).not.toBe(b.session());
    expect(await a.request.getCount()).toBe(1); expect(await b.request.getCount()).toBe(2);
});
it('persists separate interfaces within the same session', async () => {
    const f = fixture();
    await f.request.setCount(8);
    const other = f.client.createRequest(AlternateRequest);
    await other.setValue('other interface');
    expect(await f.request.getCount()).toBe(8);
    expect(await fixture(f.session()).client.createRequest(AlternateRequest).getValue()).toBe('other interface');
});
it('serializes multiple arguments, nulls, Unicode and registered classes', async () => {
    const f = fixture(), payload = new TestPayload('héllo 🌎', {items: [1, null, 3]});
    const result = await f.request.echo(payload, {missing: null, nested: ['✓', {value: 4}]}) as any[];
    expect(result).toEqual([payload, {missing: null, nested: ['✓', {value: 4}]}]);
    expect(result[0]).toBeInstanceOf(TestPayload);
});
it('restores registered-class state from the database', async () => {
    const f = fixture(), payload = new TestPayload('saved', {items: [null, 8]});
    await f.request.setPayload(payload);
    const result = await fixture(f.session()).request.getPayload();
    expect(result).toEqual(payload); expect(result).toBeInstanceOf(TestPayload);
});
it('returns member exceptions without saving failed state and allows subsequent calls', async () => {
    const f = fixture(); await f.request.setCount(6);
    await expect(f.request.fail()).rejects.toThrow('fixture failure');
    expect(await f.request.getCount()).toBe(6);
    await f.request.setCount(9); expect(await f.request.getCount()).toBe(9);
});
it('denies an authorization hook without mutating state', async () => {
    const f = fixture(); await f.request.setCount(3);
    await expect(f.request.deniedSetCount(99)).rejects.toThrow('Not Authorized');
    expect(await f.request.getCount()).toBe(3);
});
for (const [name, body, message] of [
    ['unknown interface', serialize({interfaceName: 'Missing', methodName: 'getCount', args: [], sessionId: ''}), 'No Response defined'],
    ['unknown method', serialize({interfaceName: 'ServerRequest', methodName: 'missingMethod', args: [], sessionId: ''}), 'not found'],
    ['malformed payload', '{broken', ''],
]) {
    it(`rejects ${name} and continues serving requests`, async () => {
        const result = await axios.post(process.env.__API__!, body, {headers: {'Content-Type': 'text/plain'}, transformRequest: [], transformResponse: []});
        const response = deserialize(result.data) as {exception: string};
        expect(response.exception).toBeTruthy();
        if (message) expect(response.exception).toContain(message);
        expect(await fixture().request.getCount()).toBe(0);
    });
}
it('propagates callback failure when the session has no socket', async () => {
    const f = fixture(); await f.request.setCount(2);
    await expect(f.request.sendCount()).rejects.toThrow('WebSocket handshake not established');
    expect(await f.request.getCount()).toBe(2);
});
it('rejects notification to a nonexistent session', async () => {
    await expect(fixture().request.sendOurCountTo('nonexistent-session')).rejects.toThrow('invalid session id');
});
it('rejects notification to an existing session without a connection', async () => {
    const target = fixture(); await target.request.getCount();
    await expect(fixture().request.sendOurCountTo(target.session())).rejects.toThrow('handshake not established');
});
it('updates the user index after reassignment', async () => {
    const f = fixture(); await f.request.setUserId('before');
    await eventually(() => admin.request.getSessionsForUser('before'), ids => expect(ids).toEqual([f.session()]));
    await f.request.setUserId('after');
    await eventually(() => admin.request.getSessionsForUser('before'), ids => expect(ids).toEqual([]));
    await eventually(() => admin.request.getSessionsForUser('after'), ids => expect(ids).toEqual([f.session()]));
});
it('deletes one user’s sessions while preserving another user’s state', async () => {
    const a = fixture(), b = fixture();
    await a.request.setUserId('left'); await a.request.setCount(4);
    await b.request.setUserId('right'); await b.request.setCount(5);
    await eventually(() => admin.request.getSessionsForUser('right'), ids => expect(ids).toEqual([b.session()]));
    await admin.request.clearSessionsForUser('right');
    await eventually(() => admin.request.getSessions(), ids => { expect(ids).toContain(a.session()); expect(ids).not.toContain(b.session()); });
    expect(await a.request.getCount()).toBe(4);
});
it('deletes all fixture sessions and retains only the calling session', async () => {
    await fixture().request.getCount(); await fixture().request.getCount();
    await admin.request.clearSessions();
    await eventually(() => admin.request.getSessions(), ids => expect(ids).toEqual([admin.session()]));
});
it('opens a socket once when initialized repeatedly', async () => {
    const f = fixture(); expect(await f.client.initSocket()).toBe(true);
    const socket = f.client.socket;
    expect(await f.client.initSocket()).toBe(true); expect(f.client.socket).toBe(socket);
});
it('delivers a callback to its own socket', async () => {
    const f = fixture(); await f.client.initSocket();
    const response = f.client.createResponse(ClientResponse); await f.request.setCount(3);
    expect(await receive<number>(response, 'setCount', () => f.request.sendCount())).toBe(3);
});
it('serializes a registered class through a socket callback', async () => {
    const f = fixture(); await f.client.initSocket();
    const response = f.client.createResponse(ClientResponse), payload = new TestPayload('callback 🌎', {items: [null, 4]});
    await f.request.setPayload(payload);
    const result = await receive<TestPayload>(response, 'setPayload', () => f.request.sendPayload());
    expect(result).toEqual(payload); expect(result).toBeInstanceOf(TestPayload);
});
it('routes notifications to the intended recipient and restores target state', async () => {
    const a = fixture(), b = fixture(); await a.client.initSocket(); await b.client.initSocket();
    const ra = a.client.createResponse(ClientResponse), rb = b.client.createResponse(ClientResponse);
    await a.request.setCount(1); await b.request.setCount(2);
    expect(await receive<number>(rb, 'setCount', () => a.request.sendOurCountTo(b.session()))).toBe(1);
    expect(ra.count).toBe(0);
    expect(await receive<number>(ra, 'setCount', () => b.request.sendOurCountTo(a.session()))).toBe(2);
    expect(await receive<number>(rb, 'setCount', () => a.request.sendCountTo(b.session()))).toBe(2);
    expect(await receive<number>(ra, 'setCount', () => b.request.sendCountTo(a.session()))).toBe(1);
});
it('reconnects a closed socket while retaining saved session state', async () => {
    const f = fixture(); await f.client.initSocket(); await f.request.setCount(12);
    const session = f.session(); await closeSocket(f.client);
    expect(await f.client.initSocket()).toBe(true); expect(f.session()).toBe(session);
    expect(await f.request.getCount()).toBe(12);
    const response = f.client.createResponse(ClientResponse);
    expect(await receive<number>(response, 'setCount', () => f.request.sendCount())).toBe(12);
});
it('rejects socket attachment with a nonexistent session', async () => {
    const f = fixture(); await f.client.initSocket();
    const socket = new WebSocket(f.client.webSocketURL, ['nonexistent-session']);
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { socket.close(); reject(new Error('Invalid session was not rejected')); }, 10000);
            socket.addEventListener('open', () => { clearTimeout(timer); reject(new Error('Invalid session connected')); }, {once: true});
            socket.addEventListener('error', () => {}, {once: true});
            socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, {once: true});
        });
    } finally { socket.close(); }
});
