"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientResponse = void 0;
const ClientRequest_1 = require("../client-requests/ClientRequest");
class ClientResponse extends ClientRequest_1.ClientRequest {
    constructor() {
        super(...arguments);
        this.count = 0;
    }
    setCount(count) {
        this.count = count;
    }
}
exports.ClientResponse = ClientResponse;
ClientResponse.interfaceName = 'ClientResponse';
