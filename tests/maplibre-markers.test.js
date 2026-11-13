import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalMapZoom,
  getRiderMarkerState,
  isValidMapLocation,
  reconcileMapMarkers,
  toMapLibrePoint
} from '../src/maplibre-markers.js';
import { applyBusinessRiderLocation } from '../src/dispatch-map-state.js';

test('map marker location validation accepts legal coordinates and rejects invalid ones', () => {
  assert.equal(isValidMapLocation(6.6139, 3.3582), true);
  assert.equal(isValidMapLocation(-90, 180), true);
  assert.equal(isValidMapLocation(90.01, 3.3), false);
  assert.equal(isValidMapLocation(6.5, -180.01), false);
  assert.equal(isValidMapLocation('6.5', 3.3), false);
  assert.equal(isValidMapLocation(Number.NaN, 3.3), false);
  assert.deepEqual(toMapLibrePoint(6.5, 3.3), [3.3, 6.5]);
  assert.equal(toMapLibrePoint(91, 3.3), null);
});

test('default map zoom keeps a 10 km local radius visible at common screen sizes', () => {
  for (const viewport of [
    { name: 'mobile', width: 390, height: 780 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 }
  ]) {
    const zoom = getLocalMapZoom({ latitude: 6.5, ...viewport });
    const usablePixels = Math.min(viewport.width - 48, viewport.height - 128);
    const visibleDiameterKm = usablePixels * 40_075 * Math.cos(6.5 * Math.PI / 180)
      / (512 * (2 ** zoom));
    assert.ok(visibleDiameterKm >= 19.9, `${viewport.name} should show a 20 km local diameter`);
    assert.ok(visibleDiameterKm < 20.1, `${viewport.name} should use the local viewing area`);
  }
});

test('preview and active riders get marker states without treating fixtures as live GPS', () => {
  const now = Date.now();
  assert.deepEqual(getRiderMarkerState({
    id: 'preview-rider',
    lat: 6.6,
    lng: 3.3,
    isPreviewFixture: true
  }, new Set(), now), { kind: 'preview' });
  assert.equal(getRiderMarkerState({
    id: 'invalid-rider',
    lat: 91,
    lng: 3.3,
    isPreviewFixture: true
  }, new Set(), now), null);
  assert.deepEqual(getRiderMarkerState({
    id: 'assigned-rider',
    lat: 6.6,
    lng: 3.3,
    locationUpdatedAt: new Date(now - 120_000).toISOString(),
    isTracking: true
  }, new Set(['assigned-rider']), now), { kind: 'last-known' });
});

test('map markers are created once, retain MapLibre classes, and move on location updates', () => {
  const markers = new Map();
  let created = 0;
  const createMarker = details => {
    created += 1;
    return {
      point: details.point,
      removed: false,
      element: {
        className: 'maplibregl-marker maplibregl-marker-anchor-bottom maplibregl-interactive',
        title: '',
        textContent: '',
        setAttribute(name, value) { this[name] = value; }
      },
      setLngLat(point) { this.point = [...point]; return this; },
      getElement() { return this.element; },
      remove() { this.removed = true; }
    };
  };
  const firstLocations = new Map([
    ['rider:one', {
      point: [3.3, 6.5],
      className: 'maplibre-rider-marker',
      title: 'Rider One',
      text: 'Rider One'
    }],
    ['rider:two', {
      point: [3.4, 6.6],
      className: 'maplibre-rider-marker',
      title: 'Rider Two',
      text: 'Rider Two'
    }]
  ]);
  reconcileMapMarkers(markers, firstLocations, createMarker);
  const firstMarker = markers.get('rider:one');
  const secondMarker = markers.get('rider:two');
  assert.equal(created, 2);

  const updatedLocations = new Map(firstLocations);
  updatedLocations.set('rider:one', {
    ...firstLocations.get('rider:one'),
    point: [3.31, 6.51],
    title: 'Rider One updated'
  });
  reconcileMapMarkers(markers, updatedLocations, createMarker);

  assert.equal(created, 2);
  assert.equal(markers.get('rider:one'), firstMarker);
  assert.equal(markers.get('rider:two'), secondMarker);
  assert.deepEqual(firstMarker.point, [3.31, 6.51]);
  assert.match(firstMarker.element.className, /maplibregl-marker-anchor-bottom/);
  assert.equal(firstMarker.element.title, 'Rider One updated');
  assert.equal(markers.size, 2);
});

test('Socket.IO rider locations are scoped to their business and upsert without duplicates', () => {
  const initial = [{
    id: 'rider-1',
    businessId: 'business-a',
    lat: 6.5,
    lng: 3.3,
    isTracking: true
  }];
  const rejected = applyBusinessRiderLocation(initial, {
    id: 'rider-1',
    businessId: 'business-b',
    lat: 7,
    lng: 4
  }, 'business-a');
  assert.equal(rejected, initial);

  const updated = applyBusinessRiderLocation(initial, {
    id: 'rider-1',
    businessId: 'business-a',
    lat: 6.51,
    lng: 3.31,
    isTracking: true,
    locationUpdatedAt: '2026-11-10T12:00:00.000Z'
  }, 'business-a');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].lat, 6.51);
  assert.equal(updated[0].lng, 3.31);
});
