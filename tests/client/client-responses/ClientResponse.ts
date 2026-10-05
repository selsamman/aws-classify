import {ClientRequest} from "@aws-classify-tests/requests";

export class ClientResponse extends ClientRequest{
    count = 0;
    setCount(count: number) {
        this.count = count;
    }
}
