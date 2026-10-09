// Install actual tarballs outside the workspace, then check legacy imports, types and browser output.
const {mkdtempSync, writeFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {execFileSync} = require('node:child_process');
const root=resolve(__dirname,'..'), dir=mkdtempSync(join(tmpdir(),'aws-classify-consumer-'));
const run=(cmd,args,cwd=dir) => execFileSync(cmd,args,{cwd,stdio:'inherit'});
try {
    const dependencies={};
    for(const name of ['common','client','server']) {
        const pkg=`aws-classify-${name}`;
        const result=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],{cwd:join(root,pkg),encoding:'utf8'}));
        dependencies[pkg]=`file:${join(dir,result[0].filename)}`;
    }
    writeFileSync(join(dir,'package.json'),JSON.stringify({private:true,dependencies}));
    run('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
    const source=`
import {ClassifyClient, LoginRequiredError, AuthenticationChangedError} from 'aws-classify-client';
import type {ManagedAuthenticationOptions, AuthorizationRequest, LocalLogoutResult} from 'aws-classify-client';
import {ClassifyServerless, responseHandler, publicResponseHandler} from 'aws-classify-server';
import {reqBody as a} from 'aws-classify-client/lib/cjs/aws-classify-common';
import {reqBody as b} from 'aws-classify-server/lib/cjs/aws-classify-common';
import type {LambdaRequest as ClientRequest} from 'aws-classify-client/lib/esm/aws-classify-common/LambdaRequest';
import type {LambdaResponse as ServerResponse} from 'aws-classify-server/lib/esm/aws-classify-common/LambdaResponse';
import type {ClientAuthenticationOptions, RequestContext} from 'aws-classify-common';
const legacy = new ClassifyClient(async () => '', async (_id: string) => {}, '/api/dispatch');
class Request {static interfaceName = 'Consumer'; async invoke() {return a();}}
class Response extends Request {async invoke() {return b();}}
const server = new ClassifyServerless();
server.registerResponse(Response, async (_endpoint, _method, _args) => true);
interface ExtendedExternalOptions extends ClientAuthenticationOptions {applicationPolicy?: boolean}
const options: ExtendedExternalOptions = {getAccessToken:async () => 'token'};
new ClassifyClient(async () => '',async () => {},'/api/dispatch',options);
const managed: ManagedAuthenticationOptions = {issuer:'https://issuer.example', clientId:'browser', redirectUri:'https://app.example/return', scopes:['openid','example/invoke']};
if (typeof window !== 'undefined') {
    const client = new ClassifyClient(async () => '',async () => {},'/api/dispatch',{managed});
    const begin: Promise<AuthorizationRequest> = client.beginLogin();
    const finish: Promise<void> = client.completeLogin('https://app.example/return');
    const logout: Promise<LocalLogoutResult> = client.logout();
    void [begin,finish,logout];
}
void [LoginRequiredError,AuthenticationChangedError];
const ctx: RequestContext | undefined = server.getRequestContext();
const request: ClientRequest = {interfaceName:'Consumer',methodName:'invoke',args:[],sessionId:''};
const response: ServerResponse = {data:1,cargo:undefined,exception:undefined,sessionId:''};
void [legacy,ctx,request,response,responseHandler,publicResponseHandler];
`;
    writeFileSync(join(dir,'consumer.ts'),source);
    writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true,target:'es2020',module:'commonjs',moduleResolution:'node',lib:['es2020','dom'],outDir:'out'},include:['consumer.ts']}));
    run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.json']);
    run(process.execPath,['out/consumer.js']);
    run(process.execPath,['-e', `
const nativeEncoder = global.TextEncoder;
void global.Response; void global.Request; void global.Headers; void global.FormData;
// Initialize Node's own lazy fetch types while its native encoder is available.
global.TextEncoder = undefined;
const assert=require('node:assert/strict');
const {ClassifyClient}=require('aws-classify-client');
new ClassifyClient(async () => '',async () => {});
assert.equal(require.cache[require.resolve('jose')],undefined);
global.TextEncoder = nativeEncoder;
const resolver=require('aws-classify-server/yml/authentication-config');
(async () => {
  const config={authorizer:{name:'application',scopes:['example/invoke']}};
  const result=await resolver({resolveVariable:async key => key.includes('custom.awsClassify') ? config : key.includes('httpApi.authorizers') ? {application:{type:'jwt'}} : null});
  assert.deepEqual(result,{authorizer:config.authorizer});
  await assert.rejects(resolver({resolveVariable:async () => null}),/requires an authorizer/);
  assert.equal(typeof require('aws-classify-server').publicResponseHandler,'function');
})().catch(error => {console.error(error); process.exitCode=1;});
`]);
    writeFileSync(join(dir,'browser.ts'),`import {ClassifyClient} from 'aws-classify-client'; import {reqBody} from 'aws-classify-client/lib/esm/aws-classify-common'; console.log(new ClassifyClient(async () => '',async () => {}),reqBody);`);
    run(process.execPath,[join(root,'node_modules/esbuild/bin/esbuild'),'browser.ts','--bundle','--platform=browser','--outfile=browser.js']);
    console.log('Packed consumer: legacy constructors/callbacks, exports/subpaths, types, CJS runtime and browser bundling passed.');
} finally {rmSync(dir,{recursive:true,force:true});}
