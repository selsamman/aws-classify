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

### Create a Request for the Client

First define a request class that you will instantiate and call on the client:

```typescript
import {reqBody} from "aws-classify-common";

// These methods will be called from the browser or mobile phone
// The implementation will be defined in the response class and reqBody is a placeholder
class UserRequest {
    async registerUser(newUser : User) : boolean {return reqBody}
    async login(_email : string, _password : string) : boolean {return reqBody}
    async logout() {return reqBody}
}

// An object that is passed along with the register user
class User {
    constructor(name : string, email : string, password : string) {
        this.name = name; this.email = email; this.password = password;
    }
    name;
    email;
    password;
    validate () { // Code to ensure all fields are valid or throw an Error
    }
}
serializable({User});
```
### Create a Response Class for Lambda Member Functions
Then create a response class that implements the request methods.  The response class extends the request to ensure matching call signatures and return values. Each method will be packaged by aws-classify as a Lambda function. Upon first invocation session is established with an instance of the response class.  It is persisted such that you can keep session data as member variables.
* A separate instance of the class will be persisted for each session.
* You may keep session data as memeber variables

```
import {users} from 'data-store' // Not defined here

class UserResponse extends UserRequest {

    user : User | undefined; // session data

    async registerUser(newUser : User) {
        newUser.validate(); // May throw an Error
        users.addNewUser(newUser);// May throw error if duplicate
        this.user = newUser; // No errors thrown then save it
    }

    async login(email : string, password : string) {
        const user = users.get(email);
        if (!user || user.password != password)
            throw new Error("invalid email or password");
        else {
            this.user = new User(user.name, user.email, '*****');
            return this.user;
        }
    }

    async logout () {
        if (this.user)
            this.user = undefined;
        else
            throw new Error('Not logged in');
    }
}
```
### Deploy the server
You can deploy to AWS by determining the requirements from the yml serverless templates or simply include the yml include files in your serverless.yml file and setting up a few common variables
```
The response class extends the request to ensure matching call signatures and return values. 
import {ExpressServer} from "express-classify"; 

const expressServer = new ExpressServer();
expressServer.setPort(80);
expressServer.createEndPoint("users", UserEndPoint, UserRequest);
expressServer.start();
```
### Initialize the client
```
import {ExpressClient} from "express-classify-client";
   
const expressClient = new ExpressClient();
const userRequest = expressClient.createRequest("users", new UserRequest());
``` 
### Invoke your request method
Now you can just call your request method.  Either the value will be returned or an exception will be thrown depending on the execution of the server implementation.
```
    try {
        loggedInUser = userRequest.login("username", "******");
    } catch (e) {
        alert (e);
    }
```
On the server an instance of your implementation class is created for each browser session at the moment a method is called and the properties are serialized and deserialized from/to the session.  You may use any session store or leave it to the default of a memory store designed for production use.
### Browser implemented methods
The reverse is also possible.  You can define a request on the server and an implementation in the browser. The question is which of the many possible browsers should receive the request?
* You might want to have all browsers respond if you were broadcasting content of interest to everyone.
* Sometimes you want to only send data back to the browser that made a request. For example, you are processing an order and want to update the status on the browser as the credit card is approved and the order is accepted.
* In other more complex cases you might want to send data to a specific user.  An example of this might be a chat application.

In all cases you start by defining a request on the server
```
// On server
class AlertBrowserRequest {
    sendMessage(msg : string) {}
}
```
And defining a class for the implementation on the browser
```
// On browser
        class AlterBrowserImplementation implements AlertBrowserRequest {
            sendMessage(msg : string) {
                console.log(`Server said: ${msg}`);
            }
        }
```
Then in the browser you create the implementation instance
```
expressClient.createResponse("hello", new BrowserRequestImplementation);
```
On the server you create the request
```
expressServer.createRequest("hello", BrowserRequest);
```
Note that on the server you don't actually directly create an instance of the request.  Instead, an instance is created for each browser session as you need to invoke the request.
### Sending to all Browsers
To do this you enumerate all sessions and get a request for each:
```
expressServer.enumerateSessions( (_, getRequest) => {
    const browserRequest = getRequest(BrowserRequest) as BrowserRequest;
    browserRequest.sendMessage('hello out there from the server');
});
```
Sometimes, however you might need access to session data.  In that case you can also access any server implementation such as the UserRequestImplementation we created earlier
```
expressServer.enumerateSessions( (getImplementation, getRequest) => {
    const browserRequest = getRequest(BrowserRequest) as BrowserRequest;
    const userRequestImplementation = getResponse(UserRequestImplementation) as UserRequestImplementation
    const name = userRequestImplementation.firstName;
    browserRequest.sendMessage(`Hi ${name} how are you?');
});
```
### Sending Data to Same Session
There are times when you are executing a method in an endpoint and you need to send back data after completion of the method.  For example if you want to indicate a credit card charge has been approved during checkout.  In that case you can ask for an instance of a request that is bound to the current implementation instance. This done through the **getRequest** method that is part of the ServerEndPoint class on which your implementation is based: 
```
// Server
class PaymentImplementation () extends ServerEndPoint implements PaymentRequest {

    checkout(order : Order) {
        const updateStatusRequest = this.getRequest(UpdateStatusRequest);
        paymentProcessor.processPayment(order.paymentInfo)
            .then(status => updateStatusRequest.update(status));
    }    
}

// Browser
class UpdateStatusImplementation {
    update (status) {
        if (status === 'Approved')
            alert('Your Payment is Complete');
    }
}       

```
### Sending Data to a Specific Session
Some applications need to send data to specific users if they are logged in and have a session.  Examples include social media and chat applications.  There are two ways to do this:
* Associate the session id with your user data
* Enumerate all sessions and send to the ones with a matching id

You can always get the session id using the getSessionId method in the ServerEndPoint class:
```
class UserImplementation () extends ServerEndPoint implements UserRequest {

    user : User | undefined; // session data
     
    async login(email : string, password : string) {
        const user = await userManager.fetchUser(email, password);
        if (user) {
            this.user = user; // Save logged in user in the session
            user.sessionId = this.getSessionId;  // Save Session Id
            await userManager.saveUser(user);
            return user;
        }
    }
}
```
Here we save the session id in our user object (via a hypothetical user manager) and we also save the user object in our session in the user member.  This allows us to implement a function that sends data to a specific user in one of two ways:
```
    // By enumerating all sessions
    sendMessageToUser(email, message) {
        expressServer.enumerateSessions( (sessionEndPoint, sessionRequest) => {

            const userImplementation = sessionEndPoint(UsersWebServer) as UserImplementation;
            const alertBrowserRequest = sessionRequest(ClientRequest) as AlertBrowserRequest;
            
            if (userImplementation.user.email === email)
                alertBrowserRequest.sendMessage(message);
        })
    }
```
or by the session id you saved in the user object
```
    sendMessageToUser(email, message) {
  
        const user = userManager.fetch(email);
        if (user) {
            try {
                expressServer.getRequest(user.sessionId).sendMessage(message)
            } catch (e) {}
        }
    }

```
Note: This has second method has not yet been implemented

### Shared Code
Seamless calls between the browser and the server require that code be shared between the client project and the server project. The easiest way is to keep both projects in the same repo as subdirectories.  When using a client such as create-react-app you are obliged to keep the common code in the React project since it will not bundle files outside the project. Therefore, the easiest way is to keep your client requests and client implementations in a folder in the React project and import from that project in the NodeJS project.  This is best done using a mono repo where the client and server projects are peer-subdirectories.

## Roadmap

Currently, this library is suitable for use in applications on a local area network. It is not yet robust enough for general use on the public internet.  That is a work in progress.  High priority features to be implemented:
* CSFR tokens for guard against cross-site forgery
* Session regeneration
* Proper reconnection if socket.io connection lost
* Pruning expired sessions
* Testing with secure sessions and switching back and forth
* Testing with and without sticky sessions using a load balancer
* Teating with popular sessions stores


