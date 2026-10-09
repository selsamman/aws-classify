// The stock Lambda functions for HTTPS and WSS
export {responseHandler, publicResponseHandler, webSocketConnect, webSocketDisconnect} from "aws-classify-server"
import {classifyServerless} from "aws-classify-server";

import {ServerResponse} from "./ServerResponse";
if (!classifyServerless.authenticationEnabled) classifyServerless.registerResponse(ServerResponse, async (_interface, method) => method !== 'deniedSetCount');
import {AlternateRequest} from "@aws-classify-tests/requests";
import {serializable} from "js-freeze-dry";
class AlternateResponse extends AlternateRequest {
    value = '';
    async setValue(value: string) { this.value = value; }
    async getValue() { return this.value; }
}
serializable({AlternateResponse});
if (!classifyServerless.authenticationEnabled) classifyServerless.registerResponse(AlternateResponse);

import './AuthResponse';
import {ClientRequest} from '@aws-classify-tests/requests';
// Invoked only via IAM by the disposable runner; no browser route or browser token.
export const backgroundNotify = async (event: {sessionId: string, value: number}) => {
    const request = await classifyServerless.createRequestForSession(event.sessionId, ClientRequest);
    await request.setCount(event.value);
    return {identity: classifyServerless.getRequestContext()?.identity || null};
};

if (process.env.AWS_CLASSIFY_AUTHENTICATION === 'true') classifyServerless.configureAuthentication({connectionCredentialSeconds: 10});

// Fixture-only route: browser preflight must not require a bearer token.
// Gateway supplies the configured CORS headers; this exposes no dispatch.
export const preflight = async () => ({statusCode: 204, body: ''});
