import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const root = process.cwd();
const testEnvPath = resolve(root, '.env.dispatch-test.local');
const testEnv = existsSync(testEnvPath)
  ? parse(readFileSync(testEnvPath))
  : {};
const testDatabaseUrl = process.env.DISPATCH_TEST_DATABASE_URL
  || testEnv.DISPATCH_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error('Set DISPATCH_TEST_DATABASE_URL in the git-ignored .env.dispatch-test.local file.');
  process.exit(1);
}

function databaseIdentity(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new TypeError('DISPATCH_TEST_DATABASE_URL must be a PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new TypeError('DISPATCH_TEST_DATABASE_URL must be a PostgreSQL URL.');
  }
  return [
    url.hostname.toLowerCase(),
    url.port || '5432',
    decodeURIComponent(url.pathname)
  ].join('/');
}

const applicationDatabaseUrls = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_PRISMA_URL
];
for (const envPath of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const path = resolve(root, envPath);
  if (!existsSync(path)) continue;
  const values = parse(readFileSync(path));
  applicationDatabaseUrls.push(
    values.DATABASE_URL,
    values.POSTGRES_URL,
    values.POSTGRES_PRISMA_URL
  );
}

const testIdentity = databaseIdentity(testDatabaseUrl);
if (applicationDatabaseUrls.some(value => value && databaseIdentity(value) === testIdentity)) {
  console.error('Refusing to run: the test URL points to the same PostgreSQL host/database as the application URL.');
  process.exit(1);
}

console.log('Running PostgreSQL integration tests against the configured isolated test database.');
console.log('The suite creates and drops its own temporary dispatch_test_* schema.');
const result = spawnSync(process.execPath, [
  '--test',
  'tests/dispatch.integration.test.js',
  'tests/stage2b-services.test.js',
  'tests/maplibre-markers.test.js'
], {
  cwd: root,
  env: { ...process.env, DISPATCH_TEST_DATABASE_URL: testDatabaseUrl },
  stdio: 'inherit'
});

if (result.error) {
  console.error(`Could not start the test runner: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
