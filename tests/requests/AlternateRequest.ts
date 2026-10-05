import {reqBody} from "aws-classify-common";
export class AlternateRequest {
    static interfaceName = 'AlternateRequest';
    async setValue(value: string) { reqBody() }
    async getValue(): Promise<string> { return reqBody() }
}
