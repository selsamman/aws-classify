import {reqBody} from "../aws-classify-common";

export class ClientRequest {
    static interfaceName = 'ClientRequest';
    setCount(count : number) {reqBody()}
}
