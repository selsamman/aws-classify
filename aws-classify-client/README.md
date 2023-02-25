# aws-classify

A library for calling lambda functions as class members. The reverse is also true in that class members implemented in the browser can be called from the server.  
* Complex data with classes and cyclic structures can be passed and returned
* Instances of classes that implement methods are created for each session
* The lambda member functions can also call methods that are implemented in one or more browsers
* Eliminates all the complexity of setting up AWS
## AWS Configuration
These AWS resources are automatically configured and deployment is fully automated:
* Lambda Functions with code to wrap your classes
* Web Sockets using the AWS Gateway
* Dynamo DB for managing sessions
* A static website on S3 using Cloudfront with an SSL certificate. 
## Installation

On the project that implements the lambda functions

```npm install aws-classify-common, aws-classify-server```


On the client project


```npm install aws-classify-common, aws-classify-client```

The framework has been tested with popular client software such as Expo for mobile and React Native for web.

## Hello World

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
Once these classes are registered and instantiated using aws-classify you simply call the request method and the response method is executed as a Lambda function.  Any fields (e.g. count) in the response class are saved and restored between calls and serve as session data.

Please note:
* Request classes must have a unique static interface name
* You must instantiate the request class and invoke its methods like this on the client:
```typescript
    const classifyClient = new ClassifyClient(getSession, saveSession);
    serverRequest = classifyClient.createRequest(ServerRequest);
    await serverRequest.setCount(2023);
```   
* You implement getSession and saveSession for persisting session data in the local storage
```typescript
    async function getSession () {
        return localStorage.getItem('ClassifySession') || "None"
    }
    async function setSession(sessionId : string) {
        localStorage.setItem('ClassifySession', sessionId);
    }
```
* If the implementation throws an Error it can be caught by wrapping the method call in a try/catch
```typescript
    try {
       await serverRequest.setCount(2023);
    } catch (e) { console.log(e) }    
```

* On the server you must register the class so it can be instantiated when the client calls. 
```typeescript
    classifyServerless.registerRespon(ServerResponse)
 ```
* Finally declare the response class as serializable (js-freezedry) so the fields can be saved and restored between calls.
```
    serializable(ServerResponse)
```
### Deployment
This serverless.yml file is all you need to configure AWS:
```
service: 'aws-classify-tests'

custom:

  #
  # You need to fill these out
  #

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
    staticWebsite: "./static"
    includeFiles: "node_modules/aws-classify/yml"

  #Include any scripts needed to build your static site
  #scripts:
    #hooks:
    #'before:deploy:deploy': npm run build:static

  #
  # Boiler plate
  #
  yml: "../../yml/"
  #yml ${self:custom.directories.includeFiles}
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


plugins:
  - serverless-plugin-scripts
  - serverless-s3-sync
  - serverless-cloudfront-invalidate
  - serverless-plugin-typescript
  - serverless-dynamodb-local
  - serverless-offline

provider:
  name: aws
  runtime: nodejs16.x
  region: us-east-1
  websocketsApiRouteSelectionExpression: $request.body.action
  logs:
    websocket: true
  environment:
    APIG_ENDPOINT: ${file(${self:custom.yml}/apig.yml)}
  iam:
    role:
      - statements:
        - ${file(${self:custom.yml}/provider-iam.yml)}

functions:
  - ${file(${self:custom.yml}/functions.yml)}

resources:
  - ${file(${self:custom.yml}/resources-website.yml)}
  #  {file(${self:custom.yml}/resources-custom-website.yml)} if you have a custom domain

```


