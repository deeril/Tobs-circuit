import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifySchemaObjectCount,
  extractMigrationBody,
  migrations,
  shouldRunDispatchMigrations
} from '../scripts/migrate-dispatch.js';

test('dispatch migration schema checks allow absent or complete schemas only', () => {
  assert.equal(classifySchemaObjectCount(0, 4, 'test'), 'missing');
  assert.equal(classifySchemaObjectCount(4, 4, 'test'), 'complete');
  assert.throws(
    () => classifySchemaObjectCount(2, 4, 'test'),
    /partial schema \(2\/4 objects\)/
  );
});

test('migration runner removes only the outer transaction wrapper', () => {
  const sql = 'BEGIN;\nCREATE TABLE example (id TEXT);\nDO $$ BEGIN RAISE NOTICE \'ok\'; END $$;\nCOMMIT;';
  assert.equal(
    extractMigrationBody(sql, 'test'),
    'CREATE TABLE example (id TEXT);\nDO $$ BEGIN RAISE NOTICE \'ok\'; END $$;'
  );
});

test('migration runner rejects SQL without an outer transaction', () => {
  assert.throws(
    () => extractMigrationBody('CREATE TABLE example (id TEXT);', 'test'),
    /must have an outer BEGIN\/COMMIT transaction/
  );
});

test('multi-stop migration is registered for explicit production application', () => {
  assert.deepEqual(
    migrations.find(migration => migration.id === '20261127_01'),
    {
      id: '20261127_01',
      file: '20261127_01_enable_same_business_multi_stop_trips.sql',
      tables: [],
      columns: [],
      verifySchema: false
    }
  );
});

test('dispatch migrations run only for production deployments', () => {
  assert.equal(shouldRunDispatchMigrations({ NODE_ENV: 'production' }), true);
  assert.equal(shouldRunDispatchMigrations({ VERCEL_ENV: 'production' }), true);
  assert.equal(shouldRunDispatchMigrations({
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview'
  }), false);
  assert.equal(shouldRunDispatchMigrations({ NODE_ENV: 'development' }), false);
});

test('dispatch migration files have supported transaction wrappers', async () => {
  for (const file of [
    '20261109_01_dispatch_foundation.sql',
    '20261109_02_dispatch_batches_and_communications.sql',
    '20261110_03_dispatch_calls_and_message_idempotency.sql',
    '20261127_01_enable_same_business_multi_stop_trips.sql'
  ]) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    assert.ok(extractMigrationBody(sql, file).length > 0);
  }
});
