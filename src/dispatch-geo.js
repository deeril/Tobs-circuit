import { getHexagonEdgeLengthAvg, gridDisk, latLngToCell } from 'h3-js';

export const RIDER_SEARCH_RADII_KM = [3, 5, 10];
export const RIDER_DISCOVERY_RADIUS_ROUNDS_KM = [5, 10];
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
