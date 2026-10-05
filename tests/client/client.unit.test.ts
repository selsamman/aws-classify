import axios from 'axios';
import {serialize} from 'js-freeze-dry';
import {ClassifyClient} from 'aws-classify-client';
import {ServerRequest} from '@aws-classify-tests/requests';
jest.mock('axios');
const post = axios.post as jest.Mock;
beforeEach(() => post.mockReset());
function client() {
    const c = new ClassifyClient(async () => '', async () => {}, 'http://fixture/api/dispatch');
    c.setLogger(() => {});
    return c;
}
it('propagates transport failures and supports a later successful request', async () => {
    const request = client().createRequest(ServerRequest);
    post.mockRejectedValueOnce(new Error('transport unavailable'));
    await expect(request.getCount()).rejects.toThrow('transport unavailable');
    post.mockResolvedValueOnce({data: serialize({sessionId: 'saved', data: 4})});
    expect(await request.getCount()).toBe(4);
});
it('propagates malformed responses and supports a later successful request', async () => {
    const request = client().createRequest(ServerRequest);
    post.mockResolvedValueOnce({data: '{broken'});
    await expect(request.getCount()).rejects.toThrow();
    post.mockResolvedValueOnce({data: serialize({sessionId: 'saved', data: 6})});
    expect(await request.getCount()).toBe(6);
});
it('allows socket initialization to retry after authorization transport failure', async () => {
    const c = client();
    post.mockRejectedValueOnce(new Error('authorization transport unavailable'));
    await expect(c.initSocket()).rejects.toThrow('authorization transport unavailable');
    expect(c.socketRequested).toBe(false);
    post.mockResolvedValueOnce({data: serialize({data: '', sessionId: ''})});
    expect(await c.initSocket()).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
});
it('allows retry after a socket authorization response omits its session', async () => {
    const c = client(); post.mockResolvedValue({data: serialize({data: '', sessionId: ''})});
    expect(await c.initSocket()).toBe(false);
    expect(await c.initSocket()).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
});
it('allows retry after the socket connection fails to open', async () => {
    const nativeSocket = global.WebSocket;
    jest.useFakeTimers();
    class FailedSocket extends EventTarget {
        static instance: FailedSocket;
        onerror?: (event: Event) => void;
        constructor() { super(); FailedSocket.instance = this; }
        close() { this.dispatchEvent(new CloseEvent('close')); }
    }
    global.WebSocket = FailedSocket as unknown as typeof WebSocket;
    try {
        const c = client();
        post.mockResolvedValueOnce({data: serialize({sessionId: 'session', data: 'ws://fixture'})});
        const opening = c.initSocket();
        // Let the session callback and authorization request complete.
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        FailedSocket.instance.onerror!(new Event('error'));
        await jest.advanceTimersByTimeAsync(5000);
        expect(await opening).toBe(false);
        expect(c.socketRequested).toBe(false); expect(c.socket).toBeUndefined();
        post.mockResolvedValueOnce({data: serialize({sessionId: '', data: ''})});
        expect(await c.initSocket()).toBe(false); expect(post).toHaveBeenCalledTimes(2);
    } finally { global.WebSocket = nativeSocket; jest.useRealTimers(); }
});
