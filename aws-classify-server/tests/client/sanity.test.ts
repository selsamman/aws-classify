import {ClassifyClient} from "../../../aws-classify-client";
import {after} from "node:test";
import {ServerRequest} from "./server-requests/ServerRequest";

describe("single session tests",  () => {
    let classifyClient : ClassifyClient | undefined;
    let session = "";
    let serverRequest : ServerRequest

    beforeEach(async () => {
        await new Promise((resolve, reject) => {
            try {
                classifyClient = new ClassifyClient(
                    async () => session,
                    async (sessionIn: string) => {
                        session = sessionIn
                    },
                    " http://localhost:4000/api/dispatch");
                classifyClient.setLogger(msg => console.log(msg));
                classifyClient.setLogLevel({calls: true});
                classifyClient.onDisconnect(() => console.log('disconnected'));
                classifyClient.onConnect(() => resolve(true));
                classifyClient.initSocket();
                serverRequest = classifyClient.createRequest(ServerRequest);
                //resolve(true);
            } catch (e) { reject(e) }
        });
    });
    afterEach (() => {
        session = "";
        classifyClient = undefined;
    })
    it ("can run a test", () => {
        expect(true).toBe(true);
    });
    it ( "can get/set the count", async () => {
        await serverRequest.sendCount();
    });
});