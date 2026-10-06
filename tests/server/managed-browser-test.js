const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright-core');
const {CognitoIdentityProviderClient, UpdateUserPoolClientCommand}=require('@aws-sdk/client-cognito-identity-provider');
async function runManagedBrowser({outputs:o,region,password,usernames=['alice','bob'],signal,log,onCheck=()=>{}}) {
    const cognito=new CognitoIdentityProviderClient({region});
    const website=`https://${o.WebsiteUrl}`, callback=website+'/managed.html';
    const checks=[];
    const test=async (name,fn) => {signal.throwIfAborted();await fn();checks.push(name);onCheck(name);log(`Managed browser: ${name} passed`);};
    let browser;
    try {
        await cognito.send(new UpdateUserPoolClientCommand({UserPoolId:o.AuthUserPoolId,ClientId:o.AuthManagedClientId,
            ExplicitAuthFlows:['ALLOW_USER_SRP_AUTH'],AllowedOAuthFlowsUserPoolClient:true,AllowedOAuthFlows:['code'],AllowedOAuthScopes:['openid','fixture/invoke'],
            SupportedIdentityProviders:['COGNITO'],CallbackURLs:[callback],LogoutURLs:[callback+'?signedout=1'],
            AccessTokenValidity:5,IdTokenValidity:5,RefreshTokenValidity:1,TokenValidityUnits:{AccessToken:'minutes',IdToken:'minutes',RefreshToken:'hours'},
            RefreshTokenRotation:{Feature:'ENABLED',RetryGracePeriodSeconds:0}}));
        browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'})});
        const abort=()=>{void browser.close();};signal.addEventListener('abort',abort,{once:true});
        try {
            for(const label of ['direct','cloudfront']) {
                const context=await browser.newContext();
                const page=await context.newPage(); page.setDefaultTimeout(30000);
                let exchange=0,refresh=0; const rotation=new Set(), network=[];
                page.on('requestfailed',r=>{const u=new URL(r.url());network.push({origin:u.origin,path:u.pathname,method:r.method(),failure:r.failure()?.errorText});});
                page.on('response',r=>{if(r.status()>=400) {const u=new URL(r.url());network.push({origin:u.origin,path:u.pathname,status:r.status()});}});
                page.on('request',r => {
                    if(!r.url().endsWith('/oauth2/token')) return;
                    const body=new URLSearchParams(r.postData()||'');
                    if(body.get('grant_type')==='authorization_code') exchange++;
                    if(body.get('grant_type')==='refresh_token') {refresh++;rotation.add(createHash('sha256').update(body.get('refresh_token')||'').digest('hex'));}
                });
                const ready=async () => {await page.waitForFunction(() => window.fixtureAPI?.ready || window.fixtureAPI?.failure);assert.equal(await page.evaluate(()=>window.fixtureAPI.failure),'');};
                const login=async username => {
                    await page.evaluate(()=>window.fixtureAPI.login());
                    await page.waitForURL(url=>url.hostname.includes('.amazoncognito.com'));
                    await page.locator('input[name="username"]:visible').fill(username);
                    await page.locator('input[name="password"]:visible').fill(password);
                    await page.locator('input[name="signInSubmitButton"]:visible, button[name="signInSubmitButton"]:visible').click();
                    await page.waitForURL(url=>url.origin===website && url.pathname==='/managed.html');await ready();
                };
                try {
                    await page.goto(callback+'?endpoint='+label);await ready();
                    if(label==='direct') await test('direct: unauthenticated browser CORS preflight',async()=>{
                        const response=await page.request.fetch(o.TestApiUrl,{method:'OPTIONS',headers:{Origin:website,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
                        assert.equal(response.status(),204);assert.ok(['*',website].includes(response.headers()['access-control-allow-origin']));
                        assert.match(response.headers()['access-control-allow-headers'],/authorization/i);
                    });
                    let firstSession,firstSubject;
                    await test(`${label}: browser code/S256 exchange and Gateway identity`,async()=>{
                        await login(usernames[0]);
                        const result=await page.evaluate(()=>window.fixtureAPI.request.inspect());
                        firstSubject=result.identity.subject;assert.ok(firstSubject);assert.equal(result.identity.claims.token_use,'access');
                        assert.ok(result.identity.scopes.includes('fixture/invoke'));assert.equal(exchange,1);
                        firstSession=await page.evaluate(()=>sessionStorage.getItem('fixture-protected'));assert.ok(firstSession);
                        assert.equal(new URL(page.url()).search,'');
                    });
                    await test(`${label}: reload and rotating OAuth refresh`,async()=>{
                        await page.reload();await ready();await page.evaluate(()=>window.fixtureAPI.request.inspect());
                        await page.evaluate(()=>window.fixtureAPI.request.inspect());assert.ok(refresh>=3);assert.equal(rotation.size,refresh);
                        assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixture-protected')),firstSession);
                    });
                    await test(`${label}: real socket, local logout and public availability`,async()=>{
                        assert.equal(await page.evaluate(()=>window.fixtureAPI.client.initSocket()),true);
                        assert.deepEqual(await page.evaluate(()=>window.fixtureAPI.localLogout()),{hasHint:true,session:'',socketClosed:true});
                        assert.equal(await page.evaluate(async()=>{try {await window.fixtureAPI.request.inspect();return false;} catch {return true;}}),true);
                        assert.equal((await page.evaluate(()=>window.fixtureAPI.request.inspectPublic())).identity,undefined);
                        assert.equal((await page.evaluate(()=>window.fixtureAPI.localLogout())).hasHint,false);
                    });
                    await test(`${label}: provider logout returns to signed-out application`,async()=>{
                        await page.evaluate(()=>window.fixtureAPI.providerLogout());
                        await page.waitForURL(callback+'?signedout=1');await ready();
                        assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixture-protected')),'');
                        assert.equal(await page.evaluate(async()=>{try {await window.fixtureAPI.request.inspect();return false;} catch {return true;}}),true);
                    });
                    await test(`${label}: subsequent browser login changes account and protected session`,async()=>{
                        await login(usernames[1]); const result=await page.evaluate(()=>window.fixtureAPI.request.inspect());
                        assert.notEqual(result.identity.subject,firstSubject);assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('fixture-protected')),firstSession);
                        assert.equal(exchange,2);await page.evaluate(()=>window.fixtureAPI.providerLogout());await page.waitForURL(callback+'?signedout=1');await ready();
                    });
                } catch(error) {log(`Managed browser network diagnostics: ${JSON.stringify(network)}`);throw error;}
                finally {await context.close();}
            }
        } finally {signal.removeEventListener('abort',abort);}
        return {result:'passed',browser:await browser.version(),count:checks.length,checks};
    } finally {await browser?.close();cognito.destroy();}
}
module.exports={runManagedBrowser};
