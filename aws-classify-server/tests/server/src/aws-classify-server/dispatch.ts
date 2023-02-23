import {APIGatewayProxyEvent, Context} from 'aws-lambda';
import {ClassifyServerless} from "./index";
import {serialize} from "js-freeze-dry";
import {getSessionData, saveSessionData} from "./ClassifyServerless";
import {APIGatewayProxyStructuredResultV2} from "aws-lambda/trigger/api-gateway-proxy";

export const classifyServerless = new ClassifyServerless();

export const responseHandler = async (event: APIGatewayProxyEvent, context : Context): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
        //console.log(`dispatching`);
        return {
            statusCode: 200,
            body:  (await classifyServerless.dispatch(event, context)) || "",
        };
    } catch (err : any) {
        //console.log(`request.body = ${event.body}`);
        console.log(`error = ${err.message} ${err.stack}`);
        return {
            statusCode: 200,
            body: serialize({
                data: undefined,
                exception: `Internal Server Error (${err}) - see log at ${new Date()}`,
                cargo: undefined,
                sessionId: undefined
            })
        };
    }
};

export const webSocketConnect = async (event: APIGatewayProxyEvent, _context : Context): Promise<APIGatewayProxyStructuredResultV2> => {
    //console.log('connecting');
    const sessionId = event.headers['Sec-WebSocket-Protocol'] || "";
    const connectId = event.requestContext.connectionId;
    //console.log(JSON.stringify(event));
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
        console.log(`invalid sessionId - webSocketConnect sessionId=${sessionId} connectId=${connectId}`);
        return {
            statusCode: 500,
            body:  'Opps'
        };
    }
};

export const webSocketDisconnect = async (_event: APIGatewayProxyEvent, _context : Context): Promise<APIGatewayProxyStructuredResultV2> => {
    //console.log('Disconnect ' + JSON.stringify(event));
    //console.log(`webSocketDisconnect sessionId=${sessionId} connectId=${connectId}`);

     return {
        statusCode: 200,
        headers: {
            'Sec-WebSocket-Protocol': 'websocket'
        }
    };
};


