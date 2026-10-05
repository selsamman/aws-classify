import {TestPayload} from "./TestPayload";
import {reqBody} from "aws-classify-common";

export class ServerRequest {
    async fail() { reqBody() }
    async deniedSetCount(count: number) { reqBody() }
    async echo(payload: TestPayload, extra: unknown): Promise<unknown> { return reqBody() }
    async setPayload(payload: TestPayload) { reqBody() }
    async getPayload(): Promise<TestPayload> { return reqBody() }
    async sendPayload() { reqBody() }
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
