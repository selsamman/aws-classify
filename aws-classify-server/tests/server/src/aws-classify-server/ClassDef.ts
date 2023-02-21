import {ClassifyResponse} from "./ClassifyResponse";

export interface ClassDef<ServerClass extends ClassifyResponse, ClientClass> {
    serverClass: new () => ServerClass;
    clientClass: new () => ClientClass;
    authorizer: ((endPoint: ServerClass, method: string, args: IArguments) => Promise<boolean>) | undefined;
}
