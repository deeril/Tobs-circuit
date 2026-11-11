const LOCATION_FRESHNESS_MS = 90_000;

export function isValidMapLocation(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function toMapLibrePoint(lat, lng) {
  return isValidMapLocation(lat, lng) ? [lng, lat] : null;
}

export function getRiderMarkerState(driver, activeRiderIds, now) {
  if (!isValidMapLocation(driver.lat, driver.lng)) return null;
  if (driver.isPreviewFixture === true) return { kind: 'preview' };

  const updatedAt = new Date(driver.locationUpdatedAt || '').getTime();
  if (!Number.isFinite(updatedAt)) return null;
  const isFresh = driver.isTracking === true && now - updatedAt < LOCATION_FRESHNESS_MS;
  if (!isFresh && !activeRiderIds.has(driver.id)) return null;
  return { kind: isFresh ? 'live' : 'last-known' };
}

export function updateMapMarker(marker, details) {
  marker.setLngLat(details.point);
  const element = marker.getElement();
  const mapLibreClasses = element.className.split(/\s+/)
    .filter(className => className.startsWith('maplibregl-'));
  const markerClasses = details.className.split(/\s+/).filter(Boolean);
  element.className = [...mapLibreClasses, ...markerClasses].join(' ');
  element.title = details.title;
  element.setAttribute('aria-label', details.title);
  element.textContent = details.text;
}

export function reconcileMapMarkers(markerRefs, desiredMarkers, createMarker) {
  for (const [id, marker] of markerRefs) {
    if (!desiredMarkers.has(id)) {
      marker.remove();
      markerRefs.delete(id);
    }
  }
  for (const [id, details] of desiredMarkers) {
    const marker = markerRefs.get(id);
    if (marker) {
      updateMapMarker(marker, details);
    } else {
      markerRefs.set(id, createMarker(details));
    }
  }
}
