import axios from 'axios';
import {serialize,deserialize} from 'js-freeze-dry';
async function call(method: string, path='', sessionId='', args: any[]=[]) {
    const response=await axios.post(process.env.__API__+path,serialize({interfaceName:'AuthRequest',methodName:method,sessionId,args}),{headers:{'Content-Type':'text/plain'},transformRequest:[],transformResponse:[]});
    return deserialize(response.data);
}
async function malformedCall(path = '') {
    const response=await axios.post(process.env.__API__+path,'not a Classify request',{headers:{'Content-Type':'text/plain'},transformRequest:[],transformResponse:[]});
    return deserialize(response.data);
}
it('calls public members anonymously with no identity',async () => {
    const response=await call('inspectPublic','/public');
    expect(response.exception).toBeUndefined(); expect(response.data.dispatch).toBe('public'); expect(response.data.identity).toBeUndefined();
});
it('runs protected offline functionality under --noAuth without inventing identity',async () => {
    const response=await call('inspect');
    expect(response.exception).toBeUndefined(); expect(response.data.dispatch).toBe('protected'); expect(response.data.identity).toBeUndefined(); expect(response.data.hasAdmin).toBe(false);
});
it('enforces dispatch categories before mutation even with Gateway auth disabled',async () => {
    const response=await call('inspect'); const session=response.sessionId;
    expect((await call('setValue','/public',session,[99])).exception).toBe('Internal Server Error');
    expect((await call('getValue','',session)).data).toBe(0);
    expect((await call('inspectPublic','',session)).exception).toBe('Internal Server Error');
});
it('rejects unexposed public members',async () => {
    expect((await call('hiddenPublic','/public')).exception).toBe('Internal Server Error');
});
it('does not disclose malformed-request internals',async () => {
    const response=await malformedCall('/public');
    expect(response.exception).toBe('Internal Server Error');
});
