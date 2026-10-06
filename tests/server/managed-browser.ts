// Test application owns provider URLs and navigation. No credentials enter its
// response/session state or the runner's report.
import {ClassifyClient} from 'aws-classify-client';
declare const __FIXTURE_CONFIG__: {issuer: string; clientId: string; domain: string; website: string; api: string};
const config = __FIXTURE_CONFIG__;
const callback = `${config.website}/managed.html`;
const signedOut = callback + '?signedout=1';
const endpoint = new URL(location.href).searchParams.get('endpoint');
if (endpoint) sessionStorage.setItem('fixture-endpoint', endpoint);
class Request {static interfaceName='AuthRequest'; async inspect(): Promise<any> {} async inspectPublic(): Promise<any> {}}
const client = new ClassifyClient(async () => sessionStorage.getItem('fixture-protected') || '', async id => {sessionStorage.setItem('fixture-protected',id);},
    sessionStorage.getItem('fixture-endpoint') === 'direct' ? config.api : config.website+'/api/dispatch',
    {publicSuffix:'Public', managed:{issuer:config.issuer,clientId:config.clientId,redirectUri:callback,scopes:['openid','fixture/invoke'],refreshLeewaySeconds:300}});
client.setLogger(() => {});
const request = client.createRequest(Request);
const bridge = {
    client, request, ready: false, failure: '',
    async login() {
        const authorization = await client.beginLogin();
        const url = new URL(authorization.authorizationEndpoint);
        for (const [key,value] of Object.entries(authorization.parameters)) url.searchParams.set(key,value);
        location.assign(url.href);
    },
    async localLogout() {const result=await client.logout();return {hasHint:!!result.idTokenHint,session:sessionStorage.getItem('fixture-protected'),socketClosed:!client.socket};},
    async providerLogout() {
        await client.logout();
        const url=new URL('/logout',config.domain);
        url.searchParams.set('client_id',config.clientId);url.searchParams.set('logout_uri',signedOut);
        location.assign(url.href);
    },
};
(window as any).fixtureAPI=bridge;
(async () => {
    try {
        if (new URL(location.href).searchParams.has('state')) {
            try {await client.completeLogin(location.href);} finally {history.replaceState(null,'',callback);}
        }
        bridge.ready=true;
        document.body.textContent='Managed lifecycle fixture ready';
    } catch (error) {bridge.failure=error instanceof Error ? error.message : 'Login failed'; document.body.textContent='Managed lifecycle failed';}
})();
