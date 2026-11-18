function validCoordinates(point) {
  return Number.isFinite(point?.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point?.lng) && point.lng >= -180 && point.lng <= 180;
}

function samePoint(left, right) {
  return left.lat === right.lat && left.lng === right.lng;
}

function pointKey(point) {
  return `${point.lat},${point.lng}`;
}

function validateRoadLeg(route) {
  if (route?.mode !== 'road'
    || !Number.isFinite(route.distanceKm) || route.distanceKm < 0
    || !Number.isFinite(route.durationMinutes) || route.durationMinutes < 0
    || route.geometry?.type !== 'LineString'
    || !Array.isArray(route.geometry.coordinates)
    || route.geometry.coordinates.length < 2
    || route.geometry.coordinates.some(point =>
      !Array.isArray(point) || point.length < 2
        || !Number.isFinite(point[0]) || point[0] < -180 || point[0] > 180
        || !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90
    )) {
    throw new Error('A usable road route is required to sequence delivery stops.');
  }
  return route;
}

function validateRoadCost(cost) {
  if (cost?.mode !== 'road'
    || !Number.isFinite(cost.distanceKm) || cost.distanceKm < 0
    || !Number.isFinite(cost.durationMinutes) || cost.durationMinutes < 0) {
    throw new Error('The road-routing provider could not calculate every pending stop.');
  }
  return cost;
}

export async function sequenceStopsByRoad({
  origin,
  stops,
  routeMatrixProvider,
  routeProvider
}) {
  if (!validCoordinates(origin)) {
    throw new TypeError('A current rider location with valid coordinates is required.');
  }
  if (!Array.isArray(stops) || stops.length === 0) {
    throw new TypeError('At least one pending delivery stop is required.');
  }
  if (typeof routeMatrixProvider !== 'function' || typeof routeProvider !== 'function') {
    throw new TypeError('Road routing providers are required to sequence delivery stops.');
  }

  const ids = new Set();
  for (const stop of stops) {
    if (!stop || typeof stop.id !== 'string' || !stop.id || ids.has(stop.id)) {
      throw new TypeError('Delivery stop identifiers must be present and unique.');
    }
    if (!validCoordinates({ lat: stop.lat, lng: stop.lng })) {
      throw new TypeError(`Delivery stop ${stop.id} is missing valid destination coordinates.`);
    }
    ids.add(stop.id);
  }

  const destinationsByKey = new Map();
  for (const stop of stops) {
    const destination = { lat: stop.lat, lng: stop.lng };
    destinationsByKey.set(pointKey(destination), destination);
  }
  const destinations = [...destinationsByKey.values()];
  const sourcesByKey = new Map([[pointKey(origin), origin]]);
  for (const destination of destinations) sourcesByKey.set(pointKey(destination), destination);
  const sources = [...sourcesByKey.values()];
  const matrix = await routeMatrixProvider(sources, destinations);
  if (!Array.isArray(matrix) || matrix.length !== sources.length
    || matrix.some(row => !Array.isArray(row) || row.length !== destinations.length)) {
    throw new Error('The road-routing provider returned an incomplete distance matrix.');
  }

  const sourceIndexByKey = new Map(sources.map((source, index) => [pointKey(source), index]));
  const destinationIndexByKey = new Map(destinations.map((destination, index) => [
    pointKey(destination),
    index
  ]));
  const remaining = [...stops];
  const sequence = [];
  let current = origin;

  while (remaining.length) {
    const sourceIndex = sourceIndexByKey.get(pointKey(current));
    const ranked = remaining.map(stop => {
      const destination = { lat: stop.lat, lng: stop.lng };
      const cost = samePoint(current, destination)
        ? { distanceKm: 0, durationMinutes: 0 }
        : validateRoadCost(matrix[sourceIndex]?.[destinationIndexByKey.get(pointKey(destination))]);
      return { stop, destination, cost };
    }).sort((left, right) =>
      left.cost.distanceKm - right.cost.distanceKm
      || left.cost.durationMinutes - right.cost.durationMinutes
      || left.stop.id.localeCompare(right.stop.id)
    );

    const next = ranked[0];
    sequence.push(next);
    remaining.splice(remaining.findIndex(stop => stop.id === next.stop.id), 1);
    current = next.destination;
  }

  const legs = [];
  let previous = origin;
  for (const entry of sequence) {
    legs.push({
      from: previous,
      to: entry.destination,
      stop: entry.stop,
      isZeroLength: samePoint(previous, entry.destination)
    });
    previous = entry.destination;
  }

  const ordered = [];
  const maxConcurrentRoutes = 6;
  for (let index = 0; index < legs.length; index += maxConcurrentRoutes) {
    const batch = legs.slice(index, index + maxConcurrentRoutes);
    const routes = await Promise.all(batch.map(({ from, to, isZeroLength }) => {
      if (isZeroLength) {
        return {
          mode: 'road',
          distanceKm: 0,
          durationMinutes: 0,
          geometry: {
            type: 'LineString',
            coordinates: [[from.lng, from.lat], [to.lng, to.lat]]
          }
        };
      }
      return Promise.resolve().then(() => routeProvider(from, to)).then(validateRoadLeg);
    }));
    batch.forEach((entry, batchIndex) => {
      ordered.push({
        stop: entry.stop,
        leg: {
          ...routes[batchIndex],
          distanceKm: Number(routes[batchIndex].distanceKm.toFixed(2)),
          durationMinutes: Math.ceil(routes[batchIndex].durationMinutes)
        }
      });
    });
  }

  const totalDistanceKm = ordered.reduce((total, entry) => total + entry.leg.distanceKm, 0);
  const totalDurationMinutes = ordered.reduce((total, entry) => total + entry.leg.durationMinutes, 0);
  return {
    ordered,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationMinutes
  };
}
