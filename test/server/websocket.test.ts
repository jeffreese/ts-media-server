import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createApp, type App } from '../../src/server/app.js';
import { NotificationService } from '../../src/services/notification.js';
import { websocketPlugin, formatMessage } from '../../src/server/websocket.js';
import type { Config } from '../../src/config/schema.js';
import type { NotificationEvent } from '../../src/services/notification.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    logLevel: 'silent',
    database: { path: ':memory:' },
    thumbnails: { sizes: ['300x300'] },
    concurrency: 1,
    ...overrides,
  };
}

const loggerOptions = { level: 'silent' as const };

describe('formatMessage', () => {
  it('formats a full event with id and userId', () => {
    const event: NotificationEvent = {
      action: 'create',
      source: 'mediaItem',
      data: { id: 42, userId: 7 },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(formatMessage(event)).toBe('create,mediaItem,42,7');
  });

  it('uses empty strings for missing id and userId', () => {
    const event: NotificationEvent = {
      action: 'update',
      source: 'setting',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(formatMessage(event)).toBe('update,setting,,');
  });

  it('handles data with only id', () => {
    const event: NotificationEvent = {
      action: 'delete',
      source: 'folder',
      data: { id: 99 },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(formatMessage(event)).toBe('delete,folder,99,');
  });

  it('handles progress events with no phase', () => {
    const event: NotificationEvent = {
      action: 'progress',
      source: 'indexing',
      data: { processed: 5, total: 100 },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(formatMessage(event)).toBe('progress,indexing,:5/100,');
  });

  it('encodes progress phase and counts', () => {
    const event: NotificationEvent = {
      action: 'progress',
      source: 'fileIndex',
      data: { phase: 'indexing', processed: 42, total: 100 },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(formatMessage(event)).toBe('progress,fileIndex,indexing:42/100,');
  });
});

describe('websocketPlugin', () => {
  let app: App;
  let notifications: NotificationService;

  beforeEach(() => {
    notifications = new NotificationService();
  });

  afterEach(async () => {
    await app?.close();
    notifications.removeAllListeners();
  }, 15_000);

  async function createTestApp(): Promise<App> {
    const result = await createApp({ config: makeConfig(), loggerOptions });
    await result.server.register(websocketPlugin, {
      notificationService: notifications,
    });
    await result.server.ready();
    return result;
  }

  it('accepts WebSocket connections on /ws', async () => {
    app = await createTestApp();

    const ws = await app.server.injectWS('/ws');
    expect(ws.readyState).toBe(ws.OPEN);
    ws.close();
  });

  it('broadcasts notification events to connected clients', async () => {
    app = await createTestApp();

    const ws = await app.server.injectWS('/ws');

    const messages: string[] = [];
    ws.on('message', (data) => {
      messages.push(data.toString());
    });

    notifications.notify('create', 'mediaItem', { id: 1, userId: 2 });

    await waitFor(() => messages.length > 0);

    expect(messages).toEqual(['create,mediaItem,1,2']);
    ws.close();
  });

  it('broadcasts to multiple connected clients', async () => {
    app = await createTestApp();

    const ws1 = await app.server.injectWS('/ws');
    const ws2 = await app.server.injectWS('/ws');

    const messages1: string[] = [];
    const messages2: string[] = [];
    ws1.on('message', (data) => messages1.push(data.toString()));
    ws2.on('message', (data) => messages2.push(data.toString()));

    notifications.notify('update', 'setting', { id: 5 });

    await waitFor(() => messages1.length > 0 && messages2.length > 0);

    expect(messages1).toEqual(['update,setting,5,']);
    expect(messages2).toEqual(['update,setting,5,']);

    ws1.close();
    ws2.close();
  });

  it('stops sending to a client after disconnect', async () => {
    app = await createTestApp();

    const ws1 = await app.server.injectWS('/ws');
    const ws2 = await app.server.injectWS('/ws');

    const messages1: string[] = [];
    const messages2: string[] = [];
    ws1.on('message', (data) => messages1.push(data.toString()));
    ws2.on('message', (data) => messages2.push(data.toString()));

    ws1.close();
    await waitFor(() => ws1.readyState === ws1.CLOSED);

    notifications.notify('delete', 'folder', { id: 10, userId: 3 });

    await waitFor(() => messages2.length > 0);
    await delay(50);

    expect(messages1).toHaveLength(0);
    expect(messages2).toEqual(['delete,folder,10,3']);

    ws2.close();
  });

  it('removes notification listener on server close', async () => {
    app = await createTestApp();

    expect(notifications.listenerCount).toBe(1);

    await app.close();

    expect(notifications.listenerCount).toBe(0);
  });

  it('delivers multiple sequential events in order', async () => {
    app = await createTestApp();

    const ws = await app.server.injectWS('/ws');

    const messages: string[] = [];
    ws.on('message', (data) => messages.push(data.toString()));

    notifications.notify('create', 'mediaItem', { id: 1 });
    notifications.notify('update', 'mediaItem', { id: 1 });
    notifications.notify('delete', 'mediaItem', { id: 1 });

    await waitFor(() => messages.length >= 3);

    expect(messages).toEqual([
      'create,mediaItem,1,',
      'update,mediaItem,1,',
      'delete,mediaItem,1,',
    ]);

    ws.close();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await delay(intervalMs);
  }
}
