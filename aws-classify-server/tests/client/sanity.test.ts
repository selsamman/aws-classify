import {ClassifyClient} from "./aws-classify-client";
import {after} from "node:test";
import {ServerRequest} from "./server-requests/ServerRequest";
import {ClientResponse} from "./client-responses/ClientResponse";

let sessionCount = 0;

describe("single session tests",  () => {
    let classifyClient : ClassifyClient;
    let session = "";
    let serverRequest : ServerRequest

    beforeEach(async () => {
        classifyClient = new ClassifyClient(
            async () => session,
            async (sessionIn: string) => {
                session = sessionIn
            },
            " http://localhost:4000/api/dispatch");
        serverRequest = classifyClient.createRequest(ServerRequest);
        await classifyClient.initSocket();
        ++sessionCount;
    });
    afterEach (() => {
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
        expect (await new Promise( async resolve => {
            clientResponse.setCount = count => resolve(count);
            await serverRequest.sendCount();
        })).toBe(3);
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
        await new Promise((resolve, reject) => {
            try {
                classifyClient1 = new ClassifyClient(
                    async () => session1,
                    async (sessionIn: string) => {
                        session1 = sessionIn
                    },
                    " http://localhost:4000/api/dispatch");
                classifyClient1.setLogger(msg => console.log(msg));
                classifyClient1.setLogLevel({calls: true});
                classifyClient1.onDisconnect(() => console.log('disconnected'));
                classifyClient1.onConnect(() => resolve(true));
                classifyClient1.initSocket();
                serverRequest1 = classifyClient1.createRequest(ServerRequest);
            } catch (e) { reject(e) }
        });
        ++sessionCount;
        await new Promise((resolve, reject) => {
            try {
                classifyClient2 = new ClassifyClient(
                    async () => session2,
                    async (sessionIn: string) => {
                        session2 = sessionIn
                    },
                    " http://localhost:4000/api/dispatch");
                classifyClient2.setLogger(msg => console.log(msg));
                classifyClient2.setLogLevel({calls: true});
                classifyClient2.onDisconnect(() => console.log('disconnected'));
                classifyClient2.onConnect(() => resolve(true));
                classifyClient2.initSocket();
                serverRequest2 = classifyClient2.createRequest(ServerRequest);
            } catch (e) { reject(e) }
        });
        ++sessionCount;
    });
    afterEach (() => {
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
        expect(sessionId1 !== sessionId2).toBe(true);
        await serverRequest1.setCount(1);
        await serverRequest2.setCount(2);

        expect (await new Promise( async resolve => {
            clientResponse2.setCount = count => resolve(count);
            await serverRequest1.sendOurCountTo(sessionId2);
        })).toBe(1);

        expect (await new Promise( async resolve => {
            clientResponse1.setCount = count => resolve(count);
            await serverRequest2.sendOurCountTo(sessionId1);
        })).toBe(2);

        expect (await new Promise( async resolve => {
            clientResponse2.setCount = count => resolve(count);
            await serverRequest1.sendCountTo(sessionId2);
        })).toBe(2);

        expect (await new Promise( async resolve => {
            clientResponse1.setCount = count => resolve(count);
            await serverRequest2.sendCountTo(sessionId1);
        })).toBe(1);

        const sessions = await serverRequest1.getSessions();
        console.log(sessions.join(",") + sessionId1 + sessionId2);
        //expect(sessions.length).toBe(sessionCount);
        //expect (sessions[0]).toBe(sessionId2);
        //expect (sessions[1]).toBe(sessionId1);
        expect(sessions.includes(sessionId1)).toBe(true);
        expect(sessions.includes(sessionId2)).toBe(true);

    });

});
