import 'dotenv/config';
import pg from 'pg';
import { DELETE_EXPIRED_GPS_BATCH_SQL, DISPATCH_GPS_RETENTION_DAYS } from '../server/dispatch-retention.js';

const databaseUrl = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL;

if (process.env.DISPATCH_GPS_CLEANUP_CONFIRM !== 'DELETE_EXPIRED_GPS') {
  throw new Error('Set DISPATCH_GPS_CLEANUP_CONFIRM=DELETE_EXPIRED_GPS to run GPS retention cleanup.');
}
if (!databaseUrl) {
  throw new Error('Set DATABASE_URL to the database that contains rider_location_history.');
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const { rows } = await pool.query(`
    SELECT to_regclass('public.rider_location_history') IS NOT NULL AS ready
  `);
  if (!rows[0]?.ready) {
    throw new Error('The dispatch migration must be applied before GPS retention cleanup can run.');
  }

  let deletedCount = 0;
  while (true) {
    const result = await pool.query(DELETE_EXPIRED_GPS_BATCH_SQL, [DISPATCH_GPS_RETENTION_DAYS]);
    deletedCount += result.rowCount;
    if (result.rowCount < 1000) break;
  }
  console.info(`Removed ${deletedCount} GPS history rows older than ${DISPATCH_GPS_RETENTION_DAYS} days.`);
} finally {
  await pool.end();
}
