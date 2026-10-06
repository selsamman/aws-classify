/** @jest-environment node */
import {createServer, Server} from 'node:http';
import {createHash, webcrypto} from 'node:crypto';
import {AddressInfo} from 'node:net';
import {exportJWK, generateKeyPair, SignJWT} from 'jose';
import {InMemoryWebStorage} from 'oidc-client-ts';
import {ClassifyClient, AuthorizationRequest} from 'aws-classify-client';
import {serialize} from 'js-freeze-dry';
import axios from 'axios';
jest.mock('axios');
const post = axios.post as jest.Mock;
class Request {static interfaceName = 'Lifecycle'; async inspect(): Promise<any> {} async inspectPublic(): Promise<any> {}}
const deferred = () => {let resolve!: (value?: any) => void; const promise = new Promise<any>(r => {resolve=r;}); return {promise, resolve};};
let server: Server, issuer: string, privateKey: any, jwk: any;
let code = 0, subject: string, nonce: string, challenge: string, tokenCalls: number, refreshCalls: number;
let tokenGate: ReturnType<typeof deferred> | undefined;
let tokenStarted: ReturnType<typeof deferred>;
let fault: string;
let refreshTokens: Set<string>;
let storage: InMemoryWebStorage;
let session: string;
let saved: string[];
let c: ClassifyClient;
function cacheKey(suffix: string): string {
    for (let i=0; i<storage.length; i++) {const key=storage.key(i)!; if (key.endsWith(suffix)) return key;}
    throw new Error('Private cache missing');
}
function expire() {const key=cacheKey('credentials'); const value=JSON.parse(storage.getItem(key)!); value.expiresAt=0; storage.setItem(key,JSON.stringify(value));}
function client(set = async (id: string) => {session=id; saved.push(id);}) {
    const client = new ClassifyClient(async () => session, set, issuer+'/api/dispatch', {publicSuffix:'Public', managed:{issuer, clientId:'browser', redirectUri:issuer+'/return', scopes:['openid','api/invoke']}});
    client.setLogger(() => {}); return client;
}
async function start(): Promise<{request: AuthorizationRequest; callback: string}> {
    const request = await c.beginLogin();
    nonce=request.parameters.nonce; challenge=request.parameters.code_challenge;
    return {request, callback:`${issuer}/return?state=${request.parameters.state}&code=code-${++code}`};
}
async function login() {const {callback}=await start(); await c.completeLogin(callback); return callback;}
beforeAll(async () => {
    const keys = await generateKeyPair('RS256'); privateKey=keys.privateKey; jwk={...await exportJWK(keys.publicKey),kid:'fixture'};
    server=createServer(async (req,res) => {
        const json=(status: number, body: any) => {res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(body));};
        if (req.url?.endsWith('/.well-known/openid-configuration')) return json(200,{issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/keys'});
        if (req.url==='/keys') return json(200,{keys:[jwk]});
        if (req.url!=='/token') return json(404,{});
        let body=''; for await (const chunk of req) body+=chunk;
        const params=new URLSearchParams(body); tokenCalls++;
        const refreshing=params.get('grant_type')==='refresh_token'; if (refreshing) refreshCalls++;
        tokenStarted.resolve(); if (tokenGate) await tokenGate.promise;
        if (fault==='exchange' || (refreshing && !refreshTokens.delete(params.get('refresh_token')!))) return json(400,{error:'invalid_grant'});
        if (!refreshing && createHash('sha256').update(params.get('code_verifier')||'').digest('base64url')!==challenge) return json(400,{error:'invalid_grant'});
        const refreshToken=`refresh-${tokenCalls}`; refreshTokens.add(refreshToken);
        const jwt=await new SignJWT({nonce:fault==='nonce'?'wrong':nonce})
            .setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(fault==='issuer'?issuer+'/wrong':issuer)
            .setAudience(fault==='audience'?'wrong':'browser').setSubject(fault==='subject'?'other':subject)
            .setIssuedAt().setExpirationTime(fault==='expiry'?'-60s':'5m').sign(privateKey);
        json(200,{access_token:`access-${tokenCalls}`,token_type:'Bearer',expires_in:300,refresh_token:refreshToken,
            ...(refreshing && fault==='omit-id' ? {} : {id_token: fault==='signature' ? jwt.slice(0,-8)+'tampered' : jwt}),scope:'openid api/invoke'});
    });
    await new Promise<void>((resolve, reject) => {server.once('error', reject);server.listen(0,'127.0.0.1',resolve);}); issuer=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
});
afterAll(async () => {await new Promise<void>(resolve => server.close(() => resolve())); delete (globalThis as any).window;});
beforeEach(() => {
    storage=new InMemoryWebStorage(); (globalThis as any).window={sessionStorage:storage};
    session='old'; saved=[]; subject='alice'; nonce=''; challenge=''; tokenCalls=0; refreshCalls=0; fault=''; refreshTokens=new Set(); tokenGate=undefined; tokenStarted=deferred();
    post.mockReset().mockResolvedValue({data:serialize({sessionId:'owned',data:42,cargo:'cargo'})}); c=client();
});
it('uses real OIDC code exchange with state, nonce, S256 and a tab-persisted transaction',async () => {
    const {request,callback}=await start(); expect(request.parameters).toMatchObject({response_type:'code',code_challenge_method:'S256',client_id:'browser',redirect_uri:issuer+'/return'});
    expect(saved).toEqual(['']); expect(storage.getItem(cacheKey('transaction'))).not.toContain('accessToken');
    c=client(); await c.completeLogin(callback); expect(await c.createRequest(Request).inspect()).toBe(42);
    expect(post.mock.calls[0][2].headers.Authorization).toBe('Bearer access-1');
    expect(post.mock.calls[0][1]).not.toContain('refresh-'); expect(tokenCalls).toBe(1);
});
it('retains credentials across reload reconstruction without returning tokens as login results',async () => {
    expect(await login()).toContain('code='); c=client(); await c.createRequest(Request).inspect(); expect(tokenCalls).toBe(1);
});
it.each(['nonce','issuer','audience','signature','expiry'])('rejects invalid ID token %s',async value => {
    const {callback}=await start(); fault=value; await expect(c.completeLogin(callback)).rejects.toThrow();
    await expect(c.createRequest(Request).inspect()).rejects.toThrow(); expect(post).not.toHaveBeenCalled();
});
it.each(['state','url','fragment','duplicate','missing-code','error','expired','missing'])('consumes failed callback %s without exchanging',async value => {
    let {callback}=await start();
    if(value==='state') callback=callback.replace(/state=[^&]+/,'state=wrong');
    if(value==='url') callback=callback.replace('/return?','/other?');
    if(value==='fragment') callback+='#code=bad';
    if(value==='duplicate') callback+='&code=another';
    if(value==='missing-code') callback=callback.replace(/&code=.*/,'');
    if(value==='error') callback=callback.replace(/code=.*/,'error=access_denied');
    if(value==='expired') {const key=cacheKey('transaction'), tx=JSON.parse(storage.getItem(key)!);tx.created=Date.now()-601000;storage.setItem(key,JSON.stringify(tx));}
    if(value==='missing') storage.clear();
    await expect(c.completeLogin(callback)).rejects.toThrow(); expect(tokenCalls).toBe(0);
    await expect(c.completeLogin(callback)).rejects.toThrow();
});
it('refuses code reuse and a bad PKCE verifier',async () => {
    const callback=await login(); await expect(c.completeLogin(callback)).rejects.toThrow(); expect(tokenCalls).toBe(1);
    const next=await start(); challenge='incorrect'; await expect(c.completeLogin(next.callback)).rejects.toThrow();
});
it('shares refresh and retains rotated refresh credentials',async () => {
    await login(); expire(); tokenGate=deferred(); tokenStarted=deferred();
    const request=c.createRequest(Request), first=request.inspect(), second=request.inspect(); await tokenStarted.promise; tokenGate.resolve();
    await Promise.all([first,second]); expect(refreshCalls).toBe(1);
    expire(); await request.inspect(); expect(refreshCalls).toBe(2);
});
it('accepts refresh without a new ID token, and refuses refresh account changes',async () => {
    await login(); expire(); fault='omit-id'; await c.createRequest(Request).inspect();
    expire(); fault='subject'; await expect(c.createRequest(Request).inspect()).rejects.toThrow('Login required'); expect(session).toBe('');
});
it('fails closed on refresh failure and retains public activity',async () => {
    await login(); expire(); fault='exchange'; const request=c.createRequest(Request);
    await expect(request.inspect()).rejects.toThrow('Login required'); expect(post).not.toHaveBeenCalled();
    expect(await request.inspectPublic()).toBe(42); expect(post.mock.calls[0][2].headers.Authorization).toBeUndefined();
});
it('logout immediately cancels a pending refresh and does not restore credentials',async () => {
    await login(); expire(); tokenGate=deferred(); tokenStarted=deferred();
    const pending=c.createRequest(Request).inspect(); await tokenStarted.promise; await c.logout(); tokenGate.resolve();
    await expect(pending).rejects.toThrow('Authentication changed'); expect(storage.length).toBe(0); expect(post).not.toHaveBeenCalled();
});
it('logout cancels login completion; late credentials cannot replace a newer account',async () => {
    const {callback}=await start(); tokenGate=deferred(); const pending=c.completeLogin(callback); await tokenStarted.promise;
    await c.logout(); tokenGate.resolve(); await expect(pending).rejects.toThrow('Authentication changed');
    expect(storage.length).toBe(0); tokenGate=undefined; subject='bob'; await login(); await c.createRequest(Request).inspect(); expect(session).toBe('owned');
});
it('starting another login cancels late completion without clearing the new transaction',async () => {
    const {callback}=await start(); tokenGate=deferred(); const pending=c.completeLogin(callback); await tokenStarted.promise;
    const next=await start(); tokenGate.resolve(); await expect(pending).rejects.toThrow();
    tokenGate=undefined; await c.completeLogin(next.callback); await c.createRequest(Request).inspect();
});
it('logout cancels HTTP results and cargo and clears after an already-started session save',async () => {
    await login(); const response=deferred(); post.mockReturnValueOnce(response.promise); const listener=jest.fn(); c.setListener(listener);
    const pending=c.createRequest(Request).inspect(); for(let i=0;i<20 && !post.mock.calls.length;i++) await Promise.resolve();
    await c.logout(); response.resolve({data:serialize({sessionId:'stale',data:42,cargo:'stale'})});
    await expect(pending).rejects.toThrow('Authentication changed'); expect(listener).not.toHaveBeenCalled(); expect(session).toBe('');
    await login(); const gate=deferred(), entered=deferred();
    c=client(async id => {if(id) {entered.resolve();await gate.promise;} session=id;});
    const saving=c.createRequest(Request).inspect(); await entered.promise; const logout=c.logout(); gate.resolve();
    await expect(saving).rejects.toThrow('Authentication changed'); await logout; expect(session).toBe('');
});
it('returns the provider ID-token hint once, keeps public calls, and starts a fresh session for another account',async () => {
    await login(); await c.createRequest(Request).inspect(); expect((await c.logout()).idTokenHint).toMatch(/^[^.]+\.[^.]+\./);
    expect((await c.logout()).idTokenHint).toBeUndefined(); await c.createRequest(Request).inspectPublic();
    subject='bob'; await login(); post.mockClear(); await c.createRequest(Request).inspect(); expect(post.mock.calls[0][1]).not.toContain('owned');
});
it('surfaces cleanup failure while protected requests remain disabled; repeated logout retries',async () => {
    await login(); c=client(async () => {throw new Error('storage failure');});
    await expect(c.logout()).rejects.toThrow('storage failure'); await expect(c.createRequest(Request).inspect()).rejects.toThrow();
    c.setSession=async id => {session=id;}; await c.logout(); expect(session).toBe('');
});
it('rejects ambiguous credential ownership and invalid managed configuration',() => {
    expect(() => new ClassifyClient(async()=>'',async()=>{},undefined,{publicSuffix:'Public',getAccessToken:()=>'',managed:{}} as any)).toThrow('exactly one');
    expect(() => new ClassifyClient(async()=>'',async()=>{},undefined,{publicSuffix:'Public',managed:{issuer,clientId:'browser',redirectUri:issuer+'/return',scopes:['api']}})).toThrow('openid');
});
it('logout cancels socket authorization and ignores stale open/message/close events',async () => {
    await login(); const native=global.WebSocket;
    class Socket extends EventTarget {
        static instance: Socket;
        onerror?: () => void;
        closed=false;
        constructor() {super();Socket.instance=this;}
        close() {this.closed=true;this.dispatchEvent(new Event('close'));}
    }
    global.WebSocket=Socket as any;
    try {
        const authorization=deferred(); post.mockReturnValueOnce(authorization.promise);
        const pending=c.initSocket(); for(let i=0;i<30&&!post.mock.calls.length;i++) await Promise.resolve(); await c.logout();
        authorization.resolve({data:serialize({sessionId:'late',data:{url:'ws://fixture',credential:'secret'}})});
        await expect(pending).rejects.toThrow('Authentication changed'); expect(c.socket).toBeUndefined(); expect(c.socketRequested).toBe(false);
        await login(); post.mockResolvedValue({data:serialize({sessionId:'owned',data:{url:'ws://fixture',credential:'secret'}})});
        const connect=jest.fn(), disconnect=jest.fn(), message=jest.fn(); c.onConnect(connect);c.onDisconnect(disconnect);c.messageCallback['Lifecycle.notify']=message;
        const opening=c.initSocket(); for(let i=0;i<50&&!Socket.instance;i++) await Promise.resolve(); const socket=Socket.instance;
        await c.logout(); socket.dispatchEvent(new Event('open'));socket.dispatchEvent(new MessageEvent('message',{data:serialize({interfaceName:'Lifecycle',methodName:'notify',args:[],sessionId:'owned'})}));socket.dispatchEvent(new Event('close'));
        await expect(opening).rejects.toThrow('Authentication changed'); expect(socket.closed).toBe(true);expect(connect).not.toHaveBeenCalled();expect(disconnect).not.toHaveBeenCalled();expect(message).not.toHaveBeenCalled();expect(c.socket).toBeUndefined();
    } finally {global.WebSocket=native;}
});
it('logout while reading an external token prevents protected transport and allows public calls',async () => {
    const token=deferred(); c=new ClassifyClient(async()=>'',async()=>{},issuer+'/api/dispatch',{publicSuffix:'Public',getAccessToken:()=>token.promise});c.setLogger(()=>{});
    const request=c.createRequest(Request), pending=request.inspect(); for(let i=0;i<20;i++) await Promise.resolve(); await c.logout();token.resolve('late');
    await expect(pending).rejects.toThrow('Authentication changed');expect(post).not.toHaveBeenCalled();await request.inspectPublic();
});
it('requires login when refresh is unavailable and rejects expired refresh grants',async () => {
    await login(); const key=cacheKey('credentials');const value=JSON.parse(storage.getItem(key)!);delete value.refreshToken;value.expiresAt=0;storage.setItem(key,JSON.stringify(value));
    await expect(c.createRequest(Request).inspect()).rejects.toThrow('Login required');expect(post).not.toHaveBeenCalled();
    await login();expire();refreshTokens.clear();await expect(c.createRequest(Request).inspect()).rejects.toThrow('Login required');
});
it('keeps new browser tabs independent and shares cancellation within the same tab',async () => {
    await login(); const first=c;const second=client();await second.logout();await expect(first.createRequest(Request).inspect()).rejects.toThrow();
    const originalStorage=storage;storage=new InMemoryWebStorage();(globalThis as any).window={sessionStorage:storage};c=client();
    await expect(c.createRequest(Request).inspect()).rejects.toThrow('Login required');expect(originalStorage.length).toBe(0);
});
it('preserves in-flight public results and sessions, and discards protected results if a listener logs out',async () => {
    await login();const request=c.createRequest(Request);post.mockResolvedValueOnce({data:serialize({sessionId:'anonymous',data:1})});await request.inspectPublic();
    const response=deferred();post.mockReturnValueOnce(response.promise);const pending=request.inspectPublic();for(let i=0;i<30&&post.mock.calls.length<2;i++) await Promise.resolve();
    await c.logout();response.resolve({data:serialize({sessionId:'anonymous',data:2})});expect(await pending).toBe(2);await request.inspectPublic();expect(post.mock.calls[2][1]).toContain('anonymous');
    await login();let logout:Promise<any>|undefined;c.setListener(()=>{logout=c.logout();});await expect(request.inspect()).rejects.toThrow('Authentication changed');await logout;
});
