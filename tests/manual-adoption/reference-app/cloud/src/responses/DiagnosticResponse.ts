import { DiagnosticClientRequest, DiagnosticRequest } from '@aws-classify-docs/requests';
import { serializable } from 'js-freeze-dry';
import { classifyServerless } from 'aws-classify-server';

/** The recipient is deliberately application state, never an arbitrary client session ID. */
export class DiagnosticResponse extends DiagnosticRequest {
  count = 0;
  peerSessionId = '';
  lastPeerMessage = '';

  async publicPingPublic(): Promise<string> {
    return `public ok ${new Date().toISOString()}`;
  }

  async getCount(): Promise<number> { return this.count; }

  async setCount(count: number): Promise<void> {
    if (!Number.isFinite(count)) throw new Error('Please supply a finite number');
    this.count = count;
    const notification = classifyServerless.createRequest(this, DiagnosticClientRequest);
    await notification.received(`server count changed to ${count}`);
  }

  async sendToPeer(message: string): Promise<void> {
    if (!this.peerSessionId) throw new Error('No peer has been paired by the application');
    if (typeof message !== 'string' || !message.trim()) throw new Error('Supply a message');
    const notification = await classifyServerless.createRequestForSession(this.peerSessionId, DiagnosticClientRequest);
    await notification.received(`peer: ${message}`);
  }

  async updatePeerState(message: string): Promise<void> {
    if (!this.peerSessionId) throw new Error('No peer has been paired by the application');
    await classifyServerless.createResponse(DiagnosticResponse, this.peerSessionId, async peer => {
      peer.lastPeerMessage = message;
    });
  }
}

serializable({ DiagnosticResponse });
