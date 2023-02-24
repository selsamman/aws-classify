"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerRequest = void 0;
const aws_classify_common_1 = require("../aws-classify-common");
class ServerRequest {
    async setCount(count) { (0, aws_classify_common_1.reqBody)(); }
    async getCount() { return (0, aws_classify_common_1.reqBody)(); }
    async sendCount() { (0, aws_classify_common_1.reqBody)(); }
    async getSessionId() { return (0, aws_classify_common_1.reqBody)(); }
    async sendCountTo(sessionId) { (0, aws_classify_common_1.reqBody)(); }
}
exports.ServerRequest = ServerRequest;
ServerRequest.interfaceName = 'ServerRequest';
