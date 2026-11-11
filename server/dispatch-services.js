const EARTH_RADIUS_KM = 6371;
const VALID_ROUTE_PROFILES = new Map([
  ['driving', 'auto'],
  ['auto', 'auto'],
  ['car', 'auto'],
  ['cycling', 'bicycle'],
  ['bicycle', 'bicycle'],
  ['walking', 'pedestrian'],
  ['pedestrian', 'pedestrian'],
  ['motorcycle', 'motorcycle']
]);

export function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function haversineDistanceKm(from, to) {
  const radians = value => value * (Math.PI / 180);
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat))
    * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function pointsAsLine(from, to) {
  return { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] };
}

function photonUrl(baseUrl, resource, parameters) {
  const root = new URL(baseUrl);
  root.pathname = `${root.pathname.replace(/\/+$/, '')}/${resource}`;
  root.search = '';
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') root.searchParams.set(key, String(value));
  }
  return root;
}

function decodePolyline(encoded, precision = 6) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += deltaLat;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += deltaLng;
    const scale = 10 ** precision;
    coordinates.push([lng / scale, lat / scale]);
  }
  return coordinates;
}

async function fetchJson(url, { signal, timeoutMs = 5000, method = 'GET', headers = {}, body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Service request timed out.')), timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      method,
      headers: {
        Accept: 'application/json',
        ...headers
      },
      body
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function searchPhoton({ baseUrl, query, lat, lng, reverse = false, signal }) {
  if (!baseUrl) throw new Error('Address search is not configured on this server.');
  if (reverse ? !validCoordinates(lat, lng) : typeof query !== 'string' || query.trim().length < 2) {
    throw new TypeError('The address search request is invalid.');
  }
  const url = photonUrl(baseUrl, reverse ? 'reverse' : 'api', reverse
    ? { lat, lon: lng, limit: 1 }
    : { q: query.trim().slice(0, 160), lat, lon: lng, limit: 5 });
  const result = await fetchJson(url, { signal });
  if (!Array.isArray(result.features)) throw new Error('Address provider returned an invalid response.');
  return result.features.filter(feature =>
    feature?.geometry?.type === 'Point'
    && Array.isArray(feature.geometry.coordinates)
    && validCoordinates(feature.geometry.coordinates[1], feature.geometry.coordinates[0])
    && feature.properties && typeof feature.properties === 'object'
  ).slice(0, reverse ? 1 : 5);
}

function normalizeRouteProfile(profile) {
  const candidate = String(profile || 'auto').trim().toLowerCase();
  return VALID_ROUTE_PROFILES.get(candidate) || 'auto';
}

function buildValhallaRequest(baseUrl, from, to, profile) {
  const root = new URL(baseUrl);
  root.pathname = `${root.pathname.replace(/\/+$/, '')}/route`;
  root.search = '';
  const requestBody = {
    locations: [
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng }
    ],
    costing: normalizeRouteProfile(profile),
    units: 'kilometers'
  };
  return { root, requestBody };
}

export async function getRoadRoute({ baseUrl, profile = 'auto', from, to, signal }) {
  if (!validCoordinates(from?.lat, from?.lng) || !validCoordinates(to?.lat, to?.lng)) {
    throw new TypeError('The route coordinates are invalid.');
  }
  const straightLineKm = haversineDistanceKm(from, to);
  const fallback = reason => ({
    provider: null,
    mode: 'straight-line',
    warning: reason,
    distanceKm: Number(straightLineKm.toFixed(2)),
    durationMinutes: Math.max(1, Math.ceil(straightLineKm / 20 * 60)),
    geometry: pointsAsLine(from, to)
  });
  if (!baseUrl) return fallback('Road routing is not configured; showing a straight-line estimate.');

  try {
    const { root, requestBody } = buildValhallaRequest(baseUrl, from, to, profile);
    const result = await fetchJson(root, {
      signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const trip = result?.trip;
    const leg = trip?.legs?.[0];
    const shape = leg?.shape || trip?.shape || '';
    const coordinates = shape ? decodePolyline(shape) : [[from.lng, from.lat], [to.lng, to.lat]];
    const distanceKm = Number(trip?.summary?.length ?? leg?.summary?.length);
    const durationSeconds = Number(trip?.summary?.time ?? leg?.summary?.time);
    if (!trip || !Number.isFinite(distanceKm) || !Number.isFinite(durationSeconds)
      || !Array.isArray(coordinates) || coordinates.length < 2
      || coordinates.some(([lng, lat]) => !validCoordinates(lat, lng))) {
      return fallback('The routing provider returned no usable road route; showing a straight-line estimate.');
    }
    return {
      provider: 'Valhalla',
      mode: 'road',
      warning: null,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      geometry: {
        type: 'LineString',
        coordinates: coordinates.map(([lng, lat]) => [lng, lat])
      }
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return fallback('Road routing is temporarily unavailable; showing a straight-line estimate.');
  }
}
