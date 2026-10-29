import { ClassifyClient } from 'aws-classify-client';
import { DiagnosticClientRequest, DiagnosticRequest } from '@aws-classify-docs/requests';
import { provider } from './config';

const events: string[] = [];
const log = (text: string) => { events.unshift(`${new Date().toISOString()} ${text}`); render(); };
const protectedKey = 'aws-classify-docs-protected-session';
const publicKey = 'aws-classify-docs-public-session';
const auth = provider.issuer && provider.clientId && provider.redirectUri
  ? { managed: { issuer: provider.issuer, clientId: provider.clientId, redirectUri: provider.redirectUri, scopes: ['openid', provider.scope || 'example/invoke'] } }
  // Guide-documented external-token form; offline --noAuth marks identities unvalidated.
  : { getAccessToken: async () => 'offline-unvalidated' };

const client = new ClassifyClient(
  async () => sessionStorage.getItem(protectedKey) || '',
  async id => sessionStorage.setItem(protectedKey, id),
  '/api/dispatch',
  { ...auth, publicMethods: ['publicPingPublic'], getPublicSession: async () => sessionStorage.getItem(publicKey) || '', setPublicSession: async id => sessionStorage.setItem(publicKey, id) },
);
const api = client.createRequest(DiagnosticRequest);

class BrowserNotifications extends DiagnosticClientRequest {
  async received(message: string): Promise<void> { log(`notification received: ${message}`); }
}
client.createResponse(BrowserNotifications);
client.onConnect(() => log('socket connected'));
client.onDisconnect(() => log('socket disconnected'));

async function run(label: string, work: () => Promise<unknown>) {
  try { log(`${label}: ${JSON.stringify(await work())}`); }
  catch (error) { log(`${label} ERROR: ${error instanceof Error ? error.message : String(error)}`); }
}

async function completeCallback() {
  const returned = new URL(window.location.href);
  if (returned.searchParams.has('code') || returned.searchParams.has('error')) {
    await run('login callback', () => client.completeLogin(returned.href));
    history.replaceState(null, '', provider.redirectUri || window.location.origin + '/');
  }
}

function button(label: string, handler: () => void) {
  const node = document.createElement('button'); node.textContent = label; node.onclick = handler; return node;
}
function render() {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  root.replaceChildren();
  const title = document.createElement('h1'); title.textContent = 'aws-classify diagnostic'; root.append(title);
  const status = document.createElement('p'); status.textContent = `Session A (this tab): ${sessionStorage.getItem(protectedKey) || '(new)'} · ${provider.issuer ? 'Cognito configured' : 'LOCAL MODE — identity unvalidated'}`; root.append(status);
  const controls = document.createElement('p');
  controls.append(
    button('Public ping', () => void run('public ping', () => api.publicPingPublic())),
    button('Protected get', () => void run('protected get', () => api.getCount())),
    button('Set count 7', () => void run('set count', () => api.setCount(7))),
    button('Invalid count', () => void run('invalid count', () => api.setCount(Number.NaN))),
    button('Connect socket', () => void run('socket connect', () => client.initSocket())),
    button('Disconnect socket', () => { client.socket?.close(); log('socket close requested'); }),
    button('Reconnect socket', () => void run('socket reconnect', () => client.initSocket())),
    button('Send to paired peer', () => void run('peer send', () => api.sendToPeer('hello from this session'))),
    button('Update paired peer state', () => void run('peer state update', () => api.updatePeerState('updated by peer'))),
  );
  root.append(controls);
  if (provider.issuer) root.append(button('Login', () => void run('begin login', async () => {
    const request = await client.beginLogin(); const url = new URL(request.authorizationEndpoint);
    for (const [name, value] of Object.entries(request.parameters)) url.searchParams.set(name, value);
    window.location.assign(url.href); return 'redirecting';
  })), button('Logout', () => void run('logout', async () => { await client.logout(); return 'local credentials cleared'; })));
  const note = document.createElement('p'); note.textContent = 'Use an independent/noopener browser context for Session B. The server intentionally has no session-listing control; peer pairing is an application-owned policy gap demonstrated by the failed unpaired sends.'; root.append(note);
  const output = document.createElement('pre'); output.textContent = events.join('\n') || 'No results yet.'; root.append(output);
}
void completeCallback().then(render).catch(error => { log(`callback ERROR: ${String(error)}`); });
