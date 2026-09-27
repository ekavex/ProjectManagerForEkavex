/**
 * The Socket.IO contract. Sockets carry deltas so open views stay fresh; they never carry
 * authorisation. A client that receives an event still reads through the REST API for
 * anything it does not already hold, and the server only emits into a project room after
 * verifying membership at handshake time.
 */
import type { Message, Notification, TaskSummary } from './types/core.js';

export const SOCKET_EVENTS = {
  MESSAGE_CREATED: 'message:created',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_PINNED: 'message:pinned',
  MESSAGE_UNPINNED: 'message:unpinned',
  MESSAGE_REACTION: 'message:reaction',
  TASK_UPDATED: 'task:updated',
  NOTIFICATION_NEW: 'notification:new',
  PRESENCE_CHANGED: 'presence:changed',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export interface ServerToClientEvents {
  'message:created': (payload: { projectId: string; message: Message }) => void;
  'message:updated': (payload: { projectId: string; message: Message }) => void;
  'message:deleted': (payload: { projectId: string; messageId: string }) => void;
  'message:pinned': (payload: { projectId: string; message: Message }) => void;
  'message:unpinned': (payload: { projectId: string; messageId: string }) => void;
  'message:reaction': (payload: { projectId: string; message: Message }) => void;
  'task:updated': (payload: { projectId: string; task: TaskSummary }) => void;
  'notification:new': (payload: { notification: Notification; unreadCount: number }) => void;
  'presence:changed': (payload: { userId: string; online: boolean }) => void;
}

export interface ClientToServerEvents {
  'project:join': (projectId: string, ack?: (ok: boolean) => void) => void;
  'project:leave': (projectId: string) => void;
}

export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}
