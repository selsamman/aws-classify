import { reqBody } from 'aws-classify-common';

export class DiagnosticRequest {
  static interfaceName = 'DiagnosticRequest';
  async publicPingPublic(): Promise<string> { return reqBody(); }
  async getCount(): Promise<number> { return reqBody(); }
  async setCount(count: number): Promise<void> { return reqBody(); }
  async sendToPeer(message: string): Promise<void> { return reqBody(); }
  async updatePeerState(message: string): Promise<void> { return reqBody(); }
}

export class DiagnosticClientRequest {
  static interfaceName = 'DiagnosticClientRequest';
  async received(message: string): Promise<void> { return reqBody(); }
}
