import {ClassifyClient} from "./aws-classify-client";
import {ServerRequest} from "./server-requests/ServerRequest";
import {ClientResponse} from "./client-responses/ClientResponse";

let sessionCount = 0;
jest.setTimeout(60000);

async function closeSocket(client: ClassifyClient | undefined) {
    const socket = client?.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out closing test WebSocket')), 5000);
        socket.addEventListener('close', () => {
            clearTimeout(timeout);
            resolve();
        }, {once: true});
        socket.close();
    });
}

async function receiveCount(response: ClientResponse, send: () => Promise<void>) {
    const count = new Promise<number>(resolve => { response.setCount = resolve; });
    const [result] = await Promise.all([count, send()]);
    return result;
}

beforeAll( async () => {
    let session = "";
    const classifyClient = new ClassifyClient(
        async () => session,
        async (sessionIn: string) => {
            session = sessionIn
        },
        process.env.__API__);
    const serverRequest = classifyClient.createRequest(ServerRequest);
    await serverRequest.clearSessions();
    ++sessionCount;
});

describe("work without WebSockets",  () => {
    let classifyClient : ClassifyClient;
    let session = "";
    let serverRequest : ServerRequest

    beforeEach(async () => {
        console.log(`API Endpoint: ${process.env.__API__}`);
        classifyClient = new ClassifyClient(
            async () => session,
            async (sessionIn: string) => {
                session = sessionIn
            },
            process.env.__API__);
        serverRequest = classifyClient.createRequest(ServerRequest);
        ++sessionCount;
    });
    afterEach (async () => {
        await closeSocket(classifyClient);
        session = "";
        classifyClient = undefined as unknown as ClassifyClient;
    });
    it ( "can get/set the count", async () => {
        await serverRequest.setCount(5);
        expect((await serverRequest.getSessionId()).length > 10).toBe(true);
        expect(await serverRequest.getCount()).toBe(5);
    });

});
describe("single session tests",  () => {
    let classifyClient : ClassifyClient;
    let session = "";
    let serverRequest : ServerRequest

    beforeEach(async () => {
        console.log(`API Endpoint: ${process.env.__API__}`);
        classifyClient = new ClassifyClient(
            async () => session,
            async (sessionIn: string) => {
                session = sessionIn
            },
            process.env.__API__);
        serverRequest = classifyClient.createRequest(ServerRequest);
        expect(await classifyClient.initSocket()).toBe(true);
        ++sessionCount;
    });
    afterEach (async () => {
        await closeSocket(classifyClient);
        session = "";
        classifyClient = undefined as unknown as ClassifyClient;
    });
    it ( "can get/set the count", async () => {
        await serverRequest.setCount(5);
        expect(await serverRequest.getCount()).toBe(5);
    });
    it ("can callback to the client", async () => {
        const clientResponse = classifyClient.createResponse(ClientResponse);
        await serverRequest.setCount(3);
        expect(await receiveCount(clientResponse, () => serverRequest.sendCount())).toBe(3);
    });
});
describe("multi session tests",  () => {
    let classifyClient1 : ClassifyClient;
    let session1 = "";
    let serverRequest1 : ServerRequest
    let classifyClient2 : ClassifyClient;
    let session2 = "";
    let serverRequest2 : ServerRequest
    beforeEach(async () => {
        classifyClient1 = new ClassifyClient(
            async () => session1,
            async (sessionIn: string) => { session1 = sessionIn; },
            process.env.__API__);
        serverRequest1 = classifyClient1.createRequest(ServerRequest);
        expect(await classifyClient1.initSocket()).toBe(true);
        ++sessionCount;
        classifyClient2 = new ClassifyClient(
            async () => session2,
            async (sessionIn: string) => { session2 = sessionIn; },
            process.env.__API__);
        serverRequest2 = classifyClient2.createRequest(ServerRequest);
        expect(await classifyClient2.initSocket()).toBe(true);
        ++sessionCount;
    });
    afterEach (async () => {
        await Promise.all([closeSocket(classifyClient1), closeSocket(classifyClient2)]);
        session1 = "";
        classifyClient1 = undefined as unknown as ClassifyClient;
        session2 = "";
        classifyClient2 = undefined as unknown as ClassifyClient;
    });
    it ( "can get/set the count", async () => {
        await serverRequest1.setCount(1);
        expect(await serverRequest1.getCount()).toBe(1);
        await serverRequest2.setCount(2);
        expect(await serverRequest2.getCount()).toBe(2);
        expect(await serverRequest1.getCount()).toBe(1);
    });
    it ("can callback to the other client", async () => {
        const clientResponse1 = classifyClient1.createResponse(ClientResponse);
        const clientResponse2 = classifyClient2.createResponse(ClientResponse);
        const sessionId1 = await serverRequest1.getSessionId();
        const sessionId2 = await serverRequest2.getSessionId();
        await serverRequest1.setUserId('1');
        await serverRequest2.setUserId('2');
        expect(sessionId1 !== sessionId2).toBe(true);
        await serverRequest1.setCount(1);
        await serverRequest2.setCount(2);

        expect(await receiveCount(clientResponse2, () => serverRequest1.sendOurCountTo(sessionId2))).toBe(1);

        expect(await receiveCount(clientResponse1, () => serverRequest2.sendOurCountTo(sessionId1))).toBe(2);

        expect(await receiveCount(clientResponse2, () => serverRequest1.sendCountTo(sessionId2))).toBe(2);

        expect(await receiveCount(clientResponse1, () => serverRequest2.sendCountTo(sessionId1))).toBe(1);

        const sessions = await serverRequest1.getSessions();
        console.log(sessions.join(",") + sessionId1 + sessionId2);
        expect(sessions.length).toBe(sessionCount);
        expect(sessions.includes(sessionId1)).toBe(true);
        expect(sessions.includes(sessionId2)).toBe(true);

        const sessions1 = await serverRequest1.getSessionsForUser('1');
        expect(sessions1.length).toBe(1);
        expect(sessions1[0]).toBe(sessionId1);

        const sessions2 = await serverRequest1.getSessionsForUser('2');
        expect(sessions2.length).toBe(1);
        expect(sessions2[0]).toBe(sessionId2);

        await serverRequest1.clearSessionsForUser('2');

        const sessions3 = await serverRequest1.getSessions();
        console.log(sessions2.join(",") + sessionId1 + sessionId2);
        expect(sessions3.length).toBe(sessionCount - 1);
        expect(sessions3.includes(sessionId1)).toBe(true);
        expect(sessions3.includes(sessionId2)).toBe(false);

        await serverRequest1.clearSessions();
        expect((await serverRequest1.getSessions()).length).toBe(1);
    });

});
