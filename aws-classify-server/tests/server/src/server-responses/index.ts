// The stock Lambda functions for HTTPS and WSS
export {responseHandler, webSocketConnect, webSocketDisconnect} from "../aws-classify-server"
import {classifyServerless} from "../aws-classify-server";

import {ServerResponse} from "./ServerResponse";
classifyServerless.registerResponse(ServerResponse);