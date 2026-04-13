import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle or progress signal carried on the in-process notification bus. */
export type NotificationAction = 'create' | 'update' | 'delete' | 'progress';

/**
 * Payload emitted to listeners; `source` names the emitting area (for example a model or subsystem).
 * `data` is action-specific and may be omitted.
 */
export interface NotificationEvent {
  action: NotificationAction;
  source: string;
  data?: unknown;
  timestamp: string;
}

/** Handler registered with `NotificationService.addListener`. */
export type NotificationListener = (event: NotificationEvent) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * EventEmitter-based notification bus for broadcasting model changes and
 * indexing progress throughout the application.
 *
 * Consumers register listeners via `addListener`. Producers call `notify`
 * to emit typed events. The WebSocket handler (Phase 8) will subscribe
 * here to push events to connected clients.
 */
export class NotificationService {
  private readonly emitter = new EventEmitter();
  private static readonly EVENT_NAME = 'notification';

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  /**
   * Emit a typed notification event to all registered listeners.
   */
  notify(action: NotificationAction, source: string, data?: unknown): void {
    const event: NotificationEvent = {
      action,
      source,
      data,
      timestamp: new Date().toISOString(),
    };
    this.emitter.emit(NotificationService.EVENT_NAME, event);
  }

  /**
   * Register a callback that will be invoked for every notification.
   * Returns a dispose function that removes the listener.
   */
  addListener(callback: NotificationListener): () => void {
    this.emitter.on(NotificationService.EVENT_NAME, callback);
    return () => {
      this.emitter.off(NotificationService.EVENT_NAME, callback);
    };
  }

  /** Number of currently registered listeners. */
  get listenerCount(): number {
    return this.emitter.listenerCount(NotificationService.EVENT_NAME);
  }

  /** Remove all listeners. */
  removeAllListeners(): void {
    this.emitter.removeAllListeners(NotificationService.EVENT_NAME);
  }
}
