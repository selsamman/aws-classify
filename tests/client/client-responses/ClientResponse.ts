import {ClientRequest, TestPayload} from "@aws-classify-tests/requests";

export class ClientResponse extends ClientRequest{
    count = 0;
    payload?: TestPayload;
    setPayload(payload: TestPayload) { this.payload = payload; }
    setCount(count: number) {
        this.count = count;
    }
}
