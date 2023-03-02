export class ClassifyResponse {
    // tslint:disable-next-line:variable-name
    __sessionId__ : string | undefined;
    __connectionId__ : string | undefined;
    __interfaceName__ : string | undefined;
    __userId__ : string | undefined;
    constructor(interfaceName : string, sessionId : string, connectionId : string) {
        this.__connectionId__ = connectionId;
        this.__sessionId__ = sessionId;
        this.__interfaceName__ = interfaceName;
    }
}
