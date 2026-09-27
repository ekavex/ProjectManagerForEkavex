/**
 * Server-to-client event fan-out.
 *
 * Services emit through this module rather than importing the Socket.IO server, for two
 * reasons: the dependency points one way (services do not know about transport), and the
 * jobs and tests that run without a socket server simply get a no-op.
 */
import { projectRoom, userRoom, type ServerToClientEvents } from '@ekavist/shared';
import type { Server } from 'socket.io';
import { loggerFor } from '../lib/logger.js';

const log = loggerFor('realtime');

let io: Server | null = null;

export function registerSocketServer(server: Server): void {
  io = server;
}

export function clearSocketServer(): void {
  io = null;
}

/**
 * Emits to everyone currently viewing a project.
 *
 * Membership was verified when the socket joined the room, so this call does not repeat
 * the check; it is a delivery mechanism, not an authorisation point.
 */
export function emitToProject<E extends keyof ServerToClientEvents>(
  projectId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  if (io == null) return;
  try {
    (io.to(projectRoom(projectId)).emit as (name: string, ...rest: unknown[]) => void)(
      event,
      ...(args as unknown[]),
    );
  } catch (error) {
    // A broadcast failure must never fail the request that caused it.
    log.warn({ err: error, event, projectId }, 'Failed to broadcast a project event');
  }
}

export function emitToUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  if (io == null) return;
  try {
    (io.to(userRoom(userId)).emit as (name: string, ...rest: unknown[]) => void)(
      event,
      ...(args as unknown[]),
    );
  } catch (error) {
    log.warn({ err: error, event, userId }, 'Failed to deliver a user event');
  }
}
