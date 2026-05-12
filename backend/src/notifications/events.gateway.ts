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

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/events' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(EventsGateway.name);
  private userSockets = new Map<string, string[]>(); // userId → socketIds

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
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
