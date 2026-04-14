import { describe, it, expect, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import { NotificationService } from '../../../src/services/notification.js';
import * as schema from '../../../src/db/schema.js';
import type { Config } from '../../../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    logLevel: 'silent',
    database: { path: ':memory:' },
    thumbnails: { sizes: ['300x300'] },
    concurrency: 1,
    jwt: { secret: 'test-secret', expiresIn: '1h' },
    ...overrides,
  };
}

const loggerOptions = { level: 'silent' as const };

describe('people routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;
  let notifications: NotificationService;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  function createPerson(client: DatabaseClient, opts: { gender?: string; birthday?: string } = {}): number {
    const db = drizzle(client.db, { schema });
    const person = db.insert(schema.person).values({
      gender: opts.gender ?? null,
      birthday: opts.birthday ?? null,
    }).returning().get();
    return person.id;
  }

  function createAddress(client: DatabaseClient, opts: Partial<typeof schema.address.$inferInsert> = {}): number {
    const db = drizzle(client.db, { schema });
    const addr = db.insert(schema.address).values({
      street: opts.street ?? '123 Main St',
      city: opts.city ?? 'Springfield',
      state: opts.state ?? 'IL',
      postalCode: opts.postalCode ?? '62701',
    }).returning().get();
    return addr.id;
  }

  function createFeature(client: DatabaseClient): number {
    const db = drizzle(client.db, { schema });
    const host = db.insert(schema.host).values({ name: 'test' }).returning().get();
    const path = db.insert(schema.path).values({ dir: '/photos', hostId: host.id }).returning().get();
    const file = db.insert(schema.file).values({ name: 'photo', extension: 'jpg', pathId: path.id }).returning().get();
    const item = db.insert(schema.mediaItem).values({ name: 'Test Photo', type: 'image' }).returning().get();
    db.insert(schema.mediaItemFile).values({ mediaItemId: item.id, fileId: file.id, isPrimary: true }).run();
    const feature = db.insert(schema.feature).values({ itemId: item.id, label: 'face1' }).returning().get();
    return feature.id;
  }

  async function setupApp(client: DatabaseClient): Promise<void> {
    notifications = new NotificationService();
    app = await createApp({
      config: makeConfig(),
      db: client.db,
      loggerOptions,
      notificationService: notifications,
    });
    await app.server.ready();
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Person Names
  // ---------------------------------------------------------------------------

  describe('GET /person/:personId/names', () => {
    it('returns empty list for a person with no names', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/names`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
      expect(res.json().total).toBe(0);
    });

    it('returns names for a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'John Doe', preferred: true },
      });
      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'Johnny' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/names`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
      expect(res.json().total).toBe(2);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      for (const name of ['Alice', 'Bob', 'Charlie']) {
        await app.server.inject({
          method: 'POST',
          url: `/person/${personId}/names`,
          payload: { name },
        });
      }

      const res = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/names?offset=0&limit=2`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
      expect(res.json().total).toBe(3);
    });

    it('returns 404 for non-existent person', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/person/9999/names',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /person/:personId/names', () => {
    it('creates a name for a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'Jane Smith', preferred: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Jane Smith');
      expect(body.preferred).toBe(true);
      expect(body.personId).toBe(personId);
    });

    it('clears preferred flag on existing names when setting a new preferred', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const first = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'First', preferred: true },
      });
      const firstId = first.json().id;

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'Second', preferred: true },
      });

      const db = drizzle(client.db, { schema });
      const firstUpdated = db.select().from(schema.personName).where(eq(schema.personName.id, firstId)).get();
      expect(firstUpdated!.preferred).toBe(false);
    });

    it('emits an update notification on the person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'Test Name' },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('person');
    });

    it('returns 400 for empty name', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent person', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/person/9999/names',
        payload: { name: 'Test' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /person/:personId/names', () => {
    it('removes a name from a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'To Remove' },
      });
      const nameId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/person/${personId}/names`,
        payload: { id: nameId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/names`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });

    it('returns 404 for name not belonging to this person', async () => {
      const client = setupDb();
      const personA = createPerson(client);
      const personB = createPerson(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/person/${personA}/names`,
        payload: { name: 'Person A Name' },
      });
      const nameId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/person/${personB}/names`,
        payload: { id: nameId },
      });

      expect(deleteRes.statusCode).toBe(404);
    });

    it('returns 400 for missing id', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'DELETE',
        url: `/person/${personId}/names`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Person Contacts
  // ---------------------------------------------------------------------------

  describe('POST /person/:personId/contacts', () => {
    it('creates a contact for a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/contacts`,
        payload: { contact: 'john@example.com', type: 'email' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contact).toBe('john@example.com');
      expect(body.type).toBe('email');
      expect(body.personId).toBe(personId);
    });

    it('returns 400 for empty contact', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/contacts`,
        payload: { contact: '' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /person/:personId/contacts', () => {
    it('returns contacts for a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/contacts`,
        payload: { contact: 'john@example.com', type: 'email' },
      });
      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/contacts`,
        payload: { contact: '+1-555-0100', type: 'phone' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/contacts`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
      expect(res.json().total).toBe(2);
    });
  });

  describe('DELETE /person/:personId/contacts', () => {
    it('removes a contact from a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/contacts`,
        payload: { contact: 'delete@me.com', type: 'email' },
      });
      const contactId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/person/${personId}/contacts`,
        payload: { id: contactId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Person Addresses
  // ---------------------------------------------------------------------------

  describe('POST /person/:personId/addresses', () => {
    it('links a person to an address', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const addressId = createAddress(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/addresses`,
        payload: { addressId, type: 'home', preferred: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.addressId).toBe(addressId);
      expect(body.personId).toBe(personId);
      expect(body.type).toBe('home');
      expect(body.preferred).toBe(true);
    });

    it('returns alreadyLinked when address is already linked', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const addressId = createAddress(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/addresses`,
        payload: { addressId },
      });

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/addresses`,
        payload: { addressId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().alreadyLinked).toBe(true);
    });

    it('returns 404 for non-existent address', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/addresses`,
        payload: { addressId: 9999 },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /person/:personId/addresses', () => {
    it('returns addresses with address details joined', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const addressId = createAddress(client, { street: '456 Oak Ave', city: 'Chicago' });
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/addresses`,
        payload: { addressId, type: 'work' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/addresses`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.street).toBe('456 Oak Ave');
      expect(item.city).toBe('Chicago');
      expect(item.type).toBe('work');
    });
  });

  describe('DELETE /person/:personId/addresses', () => {
    it('removes an address link from a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const addressId = createAddress(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/addresses`,
        payload: { addressId },
      });
      const linkId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/person/${personId}/addresses`,
        payload: { id: linkId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Person-Feature linking (assign faces to people)
  // ---------------------------------------------------------------------------

  describe('POST /person/:personId/features', () => {
    it('links a feature to a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const featureId = createFeature(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.featureId).toBe(featureId);
      expect(body.personId).toBe(personId);
    });

    it('returns alreadyLinked when feature is already linked', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const featureId = createFeature(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId },
      });

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().alreadyLinked).toBe(true);
    });

    it('returns 404 for non-existent feature', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId: 9999 },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /person/:personId/features', () => {
    it('returns linked features with feature details', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const featureId = createFeature(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/features`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.featureId).toBe(featureId);
      expect(item.label).toBe('face1');
    });
  });

  describe('DELETE /person/:personId/features', () => {
    it('removes a feature link from a person', async () => {
      const client = setupDb();
      const personId = createPerson(client);
      const featureId = createFeature(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId },
      });
      const linkId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/person/${personId}/features`,
        payload: { id: linkId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/person/${personId}/features`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /people/batch — batch loading of names + first feature
  // ---------------------------------------------------------------------------

  describe('POST /people/batch', () => {
    it('returns names and first feature for multiple people', async () => {
      const client = setupDb();
      const personA = createPerson(client);
      const personB = createPerson(client);
      const featureId = createFeature(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personA}/names`,
        payload: { name: 'Alice', preferred: true },
      });
      await app.server.inject({
        method: 'POST',
        url: `/person/${personB}/names`,
        payload: { name: 'Bob' },
      });
      await app.server.inject({
        method: 'POST',
        url: `/person/${personA}/features`,
        payload: { featureId },
      });

      const res = await app.server.inject({
        method: 'POST',
        url: '/people/batch',
        payload: { ids: [personA, personB] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);

      const itemA = body.items.find((i: { personId: number }) => i.personId === personA);
      expect(itemA.names).toHaveLength(1);
      expect(itemA.names[0].name).toBe('Alice');
      expect(itemA.firstFeature).not.toBeNull();
      expect(itemA.firstFeature.featureId).toBe(featureId);
      expect(itemA.photoCount).toBe(1);

      const itemB = body.items.find((i: { personId: number }) => i.personId === personB);
      expect(itemB.names).toHaveLength(1);
      expect(itemB.names[0].name).toBe('Bob');
      expect(itemB.firstFeature).toBeNull();
      expect(itemB.photoCount).toBe(0);
    });

    it('returns empty items for unknown person IDs', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/people/batch',
        payload: { ids: [9999] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].names).toEqual([]);
      expect(body.items[0].firstFeature).toBeNull();
    });

    it('returns 400 for missing ids', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/people/batch',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for empty ids array', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/people/batch',
        payload: { ids: [] },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /feature/:featureId/person — reverse lookup
  // ---------------------------------------------------------------------------

  describe('GET /feature/:featureId/person', () => {
    it('returns the person linked to a feature', async () => {
      const client = setupDb();
      const personId = createPerson(client, { gender: 'male' });
      const featureId = createFeature(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/names`,
        payload: { name: 'John Doe', preferred: true },
      });

      await app.server.inject({
        method: 'POST',
        url: `/person/${personId}/features`,
        payload: { featureId },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/feature/${featureId}/person`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.person.id).toBe(personId);
      expect(body.person.gender).toBe('male');
      expect(body.names).toHaveLength(1);
      expect(body.names[0].name).toBe('John Doe');
      expect(body.link.featureId).toBe(featureId);
    });

    it('returns 404 when no person is linked to a feature', async () => {
      const client = setupDb();
      const featureId = createFeature(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/feature/${featureId}/person`,
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
