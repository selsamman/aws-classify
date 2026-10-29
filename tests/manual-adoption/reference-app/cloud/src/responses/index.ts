export { responseHandler, publicResponseHandler, webSocketConnect, webSocketDisconnect } from 'aws-classify-server';
import { classifyServerless } from 'aws-classify-server';
import { DiagnosticClientRequest } from '@aws-classify-docs/requests';
import { DiagnosticResponse } from './DiagnosticResponse.js';

classifyServerless.registerRequest(DiagnosticClientRequest);
classifyServerless.registerResponse(DiagnosticResponse, async (_response, method, _args, context) => {
  // Smallest policy: the API authorizer establishes identity; only publicPingPublic is anonymous.
  // Other application members require the trusted context supplied by the framework.
  return method === 'publicPingPublic' || context?.offline === true || Boolean(context?.identity);
}, { publicMethods: ['publicPingPublic'] });
