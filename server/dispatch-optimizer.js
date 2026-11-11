const MAX_BATCH_SIZE = 3;
const MAX_PICKUP_DISTANCE_KM = 3;
const MAX_DESTINATION_DISTANCE_KM = 5;

function coordinates(point) {
  return Number.isFinite(point?.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point?.lng) && point.lng >= -180 && point.lng <= 180;
}

export function greatCircleDistanceKm(from, to) {
  if (!coordinates(from) || !coordinates(to)) return Infinity;
  const radians = value => value * Math.PI / 180;
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
      .map(rest => [value, ...rest])
  );
}

function packageSizeRank(size) {
  switch (String(size || '').toUpperCase()) {
    case 'SMALL': return 1;
    case 'MEDIUM': return 2;
    case 'LARGE': return 3;
    default: return null;
  }
}

function hasCapacity(deliveries, rider) {
  if (!Number.isInteger(rider?.maxPackageCount) || rider.maxPackageCount < 1
    || !Number.isFinite(rider?.maxPackageWeightKg) || rider.maxPackageWeightKg <= 0) return false;
  if (deliveries.some(delivery =>
    !Number.isInteger(delivery.packageCount) || delivery.packageCount < 1
    || !Number.isFinite(delivery.packageWeightKg) || delivery.packageWeightKg <= 0
  )) return false;
  const totalCount = deliveries.reduce((total, delivery) => total + delivery.packageCount, 0);
  const totalWeight = deliveries.reduce((total, delivery) => total + delivery.packageWeightKg, 0);
  if (totalCount > rider.maxPackageCount || totalWeight > rider.maxPackageWeightKg) return false;
  const maximumSize = packageSizeRank(rider.maxPackageSize);
  if (maximumSize === null) return false;
  return deliveries.every(delivery => {
    const requiredSize = packageSizeRank(delivery.packageSize);
    return requiredSize !== null && requiredSize <= maximumSize;
  });
}

function crossBusinessConsent(deliveries, rider) {
  const businesses = new Set(deliveries.map(delivery => delivery.businessId));
  if (businesses.size < 2) return true;
  return rider.acceptsCrossBusinessBatches === true
    && deliveries.every(delivery => delivery.businessAllowsCrossBusinessBatch === true);
}

function candidateIsCompatible(anchor, candidate) {
  return candidate.deliveryId !== anchor.deliveryId
    && greatCircleDistanceKm(anchor.pickup, candidate.pickup) <= MAX_PICKUP_DISTANCE_KM
    && greatCircleDistanceKm(anchor.destination, candidate.destination) <= MAX_DESTINATION_DISTANCE_KM
    && (!anchor.zoneId || !candidate.zoneId
      || String(anchor.zoneId).toLowerCase() === String(candidate.zoneId).toLowerCase())
    && (!anchor.requiredVehicleType || !candidate.requiredVehicleType
      || String(anchor.requiredVehicleType).toLowerCase()
        === String(candidate.requiredVehicleType).toLowerCase());
}

async function routeSequence(deliveries, routeProvider, now, riderLocation) {
  let current = riderLocation;
  let clock = now;
  let distanceKm = 0;
  const legs = [];
  for (const delivery of deliveries) {
    for (const [kind, point] of [['pickup', delivery.pickup], ['destination', delivery.destination]]) {
      if (current) {
        const leg = await routeProvider(current, point);
        if (leg?.mode !== 'road' || !Number.isFinite(leg.distanceKm)
          || !Number.isFinite(leg.durationMinutes) || leg.durationMinutes < 0) return null;
        distanceKm += leg.distanceKm;
        clock += leg.durationMinutes * 60_000;
        legs.push({ deliveryId: delivery.deliveryId, kind, ...leg });
      } else {
        legs.push({ deliveryId: delivery.deliveryId, kind, distanceKm: 0, durationMinutes: 0 });
      }
      legs[legs.length - 1].arrivesAt = new Date(clock).toISOString();
      if (kind === 'destination' && clock > new Date(delivery.deadlineAt).getTime()) return null;
      current = point;
    }
  }
  return { legs, distanceKm, estimatedArrivalAt: new Date(clock).toISOString() };
}

export async function optimizeDeliveryBatch({
  anchor,
  candidates,
  rider,
  routeProvider,
  now = Date.now(),
  allowBatching = true
}) {
  if (!anchor?.deliveryId || !coordinates(anchor.pickup) || !coordinates(anchor.destination)) {
    throw new TypeError('An anchor delivery with valid pickup and destination coordinates is required.');
  }
  if (!Array.isArray(candidates) || candidates.length === 0 || !allowBatching) {
    return { deliveries: [anchor], sequence: [anchor.deliveryId], route: null, reason: 'batching_disabled' };
  }
  if (!coordinates(rider?.location)) {
    return { deliveries: [anchor], sequence: [anchor.deliveryId], route: null, reason: 'rider_location_unknown' };
  }
  const options = [anchor, ...candidates]
    .filter(candidate => candidate && candidate.deliveryId !== anchor.deliveryId)
    .filter(candidate => candidateIsCompatible(anchor, candidate))
    .filter(candidate => [anchor, candidate].every(delivery =>
      !delivery.requiredVehicleType
      || String(delivery.requiredVehicleType).toLowerCase()
        === String(rider.vehicleType || '').toLowerCase()
    ))
    .slice(0, MAX_BATCH_SIZE - 1);
  if (!options.length) {
    return { deliveries: [anchor], sequence: [anchor.deliveryId], route: null, reason: 'no_nearby_deliveries' };
  }

  const feasible = [];
  for (let count = Math.min(MAX_BATCH_SIZE - 1, options.length); count >= 1 && feasible.length === 0; count -= 1) {
    const subsets = [];
    const choose = (start, selected) => {
      if (selected.length === count) {
        subsets.push([anchor, ...selected]);
        return;
      }
      for (let index = start; index < options.length; index += 1) {
        choose(index + 1, [...selected, options[index]]);
      }
    };
    choose(0, []);

    for (const deliveries of subsets) {
      if (deliveries.some(delivery =>
        !Number.isFinite(new Date(delivery.deadlineAt || '').getTime())
        || new Date(delivery.deadlineAt).getTime() <= now
      )) continue;
      if (!crossBusinessConsent(deliveries, rider) || !hasCapacity(deliveries, rider)) continue;
      for (const order of permutations(deliveries)) {
        const route = await routeSequence(order, routeProvider, now, rider?.location);
        if (route) feasible.push({ deliveries: order, route });
      }
    }
  }

  if (!feasible.length) {
    return { deliveries: [anchor], sequence: [anchor.deliveryId], route: null, reason: 'constraints_not_met' };
  }
  feasible.sort((left, right) =>
    left.route.distanceKm - right.route.distanceKm
    || left.route.estimatedArrivalAt.localeCompare(right.route.estimatedArrivalAt)
  );
  const selected = feasible[0];
  return {
    ...selected,
    sequence: selected.deliveries.map(delivery => delivery.deliveryId),
    reason: null
  };
}
