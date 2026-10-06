// Test-only Cognito provisioning and tokens; production aws-classify never issues/verifies JWTs.
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const {CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, InitiateAuthCommand, DescribeUserPoolClientCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {ApiGatewayV2Client, GetStageCommand, UpdateStageCommand} = require('@aws-sdk/client-apigatewayv2');
const {LambdaClient, InvokeCommand} = require('@aws-sdk/client-lambda');
const {DynamoDBDocument} = require('@aws-sdk/lib-dynamodb');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {serialize, deserialize} = require('js-freeze-dry');
const {ClassifyClient} = require('aws-classify-client');
const WebSocket = require('ws');
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); // expected values in tests only
async function runAuthentication({outputs: o, region, signal, log, onCheck = () => {}}) {
    const cognito = new CognitoIdentityProviderClient({region}), lambda = new LambdaClient({region}), rawDb = new DynamoDBClient({region});
    const db = DynamoDBDocument.from(rawDb), gateway = new ApiGatewayV2Client({region});
    const sockets = new Set(), checks = [];
    const password = `Aa1!${randomBytes(24).toString('hex')}`;
    const wait = ms => delay(ms, undefined, {signal});
    const test = async (name, fn) => { signal.throwIfAborted(); await fn(); checks.push(name); onCheck(name); log(`Authentication: ${name} passed`); };
    async function user(pool, username) {
        await cognito.send(new AdminCreateUserCommand({UserPoolId: pool, Username: username, MessageAction: 'SUPPRESS'}));
        await cognito.send(new AdminSetUserPasswordCommand({UserPoolId: pool, Username: username, Password: password, Permanent: true}));
    }
    async function login(client, username) {
        return (await cognito.send(new InitiateAuthCommand({ClientId: client, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: {USERNAME: username, PASSWORD: password}}))).AuthenticationResult;
    }
    async function call(api, method, token, sessionId = '', args = [], path = '', extra = {}) {
        const response = await fetch(api + path, {method: 'POST', headers: {'Content-Type': 'text/plain', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: serialize({interfaceName: method === '$authorize' ? '$WebSocket' : 'AuthRequest', methodName: method, sessionId, args, ...extra}), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])});
        const body = await response.text();
        return {status: response.status, headers: response.headers, body: response.status === 200 ? deserialize(body) : undefined};
    }
    async function ok(api, method, token, session = '', args = [], path = '') {
        const r = await call(api, method, token, session, args, path);
        assert.equal(r.status, 200); assert.equal(r.body.exception, undefined); assert.ok(!/hit/i.test(r.headers.get('x-cache') || ''));
        return r.body;
    }
    async function refused(api, method, token, session = '', args = [], path = '') {
        const r = await call(api, method, token, session, args, path);
        assert.ok(r.status === 401 || r.status === 403 || (r.status === 200 && r.body.exception), 'Request must be refused');
    }
    async function connect(credential, shouldOpen = true) {
        const socket = new WebSocket(o.TestWebSocketUrl, [credential]); sockets.add(socket);
        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { socket.terminate(); reject(new Error('Socket handshake deadline')); }, 15000);
            socket.once('open', () => {clearTimeout(timer); resolve(true);});
            socket.once('error', () => {clearTimeout(timer); resolve(false);});
        });
        assert.equal(result, shouldOpen, shouldOpen ? 'Socket should open' : 'Credential should be rejected');
        return socket;
    }
    async function close(socket) {
        if (socket.readyState === WebSocket.CLOSED) return;
        await new Promise(resolve => { socket.once('close', resolve); socket.close(); });
        sockets.delete(socket);
    }
    async function receive(socket, action, value) {
        let timer;
        const message = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Notification deadline')), 10000);
            socket.once('message', data => resolve(deserialize(data.toString())));
        });
        try {const [payload] = await Promise.all([message, action()]); assert.deepEqual(payload.args, [value]);}
        finally {clearTimeout(timer);}
    }
    try {
        const ApiId = new URL(o.TestWebSocketUrl).hostname.split('.')[0], StageName = new URL(o.TestWebSocketUrl).pathname.slice(1);
        // Older in-flight fixture packages used Serverless's tracing default. Disable before ANY credentials are sent.
        await gateway.send(new UpdateStageCommand({ApiId, StageName, DefaultRouteSettings:{DataTraceEnabled:false}}));
        const stage = await gateway.send(new GetStageCommand({ApiId,StageName}));
        assert.equal(stage.DefaultRouteSettings.DataTraceEnabled,false);
        await user(o.AuthUserPoolId, 'alice'); await user(o.AuthUserPoolId, 'bob'); await user(o.WrongIssuerPoolId, 'other');
        const {runManagedBrowser} = require('./managed-browser-test');
        await runManagedBrowser({outputs:o,region,password,signal,log,onCheck:name => {checks.push(name);onCheck(name);}});
        let alice = await login(o.AuthUserClientId, 'alice'), bob = await login(o.AuthUserClientId, 'bob');
        const expiring = alice.AccessToken;
        const wrongAudience = (await login(o.WrongAudienceClientId, 'alice')).AccessToken;
        const wrongIssuer = (await login(o.WrongIssuerClientId, 'other')).AccessToken;
        const machine = (await cognito.send(new DescribeUserPoolClientCommand({UserPoolId: o.AuthUserPoolId, ClientId: o.AuthMachineClientId}))).UserPoolClient;
        async function machineToken(scope) {
            const response = await fetch(o.AuthTokenUrl, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${machine.ClientId}:${machine.ClientSecret}`).toString('base64')}`}, body: new URLSearchParams({grant_type: 'client_credentials', scope}), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])});
            assert.equal(response.status, 200, 'Cognito OAuth issuance succeeds');
            const token = (await response.json()).access_token; assert.ok(token); return token;
        }
        let invoke = await machineToken('fixture/invoke'), missingScope = await machineToken('fixture/other');
        // Wrong issuer has an allowed audience in the fixture, isolating issuer enforcement.
        assert.equal(claims(wrongIssuer).client_id, o.WrongIssuerClientId);
        for (const [label, api] of [['direct', o.TestApiUrl], ['cloudfront', `https://${o.WebsiteUrl}/api/dispatch`]]) {
            if (claims(invoke).exp*1000 < Date.now()+60000) invoke = await machineToken('fixture/invoke');
            if (claims(missingScope).exp*1000 < Date.now()+60000) missingScope = await machineToken('fixture/other');
            assert.ok(claims(missingScope).exp*1000 > Date.now());
            const a = () => alice.AccessToken, b = () => bob.AccessToken;
            let session, publicSession;
            await test(`${label}: trusted identity and scopes`, async () => {
                const result = await ok(api, 'inspect', a()); session = result.sessionId;
                assert.equal(result.data.identity.subject, claims(a()).sub); assert.equal(result.data.identity.issuer, claims(a()).iss);
                assert.ok(result.data.identity.scopes.includes('aws.cognito.signin.user.admin')); assert.equal(result.data.hasAdmin, true);
                assert.equal(result.data.identity.claims.token_use, 'access');
                await ok(api, 'setValue', a(), session, [7]);
            });
            const parts = a().split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
            for (const [name, token] of [['anonymous', undefined], ['malformed', 'not-a-token'], ['invalid signature', parts.join('.')], ['wrong issuer', wrongIssuer], ['wrong client', wrongAudience], ['missing scope', missingScope], ['ID token', alice.IdToken]]) {
                await test(`${label}: rejects ${name} before mutation`, async () => {
                    const r = await call(api, 'setValue', token, session, [999]); assert.ok([401,403].includes(r.status));
                    assert.equal((await ok(api, 'getValue', a(), session)).data, 7);
                });
            }
            await test(`${label}: route scope OR behavior`, async () => {
                assert.equal((await ok(api, 'inspect', invoke)).data.hasInvoke, true);
                assert.equal((await ok(api, 'inspect', a())).data.hasAdmin, true);
            });
            await test(`${label}: public and protected dispatch categories`, async () => {
                const r = await ok(api, 'inspectPublic', undefined, '', [], '/public'); publicSession = r.sessionId;
                assert.equal(r.data.identity, undefined); assert.equal(r.data.hasAdmin, false);
                await refused(api, 'setValue', a(), session, [100], '/public');
                await refused(api, 'inspectPublic', a(), session);
                await refused(api, 'hiddenPublic', undefined, '', [], '/public');
                await refused(api, 'constructor', a()); await refused(api, 'toString', a());
                await refused(api, '$authorize', a(), session, [], '/public');
                assert.equal((await ok(api, 'getValue', a(), session)).data, 7);
            });
            await test(`${label}: forged payload identity and dispatch flags are ignored`, async () => {
                const r = await call(api, 'inspect', a(), session, [], '', {identity:{subject:'bob', issuer:'forged', scopes:['fixture/never']}, dispatch:'public', requestContext:{authorizer:{jwt:{claims:{sub:'bob',iss:'forged'},scopes:['fixture/never']}}}});
                assert.equal(r.status,200); assert.equal(r.body.exception,undefined); assert.equal(r.body.data.identity.subject,claims(a()).sub);
                await refused(api,'setValue',a(),session,[999],'/public?dispatch=protected');
                assert.equal((await ok(api,'getValue',a(),session)).data,7);
            });
            await test(`${label}: legacy fixture management interface is not exposed`, async () => {
                const r=await fetch(api,{method:'POST',headers:{'Content-Type':'text/plain',Authorization:`Bearer ${a()}`},body:serialize({interfaceName:'ServerRequest',methodName:'sendCountTo',sessionId:session,args:[session]}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
                assert.equal(r.status,200); assert.match(deserialize(await r.text()).exception,/No Response defined/);
                assert.equal((await ok(api,'getValue',a(),session)).data,7);
            });
            await test(`${label}: scope policy denies without mutation`, async () => {
                await refused(api, 'hookDenied', a(), session); const denied = await call(api, 'memberDenied', a(), session); assert.equal(denied.status,200); assert.equal(denied.body.exception,'Application scope denied');
                assert.equal((await ok(api, 'getValue', a(), session)).data, 7);
            });
            await test(`${label}: sequential context isolation and session ownership`, async () => {
                const other = await ok(api, 'inspect', b()); assert.equal(other.data.identity.subject, claims(b()).sub);
                const own = await ok(api, 'inspect', a(), session); assert.equal(own.data.identity.subject, claims(a()).sub);
                const pub = await ok(api, 'inspectPublic', a(), publicSession, [{identity: {subject: 'forged'}, scopes: ['fixture/never']}], '/public'); assert.equal(pub.data.identity, undefined);
                await refused(api, 'inspect', b(), session); await refused(api, '$authorize', b(), session);
                await refused(api, 'inspectPublic', undefined, session, [], '/public'); await refused(api, 'inspect', a(), publicSession);
                await ok(api, 'reassociate', a(), session, [claims(b()).sub]); await refused(api, 'getValue', b(), session);
                const saved = (await db.get({TableName: o.TestSessionTable, Key: {sessionId: session}, ConsistentRead: true})).Item;
                assert.equal(saved.authOwner, JSON.stringify([claims(a()).iss, claims(a()).sub]));
                assert.ok(!saved.interface_AuthRequest.includes('identity') && !saved.interface_AuthRequest.includes('scopes'));
            });
            await test(`${label}: unowned legacy session cannot be claimed`, async () => {
                const id = `legacy-${randomBytes(8).toString('hex')}`;
                await db.put({TableName: o.TestSessionTable, Item: {sessionId: id, expires: Math.floor(Date.now()/1000)+86400, updated: Date.now()}});
                await refused(api, 'inspect', a(), id); await refused(api, '$authorize', a(), id);
            });
            await test(`${label}: expired owned session cannot dispatch or attach`, async () => {
                const issued = await ok(api,'$authorize',a());
                await db.update({TableName:o.TestSessionTable,Key:{sessionId:issued.sessionId},UpdateExpression:'SET expires = :past',ExpressionAttributeValues:{':past':Math.floor(Date.now()/1000)-1}});
                try {
                    await refused(api,'inspect',a(),issued.sessionId);
                    await connect(issued.data.credential,false);
                } finally {await db.delete({TableName:o.TestSessionTable,Key:{sessionId:issued.sessionId}});}
            });
            let credential;
            await test(`${label}: socket attachment, replay and wrong-session rejection`, async () => {
                credential = (await ok(api, '$authorize', a(), session)).data;
                await connect(session, false); await connect('malformed', false);
                const other = (await ok(api, '$authorize', b())).data;
                await connect(`ac1.${other.credential.split('.')[1]}.${credential.credential.split('.')[2]}`, false);
                const socket = await connect(credential.credential);
                await connect(credential.credential, false);
                await receive(socket, () => ok(api, 'notify', a(), session), 7); await close(socket);
            });
            await test(`${label}: expiry checked without TTL deletion`, async () => {
                const expired = (await ok(api, '$authorize', a(), session)).data;
                await wait(Math.max(1, expired.expiresAt*1000 - Date.now()+1100));
                await connect(expired.credential, false);
                const saved = (await db.get({TableName: o.TestSessionTable, Key: {sessionId: session}, ConsistentRead: true})).Item;
                assert.ok(saved.credentialHash); // TTL hasn't removed the session; explicit expiry refused it.
            });
            await test(`${label}: concurrent credential consumption has one winner`, async () => {
                const c = (await ok(api, '$authorize', a(), session)).data;
                const opened = await Promise.all([0,1].map(async () => {
                    const ws = new WebSocket(o.TestWebSocketUrl, [c.credential]); sockets.add(ws);
                    const result = await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {ws.terminate(); reject(new Error('Concurrent handshake deadline'));}, 15000);
                        ws.once('open', () => {clearTimeout(timer); resolve(true);}); ws.once('error', () => {clearTimeout(timer); resolve(false);});
                    }); return {ws, result};
                }));
                assert.equal(opened.filter(r => r.result).length, 1);
                for (const r of opened) if (r.result) await close(r.ws);
            });
            await test(`${label}: refreshed credentials, reconnect races and trusted producer`, async () => {
                const stale = (await ok(api, '$authorize', a(), session)).data;
                const fresh = (await ok(api, '$authorize', a(), session)).data;
                await connect(stale.credential, false); const oldSocket = await connect(fresh.credential);
                const next = (await ok(api, '$authorize', a(), session)).data; const newSocket = await connect(next.credential);
                let leaked = false; oldSocket.on('message', () => {leaked = true;});
                await close(oldSocket); await wait(1000);
                await receive(newSocket, async () => {
                    const result = await lambda.send(new InvokeCommand({FunctionName: o.BackgroundNotifyName, Payload: Buffer.from(JSON.stringify({sessionId: session, value: 42}))}));
                    assert.equal(result.FunctionError, undefined); assert.equal(JSON.parse(Buffer.from(result.Payload).toString()).identity, null);
                }, 42);
                assert.equal(leaked, false); assert.equal((await ok(api, 'getValue', a(), session)).data, 7);
                await close(newSocket);
                const deadline = Date.now()+10000;
                while (true) {
                    const saved = (await db.get({TableName: o.TestSessionTable, Key: {sessionId: session}, ConsistentRead: true})).Item;
                    if (!saved.connectionId) break; assert.ok(Date.now()<deadline, 'Disconnect removes current connection'); await wait(200);
                }
                await refused(api, 'notify', a(), session);
            });
            await test(`${label}: notifications isolate two authenticated recipients`, async () => {
                const aliceCredential = (await ok(api,'$authorize',a(),session)).data;
                const bobSession = (await ok(api,'inspect',b())).sessionId;
                await ok(api,'setValue',b(),bobSession,[17]);
                const bobCredential = (await ok(api,'$authorize',b(),bobSession)).data;
                const sa = await connect(aliceCredential.credential), sb = await connect(bobCredential.credential);
                let aliceReceived=0,bobReceived=0; sa.on('message',() => aliceReceived++); sb.on('message',() => bobReceived++);
                await receive(sa, () => ok(api,'notify',a(),session),7); await wait(200);
                assert.equal(aliceReceived,1); assert.equal(bobReceived,0);
                await receive(sb, () => ok(api,'notify',b(),bobSession),17); await wait(200);
                assert.equal(aliceReceived,1); assert.equal(bobReceived,1);
                await close(sa); await close(sb);
            });
            await test(`${label}: client token callback and separate public session`, async () => {
                global.WebSocket = WebSocket;
                class Request {static interfaceName = 'AuthRequest'; async inspect() {} async inspectPublic() {}}
                let clientSession = '', reads = 0;
                const client = new ClassifyClient(async () => clientSession, async id => {clientSession=id;}, api, {publicSuffix:'Public', getAccessToken: async () => {reads++; return a();}});
                client.setLogger(() => {}); const request = client.createRequest(Request);
                assert.equal((await request.inspect()).identity.subject, claims(a()).sub); const protectedSession = clientSession;
                assert.equal((await request.inspectPublic()).identity, undefined); assert.equal(clientSession, protectedSession); assert.equal(reads, 1);
                assert.equal(await client.initSocket(), true); sockets.add(client.socket); assert.equal(reads, 2); await close(client.socket);
            });
            // Cognito's minimum access-token lifetime is five minutes. Expiry is genuine, not payload editing.
            await test(`${label}: genuinely expired token`, async () => {
                const remaining = claims(expiring).exp*1000 - Date.now() + 1100;
                if (remaining > 0) {log(`Waiting ${Math.ceil(remaining/1000)} seconds for a real Cognito token to expire…`); await wait(remaining);}
                const r = await call(api, 'setValue', expiring, session, [999]); assert.ok([401,403].includes(r.status));
                alice = await login(o.AuthUserClientId, 'alice'); bob = await login(o.AuthUserClientId, 'bob');
                assert.equal((await ok(api, 'getValue', a(), session)).data, 7);
            });
        }
        return {result:'passed', count:checks.length, checks};
    } finally {
        for (const socket of sockets) socket.terminate();
        cognito.destroy(); lambda.destroy(); rawDb.destroy(); gateway.destroy();
    }
}
module.exports = {runAuthentication};
