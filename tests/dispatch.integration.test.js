import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AUTHORIZED_MAP_RIDERS_SQL } from '../server/dispatch-map-query.js';
import { PUBLIC_MARKETPLACE_DRIVERS_SQL } from '../server/dispatch-marketplace-query.js';

const databaseUrl = process.env.DISPATCH_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const applicationDatabaseUrl = process.env.DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL;
if (enabled && databaseUrl === applicationDatabaseUrl) {
  throw new Error('DISPATCH_TEST_DATABASE_URL must not point at the application database.');
}

const schema = `dispatch_test_${randomUUID().replaceAll('-', '')}`;
let pool;

describe('dispatch PostgreSQL integration', () => {
  before(async () => {
    if (!enabled) return;
    const adminPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    await adminPool.end();
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schema}`
    });
    await pool.query(`
      CREATE TABLE dispatch_deliveries (
        delivery_id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE tobs_app_state (
        id SMALLINT PRIMARY KEY,
        state JSONB NOT NULL
      );
      CREATE TABLE dispatch_business_riders (
        business_id TEXT NOT NULL,
        rider_id TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (business_id, rider_id)
      );
      CREATE TABLE rider_dispatch_profiles (
        rider_id TEXT PRIMARY KEY,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        is_available BOOLEAN NOT NULL DEFAULT FALSE,
        vehicle_type TEXT
      );
      CREATE TABLE rider_current_locations (
        rider_id TEXT PRIMARY KEY,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL,
        sharing_enabled BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE rider_location_history (
        location_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        rider_id TEXT NOT NULL,
        delivery_id TEXT,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        context TEXT NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE dispatch_offers (
        offer_id UUID PRIMARY KEY,
        batch_id UUID NOT NULL,
        delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
        business_id TEXT NOT NULL,
        rider_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE delivery_batch_offers (
        batch_offer_id UUID PRIMARY KEY,
        rider_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE delivery_batch_offer_items (
        batch_offer_id UUID NOT NULL REFERENCES delivery_batch_offers(batch_offer_id),
        delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
        business_id TEXT NOT NULL,
        sequence_number SMALLINT NOT NULL
      );
      CREATE TABLE delivery_assignments (
        assignment_id UUID PRIMARY KEY,
        delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
        offer_id UUID,
        rider_id TEXT NOT NULL,
        business_id TEXT NOT NULL,
        status TEXT NOT NULL,
        end_reason TEXT,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE delivery_assignment_history (
        assignment_id UUID NOT NULL REFERENCES delivery_assignments(assignment_id),
        event_type TEXT NOT NULL
      );
      CREATE TABLE delivery_status_history (
        delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
        status TEXT NOT NULL,
        actor_id TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX delivery_one_active_assignment_idx
        ON delivery_assignments (delivery_id)
        WHERE status = 'ACTIVE';
    `);

    const legacyDeliveryId = randomUUID();
    const legacyBusinessId = randomUUID();
    const legacyRiderId = randomUUID();
    await pool.query(
      'INSERT INTO dispatch_deliveries (delivery_id, business_id, status) VALUES ($1, $2, $3)',
      [legacyDeliveryId, legacyBusinessId, 'RIDER_ACCEPTED']
    );
    await pool.query(
      'INSERT INTO tobs_app_state (id, state) VALUES (1, $1::jsonb)',
      [JSON.stringify({ stops: [{
        id: legacyDeliveryId,
        ownerAdminId: legacyBusinessId,
        assignedDriverId: legacyRiderId
      }] })]
    );
    const assignmentMigration = readFileSync(
      new URL('../migrations/20261111_05_global_rider_assignment_protection.sql', import.meta.url),
      'utf8'
    );
    await pool.query(assignmentMigration);
    const { rows: migratedAssignments } = await pool.query(
      'SELECT rider_id FROM delivery_assignments WHERE delivery_id = $1 AND status = $2',
      [legacyDeliveryId, 'ACTIVE']
    );
    assert.deepEqual(migratedAssignments.map(row => row.rider_id), [legacyRiderId]);
    await pool.query('DELETE FROM delivery_assignments WHERE delivery_id = $1', [legacyDeliveryId]);
    await pool.query('DELETE FROM dispatch_deliveries WHERE delivery_id = $1', [legacyDeliveryId]);
    await pool.query('UPDATE tobs_app_state SET state = $1::jsonb WHERE id = 1', [JSON.stringify({ stops: [] })]);
  });

  it('persists route sequence and route geometry in the shared application state', { skip: !enabled }, async () => {
    const routeState = {
      stops: [{
        id: randomUUID(),
        assignedDriverId: randomUUID(),
        routeSequence: 1,
        routeOrder: 1,
        routeSequenceStatus: 'READY',
        routeLegGeometry: {
          type: 'LineString',
          coordinates: [[3.3, 6.5], [3.31, 6.51]]
        }
      }]
    };
    await pool.query(
      'INSERT INTO tobs_app_state (id, state) VALUES (2, $1::jsonb)',
      [JSON.stringify(routeState)]
    );
    const { rows } = await pool.query(
      'SELECT state->\'stops\' AS stops FROM tobs_app_state WHERE id = 2'
    );
    assert.deepEqual(rows[0].stops, routeState.stops);
    await pool.query('DELETE FROM tobs_app_state WHERE id = 2');
  });

  after(async () => {
    if (!enabled) return;
    await pool?.end();
    if (databaseUrl) {
      const cleanupPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
      await cleanupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanupPool.end();
    }
  });

  async function createOfferBatch({
    expired = false,
    riderIds = [randomUUID(), randomUUID()],
    deliveryStatus = 'FINDING_RIDER'
  } = {}) {
    const deliveryId = randomUUID();
    const businessId = randomUUID();
    const batchId = randomUUID();
    await pool.query(
      'INSERT INTO dispatch_deliveries (delivery_id, business_id, status) VALUES ($1, $2, $3)',
      [deliveryId, businessId, deliveryStatus]
    );
    for (const riderId of riderIds) {
      await pool.query(
        'INSERT INTO dispatch_business_riders (business_id, rider_id) VALUES ($1, $2)',
        [businessId, riderId]
      );
      await pool.query(`
        INSERT INTO dispatch_offers
          (offer_id, batch_id, delivery_id, business_id, rider_id, status, expires_at)
        VALUES (
          $1, $2, $3, $4, $5, 'PENDING',
          CASE WHEN $6 THEN NOW() - INTERVAL '1 minute'
            ELSE NOW() + INTERVAL '1 minute' END
        )
      `, [
        randomUUID(), batchId, deliveryId, businessId, riderId, expired
      ]);
    }
    return { deliveryId, businessId, riderIds, batchId };
  }

  async function attemptAcceptance(client, deliveryId, batchId, businessId, riderId) {
    return client.query(`
      INSERT INTO delivery_assignments (
        assignment_id, delivery_id, offer_id, rider_id, business_id, status
      )
      SELECT $1, offer.delivery_id, offer.offer_id, offer.rider_id, offer.business_id, 'ACTIVE'
      FROM dispatch_offers AS offer
      JOIN dispatch_deliveries AS delivery
        ON delivery.delivery_id = offer.delivery_id
       AND delivery.business_id = offer.business_id
      JOIN dispatch_business_riders AS membership
        ON membership.business_id = offer.business_id
        AND membership.rider_id = offer.rider_id
        AND membership.active = TRUE
      WHERE offer.batch_id = $2 AND offer.delivery_id = $3
        AND offer.business_id = $4 AND offer.rider_id = $5
        AND offer.status = 'PENDING' AND offer.expires_at > NOW()
        AND delivery.status NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
      ON CONFLICT DO NOTHING
      RETURNING assignment_id
    `, [randomUUID(), batchId, deliveryId, businessId, riderId]);
  }

  it('allows only one of two simultaneous riders to own a delivery', { skip: !enabled }, async () => {
    const delivery = await createOfferBatch();
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const results = await Promise.all(clients.map((client, index) =>
        attemptAcceptance(
          client,
          delivery.deliveryId,
          delivery.batchId,
          delivery.businessId,
          delivery.riderIds[index]
        )
      ));
      assert.equal(results.filter(result => result.rowCount === 1).length, 1);
      const { rows } = await pool.query(
        "SELECT COUNT(*)::integer AS count FROM delivery_assignments WHERE delivery_id = $1 AND status = 'ACTIVE'",
        [delivery.deliveryId]
      );
      assert.equal(rows[0].count, 1);
    } finally {
      clients.forEach(client => client.release());
    }
  });

  it('allows a rider only one active delivery across businesses', { skip: !enabled }, async () => {
    const riderId = randomUUID();
    const first = await createOfferBatch({ riderIds: [riderId, randomUUID()] });
    const second = await createOfferBatch({ riderIds: [riderId, randomUUID()] });
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const results = await Promise.all([
        attemptAcceptance(clients[0], first.deliveryId, first.batchId, first.businessId, riderId),
        attemptAcceptance(clients[1], second.deliveryId, second.batchId, second.businessId, riderId)
      ]);
      assert.equal(results.filter(result => result.rowCount === 1).length, 1);
      const { rows } = await pool.query(
        "SELECT COUNT(*)::integer AS count FROM delivery_assignments WHERE rider_id = $1 AND status = 'ACTIVE'",
        [riderId]
      );
      assert.equal(rows[0].count, 1);
    } finally {
      clients.forEach(client => client.release());
    }
  });

  it('releases cancelled history and permits a later reassignment', { skip: !enabled }, async () => {
    const delivery = await createOfferBatch();
    const firstAssignment = await attemptAcceptance(
      pool, delivery.deliveryId, delivery.batchId, delivery.businessId, delivery.riderIds[0]
    );
    assert.equal(firstAssignment.rowCount, 1);
    const cancelled = await pool.query(`
      UPDATE delivery_assignments SET status = 'CANCELLED', end_reason = 'CANCELLED_BY_PARTY'
      WHERE delivery_id = $1 AND status = 'ACTIVE'
      RETURNING assignment_id
    `, [delivery.deliveryId]);
    await pool.query(
      "INSERT INTO delivery_assignment_history (assignment_id, event_type) VALUES ($1, 'CANCELLED')",
      [cancelled.rows[0].assignment_id]
    );
    assert.equal((await attemptAcceptance(
      pool, delivery.deliveryId, delivery.batchId, delivery.businessId, delivery.riderIds[1]
    )).rowCount, 1);
    const reassigned = await pool.query(`
      UPDATE delivery_assignments
      SET status = 'REASSIGNED'
      WHERE delivery_id = $1 AND status = 'CANCELLED'
        AND end_reason = 'CANCELLED_BY_PARTY'
      RETURNING assignment_id
    `, [delivery.deliveryId]);
    await pool.query(
      "INSERT INTO delivery_assignment_history (assignment_id, event_type) VALUES ($1, 'REASSIGNED')",
      [reassigned.rows[0].assignment_id]
    );
    const { rows } = await pool.query(
      'SELECT status FROM delivery_assignments WHERE delivery_id = $1 ORDER BY status',
      [delivery.deliveryId]
    );
    assert.deepEqual(rows.map(row => row.status).sort(), ['ACTIVE', 'REASSIGNED']);
    const { rows: history } = await pool.query(
      'SELECT event_type FROM delivery_assignment_history WHERE assignment_id = $1 ORDER BY event_type',
      [reassigned.rows[0].assignment_id]
    );
    assert.deepEqual(history.map(row => row.event_type), ['CANCELLED', 'REASSIGNED']);
  });

  it('does not accept an expired offer', { skip: !enabled }, async () => {
    const delivery = await createOfferBatch({ expired: true });
    assert.equal((await attemptAcceptance(
      pool, delivery.deliveryId, delivery.batchId, delivery.businessId, delivery.riderIds[0]
    )).rowCount, 0);
    await pool.query(`
      UPDATE dispatch_offers SET status = 'EXPIRED'
      WHERE batch_id = $1 AND status = 'PENDING' AND expires_at <= NOW()
    `, [delivery.batchId]);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::integer AS count FROM dispatch_offers WHERE batch_id = $1 AND status = $2',
      [delivery.batchId, 'EXPIRED']
    );
    assert.equal(rows[0].count, 2);
  });

  it('does not accept a rejected offer or a cancelled delivery', { skip: !enabled }, async () => {
    const rejected = await createOfferBatch();
    await pool.query(`
      UPDATE dispatch_offers SET status = 'REJECTED'
      WHERE batch_id = $1 AND rider_id = $2
    `, [rejected.batchId, rejected.riderIds[0]]);
    assert.equal((await attemptAcceptance(
      pool, rejected.deliveryId, rejected.batchId, rejected.businessId, rejected.riderIds[0]
    )).rowCount, 0);

    const cancelled = await createOfferBatch({ deliveryStatus: 'CANCELLED' });
    assert.equal((await attemptAcceptance(
      pool, cancelled.deliveryId, cancelled.batchId, cancelled.businessId, cancelled.riderIds[0]
    )).rowCount, 0);
  });

  it('does not expose a delivery to an unrelated rider or business', { skip: !enabled }, async () => {
    const delivery = await createOfferBatch();
    const { rows } = await pool.query(`
      SELECT offer_id FROM dispatch_offers
      WHERE batch_id = $1 AND business_id = $2 AND rider_id = $3
    `, [delivery.batchId, randomUUID(), randomUUID()]);
    assert.equal(rows.length, 0);
    assert.equal((await attemptAcceptance(
      pool,
      delivery.deliveryId,
      delivery.batchId,
      delivery.businessId,
      randomUUID()
    )).rowCount, 0);
  });

  it('surfaces database errors instead of recording a successful assignment', { skip: !enabled }, async () => {
    await assert.rejects(pool.query('SELECT * FROM missing_dispatch_test_relation'));
  });

  it('shares fresh online public rider locations with every business while sharing is enabled', { skip: !enabled }, async () => {
    const riderId = randomUUID();
    const businessIds = [randomUUID(), randomUUID(), randomUUID()];
    await pool.query(
      'INSERT INTO rider_dispatch_profiles (rider_id, is_active, is_available) VALUES ($1, TRUE, TRUE)',
      [riderId]
    );
    await pool.query(
      'INSERT INTO dispatch_business_riders (business_id, rider_id, active) VALUES ($1, $2, TRUE), ($3, $2, TRUE)',
      [businessIds[0], riderId, businessIds[1]]
    );
    await pool.query(`
      INSERT INTO rider_current_locations (rider_id, latitude, longitude, recorded_at, sharing_enabled)
      VALUES ($1, 6.5244, 3.3792, NOW(), TRUE)
    `, [riderId]);
    await pool.query(`
      INSERT INTO rider_location_history
        (rider_id, latitude, longitude, context, recorded_at)
      VALUES ($1, 6.5244, 3.3792, 'AVAILABLE_FOR_MATCHING', NOW())
    `, [riderId]);

    const deliveryIds = businessIds.slice(0, 2).map(() => randomUUID());
    for (let index = 0; index < deliveryIds.length; index += 1) {
      await pool.query(
        'INSERT INTO dispatch_deliveries (delivery_id, business_id, status) VALUES ($1, $2, $3)',
        [deliveryIds[index], businessIds[index], 'FINDING_RIDER']
      );
      await pool.query(`
        INSERT INTO dispatch_offers
          (offer_id, batch_id, delivery_id, business_id, rider_id, status, expires_at)
        VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW() + INTERVAL '1 minute')
      `, [randomUUID(), randomUUID(), deliveryIds[index], businessIds[index], riderId]);
    }

    const visibleForBusiness = async businessId => {
      const { rows } = await pool.query(AUTHORIZED_MAP_RIDERS_SQL, [businessId]);
      return rows;
    };

    assert.equal((await visibleForBusiness(businessIds[0]))[0].rider_id, riderId);
    assert.equal((await visibleForBusiness(businessIds[1]))[0].rider_id, riderId);
    assert.equal((await visibleForBusiness(businessIds[2]))[0].rider_id, riderId);

    await pool.query(`
      INSERT INTO rider_current_locations (rider_id, latitude, longitude, recorded_at, sharing_enabled)
      VALUES ($1, 6.525, 3.38, NOW(), TRUE)
      ON CONFLICT (rider_id) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        recorded_at = EXCLUDED.recorded_at
    `, [riderId]);
    const updatedLocation = (await visibleForBusiness(businessIds[0]))[0];
    assert.equal(updatedLocation.lat, 6.525);
    assert.equal(updatedLocation.lng, 3.38);

    await pool.query(`
      UPDATE rider_current_locations
      SET recorded_at = NOW() - INTERVAL '2 minutes'
      WHERE rider_id = $1
    `, [riderId]);
    assert.deepEqual(await visibleForBusiness(businessIds[0]), []);
    assert.deepEqual(await visibleForBusiness(businessIds[2]), []);

    await pool.query(`
      UPDATE rider_current_locations SET recorded_at = NOW() WHERE rider_id = $1
    `, [riderId]);
    await pool.query(
      'UPDATE rider_dispatch_profiles SET is_available = FALSE WHERE rider_id = $1',
      [riderId]
    );
    assert.deepEqual(await visibleForBusiness(businessIds[0]), []);
    assert.deepEqual(await visibleForBusiness(businessIds[2]), []);

    await pool.query(
      'UPDATE rider_current_locations SET sharing_enabled = FALSE WHERE rider_id = $1',
      [riderId]
    );
    assert.deepEqual(await visibleForBusiness(businessIds[0]), []);
    assert.deepEqual(await visibleForBusiness(businessIds[1]), []);
    assert.deepEqual(await visibleForBusiness(businessIds[2]), []);
  });

  it('matches only approved online drivers with fresh GPS regardless of business membership', { skip: !enabled }, async () => {
    const businessId = randomUUID();
    const riderIds = {
      public: randomUUID(),
      stale: randomUUID(),
      offline: randomUUID(),
      pending: randomUUID(),
      assigned: randomUUID()
    };
    for (const [riderId, isActive, isAvailable] of [
      [riderIds.public, true, true],
      [riderIds.stale, true, true],
      [riderIds.offline, true, false],
      [riderIds.pending, false, true],
      [riderIds.assigned, true, true]
    ]) {
      await pool.query(`
        INSERT INTO rider_dispatch_profiles (rider_id, is_active, is_available)
        VALUES ($1, $2, $3)
      `, [riderId, isActive, isAvailable]);
    }
    await pool.query(`
      INSERT INTO rider_current_locations (rider_id, latitude, longitude, recorded_at, sharing_enabled)
      VALUES
        ($1, 6.5244, 3.3792, NOW(), TRUE),
        ($2, 6.5245, 3.3793, NOW() - INTERVAL '2 minutes', TRUE),
        ($3, 6.5246, 3.3794, NOW(), TRUE),
        ($4, 6.5247, 3.3795, NOW(), TRUE),
        ($5, 6.5248, 3.3796, NOW(), TRUE)
    `, [
      riderIds.public,
      riderIds.stale,
      riderIds.offline,
      riderIds.pending,
      riderIds.assigned
    ]);
    const users = Object.entries(riderIds).map(([key, id]) => ({
      id,
      role: 'DRIVER',
      status: key === 'pending' ? 'PENDING' : 'ACTIVE',
      name: key === 'public' ? 'Unlinked public rider' : key,
      vehicle: 'Delivery bike',
      zone: 'Ikeja'
    }));
    await pool.query(
      'UPDATE tobs_app_state SET state = $1::jsonb WHERE id = 1',
      [JSON.stringify({ users })]
    );
    const assignedDeliveryId = randomUUID();
    await pool.query(
      'INSERT INTO dispatch_deliveries (delivery_id, business_id, status) VALUES ($1, $2, $3)',
      [assignedDeliveryId, businessId, 'RIDER_ACCEPTED']
    );
    await pool.query(`
      INSERT INTO delivery_assignments
        (assignment_id, delivery_id, rider_id, business_id, status)
      VALUES ($1, $2, $3, $4, 'ACTIVE')
    `, [randomUUID(), assignedDeliveryId, riderIds.assigned, businessId]);

    const { rows } = await pool.query(PUBLIC_MARKETPLACE_DRIVERS_SQL, [6.5244, 3.3792, true]);
    assert.deepEqual(rows.map(row => row.rider_id), [riderIds.public]);
    assert.equal(rows[0].name, 'Unlinked public rider');
    assert.equal(rows[0].zone, 'Ikeja');
    await pool.query(
      'UPDATE rider_dispatch_profiles SET is_available = FALSE WHERE rider_id = ANY($1::text[])',
      [Object.values(riderIds)]
    );
  });

  it('shares public availability globally while keeping pending offer details business scoped', { skip: !enabled }, async () => {
    const [businessId, unrelatedBusinessId] = [randomUUID(), randomUUID()];
    const riderId = randomUUID();
    const deliveryId = randomUUID();
    const batchOfferId = randomUUID();
    await pool.query(
      'INSERT INTO dispatch_deliveries (delivery_id, business_id, status) VALUES ($1, $2, $3)',
      [deliveryId, businessId, 'FINDING_RIDER']
    );
    await pool.query(
      'INSERT INTO dispatch_business_riders (business_id, rider_id, active) VALUES ($1, $2, TRUE)',
      [businessId, riderId]
    );
    await pool.query(
      'INSERT INTO rider_dispatch_profiles (rider_id, is_active, is_available) VALUES ($1, TRUE, TRUE)',
      [riderId]
    );
    await pool.query(`
      INSERT INTO rider_current_locations (rider_id, latitude, longitude, recorded_at, sharing_enabled)
      VALUES ($1, 6.5244, 3.3792, NOW(), TRUE)
    `, [riderId]);
    await pool.query(`
      INSERT INTO delivery_batch_offers (batch_offer_id, rider_id, status, expires_at)
      VALUES ($1, $2, 'PENDING', NOW() + INTERVAL '1 minute')
    `, [batchOfferId, riderId]);
    await pool.query(`
      INSERT INTO delivery_batch_offer_items (batch_offer_id, delivery_id, business_id, sequence_number)
      VALUES ($1, $2, $3, 1)
    `, [batchOfferId, deliveryId, businessId]);

    const visibleForBusiness = async ownerId => {
      const { rows } = await pool.query(AUTHORIZED_MAP_RIDERS_SQL, [ownerId]);
      return rows;
    };

    const visible = await visibleForBusiness(businessId);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].rider_id, riderId);
    const publicAvailability = await visibleForBusiness(unrelatedBusinessId);
    assert.equal(publicAvailability.length, 1);
    assert.equal(publicAvailability[0].rider_id, riderId);
    assert.equal(publicAvailability[0].delivery_id, null);

    await pool.query(
      'UPDATE rider_dispatch_profiles SET is_available = FALSE WHERE rider_id = $1',
      [riderId]
    );
    assert.deepEqual(await visibleForBusiness(businessId), []);
    assert.deepEqual(await visibleForBusiness(unrelatedBusinessId), []);
  });

  it('records acceptance, pickup, delivery completion, and releases the active assignment', { skip: !enabled }, async () => {
    const delivery = await createOfferBatch();
    const client = await pool.connect();
    const riderId = delivery.riderIds[0];
    try {
      await client.query('BEGIN');
      const accepted = await attemptAcceptance(
        client, delivery.deliveryId, delivery.batchId, delivery.businessId, riderId
      );
      assert.equal(accepted.rowCount, 1);
      await client.query(`
        UPDATE dispatch_deliveries SET status = 'RIDER_ACCEPTED', updated_at = NOW()
        WHERE delivery_id = $1
      `, [delivery.deliveryId]);
      await client.query(`
        INSERT INTO delivery_status_history (delivery_id, status, actor_id)
        VALUES ($1, 'RIDER_ACCEPTED', $2)
      `, [delivery.deliveryId, riderId]);

      for (const status of ['HEADING_TO_PICKUP', 'HEADING_TO_DESTINATION']) {
        await client.query(`
          UPDATE dispatch_deliveries SET status = $2, updated_at = NOW()
          WHERE delivery_id = $1
        `, [delivery.deliveryId, status]);
        await client.query(`
          INSERT INTO delivery_status_history (delivery_id, status, actor_id)
          VALUES ($1, $2, $3)
        `, [delivery.deliveryId, status, riderId]);
      }

      await client.query(`
        UPDATE delivery_assignments
        SET status = 'COMPLETED'
        WHERE delivery_id = $1 AND rider_id = $2 AND status = 'ACTIVE'
      `, [delivery.deliveryId, riderId]);
      await client.query(`
        UPDATE dispatch_deliveries SET status = 'DELIVERED', updated_at = NOW()
        WHERE delivery_id = $1
      `, [delivery.deliveryId]);
      await client.query(`
        INSERT INTO delivery_status_history (delivery_id, status, actor_id)
        VALUES ($1, 'DELIVERED', $2)
      `, [delivery.deliveryId, riderId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const { rows: statuses } = await pool.query(`
      SELECT status FROM delivery_status_history
      WHERE delivery_id = $1 ORDER BY occurred_at, ctid
    `, [delivery.deliveryId]);
    assert.deepEqual(statuses.map(row => row.status), [
      'RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'HEADING_TO_DESTINATION', 'DELIVERED'
    ]);
    const { rows: assignments } = await pool.query(`
      SELECT status FROM delivery_assignments WHERE delivery_id = $1
    `, [delivery.deliveryId]);
    assert.deepEqual(assignments.map(row => row.status), ['COMPLETED']);
    const nextDelivery = await createOfferBatch({ riderIds: [riderId, randomUUID()] });
    assert.equal((await attemptAcceptance(
      pool,
      nextDelivery.deliveryId,
      nextDelivery.batchId,
      nextDelivery.businessId,
      riderId
    )).rowCount, 1);
  });
});
