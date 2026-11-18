const LOCATION_FRESHNESS_MS = 90_000;

export function isValidMapLocation(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function toMapLibrePoint(lat, lng) {
  return isValidMapLocation(lat, lng) ? [lng, lat] : null;
}

export function getLocalMapZoom({ latitude, width, height, diameterKm = 20 }) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(width) || !Number.isFinite(height)
    || !Number.isFinite(diameterKm) || diameterKm <= 0) return 10;

  const viewportPixels = Math.max(160, Math.min(width - 48, height - 128));
  const latitudeScale = Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  const zoom = Math.log2(
    (viewportPixels * 40_075 * latitudeScale) / (512 * diameterKm)
  );
  return Math.max(8, Math.min(14, zoom));
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
  if (typeof document !== 'undefined' && element.querySelector) {
    let content = element.querySelector('.maplibre-marker-content');
    if (!content) {
      element.textContent = '';
      content = document.createElement('span');
      content.className = 'maplibre-marker-content';
      element.append(content);
    }
    let icon = content.querySelector('.maplibre-marker-icon');
    if (details.icon) {
      if (!icon) {
        icon = document.createElement('span');
        icon.className = 'maplibre-marker-icon';
        icon.setAttribute('aria-hidden', 'true');
        content.prepend(icon);
      }
      icon.textContent = details.icon;
      icon.style.transform = Number.isFinite(details.rotation)
        ? `rotate(${details.rotation}deg)`
        : '';
    } else if (icon) {
      icon.remove();
    }
    let label = content.querySelector('.maplibre-marker-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'maplibre-marker-label';
      content.append(label);
    }
    label.textContent = details.text;
  } else {
    element.textContent = details.text;
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
