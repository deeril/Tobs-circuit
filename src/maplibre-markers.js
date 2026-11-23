const LOCATION_FRESHNESS_MS = 90_000;

export function isValidMapLocation(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function toMapLibrePoint(lat, lng) {
  return isValidMapLocation(lat, lng) ? [lng, lat] : null;
}

export function getRiderMarkerInitial(name) {
  return String(name || '').trim().charAt(0).toUpperCase() || 'R';
}

export function getLocalMapZoom({ latitude = 0, width = 768, height = 1024 } = {}) {
  const safeLatitude = isValidMapLocation(latitude, 0) ? latitude : 0;
  const usablePixels = Math.min(
    Math.max(Number(width) - 48, 1),
    Math.max(Number(height) - 128, 1)
  );
  const visibleDiameterKm = 20;
  const zoom = Math.log2(
    usablePixels * 40_075 * Math.cos(safeLatitude * Math.PI / 180)
      / (512 * visibleDiameterKm)
  );
  return Math.max(0, Math.min(20, zoom));
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

export function getRouteStopMarkerInfo(stops) {
  if (!Array.isArray(stops)) return new Map();
  const routes = new Map();
  stops.forEach((stop, index) => {
    if (!stop?.id || !stop.assignedDriverId) return;
    const route = routes.get(stop.assignedDriverId) || [];
    route.push({ stop, index });
    routes.set(stop.assignedDriverId, route);
  });

  const markerInfo = new Map();
  for (const route of routes.values()) {
    route.sort((left, right) =>
      (getRouteOrder(left.stop) ?? Number.MAX_SAFE_INTEGER)
        - (getRouteOrder(right.stop) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index
    );
    const nextStop = route.find(({ stop }) => !isTerminalStop(stop))?.stop;
    route.forEach(({ stop }, index) => {
      markerInfo.set(stop.id, {
        number: getRouteOrder(stop) ?? index + 1,
        isNext: stop.id === nextStop?.id,
        isCompleted: isCompletedStop(stop)
      });
    });
  }
  return markerInfo;
}

function getRouteOrder(stop) {
  if (Number.isInteger(stop.routeSequence) && stop.routeSequence > 0) return stop.routeSequence;
  return Number.isInteger(stop.routeOrder) && stop.routeOrder > 0 ? stop.routeOrder : null;
}

function isCompletedStop(stop) {
  return ['DELIVERED', 'COMPLETED'].some(status =>
    [stop.dispatchStatus, stop.status].some(value => String(value || '').toUpperCase() === status)
  );
}

function isTerminalStop(stop) {
  return ['DELIVERED', 'COMPLETED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED']
    .some(status =>
      [stop.dispatchStatus, stop.status].some(value => String(value || '').toUpperCase() === status)
    );
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
  element.onclick = details.onClick || null;
  if (Number.isFinite(details.heading)) {
    element.style?.setProperty('--location-heading', `${details.heading}deg`);
  }
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
