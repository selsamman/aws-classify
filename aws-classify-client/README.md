# aws-classify

A library for calling AWS lambda functions from a browser or react-native app where the lambda functions are implemented as Typescript class members.  You create a request and corresponding response class. When you call the request class member function aws-classify takes care of the magic of invoking the corresponding response class member as a Lambda function. 

The reverse is also true in that class members implemented in the browser can be called from within a Lambda server. The latter uses Web Sockets in the AWS gateway. aws-classify also provides for a static website from which everything can be executed to comply with same-origin policy.  

* Complex data with classes and cyclic structures can be passed and returned
* Exceptions are passed back to the caller of the request method
* back-end session data is simply a matter of defining fields in the response class
* Configuration and deployment via a simple serverless.yml file

### AWS Resources Configured and Deployed
These AWS resources are automatically configured and deployment is fully automated:
* AWS Lambda
* Web Sockets in the AWS Gateway
* Dynamo DB for managing sessions
* S3 for a static website
* Cloudfront with a custom domain name as a CDN

All of these resources are configured by the Serverless Framework and deployed by running a script.  You only need to login to AWS in order to create credentials for the Serverless Framework and to register your domain name and create an SSL certificate for it.  

### Use Cases
aws-classify harnesses AWS to make it easy to leverage a scalable cloud-based infrastructure with virtually no learning curve.  From there you can leverage all of the other AWS resources your application may need.  The primary use-case is startups and projects that want a complete "app in a box" solution.
 
## Installation

On the project that implements the lambda functions

```npm install aws-classify-common, aws-classify-server```


On the client project


```npm install aws-classify-common, aws-classify-client```

The framework has been tested with popular client software such as Expo for mobile and React Native for web.
## Kicking the Tires

Because aws-classify involves multiple sub-projects (web, mobile, aws back-end) the best way to get started is to fork or checkout this sample [chat application](https://github.com/selsamman/aws-classify-example-simple-chat) that contains some simple Lambda response classes and a mobile/web front-end. 

## Calling Lambda Functions from the Client

### Create a Request/Response Pair of Classes

Create a request class that you will instantiate on the client:

```typescript
export class ServerRequest {
    static interfaceName = 'ServerRequest';
    async setCount (count : number) { reqBody() }
    async getCount () : Promise<number> { return reqBody() }
}
```
Create a corresponding response class that extends the request class:
```typescript
export class ServerResponse extends ServerRequest {
    count = 0;
    async setCount(count: number) {this.count = count}
    async getCount(): Promise<number> {return this.count}
}
```
Once these classes are registered and instantiated using aws-classify you simply call the request method and the response method is executed as a Lambda function.  Any fields (e.g. count) in the response class are saved and restored between calls and serve as session data.  Request classes must have a unique static interface name field so they are uniquely identified.

### Using the Request Class

You instantiate the request class and invoke its methods like this on the client:
```typescript
    const classifyClient = new ClassifyClient(getSession, saveSession);
    serverRequest = classifyClient.createRequest(ServerRequest);
    await serverRequest.setCount(2023);
```   
Since aws-classify is client platform-agnostic you need to implement getSession and saveSession for persisting client session data.  In the browser it would look like this:
```typescript
    async function getSession () {
        return localStorage.getItem('ClassifySession') || "None"
    }
    async function setSession(sessionId : string) {
        localStorage.setItem('ClassifySession', sessionId);
    }
```
If the implementation on the response class throws an Error, the Error will be thrown when you call the request class so it is best to enclose the call in a try/catch:
```typescript
    try {
       await serverRequest.setCount(2023);
    } catch (e) { console.log(e) }    
```
### Using the Response class
You must register the class so it can be instantiated when the client calls. Usually this is done in the file where the class is defined: 
```typescript
    classifyServerless.registerRespon(ServerResponse)
 ```
Because class fields are persisted between calls from the same session, you need to declare the response class as serializable so that js-freezedry can serialize it. Usually this is done in the file where the class is defined:
```
    serializable(ServerResponse)
```
## Calling Client Functions from Lambda Functions
Calling member functions implemented on the client use WebSockets.  There are three distinct use cases:
* ***Same Session*** - Call a client-request for the same session as the caller of your Lambda function.  
* ***Alternate Session*** - Instantiate a response class for a different session and then call a client request for that session.  This allows means the response class for the alternate session can change it's session session data
* ***Direct to Alternate Session*** A shortcut whereby the Lambda fuction directly invokes a request method for an alternate session.

### Setup Requests and Response Classes
Your Lambda functions can also call requests that will be implemented in the browser.  The class setup is analogous in that you define a request class
```typescript
export class ClientRequest {
    static interfaceName = 'ClientRequest';
    setCount(count : number) {reqBody()}
}
```
and a response class
```typescript
export class ClientResponse extends ClientRequest{
    count = 0;
    setCount(count: number) {
        this.count = 0;
        console.log(count);
    }
}
```
On the client you need to instantiate the response class like this:
```typescript
    const classifyClient = new ClassifyClient(getSession, saveSession);
    const clientResponse = classifyClient.createResponse(ClientResponse);
```

### Implement Lambda Response methods
In all cases you must register the request class. 
```typescript
classifyServerless.registerRequest(ClientRequest);
```
For the ***Same Session*** case you instantiate the request object and call the method. The first parameter of **createRequest** is a response object from which the session is to be extracted:
```typescript
export class ServerResponse extends ServerRequest {
    count = 0;
    // ....
    async sendCount() {
        const clientRequest = classifyServerless.createRequest(this, ClientRequest);
        clientRequest.setCount(this.count);
    }
}
```
For the ***Alternate Session*** case you first instantiate a response object for the target session and call a method that will invoke a request for the target session:
```typescript
 export class ServerResponse extends ServerRequest {
    count = 0;
    // ...
    async sendCountTo(sessionId: string) {
        await classifyServerless.createResponse(ServerResponse, sessionId, async serverResponse => {
            await serverResponse.sendCount()
        });
    }
    async sendCount() {
        const clientRequest = classifyServerless.createRequest(this, ClientRequest);
        clientRequest.setCount(this.count);
    }
    
}
```

And for the ***Direct to Alternate Session*** case you may directly instantiate a request object for the target session and invoke its method
```typescript
export class ServerResponse extends ServerRequest {
    count = 0;
    // ...
    async sendOurCountTo(sessionId: string) {
        const clientRequest = await classifyServerless.createRequestForSession(sessionId, ClientRequest);
        await clientRequest.setCount(this.count);
    }
}
```
The combination of these use cases allows for a rich set of interactions between code in the cloud and code on the server.  For example:
* You have two sessions "chat" with other by sharing the session Id
* You can instantiate and invoke your class methods from any normal Lambda function provided that you have a session.  This includes any of the AWS event mechanisms capable of invoking Lamda functions 
## Project Structure
The mono repo structure is ideal for projects that use aws-classify as you typically will have a server sub-project and one or more client projects, perhaps mobile and web.  These projects will share code as the request classes must be present in both the client and the server.  The easiest way to accomplish this is using bisync which synchronizes your shared directories automatically.

```
Root
- bisync.json (configured to synchronized shared directories)
- package.json (just for bisync)
- node_modules (just bisync)
- cloud
  - serverless.yml
  - requests (request classes)
  - responses (contains implementations of requests from client)
- web (could be a project created with create-react-app)
  - requests (requests) 
  - responses (contains implementation of requests from the server)
  - other files pertaining to the client and static website   
```
You would then configure bisync.json to keep the shared code in sync
```
[
    ["./cloud/requests", "./web/requests"],
]    
```
Implementing shared code this way avoid restrictions that packaging schemes have that effectively require code to be present in project tree
## Deployment
You will need a serverless.yml file for automatic deployment in your cloud folder
In the first two sections you need to setup these custom variables
* **service:** - A unique name for your project within your AWS account
* **domain:** - The domain name your will use(even it is not yet registered)
* **certificateARN:** - An AWS certificate which you can [generate on the AWS 
console](https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-public.html)
* **prefixes** - The sub-domain to be used for the development stage.  You may, of course, define other stages (e.g. staging, qa etc)
* **directories**
  * **responseHandlers:** - A file that has the exports for the handlers aws-classify needs.  This file should also register your responses.  It looks like this:
```  
    export {responseHandler, webSocketConnect, webSocketDisconnect} from "../aws-classify-server"
    import {classifyServerless} from "aws-classify-server";

    import {ServerResponse} from "./ServerResponse"; // Your server responses
    classifyServerless.registerResponse(ServerResponse);
```
   * **staticWebsite:** - The directory where your static website will be built
   * **includeFiles:** - Normally this just points to the yml directory in aws-classify
```
service: 'my-fantastic-project'

custom:

  # Specify this even if you don't have a custom domain at this time
  domain: awsclassify.com
  
  # Get your AWS SSL Certificate and put it here if you have a custom domain
  certificateARN: "arn:aws:acm:us-east-1:############:certificate/########-####-####-####-############"

  # Map stages to domain prefixes
  prefixes:
    dev: test.
    prod: ''

  directories:
    responseHandlers: "src/server-responses/index"
    staticWebsite: "../web/build"
    includeFiles: "node_modules/aws-classify-serverless/yml"
```
If you are using a web site that requires building you will want to force it to be built as part of the deployment by adding the script in the **scripts** custom variable:
```
  scripts:
    hooks:
    'before:deploy:deploy': npm run build:static
```
The remaining custom variables just need to be copied as is.  They will:
* set up the detailed names for your domain and buckets 
* configure the s3Sync plugin. Note that noSync: true is specified here so you will have to run ```sls s3Sync``` to push our your site.  Doing this way avoids s3Sync deploying your site when you use offline mode
* Configures other custom variables needed
```
  yml: ${self:custom.directories.includeFiles}
  stage: ${opt:stage,'dev'}
  hostedZoneName: ${self:custom.domain}.
  domainName: ${self:custom.prefixes.${self:custom.stage}}{$self:custome.domain}
  handler: "src/server-responses/index"
  bucketName: ${self:custom.domainName}
  s3Sync:
    noSync: true
    buckets:
    - bucketName: ${self:custom.bucketName}
      localDir: ${self:custom.directories.includeFiles}
  cloudfrontInvalidate: ${file(${self:custom.yml}/custom-cloudfront.yml)}
  serverless-offline:
    httpPort: 4000
  dynamodb: ${file(${self:custom.yml}/custom-dynamodb.yml)}
```
The deployment is dependent on a number plugs which must be installed with npm install
```
plugins:
  - serverless-plugin-scripts
  - serverless-s3-sync
  - "@serverless-aws/serverless-s3-remover"
  - serverless-cloudfront-invalidate
  - serverless-plugin-typescript
  - serverless-dynamodb-local
  - serverless-offline
```
The provider section details configuration the Serverless Framework handles.  Many of the details are in included files to keep this simple and resilient to change
```
provider:
  name: aws
  runtime: nodejs16.x
  region: us-east-1
  websocketsApiRouteSelectionExpression: $request.body.action
  logs:
    websocket: true
  environment:
    APIG_ENDPOINT: ${file(${self:custom.yml}/apig.yml)}
    DOMAIN: ${self:custom.domainName}
  iam:
    role:
      statements:
        - ${file(${self:custom.yml}/provider-iam.yml)}
```
The functions details each of the Lamda handlers.  The details are in an include file
```
functions:
  - ${file(${self:custom.yml}/functions.yml)}
```
Finally resources contains all of the resource definitions most of which are in include files.  Important:  If you don't yet have a custom domain use ```{file(${self:custom.yml}/resources-website.yml)}``` instead of ```{file(${self:custom.yml}/resources-custom-website.yml)}```
```
resources:
  - ${file(${self:custom.yml}/resources-custom-website.yml)}
  - ${file(${self:custom.yml}/resources-dynamodb.yml)}
```

To deploy you need to:
- Create AWS credentials using the AWS console as defined in the Serverless [documents](https://www.serverless.com/framework/docs/providers/aws/guide/credentials)
- Install and setup credentials You need to setup your credentials with serverless
```	
serverless config credentials \
  --provider aws \
  --key AKIAIOSFODNN7EXAMPLE \
  --secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```
- Obtain a no-cost SSL certificate on the AWS console and put it in the serverless.yml file
- You can deploy a test version with
```
sls deploy --verbose --stage dev
sls s3sync 
```
- Deploy production version with 
```
serverless deploy stage prod 
sls s3sync 
```
## Limitations
* AWS Websockets are limited to 10 minutes
* No locking mechanism for simultaneous lambda function execution which could cause sessions to be over-ridden with the last one to complete
* The session key is not periodically updated as the actual database key is used
* No mechanism to have session alternatives to DynamoDB (for example, REDIS, JWT)
## Roadmap
* Create template/scripts for getting started (currently starting with chat) sample app is the easiest way to use this library.
* Continued shakeout with real-world applications
* Community feedback

At present the library should rightly be considered "beta" until it is more widely adopted.  It is ideal for side projects and proof of concepts.  It is also a useful reference on how to configure AWS services.
