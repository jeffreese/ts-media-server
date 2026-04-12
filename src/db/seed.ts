import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { DatabaseClient } from './client.js';
import * as schema from './schema.js';

const DEFAULT_COMPONENTS = [
  { key: 'SysAdmin', label: 'System Administration', description: 'Full system access' },
  { key: 'UserAdmin', label: 'User Administration', description: 'Manage users and groups' },
  { key: 'Media', label: 'Media', description: 'Access to media library' },
  { key: 'Contact', label: 'Contacts', description: 'Access to contacts and people' },
] as const;

const ADMIN_ACCESS_LEVEL = 5;

function defaultSettings(): Array<{ key: string; value: string }> {
  return [
    { key: 'db_date', value: new Date().toISOString() },
    { key: 'auth_status', value: 'disabled' },
  ];
}

/**
 * Seed the database with the minimum records required for the application to
 * function: a default person, a default admin user, the four core components,
 * admin access grants, and initial settings.
 *
 * Idempotent — checks for existing component records before inserting.
 */
export function seedDatabase(client: DatabaseClient): void {
  const db = drizzle(client.db, { schema });

  db.transaction((tx) => {
    const existingComponents = tx.select().from(schema.component).all();
    if (existingComponents.length > 0) return;

    const defaultPerson = tx
      .insert(schema.person)
      .values({ info: JSON.stringify({ role: 'admin' }) })
      .returning()
      .get();

    const defaultUser = tx
      .insert(schema.user)
      .values({ personId: defaultPerson.id, status: 'active' })
      .returning()
      .get();

    tx.insert(schema.personName)
      .values({ personId: defaultPerson.id, name: 'Admin', preferred: true })
      .run();

    for (const comp of DEFAULT_COMPONENTS) {
      const inserted = tx
        .insert(schema.component)
        .values(comp)
        .returning()
        .get();

      tx.insert(schema.userAccess).values({
        userId: defaultUser.id,
        componentId: inserted.id,
        level: ADMIN_ACCESS_LEVEL,
      }).run();
    }

    for (const s of defaultSettings()) {
      tx.insert(schema.setting)
        .values(s)
        .onConflictDoNothing()
        .run();
    }
  });
}
