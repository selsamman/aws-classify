"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_classify_client_1 = require("./aws-classify-client");
const ServerRequest_1 = require("./server-requests/ServerRequest");
const ClientResponse_1 = require("./client-responses/ClientResponse");
describe("single session tests", () => {
    let classifyClient;
    let session = "";
    let serverRequest;
    beforeEach(async () => {
        classifyClient = new aws_classify_client_1.ClassifyClient(async () => session, async (sessionIn) => {
            session = sessionIn;
        }, " http://localhost:4000/api/dispatch");
        serverRequest = classifyClient.createRequest(ServerRequest_1.ServerRequest);
        await classifyClient.initSocket();
    });
    afterEach(() => {
        session = "";
        classifyClient = undefined;
    });
    it("can get/set the count", async () => {
        await serverRequest.setCount(5);
        expect(await serverRequest.getCount()).toBe(5);
    });
    it("can callback to the client", async () => {
        const clientResponse = classifyClient.createResponse(ClientResponse_1.ClientResponse);
        await serverRequest.setCount(3);
        expect(await new Promise(async (resolve) => {
            clientResponse.setCount = count => resolve(count);
            await serverRequest.sendCount();
        })).toBe(3);
    });
});
describe("multi session tests", () => {
    let classifyClient1;
    let session1 = "";
    let serverRequest1;
    let classifyClient2;
    let session2 = "";
    let serverRequest2;
    beforeEach(async () => {
        await new Promise((resolve, reject) => {
            try {
                classifyClient1 = new aws_classify_client_1.ClassifyClient(async () => session1, async (sessionIn) => {
                    session1 = sessionIn;
                }, " http://localhost:4000/api/dispatch");
                classifyClient1.setLogger(msg => console.log(msg));
                classifyClient1.setLogLevel({ calls: true });
                classifyClient1.onDisconnect(() => console.log('disconnected'));
                classifyClient1.onConnect(() => resolve(true));
                classifyClient1.initSocket();
                serverRequest1 = classifyClient1.createRequest(ServerRequest_1.ServerRequest);
            }
            catch (e) {
                reject(e);
            }
        });
        await new Promise((resolve, reject) => {
            try {
                classifyClient2 = new aws_classify_client_1.ClassifyClient(async () => session2, async (sessionIn) => {
                    session2 = sessionIn;
                }, " http://localhost:4000/api/dispatch");
                classifyClient2.setLogger(msg => console.log(msg));
                classifyClient2.setLogLevel({ calls: true });
                classifyClient2.onDisconnect(() => console.log('disconnected'));
                classifyClient2.onConnect(() => resolve(true));
                classifyClient2.initSocket();
                serverRequest2 = classifyClient2.createRequest(ServerRequest_1.ServerRequest);
            }
            catch (e) {
                reject(e);
            }
        });
    });
    afterEach(() => {
        session1 = "";
        classifyClient1 = undefined;
        session2 = "";
        classifyClient2 = undefined;
    });
    it("can get/set the count", async () => {
        await serverRequest1.setCount(1);
        expect(await serverRequest1.getCount()).toBe(1);
        await serverRequest2.setCount(2);
        expect(await serverRequest2.getCount()).toBe(2);
        expect(await serverRequest1.getCount()).toBe(1);
    });
    it("can callback to the other client", async () => {
        const clientResponse1 = classifyClient1.createResponse(ClientResponse_1.ClientResponse);
        const clientResponse2 = classifyClient2.createResponse(ClientResponse_1.ClientResponse);
        const sessionId1 = await serverRequest1.getSessionId();
        const sessionId2 = await serverRequest2.getSessionId();
        expect(sessionId1 !== sessionId2).toBe(true);
        await serverRequest1.setCount(1);
        await serverRequest2.setCount(2);
        expect(await new Promise(async (resolve) => {
            clientResponse2.setCount = count => resolve(count);
            await serverRequest1.sendCountTo(sessionId2);
        })).toBe(1);
        expect(await new Promise(async (resolve) => {
            clientResponse1.setCount = count => resolve(count);
            await serverRequest2.sendCountTo(sessionId1);
        })).toBe(2);
    });
});
