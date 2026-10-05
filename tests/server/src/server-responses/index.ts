// The stock Lambda functions for HTTPS and WSS
export {responseHandler, webSocketConnect, webSocketDisconnect} from "aws-classify-server"
import {classifyServerless} from "aws-classify-server";

import {ServerResponse} from "./ServerResponse";
classifyServerless.registerResponse(ServerResponse, async (_interface, method) => method !== 'deniedSetCount');
import {AlternateRequest} from "@aws-classify-tests/requests";
import {serializable} from "js-freeze-dry";
class AlternateResponse extends AlternateRequest {
    value = '';
    async setValue(value: string) { this.value = value; }
    async getValue() { return this.value; }
}
serializable({AlternateResponse});
classifyServerless.registerResponse(AlternateResponse);
