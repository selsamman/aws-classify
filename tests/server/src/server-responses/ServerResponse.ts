import {ServerRequest, TestPayload} from "@aws-classify-tests/requests";
import {classifyServerless} from "aws-classify-server";
import {ClientRequest} from "@aws-classify-tests/requests";
import {serializable} from "js-freeze-dry";

// Register request class
classifyServerless.registerRequest(ClientRequest);

export class ServerResponse extends ServerRequest {

    count = 0;
    payload = new TestPayload();
    async fail() { this.count = -1; throw new Error('fixture failure'); }
    async deniedSetCount(count: number) { this.count = count; }
    async echo(payload: TestPayload, extra: unknown) { return [payload, extra]; }
    async setPayload(payload: TestPayload) { this.payload = payload; }
    async getPayload() { return this.payload; }
    async sendPayload() {
        await classifyServerless.createRequest(this, ClientRequest).setPayload(this.payload);
    }

    constructor() {
        super();
        classifyServerless.setUserId(this, 'all');
    }

    async setCount (count : number) { this.count = count }

    async getCount () : Promise<number> { return this.count }

    async sendCount () {
        const clientRequest = classifyServerless.createRequest(this, ClientRequest);
        await clientRequest.setCount(this.count);
    }

    async getSessionId (): Promise<string> {
        return await classifyServerless.getSessionId(this);
    }
    async getSessionsForUser (user : string) : Promise<Array<string>> {
        return await classifyServerless.getSessionsForUserId(user);
    }
    async getSessions () : Promise<Array<string>> {
        return await classifyServerless.getSessions();
    }
    async clearSessionsForUser (user : string) {
         await classifyServerless.deleteSessionsForUserId(user);
    }
    async clearSessions () {
        await classifyServerless.deleteSessions();
    }
    async setUserId(userId : string) {
        classifyServerless.setUserId(this, userId);
    }

    async sendCountTo(sessionId: string) {
        await classifyServerless.createResponse(ServerResponse, sessionId, async serverResponse => {
            await serverResponse.sendCount()
        });
    }

    async sendOurCountTo(sessionId: string) {
        const clientRequest = await classifyServerless.createRequestForSession(sessionId, ClientRequest);
        await clientRequest.setCount(this.count);
    }
}
serializable({ServerResponse})
