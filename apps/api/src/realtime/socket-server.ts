/**
 * The Socket.IO server.
 *
 * Authorisation happens twice and never on the client's word: the handshake verifies the
 * access token and loads the user, and joining a project room re-checks membership through
 * the same policy layer the REST API uses. A socket carries deltas, never permissions.
 */
import {
  projectRoom,
  userRoom,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@ekavist/shared';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { loggerFor } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { loadOrgPermissions, type Actor } from '../policy/actor.js';
import { loadProjectContext } from '../policy/project-access.js';
import { registerSocketServer, clearSocketServer } from './emitter.js';

const log = loggerFor('socket');

interface SocketData {
  actor: Actor;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(httpServer, {
    cors: { origin: env.APP_URL, credentials: true },
    // A project chat is small; the default 1 MB buffer is more than enough and keeps a
    // misbehaving client from allocating memory on the server.
    maxHttpBufferSize: 1_000_000,
  });

  io.use((socket, next) => {
    void (async () => {
      const token =
        typeof socket.handshake.auth?.['token'] === 'string'
          ? (socket.handshake.auth['token'] as string)
          : null;
      if (token == null) throw new Error('No access token was supplied.');

      const claims = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: {
          id: true,
          organizationId: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
          timezone: true,
        },
      });

      if (user == null || user.status !== 'ACTIVE') {
        throw new Error('This account cannot connect.');
      }

      socket.data.actor = {
        id: user.id,
        organizationId: user.organizationId,
        role: user.role,
        email: user.email,
        fullName: user.fullName,
        timezone: user.timezone,
        permissions: await loadOrgPermissions(prisma, user.organizationId, user.role),
      };
    })().then(
      () => next(),
      (error: unknown) => {
        log.debug({ err: error }, 'Rejected a socket handshake');
        next(error instanceof Error ? error : new Error('Authentication failed.'));
      },
    );
  });

  io.on('connection', (socket: AppSocket) => {
    const actor = socket.data.actor;
    // Every connection joins its own room, so notifications reach a person on any device.
    void socket.join(userRoom(actor.id));
    log.debug({ userId: actor.id }, 'Socket connected');

    socket.on('project:join', (projectId, ack) => {
      void (async () => {
        try {
          const context = await loadProjectContext(prisma, actor, projectId);
          if (!context.permissions.has('chat:read') && !context.permissions.has('project:read')) {
            ack?.(false);
            return;
          }
          await socket.join(projectRoom(projectId));
          ack?.(true);
        } catch {
          // A project the caller cannot see is simply refused; no detail is leaked.
          ack?.(false);
        }
      })();
    });

    socket.on('project:leave', (projectId) => {
      void socket.leave(projectRoom(projectId));
    });

    socket.on('disconnect', (reason) => {
      log.debug({ userId: actor.id, reason }, 'Socket disconnected');
    });
  });

  registerSocketServer(io);
  return io;
}

export async function closeSocketServer(io: Server): Promise<void> {
  clearSocketServer();
  await io.close();
}
