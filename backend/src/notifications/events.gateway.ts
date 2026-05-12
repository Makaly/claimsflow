import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

// CORS allowlist for the WS handshake — mirrors the REST CORS rules in
// main.ts. Wildcard origin is incompatible with credentialed connections in
// modern browsers, so we read the same FRONTEND_URL env var. The localhost
// regex is anchored (^…$) so it can't be bypassed by hostnames like
// `https://localhost.evil.com`, and it's gated behind NODE_ENV so it is not
// on the prod allowlist.
const wsCorsOrigin: (string | RegExp)[] | RegExp = (() => {
  const allowed = process.env.FRONTEND_URL;
  const isDev = process.env.NODE_ENV !== 'production';
  const localhost = /^https?:\/\/localhost(:\d+)?$/;
  if (!allowed) return isDev ? localhost : [];
  return isDev ? [allowed, localhost] : [allowed];
})();

@WebSocketGateway({
  cors: { origin: wsCorsOrigin, credentials: true },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(EventsGateway.name);
  private userSockets = new Map<string, string[]>(); // userId → socketIds

  constructor(private jwtService: JwtService) {}

  /**
   * Token resolution order for WS auth, matching the REST side:
   *   1. handshake.auth.token   (socket.io-client { auth: { token } })
   *   2. Authorization header   ("Bearer …")
   *   3. access_token cookie    (HttpOnly, set by /api/auth/login)
   */
  private extractToken(client: Socket): string | undefined {
    const fromAuth = (client.handshake.auth as Record<string, unknown> | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

    const authHeader = client.handshake.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice('Bearer '.length);

    const cookieHeader = client.handshake.headers?.cookie;
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === 'access_token') return decodeURIComponent(rest.join('='));
      }
    }
    return undefined;
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) { client.disconnect(); return; }
      const payload = this.jwtService.verify(token);
      (client as any).userId = payload.sub;
      (client as any).role = payload.role;

      const existing = this.userSockets.get(payload.sub) || [];
      this.userSockets.set(payload.sub, [...existing, client.id]);
      client.join(`user:${payload.sub}`);
      client.join(`role:${payload.role ?? 'user'}`);
      this.logger.log(`Client connected: ${client.id} (user ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      const sockets = (this.userSockets.get(userId) || []).filter(id => id !== client.id);
      if (sockets.length) this.userSockets.set(userId, sockets);
      else this.userSockets.delete(userId);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { time: Date.now() });
  }

  // Emit to a specific user
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // Emit to all users with a specific role
  emitToRole(role: string, event: string, data: any) {
    this.server.to(`role:${role}`).emit(event, data);
  }

  // Broadcast to all connected clients
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }

  emitClaimAssigned(userId: string, claimNumber: string, stage: string) {
    this.emitToUser(userId, 'claim:assigned', { claimNumber, stage, timestamp: new Date() });
  }

  emitClaimStatusChanged(providerId: string, claimNumber: string, status: string) {
    this.emitToUser(providerId, 'claim:status', { claimNumber, status, timestamp: new Date() });
  }

  emitSlaBreached(claimNumber: string, stage: string) {
    this.emitToRole('supervisor', 'sla:breach', { claimNumber, stage, timestamp: new Date() });
    this.emitToRole('admin', 'sla:breach', { claimNumber, stage, timestamp: new Date() });
  }

  emitNewAppeal(claimNumber: string) {
    this.emitToRole('supervisor', 'appeal:new', { claimNumber, timestamp: new Date() });
    this.emitToRole('admin', 'appeal:new', { claimNumber, timestamp: new Date() });
  }

  emitBatchComplete(userId: string, batchNumber: string, totalClaims: number) {
    this.emitToUser(userId, 'batch:complete', { batchNumber, totalClaims, timestamp: new Date() });
  }
}
