import {reqBody} from "../aws-classify-common";

export class ServerRequest {
    static interfaceName = 'ServerRequest';
    async setCount (count : number) { reqBody() }
    async getCount () : Promise<number> { return reqBody() }
    async sendCount () { reqBody() }
    async getSessionId() : Promise<string> { return reqBody() }
    async sendCountTo(sessionId : string) { reqBody() }
}