import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations'
);

export const migrations = [
  {
    id: '20261109_01',
    file: '20261109_01_dispatch_foundation.sql',
    tables: [
      'dispatch_deliveries',
      'dispatch_business_riders',
      'rider_dispatch_profiles',
      'rider_current_locations',
      'dispatch_offers',
      'delivery_assignments',
      'delivery_assignment_history',
      'delivery_status_history',
      'rider_location_history',
      'rider_location_access_audit'
    ],
    columns: []
  },
  {
    id: '20261109_02',
    file: '20261109_02_dispatch_batches_and_communications.sql',
    tables: [
      'dispatch_business_batch_preferences',
      'delivery_batch_offers',
      'delivery_batch_offer_items',
      'delivery_messages',
      'dispatch_notifications',
      'delivery_proofs'
    ],
    columns: [
      ['dispatch_deliveries', 'deadline_at'],
      ['rider_dispatch_profiles', 'max_package_count'],
      ['rider_dispatch_profiles', 'accepts_cross_business_batches'],
      ['delivery_assignments', 'batch_offer_id']
    ]
  },
  {
    id: '20261110_03',
    file: '20261110_03_dispatch_calls_and_message_idempotency.sql',
    tables: ['dispatch_calls'],
    columns: [['delivery_messages', 'client_message_id']]
  },
  {
    id: '20261127_01',
    file: '20261127_01_enable_same_business_multi_stop_trips.sql',
    tables: [],
    columns: [],
    verifySchema: false
  },
  {
    id: '20261127_02',
    file: '20261127_02_allow_zero_package_multi_stop_waypoints.sql',
    tables: [],
    columns: [],
    verifySchema: false
  }
];

export function classifySchemaObjectCount(present, expected, migrationId) {
  if (!Number.isInteger(present) || !Number.isInteger(expected)
    || expected < 1 || present < 0 || present > expected) {
    throw new TypeError('Invalid dispatch migration schema object counts.');
  }
  if (present === 0) return 'missing';
  if (present === expected) return 'complete';
  throw new Error(
    `Migration ${migrationId} has a partial schema (${present}/${expected} objects); refusing to apply it automatically.`
  );
}

export function extractMigrationBody(sql, migrationId) {
  const match = sql.match(/^\s*BEGIN\s*;\s*([\s\S]+?)\s*COMMIT\s*;\s*$/i);
  if (!match) {
    throw new Error(`Migration ${migrationId} must have an outer BEGIN/COMMIT transaction.`);
  }
  return match[1];
}

export function shouldRunDispatchMigrations(environment = process.env) {
  if (environment.VERCEL_ENV) return environment.VERCEL_ENV === 'production';
  return environment.NODE_ENV === 'production';
}

async function getSchemaObjectCount(client, migration) {
  const tables = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [migration.tables]);
  const columns = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns AS present
    JOIN unnest($1::text[], $2::text[]) AS expected(table_name, column_name)
      ON expected.table_name = present.table_name
     AND expected.column_name = present.column_name
    WHERE present.table_schema = 'public'
  `, [
    migration.columns.map(([table]) => table),
    migration.columns.map(([, column]) => column)
  ]);
  return tables.rows[0].count + columns.rows[0].count;
}

async function applyMigrations(client) {
  await client.query('SELECT pg_advisory_lock(819204, 20261109)');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tobs_dispatch_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      const recorded = await client.query(
        'SELECT 1 FROM public.tobs_dispatch_migrations WHERE migration_id = $1',
        [migration.id]
      );
      if (recorded.rowCount) {
        console.log(`Dispatch migration ${migration.id} already recorded.`);
        continue;
      }

      const expected = migration.tables.length + migration.columns.length;
      if (migration.verifySchema !== false) {
        const present = await getSchemaObjectCount(client, migration);
        const schemaState = classifySchemaObjectCount(present, expected, migration.id);
        if (schemaState === 'complete') {
          await client.query(
            'INSERT INTO public.tobs_dispatch_migrations (migration_id) VALUES ($1)',
            [migration.id]
          );
          console.log(`Recorded existing dispatch schema for ${migration.id}.`);
          continue;
        }
      }

      const sql = await readFile(path.join(migrationDirectory, migration.file), 'utf8');
      const body = extractMigrationBody(sql, migration.id);
      await client.query('BEGIN');
      try {
        await client.query(body);
        if (migration.verifySchema !== false) {
          const appliedObjects = await getSchemaObjectCount(client, migration);
          classifySchemaObjectCount(appliedObjects, expected, migration.id);
        }
        await client.query(
          'INSERT INTO public.tobs_dispatch_migrations (migration_id) VALUES ($1)',
          [migration.id]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(`Applied dispatch migration ${migration.id}.`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(819204, 20261109)');
  }
}

async function runDispatchMigrations() {
  if (!shouldRunDispatchMigrations()) {
    console.log('Skipping dispatch migrations outside production.');
    return;
  }

  const databaseUrl = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL;
  if (!databaseUrl) {
    throw new Error('Set DATABASE_URL before applying production dispatch migrations.');
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000
  });
  await client.connect();
  try {
    await applyMigrations(client);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDispatchMigrations().catch(error => {
    console.error(`Dispatch migration startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
