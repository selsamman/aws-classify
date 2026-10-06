import {AuthRequest, ClientRequest} from '@aws-classify-tests/requests';
import {classifyServerless} from 'aws-classify-server';
import {serializable} from 'js-freeze-dry';
export class AuthResponse extends AuthRequest {
    value = 0;
    async inspect() {
        const context = classifyServerless.getRequestContext(this)!;
        return {dispatch: context.dispatch, identity: context.identity, hasInvoke: context.hasScope('fixture/invoke'), hasAdmin: context.hasScope('aws.cognito.signin.user.admin'), session: classifyServerless.getSessionId(this)};
    }
    async inspectPublic() { return this.inspect(); }
    async setValue(value: number) { this.value = value; }
    async getValue() { return this.value; }
    async hookDenied() { this.value = -1; }
    async memberDenied() {
        if (!classifyServerless.getRequestContext(this)!.hasScope('fixture/never')) throw new Error('Application scope denied');
        this.value = -2;
    }
    async notify() { await classifyServerless.createRequest(this, ClientRequest).setCount(this.value); }
    async reassociate(user: string) { classifyServerless.setUserId(this, user); }
    async hiddenPublic() { return 'unexposed'; }
}
serializable({AuthResponse});
classifyServerless.registerResponse(AuthResponse, async (_endpoint, method, _args, context) => method !== 'hookDenied' || !!context?.hasScope('fixture/never'));
