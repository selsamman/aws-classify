import {ClientRequest} from "../client-requests/ClientRequest";

export class ClientResponse extends ClientRequest{
    count = 0;
    setCount(count: number) {
        this.count = count;
    }
}
