import {reqBody} from 'aws-classify-common';
export class AuthRequest {
    static interfaceName = 'AuthRequest';
    async inspect(): Promise<any> { return reqBody(); }
    async inspectPublic(): Promise<any> { return reqBody(); }
    async setValue(_value: number): Promise<void> { return reqBody(); }
    async getValue(): Promise<number> { return reqBody(); }
    async hookDenied(): Promise<void> { return reqBody(); }
    async memberDenied(): Promise<void> { return reqBody(); }
    async notify(): Promise<void> { return reqBody(); }
    async reassociate(_user: string): Promise<void> { return reqBody(); }
}
