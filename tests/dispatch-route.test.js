import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRiderRoutePlan,
  orderStopsByPickupAndDelivery
} from '../src/dispatch-geo.js';
import { riderCanCarryDeliveryRoute } from '../server/dispatch-route-capacity.js';
import { hasActiveRiderAssignment } from '../server/dispatch-assignments.js';

const distance = (fromLat, fromLng, toLat, toLng) =>
  Math.hypot(toLat - fromLat, toLng - fromLng);

test('orders a rider route by full pickup and delivery legs from the rider location', () => {
  const stops = [
    { id: 'long-delivery', pickupLat: 0, pickupLng: 2, lat: 0, lng: 20 },
    { id: 'short-delivery', pickupLat: 0, pickupLng: 5, lat: 0, lng: 6 },
    { id: 'next-nearest', pickupLat: 0, pickupLng: 10, lat: 0, lng: 12 }
  ];

  const ordered = orderStopsByPickupAndDelivery(stops, { lat: 0, lng: 0 }, distance);

  assert.deepEqual(ordered.map(stop => stop.id), ['short-delivery', 'next-nearest', 'long-delivery']);
  assert.deepEqual(stops.map(stop => stop.id), ['long-delivery', 'short-delivery', 'next-nearest']);
});

test('keeps rider routes independent and leaves unlocated stops in their original order', () => {
  const riderOneStops = [
    { id: 'one-near-east', pickupLat: 0, pickupLng: 1, lat: 0, lng: 2 },
    { id: 'one-near-west', pickupLat: 0, pickupLng: -1, lat: 0, lng: -2 },
    { id: 'one-unlocated' }
  ];
  const riderTwoStops = [
    { id: 'two-near-east', pickupLat: 0, pickupLng: 1, lat: 0, lng: 2 },
    { id: 'two-near-west', pickupLat: 0, pickupLng: -1, lat: 0, lng: -2 }
  ];

  const riderOneRoute = orderStopsByPickupAndDelivery(riderOneStops, { lat: 0, lng: -3 }, distance);
  const riderTwoRoute = orderStopsByPickupAndDelivery(riderTwoStops, { lat: 0, lng: 3 }, distance);

  assert.deepEqual(riderOneRoute.map(stop => stop.id), ['one-near-west', 'one-near-east', 'one-unlocated']);
  assert.deepEqual(riderTwoRoute.map(stop => stop.id), ['two-near-east', 'two-near-west']);
});

test('builds numbered road-route waypoints per rider and advances past completed deliveries', () => {
  const stops = [
    {
      id: 'rider-one-done', assignedDriverId: 'rider-one',
      dispatchStatus: 'RIDER_ACCEPTED', status: 'DELIVERED', lat: 0, lng: 1
    },
    {
      id: 'rider-two-stop', assignedDriverId: 'rider-two', dispatchStatus: 'RIDER_ACCEPTED',
      pickupLat: 1, pickupLng: 1, lat: 1, lng: 2
    },
    {
      id: 'rider-one-active', assignedDriverId: 'rider-one', dispatchStatus: 'HEADING_TO_DESTINATION',
      pickupLat: 0, pickupLng: 2, lat: 0, lng: 3
    },
    {
      id: 'rider-one-next', assignedDriverId: 'rider-one', dispatchStatus: 'RIDER_ACCEPTED',
      pickupLat: 0, pickupLng: 4, lat: 0, lng: 5
    }
  ];

  const plan = buildRiderRoutePlan(stops, 'rider-one');

  assert.deepEqual(plan.stops.map(stop => [stop.id, stop.routeNumber, stop.routeCompleted]), [
    ['rider-one-done', 1, true],
    ['rider-one-active', 2, false],
    ['rider-one-next', 3, false]
  ]);
  assert.deepEqual(plan.remainingStops.map(stop => stop.id), ['rider-one-active', 'rider-one-next']);
  assert.deepEqual(plan.waypoints.map(waypoint => [waypoint.stopId, waypoint.kind, waypoint.label]), [
    ['rider-one-active', 'delivery', 'Delivery 2'],
    ['rider-one-next', 'pickup', 'Pickup 3'],
    ['rider-one-next', 'delivery', 'Delivery 3']
  ]);
  assert.equal(plan.waypoints[0].address, 'Delivery');
  assert.equal(plan.waypoints[2].address, 'Delivery');
});

test('checks package count and weight against whole-trip totals', () => {
  const stops = [
    { packages: 2, packageWeightKg: 3.5, packageSize: 'MEDIUM' },
    { packages: 3, packageWeightKg: null, packageSize: 'MEDIUM' }
  ];

  assert.equal(riderCanCarryDeliveryRoute({
    maxPackageCount: 5,
    maxPackageWeightKg: 3.5,
    maxPackageSize: 'MEDIUM'
  }, stops), true);
  assert.equal(riderCanCarryDeliveryRoute({
    maxPackageCount: 4,
    maxPackageWeightKg: 3.5,
    maxPackageSize: 'MEDIUM'
  }, stops), false);
  assert.equal(riderCanCarryDeliveryRoute({
    maxPackageCount: 5,
    maxPackageWeightKg: 3,
    maxPackageSize: 'MEDIUM'
  }, stops), false);
});

test('rejects a route when its largest item exceeds the rider size limit', () => {
  const stops = [
    { packages: 1, packageSize: 'SMALL' },
    { packages: 1, packageSize: 'LARGE' }
  ];

  assert.equal(riderCanCarryDeliveryRoute({ maxPackageSize: 'MEDIUM' }, stops), false);
  assert.equal(riderCanCarryDeliveryRoute({ maxPackageSize: 'LARGE' }, stops), true);
  assert.equal(riderCanCarryDeliveryRoute({}, stops), true);
});

test('terminal stops do not remain active through stale assignment records', () => {
  const assignments = [{
    deliveryId: 'completed-stop',
    riderId: 'rider-1',
    status: 'ACTIVE'
  }];
  const stops = [{
    id: 'completed-stop',
    assignedDriverId: 'rider-1',
    dispatchStatus: 'DELIVERED'
  }];

  assert.equal(hasActiveRiderAssignment(assignments, stops, 'rider-1'), false);
});