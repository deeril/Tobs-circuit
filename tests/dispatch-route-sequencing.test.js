import assert from 'node:assert/strict';
import test from 'node:test';
import { sequenceStopsByRoad } from '../server/dispatch-route-sequencing.js';

const origin = { lat: 6.5, lng: 3.3 };
const stops = [
  { id: 'one', lat: 6.51, lng: 3.31 },
  { id: 'two', lat: 6.52, lng: 3.32 },
  { id: 'three', lat: 6.53, lng: 3.33 }
];

function roadProvider(distanceBetween) {
  return {
    async routeMatrixProvider(sources, destinations) {
      return sources.map(from => destinations.map(to => ({
          mode: 'road',
          distanceKm: distanceBetween(from, to),
          durationMinutes: distanceBetween(from, to) * 2
        })));
    },
    async routeProvider(from, to) {
      return {
        mode: 'road',
        distanceKm: distanceBetween(from, to),
        durationMinutes: distanceBetween(from, to) * 2,
        geometry: {
          type: 'LineString',
          coordinates: [[from.lng, from.lat], [to.lng, to.lat]]
        }
      };
    }
  };
}

test('road sequencing handles one, two, and three delivery stops', async () => {
  const { routeMatrixProvider, routeProvider } = roadProvider((from, to) =>
    Math.abs(from.lng - to.lng) * 100
  );
  const one = await sequenceStopsByRoad({
    origin,
    stops: [stops[0]],
    routeMatrixProvider,
    routeProvider
  });
  const two = await sequenceStopsByRoad({
    origin,
    stops: [stops[1], stops[0]],
    routeMatrixProvider,
    routeProvider
  });
  const three = await sequenceStopsByRoad({
    origin,
    stops: [stops[2], stops[0], stops[1]],
    routeMatrixProvider,
    routeProvider
  });

  assert.deepEqual(one.ordered.map(entry => entry.stop.id), ['one']);
  assert.deepEqual(two.ordered.map(entry => entry.stop.id), ['one', 'two']);
  assert.deepEqual(three.ordered.map(entry => entry.stop.id), ['one', 'two', 'three']);
  assert.equal(three.ordered[0].leg.geometry.type, 'LineString');
  assert.equal(three.totalDistanceKm, 3);
});

test('road sequencing completes 2, 3, 5, and 10 stops from previous-stop road costs', async () => {
  for (const stopCount of [2, 3, 5, 10]) {
    const destinations = Array.from({ length: stopCount }, (_, index) => ({
      id: `stop-${String(index + 1).padStart(2, '0')}`,
      lat: origin.lat + index * 0.001,
      lng: origin.lng + (index + 1) * 0.001
    }));
    const result = await sequenceStopsByRoad({
      origin,
      stops: [...destinations].reverse(),
      ...roadProvider((from, to) => Math.abs(from.lng - to.lng) * 1000)
    });

    assert.deepEqual(
      result.ordered.map(entry => entry.stop.id),
      destinations.map(stop => stop.id),
      `expected nearest-next-stop ordering for ${stopCount} stops`
    );
    assert.equal(result.ordered.length, stopCount);
    assert.ok(result.ordered.every(entry => entry.leg.geometry.type === 'LineString'));
  }
});

test('sequences independently from different rider GPS origins using road costs', async () => {
  const driverAOrigin = { lat: 1, lng: 1 };
  const driverBOrigin = { lat: 2, lng: 2 };
  const destinations = [
    { id: 'north', lat: 1.1, lng: 1.1 },
    { id: 'south', lat: 2.1, lng: 2.1 }
  ];
  const routeA = await sequenceStopsByRoad({
    origin: driverAOrigin,
    stops: destinations,
    ...roadProvider((from, to) => Math.abs(from.lat - to.lat) + Math.abs(from.lng - to.lng))
  });
  const routeB = await sequenceStopsByRoad({
    origin: driverBOrigin,
    stops: destinations,
    ...roadProvider((from, to) => Math.abs(from.lat - to.lat) + Math.abs(from.lng - to.lng))
  });

  assert.equal(routeA.ordered[0].stop.id, 'north');
  assert.equal(routeB.ordered[0].stop.id, 'south');
});

test('chooses the next stop from the previously selected destination road distances', async () => {
  const locations = {
    origin: { lat: 6.5, lng: 3.3 },
    alpha: { lat: 6.51, lng: 3.31 },
    bravo: { lat: 6.52, lng: 3.32 },
    charlie: { lat: 6.53, lng: 3.33 }
  };
  const distances = new Map([
    ['origin:alpha', 2], ['origin:bravo', 1], ['origin:charlie', 5],
    ['bravo:alpha', 10], ['bravo:charlie', 2],
    ['charlie:alpha', 1], ['alpha:bravo', 10], ['alpha:charlie', 3],
    ['charlie:bravo', 2]
  ]);
  const result = await sequenceStopsByRoad({
    origin: locations.origin,
    stops: ['alpha', 'bravo', 'charlie'].map(id => ({ id, ...locations[id] })),
    routeMatrixProvider: async (sources, destinations) => sources.map(source => {
      const sourceName = Object.keys(locations).find(name =>
        locations[name].lat === source.lat && locations[name].lng === source.lng
      );
      return destinations.map(destination => {
        const destinationName = Object.keys(locations).find(name =>
          locations[name].lat === destination.lat && locations[name].lng === destination.lng
        );
        return {
          mode: 'road',
          distanceKm: distances.get(`${sourceName}:${destinationName}`) ?? 0,
          durationMinutes: 2
        };
      });
    }),
    routeProvider: async (from, to) => ({
      mode: 'road',
      distanceKm: 1,
      durationMinutes: 2,
      geometry: {
        type: 'LineString',
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]]
      }
    })
  });

  assert.deepEqual(result.ordered.map(entry => entry.stop.id), ['bravo', 'charlie', 'alpha']);
});

test('duplicate destinations keep unique stop identities without requesting zero-length routes', async () => {
  let geometryRequests = 0;
  const result = await sequenceStopsByRoad({
    origin,
    stops: [
      { id: 'duplicate-b', lat: 6.51, lng: 3.31 },
      { id: 'duplicate-a', lat: 6.51, lng: 3.31 }
    ],
    routeMatrixProvider: async (sources, destinations) =>
      sources.map(from => destinations.map(to => ({
        mode: 'road',
        distanceKm: from.lat === to.lat && from.lng === to.lng ? 0 : 1,
        durationMinutes: from.lat === to.lat && from.lng === to.lng ? 0 : 2
      }))),
    routeProvider: async (from, to) => {
      geometryRequests += 1;
      return {
        mode: 'road',
        distanceKm: 1,
        durationMinutes: 2,
        geometry: {
          type: 'LineString',
          coordinates: [[from.lng, from.lat], [to.lng, to.lat]]
        }
      };
    }
  });

  assert.deepEqual(result.ordered.map(entry => entry.stop.id), ['duplicate-a', 'duplicate-b']);
  assert.equal(result.ordered[1].leg.distanceKm, 0);
  assert.equal(geometryRequests, 1);
});

test('missing coordinates and incomplete road responses fail without a straight-line ordering', async () => {
  const providers = roadProvider(() => 1);
  await assert.rejects(() => sequenceStopsByRoad({
    origin,
    stops: [{ id: 'missing', lat: null, lng: null }],
    ...providers
  }), /valid destination coordinates/);
  await assert.rejects(() => sequenceStopsByRoad({
    origin,
    stops: [stops[0]],
    routeMatrixProvider: async (sources, destinations) =>
      sources.map(() => destinations.map(() =>
        ({ mode: 'straight-line', distanceKm: 1, durationMinutes: 2 }))),
    routeProvider: providers.routeProvider
  }), /could not calculate every pending stop/);
  await assert.rejects(() => sequenceStopsByRoad({
    origin,
    stops: [stops[0], stops[0]],
    ...providers
  }), /identifiers must be present and unique/);
});
