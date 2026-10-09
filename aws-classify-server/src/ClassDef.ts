import type {RequestContext} from "aws-classify-common";
import {ClassifyResponse} from "./ClassifyResponse";

export interface ClassDef<ServerClass extends ClassifyResponse, ClientClass> {
    serverClass: new () => ServerClass;
    clientClass: new () => ClientClass;
    publicMethods: ReadonlySet<string>;
    authorizer: ((endPoint: ServerClass, method: string, args: IArguments, context?: RequestContext) => Promise<boolean>) | undefined;
}
