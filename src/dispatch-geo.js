import { getHexagonEdgeLengthAvg, gridDisk, latLngToCell } from 'h3-js';

export const RIDER_SEARCH_RADII_KM = [3, 5, 10];
export const RIDER_DISCOVERY_RADIUS_ROUNDS_KM = [5];
export const RIDER_H3_RESOLUTION = 7;

export function cellsWithinRadius(lat, lng, radiusKm) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180
    || !RIDER_SEARCH_RADII_KM.includes(radiusKm)) {
    throw new TypeError('A valid location and supported rider search radius are required.');
  }
  const originCell = latLngToCell(lat, lng, RIDER_H3_RESOLUTION);
  const edgeLengthKm = getHexagonEdgeLengthAvg(RIDER_H3_RESOLUTION, 'km');
  const ringCount = Math.ceil(radiusKm / edgeLengthKm) + 2;
  return new Set(gridDisk(originCell, ringCount));
}

export function isWithinSearchCells(cells, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return cells.has(latLngToCell(lat, lng, RIDER_H3_RESOLUTION));
}

export function orderStopsByPickupAndDelivery(stops, startPoint, distanceBetween) {
  if (!Array.isArray(stops) || !Number.isFinite(startPoint?.lat)
    || !Number.isFinite(startPoint?.lng) || typeof distanceBetween !== 'function') {
    return Array.isArray(stops) ? [...stops] : [];
  }

  const remaining = [...stops];
  const orderedStops = [];
  let currentPoint = startPoint;

  while (remaining.length > 0) {
    let closestIndex = -1;
    let closestLegDistance = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const stop = remaining[index];
      const hasPickup = Number.isFinite(stop.pickupLat) && Number.isFinite(stop.pickupLng);
      const hasDestination = Number.isFinite(stop.lat) && Number.isFinite(stop.lng);
      const pickup = hasPickup
        ? { lat: stop.pickupLat, lng: stop.pickupLng }
        : hasDestination ? { lat: stop.lat, lng: stop.lng } : null;
      if (!pickup) continue;

      const toPickupDistance = distanceBetween(
        currentPoint.lat, currentPoint.lng, pickup.lat, pickup.lng
      );
      const toDestinationDistance = hasPickup && hasDestination
        ? distanceBetween(pickup.lat, pickup.lng, stop.lat, stop.lng)
        : 0;
      const legDistance = toPickupDistance + toDestinationDistance;
      if (Number.isFinite(legDistance) && legDistance < closestLegDistance) {
        closestIndex = index;
        closestLegDistance = legDistance;
      }
    }

    if (closestIndex < 0) {
      orderedStops.push(...remaining);
      break;
    }

    const [stop] = remaining.splice(closestIndex, 1);
    orderedStops.push(stop);
    currentPoint = Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
      ? { lat: stop.lat, lng: stop.lng }
      : Number.isFinite(stop.pickupLat) && Number.isFinite(stop.pickupLng)
        ? { lat: stop.pickupLat, lng: stop.pickupLng }
        : currentPoint;
  }

  return orderedStops;
}

const TERMINAL_DELIVERY_STATUSES = new Set([
  'DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED'
]);
const DELIVERY_BOUND_STATUSES = new Set([
  'HEADING_TO_DESTINATION', 'ARRIVED_AT_DESTINATION'
]);

export function buildRiderRoutePlan(stops, riderId) {
  if (!Array.isArray(stops) || !riderId) {
    return { stops: [], remainingStops: [], waypoints: [] };
  }

  const riderStops = stops.filter(stop => stop.assignedDriverId === riderId);
  const numberedStops = riderStops.map((stop, index) => {
    const statuses = [stop.dispatchStatus, stop.status]
      .map(status => String(status || '').toUpperCase());
    return {
      ...stop,
      routeNumber: index + 1,
      routeCompleted: statuses.includes('DELIVERED'),
      routeTerminal: statuses.some(status => TERMINAL_DELIVERY_STATUSES.has(status))
    };
  });
  const remainingStops = numberedStops.filter(stop => !stop.routeTerminal);
  const waypoints = [];

  for (const stop of remainingStops) {
    const statuses = [stop.dispatchStatus, stop.status]
      .map(status => String(status || '').toUpperCase());
    if (Number.isFinite(stop.pickupLat) && Number.isFinite(stop.pickupLng)
      && !statuses.some(status => DELIVERY_BOUND_STATUSES.has(status))) {
      waypoints.push({
        stopId: stop.id,
        routeNumber: stop.routeNumber,
        kind: 'pickup',
        label: `Pickup ${stop.routeNumber}`,
        address: stop.pickupAddress || stop.name || 'Pickup',
        point: { lat: stop.pickupLat, lng: stop.pickupLng }
      });
    }
    if (Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
      waypoints.push({
        stopId: stop.id,
        routeNumber: stop.routeNumber,
        kind: 'delivery',
        label: `Delivery ${stop.routeNumber}`,
        address: stop.address || stop.name || 'Delivery',
        point: { lat: stop.lat, lng: stop.lng }
      });
    }
  }

  return { stops: numberedStops, remainingStops, waypoints };
}

export function distanceToRouteKm(location, geometry) {
  if (!Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)
    || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)
    || geometry.coordinates.length < 2) {
    return Infinity;
  }
  const longitudeScale = 111.32 * Math.cos(location.lat * Math.PI / 180);
  const project = ([lng, lat]) => ({
    x: (lng - location.lng) * longitudeScale,
    y: (lat - location.lat) * 110.574
  });
  let minimumDistance = Infinity;
  for (let index = 1; index < geometry.coordinates.length; index += 1) {
    const start = project(geometry.coordinates[index - 1]);
    const end = project(geometry.coordinates[index]);
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(start.x * deltaX + start.y * deltaY) / lengthSquared));
    const nearestX = start.x + fraction * deltaX;
    const nearestY = start.y + fraction * deltaY;
    minimumDistance = Math.min(minimumDistance, Math.hypot(nearestX, nearestY));
  }
  return minimumDistance;
}
