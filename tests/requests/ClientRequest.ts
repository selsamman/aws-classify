import {TestPayload} from "./TestPayload";
import {reqBody} from "aws-classify-common";

export class ClientRequest {
    static interfaceName = 'ClientRequest';
    setPayload(payload: TestPayload) { reqBody() }
    setCount(count : number) {reqBody()}
}
