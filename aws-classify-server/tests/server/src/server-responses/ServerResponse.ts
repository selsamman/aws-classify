import {ServerRequest} from "../server-requests/ServerRequest";
import {classifyServerless} from "../aws-classify-server";
import {ClientRequest} from "../client-requests/ClientRequest";
import {serializable} from "js-freeze-dry";

// Register request class
classifyServerless.registerRequest(ClientRequest);

export class ServerResponse extends ServerRequest {

    count = 0;

    async setCount (count : number) { this.count = count }

    async getCount () : Promise<number> { return this.count }

    async sendCount () {
        const clientRequest = classifyServerless.createRequest(this, ClientRequest);
        clientRequest.setCount(this.count);
    }

    async getSessionId (): Promise<string> {
        return await classifyServerless.getSessionId(this);
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
