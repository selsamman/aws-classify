import {HttpEvent} from './Authentication';
import {attachAuthenticatedSocket, detachAuthenticatedSocket} from './AuthenticatedSessions';
import {APIGatewayProxyEvent, Context} from 'aws-lambda';
import {ClassifyServerless} from "./index";
import {serialize} from "js-freeze-dry";
import {getSessionData, saveSessionData} from "./ClassifyServerless";
import {APIGatewayProxyStructuredResultV2} from "aws-lambda/trigger/api-gateway-proxy";

export const classifyServerless = new ClassifyServerless();

const httpHandler = async (event: HttpEvent, context : Context, entry: 'protected' | 'public'): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
        //console.log(`dispatching`);
        return {
            statusCode: 200,
            headers: {'Cache-Control': 'no-store'},
            body:  (await classifyServerless.dispatch(event, context, {}, entry)) || "",
        };
    } catch (err : any) {
        //console.log(`request.body = ${event.body}`);
        console.log('Dispatch failed');
        return {
            statusCode: 200,
            headers: {'Cache-Control': 'no-store'},
            body: serialize({
                data: undefined,
                exception: `Internal Server Error (${err}) - see log at ${new Date()}`,
                cargo: undefined,
                sessionId: undefined
            })
        };
    }
};

export const responseHandler = (event: HttpEvent, context: Context) => httpHandler(event, context, 'protected');
export const publicResponseHandler = (event: HttpEvent, context: Context) => httpHandler(event, context, 'public');

export const webSocketConnect = async (event: APIGatewayProxyEvent, _context : Context): Promise<APIGatewayProxyStructuredResultV2> => {
    //console.log('connecting');
    const sessionId = event.headers['Sec-WebSocket-Protocol'] || event.headers['sec-websocket-protocol'] || "";
    const connectId = event.requestContext.connectionId;
    //console.log(JSON.stringify(event));
    if (classifyServerless.authenticationEnabled) {
        try {
            await attachAuthenticatedSocket(sessionId, connectId || '');
            return {statusCode: 200, headers: {'Sec-WebSocket-Protocol': sessionId}, body: ''};
        } catch { return {statusCode: 403, body: 'Connection refused'}; }
    }
    const result = await getSessionData(sessionId); // Make sure session id passed in is valid
    if (result) {
         // Save connection id
        await saveSessionData(sessionId, undefined,undefined, connectId)
        //console.log(`webSocketConnect session ${sessionId} connected to websocket connectId ${connectId}`);
        return {
            statusCode: 200,
            headers: {
                'Sec-WebSocket-Protocol': sessionId
            },
            body: JSON.stringify({
                msg: connectId,
            })
        };
    } else {
        console.log('Invalid socket session');
        return {
            statusCode: 500,
            body:  'Opps'
        };
    }
};

export const webSocketDisconnect = async (event: APIGatewayProxyEvent, _context : Context): Promise<APIGatewayProxyStructuredResultV2> => {
    if (classifyServerless.authenticationEnabled && event.requestContext.connectionId) await detachAuthenticatedSocket(event.requestContext.connectionId);
    //console.log('Disconnect ' + JSON.stringify(event));
    //console.log(`webSocketDisconnect sessionId=${sessionId} connectId=${connectId}`);

     return {
        statusCode: 200,
        headers: {
            'Sec-WebSocket-Protocol': 'websocket'
        }
    };
};


