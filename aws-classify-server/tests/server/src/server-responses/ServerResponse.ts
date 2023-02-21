import {ServerRequest} from "../server-requests/ServerRequest";
import {classifyServerless} from "../aws-classify-server";
import {ClientRequest} from "../client-requests/ClientRequest";

// Register request class
classifyServerless.registerRequest(ClientRequest);

export class ServerResponse extends ServerRequest {

    count = 0;

    async setCount (count : number) { this.count = count }

    async getCount () : Promise<number> { return this.count }

    async sendCount () {
        classifyServerless.createRequest(this, ClientRequest).setCount(this.count);
    }

    async getSessionId (): Promise<string> {
        return await classifyServerless.getSessionId(this);
    }

    async sendCountTo(sessionId: string) {
        await classifyServerless.createResponse(ServerResponse, sessionId, async serverResponse => {
            await classifyServerless.createRequest(serverResponse, ClientRequest).setCount(this.count);
        })
    }
}