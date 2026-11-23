import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRealtimeEventBus,
  DISCONNECT_REALTIME_ROOM_EVENT
} from '../server/realtime-event-bus.js';

function createIoStub() {
  const emitted = [];
  const disconnected = [];
  return {
    emitted,
    disconnected,
    engine: { clientsCount: 1 },
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        }
      };
    },
    in(room) {
      return {
        disconnectSockets(close) {
          disconnected.push({ room, close });
        }
      };
    }
  };
}

describe('realtime event bus', () => {
  it('emits directly when running outside Vercel', async () => {
    const io = createIoStub();
    const bus = createRealtimeEventBus({ io });

    await bus.publish('user:driver-1', 'dispatch:message', { id: 'm1' });

    assert.deepEqual(io.emitted, [{
      room: 'user:driver-1',
      event: 'dispatch:message',
      payload: { id: 'm1' }
    }]);
  });

  it('stores Vercel events in the active request transaction', async () => {
    const io = createIoStub();
    const calls = [];
    const client = {
      async query(sql, values) {
        calls.push({ sql, values });
      }
    };
    const bus = createRealtimeEventBus({
      io,
      pool: { query() { throw new Error('The active transaction should be used.'); } },
      enabled: true
    });

    await bus.publish('business:admin-1', 'driver:location', { id: 'driver-1' }, client);

    assert.match(calls[0].sql, /INSERT INTO tobs_realtime_events/);
    assert.deepEqual(calls[0].values, [
      'business:admin-1',
      'driver:location',
      JSON.stringify({ id: 'driver-1' })
    ]);
  });

  it('fans Neon events out to local rooms and disconnects revoked rooms', async () => {
    const io = createIoStub();
    const rows = [
      {
        event_id: '1',
        room: 'user:driver-1',
        event_name: 'dispatch:message',
        payload: { id: 'm1' }
      },
      {
        event_id: '2',
        room: 'user:driver-1',
        event_name: DISCONNECT_REALTIME_ROOM_EVENT,
        payload: {}
      }
    ];
    const pool = {
      async query(sql) {
        if (sql.includes('MAX(event_id)')) return { rows: [{ cursor: '0' }] };
        if (sql.includes('SELECT event_id::text')) return { rows };
        return { rows: [] };
      }
    };
    const bus = createRealtimeEventBus({ io, pool, enabled: true });

    await bus.start();
    bus.stop();

    assert.deepEqual(io.emitted, [{
      room: 'user:driver-1',
      event: 'dispatch:message',
      payload: { id: 'm1' }
    }]);
    assert.deepEqual(io.disconnected, [{ room: 'user:driver-1', close: true }]);
  });
});
