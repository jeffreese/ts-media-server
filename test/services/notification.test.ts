import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotificationService,
  type NotificationEvent,
  type NotificationListener,
} from '../../src/services/notification.js';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
  });

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  describe('notify', () => {
    it('delivers events to registered listeners', () => {
      const received: NotificationEvent[] = [];
      service.addListener((event) => received.push(event));

      service.notify('create', 'mediaItem', { id: 1 });

      expect(received).toHaveLength(1);
      expect(received[0].action).toBe('create');
      expect(received[0].source).toBe('mediaItem');
      expect(received[0].data).toEqual({ id: 1 });
      expect(received[0].timestamp).toBeTruthy();
    });

    it('delivers events to multiple listeners', () => {
      const received1: NotificationEvent[] = [];
      const received2: NotificationEvent[] = [];
      service.addListener((event) => received1.push(event));
      service.addListener((event) => received2.push(event));

      service.notify('update', 'file');

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('includes an ISO timestamp on each event', () => {
      const received: NotificationEvent[] = [];
      service.addListener((event) => received.push(event));

      service.notify('delete', 'folder');

      const ts = received[0].timestamp;
      expect(() => new Date(ts).toISOString()).not.toThrow();
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('allows data to be omitted', () => {
      const received: NotificationEvent[] = [];
      service.addListener((event) => received.push(event));

      service.notify('progress', 'indexing');

      expect(received[0].data).toBeUndefined();
    });

    it('does nothing when there are no listeners', () => {
      expect(() => service.notify('create', 'mediaItem')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Event types
  // -------------------------------------------------------------------------

  describe('event types', () => {
    it.each(['create', 'update', 'delete', 'progress'] as const)(
      'supports the "%s" action',
      (action) => {
        const received: NotificationEvent[] = [];
        service.addListener((event) => received.push(event));

        service.notify(action, 'test');

        expect(received[0].action).toBe(action);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Listener registration
  // -------------------------------------------------------------------------

  describe('addListener', () => {
    it('returns a dispose function that removes the listener', () => {
      const received: NotificationEvent[] = [];
      const dispose = service.addListener((event) => received.push(event));

      service.notify('create', 'a');
      expect(received).toHaveLength(1);

      dispose();
      service.notify('create', 'b');
      expect(received).toHaveLength(1);
    });

    it('tracks listener count correctly', () => {
      expect(service.listenerCount).toBe(0);

      const dispose1 = service.addListener(() => {});
      expect(service.listenerCount).toBe(1);

      const dispose2 = service.addListener(() => {});
      expect(service.listenerCount).toBe(2);

      dispose1();
      expect(service.listenerCount).toBe(1);

      dispose2();
      expect(service.listenerCount).toBe(0);
    });

    it('allows the same callback to be registered multiple times', () => {
      const fn = vi.fn();
      service.addListener(fn);
      service.addListener(fn);

      service.notify('create', 'test');

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // removeAllListeners
  // -------------------------------------------------------------------------

  describe('removeAllListeners', () => {
    it('removes all registered listeners', () => {
      const received: NotificationEvent[] = [];
      service.addListener((event) => received.push(event));
      service.addListener((event) => received.push(event));

      service.removeAllListeners();

      service.notify('create', 'test');
      expect(received).toHaveLength(0);
      expect(service.listenerCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Ordering
  // -------------------------------------------------------------------------

  describe('event ordering', () => {
    it('delivers events in emission order', () => {
      const received: string[] = [];
      service.addListener((event) => received.push(event.source));

      service.notify('create', 'first');
      service.notify('update', 'second');
      service.notify('delete', 'third');

      expect(received).toEqual(['first', 'second', 'third']);
    });
  });
});
