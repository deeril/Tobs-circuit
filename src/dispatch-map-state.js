export function applyBusinessRiderLocation(riders, event, businessId) {
  const isPublicMarketplaceUpdate = event?.publicMarket === true && event.assigned !== true;
  if (!event || typeof event.id !== 'string'
    || (!isPublicMarketplaceUpdate && event.businessId !== businessId)) return riders;

  const existing = riders.find(rider => rider.id === event.id);
  const nextRider = {
    ...existing,
    ...event,
    lat: Number.isFinite(event.lat) ? event.lat : existing?.lat,
    lng: Number.isFinite(event.lng) ? event.lng : existing?.lng,
    locationUpdatedAt: event.locationUpdatedAt || existing?.locationUpdatedAt
  };
  if (!nextRider.isTracking && !nextRider.assigned && !nextRider.isAvailable) {
    return riders.filter(rider => rider.id !== event.id);
  }
  return [...riders.filter(rider => rider.id !== event.id), nextRider];
}

export function removeUnavailableBusinessRider(riders, event) {
  if (typeof event?.id !== 'string') return riders;
  return riders.filter(rider => rider.id !== event.id);
}
