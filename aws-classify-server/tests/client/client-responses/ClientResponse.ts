import {ClientRequest} from "../client-requests/ClientRequest";

export class ClientResponse extends ClientRequest{
    static interfaceName = 'ClientResponse';
    count = 0;
    setCount(count: number) {
        this.count = count;
    }
}
