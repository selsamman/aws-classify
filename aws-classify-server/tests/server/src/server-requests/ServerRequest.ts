import {reqBody} from "../aws-classify-common";

export class ServerRequest {
    static interfaceName = 'ServerRequest';
    async setCount (count : number) { reqBody() }
    async getCount () : Promise<number> { return reqBody() }
    async sendCount () { reqBody() }
    async getSessionId() : Promise<string> { return reqBody() }
    async getSessionsForUser(user : string) : Promise<Array<string>> { return reqBody() }
    async getSessions() : Promise<Array<string>> { return reqBody() }
    async clearSessionsForUser(user : string) {reqBody()}
    async setUserId(user : string) {reqBody()}
    async clearSessions() {reqBody()}
    async sendCountTo(sessionId : string) { reqBody() }
    async sendOurCountTo(sessionId : string) { reqBody() }
}