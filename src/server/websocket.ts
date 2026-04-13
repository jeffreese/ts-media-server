import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import fp from 'fastify-plugin';
import {
  NotificationService,
  type NotificationEvent,
} from '../services/notification.js';

/** Supplies notification events that the plugin forwards to connected `/ws` clients. */
export interface WebSocketPluginOptions {
  notificationService: NotificationService;
}

/**
 * Format a notification event into the wire protocol expected by clients.
 *
 * Format: `action,source,id,userId`
 * - `id` and `userId` are extracted from `event.data` when present
 * - Missing fields are sent as empty strings
 */
export function formatMessage(event: NotificationEvent): string {
  const data = event.data as Record<string, unknown> | undefined;
  const id = data?.id ?? '';
  const userId = data?.userId ?? '';
  return `${event.action},${event.source},${id},${userId}`;
}

/**
 * WebSocket plugin that bridges NotificationService events to connected
 * clients. Each client receives every notification as a comma-delimited
 * message: `action,model,id,userId`.
 *
 * Wrapped with fastify-plugin so the `/ws` route is registered in the
 * parent scope (alongside other routes).
 */
export const websocketPlugin = fp<WebSocketPluginOptions>(
  async function websocketPlugin(
    app: FastifyInstance,
    opts: WebSocketPluginOptions,
  ): Promise<void> {
    const { notificationService } = opts;
    const clients = new Set<WebSocket>();

    const dispose = notificationService.addListener(
      (event: NotificationEvent) => {
        const message = formatMessage(event);
        for (const socket of clients) {
          if (socket.readyState === socket.OPEN) {
            socket.send(message);
          }
        }
      },
    );

    app.get('/ws', { websocket: true }, (socket: WebSocket) => {
      clients.add(socket);

      socket.on('close', () => {
        clients.delete(socket);
      });

      socket.on('error', () => {
        clients.delete(socket);
      });
    });

    app.addHook('onClose', () => {
      dispose();
      for (const socket of clients) {
        socket.close();
      }
      clients.clear();
    });
  },
  { name: 'websocket-events', dependencies: ['@fastify/websocket'] },
);
