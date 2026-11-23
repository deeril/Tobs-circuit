export const DISCONNECT_REALTIME_ROOM_EVENT = '__tobs_disconnect_room__';

export function createRealtimeEventBus({
  io,
  pool,
  enabled = false,
  pollIntervalMs = 250,
  maxBatchSize = 500
}) {
  let cursor = '0';
  let pollTimer = null;
  let startPromise = null;
  let pollInProgress = false;
  let cleanupPolls = 0;
  let lastPollErrorAt = 0;

  async function publish(room, event, payload, client = pool) {
    if (!enabled) {
      io.to(room).emit(event, payload);
      return;
    }
    if (!client) throw new Error('Realtime event storage requires a PostgreSQL connection.');
    await client.query(`
      WITH inserted AS (
        INSERT INTO tobs_realtime_events (room, event_name, payload)
        VALUES ($1, $2, $3::jsonb)
        RETURNING event_id
      ), cleanup AS (
        DELETE FROM tobs_realtime_events
        WHERE event_id IN (
          SELECT event_id
          FROM tobs_realtime_events
          WHERE created_at < NOW() - INTERVAL '10 minutes'
          ORDER BY event_id
          LIMIT 100
        )
        AND (SELECT event_id FROM inserted) % 100 = 0
      )
      SELECT event_id FROM inserted
    `, [room, event, JSON.stringify(payload)]);
  }

  async function poll() {
    if (!enabled || !pool || pollInProgress) return;
    pollInProgress = true;
    try {
      const { rows } = await pool.query(`
        SELECT event_id::text AS event_id, room, event_name, payload
        FROM tobs_realtime_events
        WHERE event_id > $1::bigint
        ORDER BY event_id
        LIMIT $2
      `, [cursor, maxBatchSize]);
      for (const row of rows) {
        cursor = row.event_id;
        if (row.event_name === DISCONNECT_REALTIME_ROOM_EVENT) {
          io.in(row.room).disconnectSockets(true);
        } else {
          io.to(row.room).emit(row.event_name, row.payload);
        }
      }

      cleanupPolls += 1;
      if (cleanupPolls >= Math.ceil(60_000 / pollIntervalMs)) {
        cleanupPolls = 0;
        await pool.query(`
          DELETE FROM tobs_realtime_events
          WHERE created_at < NOW() - INTERVAL '10 minutes'
        `);
      }
    } catch (error) {
      if (Date.now() - lastPollErrorAt >= 10_000) {
        lastPollErrorAt = Date.now();
        console.error('Could not relay realtime events from Neon:', error);
      }
    } finally {
      pollInProgress = false;
    }
  }

  async function start() {
    if (!enabled || !pool || pollTimer) return;
    if (!startPromise) {
      startPromise = (async () => {
        const { rows } = await pool.query(`
          SELECT COALESCE(MAX(event_id), 0)::text AS cursor
          FROM tobs_realtime_events
        `);
        cursor = rows[0]?.cursor || '0';
        await poll();
        if (io.engine.clientsCount === 0) return;
        pollTimer = setInterval(() => {
          void poll();
        }, pollIntervalMs);
      })().catch(error => {
        startPromise = null;
        throw error;
      });
    }
    await startPromise;
  }

  function stopIfIdle() {
    if (!enabled || io.engine.clientsCount !== 0 || !pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    startPromise = null;
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    startPromise = null;
  }

  return { publish, start, stopIfIdle, stop, poll };
}
