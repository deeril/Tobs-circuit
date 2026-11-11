import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellsWithinRadius,
  distanceToRouteKm,
  isWithinSearchCells,
  RIDER_DISCOVERY_RADIUS_ROUNDS_KM
} from '../src/dispatch-geo.js';
import { getRoadRoute, searchPhoton } from '../server/dispatch-services.js';
import { hasActiveRiderAssignment } from '../server/dispatch-assignments.js';
import { optimizeDeliveryBatch } from '../server/dispatch-optimizer.js';
import { DELETE_EXPIRED_GPS_BATCH_SQL, DISPATCH_GPS_RETENTION_DAYS } from '../server/dispatch-retention.js';

test('fallback assignment protection blocks active jobs and releases terminal history', () => {
  assert.equal(hasActiveRiderAssignment([
    { riderId: 'rider-1', status: 'ACTIVE' }
  ], [], 'rider-1'), true);
  assert.equal(hasActiveRiderAssignment([
    { riderId: 'rider-1', status: 'COMPLETED' }
  ], [], 'rider-1'), false);
  assert.equal(hasActiveRiderAssignment([], [{
    assignedDriverId: 'rider-1',
    status: 'IN_PROGRESS',
    dispatchStatus: 'HEADING_TO_PICKUP'
  }], 'rider-1'), true);
  assert.equal(hasActiveRiderAssignment([], [{
    assignedDriverId: 'rider-1',
    status: 'DELIVERED',
    dispatchStatus: 'DELIVERED'
  }], 'rider-1'), false);
  assert.equal(hasActiveRiderAssignment([], [], 'rider-1'), false);
});

test('H3 search coverage includes central and nearby cells at each supported radius', () => {
  for (const radius of [3, 5, 10]) {
    const cells = cellsWithinRadius(6.5244, 3.3792, radius);
    assert.ok(cells.size > 1);
    assert.equal(isWithinSearchCells(cells, 6.5244, 3.3792), true);
    assert.throws(() => cellsWithinRadius(6.5244, 3.3792, 4), TypeError);
  }
});

test('rider discovery includes every eligible rider within five km before expanding to ten', () => {
  assert.deepEqual(RIDER_DISCOVERY_RADIUS_ROUNDS_KM, [5, 10]);
});

test('delivery optimizer groups at most three nearby orders and honors road-route deadlines', async () => {
  const anchor = {
    deliveryId: 'anchor',
    businessId: 'business-a',
    pickup: { lat: 6.5, lng: 3.3 },
    destination: { lat: 6.51, lng: 3.31 },
    packageCount: 1,
    packageWeightKg: 1,
    packageSize: 'SMALL',
    deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString()
  };
  const candidates = ['near-1', 'near-2', 'near-3'].map((deliveryId, index) => ({
    ...anchor,
    deliveryId,
    pickup: { lat: 6.5 + index * 0.001, lng: 3.3 },
    destination: { lat: 6.51 + index * 0.001, lng: 3.31 },
    deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString()
  }));
  const routeProvider = async () => ({ mode: 'road', distanceKm: 1, durationMinutes: 1 });
  const result = await optimizeDeliveryBatch({
    anchor,
    candidates,
    rider: {
      maxPackageCount: 3,
      maxPackageWeightKg: 5,
      maxPackageSize: 'MEDIUM',
      acceptsCrossBusinessBatches: false,
      location: { lat: 6.499, lng: 3.299 }
    },
    routeProvider
  });
  assert.equal(result.deliveries.length, 3);
  assert.equal(result.sequence.length, 3);
  assert.equal(result.route.legs.length, 6);
});

test('delivery optimizer fails closed for unknown capacity, deadline, cross-business consent, or non-road routing', async () => {
  const anchor = {
    deliveryId: 'anchor',
    businessId: 'business-a',
    pickup: { lat: 6.5, lng: 3.3 },
    destination: { lat: 6.51, lng: 3.31 },
    packageCount: 1,
    packageWeightKg: 1,
    packageSize: 'SMALL',
    deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString()
  };
  const candidate = {
    ...anchor,
    deliveryId: 'candidate',
    pickup: { lat: 6.501, lng: 3.3 },
    destination: { lat: 6.511, lng: 3.31 }
  };
  const rider = {
    maxPackageCount: 3,
    maxPackageWeightKg: 5,
    maxPackageSize: 'MEDIUM',
    location: { lat: 6.499, lng: 3.299 }
  };
  const routeProvider = async () => ({ mode: 'road', distanceKm: 1, durationMinutes: 1 });
  const optimize = (overrides = {}) => optimizeDeliveryBatch({
    anchor,
    candidates: [candidate],
    rider,
    routeProvider,
    ...overrides
  });

  assert.equal((await optimize({ rider: { ...rider, maxPackageWeightKg: null } })).deliveries.length, 1);
  assert.equal((await optimize({ candidates: [{ ...candidate, deadlineAt: null }] })).deliveries.length, 1);
  assert.equal((await optimize({
    candidates: [{ ...candidate, businessId: 'business-b', businessAllowsCrossBusinessBatch: false }],
    rider: { ...rider, acceptsCrossBusinessBatches: true }
  })).deliveries.length, 1);
  assert.equal((await optimize({ routeProvider: async () => ({ mode: 'straight-line', distanceKm: 1, durationMinutes: 1 }) })).deliveries.length, 1);
});

test('route deviation detection distinguishes on-route locations from meaningful drift', () => {
  const route = {
    type: 'LineString',
    coordinates: [[3.3, 6.5], [3.4, 6.6]]
  };
  assert.ok(distanceToRouteKm({ lat: 6.55, lng: 3.35 }, route) < 0.01);
  assert.ok(distanceToRouteKm({ lat: 6.55, lng: 3.36 }, route) > 0.5);
  assert.equal(distanceToRouteKm({ lat: 6.55, lng: 3.35 }, { type: 'Point' }), Infinity);
});

test('GPS retention deletes only history older than the 14-day policy', () => {
  assert.equal(DISPATCH_GPS_RETENTION_DAYS, 14);
  assert.match(DELETE_EXPIRED_GPS_BATCH_SQL, /NOW\(\) - \(\$1::integer \* INTERVAL '1 day'\)/);
  assert.doesNotMatch(DELETE_EXPIRED_GPS_BATCH_SQL, /30 days/);
});

function encodePolyline6(points) {
  const encodeValue = value => {
    let remaining = value < 0 ? ~(value << 1) : value << 1;
    let encoded = '';
    while (remaining >= 0x20) {
      encoded += String.fromCharCode((0x20 | (remaining & 0x1f)) + 63);
      remaining >>= 5;
    }
    return encoded + String.fromCharCode(remaining + 63);
  };
  let previousLat = 0;
  let previousLng = 0;
  return points.map(([lng, lat]) => {
    const scaledLat = Math.round(lat * 1e6);
    const scaledLng = Math.round(lng * 1e6);
    const encoded = encodeValue(scaledLat - previousLat) + encodeValue(scaledLng - previousLng);
    previousLat = scaledLat;
    previousLng = scaledLng;
    return encoded;
  }).join('');
}

test('Valhalla route requests use auto costing and decode the route geometry', async t => {
  const originalFetch = globalThis.fetch;
  const shape = encodePolyline6([[3.3, 6.5], [3.4, 6.6]]);
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://router.example.test/route');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      locations: [
        { lat: 6.5, lon: 3.3 },
        { lat: 6.6, lon: 3.4 }
      ],
      costing: 'auto',
      units: 'kilometers'
    });
    return new Response(JSON.stringify({
      trip: {
        summary: { length: 15.24, time: 780 },
        legs: [{ shape }]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await getRoadRoute({
    baseUrl: 'https://router.example.test',
    from: { lat: 6.5, lng: 3.3 },
    to: { lat: 6.6, lng: 3.4 }
  });
  assert.equal(result.mode, 'road');
  assert.equal(result.provider, 'Valhalla');
  assert.equal(result.distanceKm, 15.24);
  assert.equal(result.durationMinutes, 13);
  assert.deepEqual(result.geometry.coordinates, [[3.3, 6.5], [3.4, 6.6]]);
});

test('routing reports an explicit straight-line fallback when unconfigured or unavailable', async t => {
  const originalFetch = globalThis.fetch;
  const unconfigured = await getRoadRoute({
    from: { lat: 6.5, lng: 3.3 },
    to: { lat: 6.6, lng: 3.4 }
  });
  assert.equal(unconfigured.mode, 'straight-line');
  assert.match(unconfigured.warning, /not configured/i);

  globalThis.fetch = async () => { throw new Error('offline'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const unavailable = await getRoadRoute({
    baseUrl: 'https://router.example.test',
    from: { lat: 6.5, lng: 3.3 },
    to: { lat: 6.6, lng: 3.4 }
  });
  assert.equal(unavailable.mode, 'straight-line');
  assert.match(unavailable.warning, /temporarily unavailable/i);
});

test('Photon searches validate input, bound results, and preserve provider properties', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.pathname, '/api');
    assert.equal(parsedUrl.searchParams.get('limit'), '5');
    return new Response(JSON.stringify({
      features: Array.from({ length: 7 }, (_, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [3.3 + index / 100, 6.5] },
        properties: { name: `Lagos ${index}` }
      }))
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const results = await searchPhoton({
    baseUrl: 'https://photon.example.test/',
    query: 'Ikeja',
    lat: 6.5,
    lng: 3.3
  });
  assert.equal(results.length, 5);
  assert.equal(results[0].properties.name, 'Lagos 0');
  await assert.rejects(() => searchPhoton({ baseUrl: '', query: 'Ikeja' }), /not configured/i);
  await assert.rejects(() => searchPhoton({ baseUrl: 'https://photon.example.test', query: 'x' }), TypeError);
});
