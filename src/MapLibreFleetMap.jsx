import React, { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  NavigationControl,
  setWorkerUrl
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { distanceToRouteKm } from './dispatch-geo.js';
import {
  getRiderMarkerState,
  isValidMapLocation,
  reconcileMapMarkers,
  toMapLibrePoint
} from './maplibre-markers.js';

setWorkerUrl(maplibreWorkerUrl);

const LOCATION_FRESHNESS_MS = 90_000;
const ROUTE_REFRESH_MS = 30_000;
const DEVIATION_REROUTE_COOLDOWN_MS = 15_000;
const ROUTE_DEVIATION_THRESHOLD_KM = 0.5;
const MAX_ROUTES = 8;
const ACTIVE_DELIVERY_STATUSES = [
  'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP',
  'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION'
];

function straightLineGeometry(from, to) {
  return { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] };
}

function makeMarkerElement(className, label, text) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.setAttribute('aria-label', label);
  element.title = label;
  element.textContent = text;
  return element;
}

export default function MapLibreFleetMap({
  styleUrl,
  apiBaseUrl = '',
  center,
  currentLocation,
  drivers,
  stops = [],
  now,
  selectedDriverId,
  onReadyChange,
  onDriverSelect
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const initialCenterRef = useRef(center);
  const mapHasLoadedRef = useRef(false);
  const markerRefs = useRef(new Map());
  const routeProgressRef = useRef(new Map());
  const routeInputsRef = useRef({ drivers, now, stops });
  const lastCandidateFitKeyRef = useRef('');
  const lastActiveRideFitKeyRef = useRef('');
  const requestCallbacksRef = useRef({ onReadyChange, onDriverSelect });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [usingRoadRoutes, setUsingRoadRoutes] = useState(true);
  const [routeSummaries, setRouteSummaries] = useState([]);
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    requestCallbacksRef.current = { onReadyChange, onDriverSelect };
  }, [onReadyChange, onDriverSelect]);

  useEffect(() => {
    routeInputsRef.current = { drivers, now, stops };
  }, [drivers, now, stops]);

  useEffect(() => {
    const container = containerRef.current;
    const markers = markerRefs.current;
    if (!styleUrl || !container) return undefined;
    let active = true;
    const map = new MapLibreMap({
      container,
      style: styleUrl,
      center: [initialCenterRef.current.lng, initialCenterRef.current.lat],
      zoom: 10,
      cooperativeGestures: false,
      attributionControl: true
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);
    map.once('load', () => {
      if (!active) return;
      map.addSource('delivery-routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'delivery-route-lines',
        type: 'line',
        source: 'delivery-routes',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 0.78
        }
      });
      setMapLoaded(true);
      mapHasLoadedRef.current = true;
      requestCallbacksRef.current.onReadyChange?.(true);
    });
    map.on('error', event => {
      if (!active || mapHasLoadedRef.current) return;
      console.error('MapLibre map could not be initialized:', event.error);
      setMapError('The interactive map could not load. Check the map style URL and network access.');
      requestCallbacksRef.current.onReadyChange?.(false);
    });
    return () => {
      active = false;
      resizeObserver.disconnect();
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
      mapHasLoadedRef.current = false;
    };
  }, [styleUrl]);

  const centerLat = center.lat;
  const centerLng = center.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isValidMapLocation(centerLat, centerLng)) return;
    map.setCenter([centerLng, centerLat]);
  }, [centerLat, centerLng, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const activeStops = stops.filter(stop =>
      stop.assignedDriverId
      && ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus)
      && (!selectedDriverId || stop.assignedDriverId === selectedDriverId)
    );
    if (activeStops.length > 0) {
      const activeRider = drivers.find(driver => driver.id === activeStops[0].assignedDriverId);
      const focusCoordinates = [
        ...(activeRider && isValidMapLocation(activeRider.lat, activeRider.lng)
          ? [[activeRider.lng, activeRider.lat]]
          : []),
        ...activeStops.flatMap(stop => [
          ...(isValidMapLocation(stop.pickupLat, stop.pickupLng) ? [[stop.pickupLng, stop.pickupLat]] : []),
          ...(isValidMapLocation(stop.lat, stop.lng) ? [[stop.lng, stop.lat]] : [])
        ])
      ];
      const fitKey = [
        ...activeStops.map(stop => `${stop.id}:${stop.dispatchStatus}`),
        ...focusCoordinates.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
      ].join('|');
      const riderOutsideView = activeRider
        && isValidMapLocation(activeRider.lat, activeRider.lng)
        && !map.getBounds().contains([activeRider.lng, activeRider.lat]);

      if (focusCoordinates.length > 0
        && (fitKey !== lastActiveRideFitKeyRef.current || riderOutsideView)) {
        lastActiveRideFitKeyRef.current = fitKey;
        if (focusCoordinates.length === 1) {
          map.easeTo({ center: focusCoordinates[0], zoom: 13, duration: 450 });
        } else {
          const bounds = focusCoordinates.reduce(
            (result, point) => result.extend(point),
            new LngLatBounds()
          );
          const isMobileMap = map.getContainer().clientWidth < 768;
          map.fitBounds(bounds, {
            padding: isMobileMap
              ? { top: 76, right: 32, bottom: Math.round(map.getContainer().clientHeight * 0.68), left: 32 }
              : 76,
            maxZoom: isMobileMap ? 13 : 14,
            duration: 450
          });
        }
      }
      return;
    }

    lastActiveRideFitKeyRef.current = '';
    if (selectedDriverId) return;
    const candidates = drivers.filter(driver =>
      (driver.isPreviewFixture || (driver.isAvailable && driver.isTracking))
      && isValidMapLocation(driver.lat, driver.lng)
    );
    if (!candidates.length) return;
    const fitKey = candidates.map(driver => driver.id).sort().join(':');
    if (fitKey === lastCandidateFitKeyRef.current) return;
    lastCandidateFitKeyRef.current = fitKey;
    const coordinates = candidates.flatMap(driver => {
      const delivery = stops.find(stop => stop.id === driver.deliveryId);
      return [
        [driver.lng, driver.lat],
        ...(delivery && isValidMapLocation(delivery.pickupLat, delivery.pickupLng)
          ? [[delivery.pickupLng, delivery.pickupLat]]
          : []),
        ...(delivery && isValidMapLocation(delivery.lat, delivery.lng)
          ? [[delivery.lng, delivery.lat]]
          : [])
      ];
    });
    if (coordinates.length === 1) {
      map.setCenter(coordinates[0]);
      return;
    }
    const bounds = coordinates.reduce((result, point) => result.extend(point), new LngLatBounds());
    map.fitBounds(bounds, { padding: 72, maxZoom: 12, duration: 450 });
  }, [drivers, mapLoaded, selectedDriverId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isValidMapLocation(currentLocation?.lat, currentLocation?.lng)) return;
    map.flyTo({
      center: [currentLocation.lng, currentLocation.lat],
      zoom: 16,
      duration: 900,
      essential: true
    });
  }, [currentLocation?.lat, currentLocation?.lng, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const desiredMarkers = new Map();
    if (isValidMapLocation(currentLocation?.lat, currentLocation?.lng)) {
      desiredMarkers.set('current-location', {
        point: toMapLibrePoint(currentLocation.lat, currentLocation.lng),
        title: 'Your current location',
        className: 'maplibre-current-location-marker',
        text: 'Me'
      });
    }
    const activeRiderIds = new Set(stops
      .filter(stop => ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus))
      .map(stop => stop.assignedDriverId)
      .filter(Boolean));
    for (const driver of drivers) {
      const markerState = getRiderMarkerState(driver, activeRiderIds, now);
      if (!markerState) continue;
      const isFresh = markerState.kind === 'live';
      const isPreview = markerState.kind === 'preview';
      desiredMarkers.set(`rider:${driver.id}`, {
        point: toMapLibrePoint(driver.lat, driver.lng),
        title: `${driver.discoveryRank ? `Driver ${driver.discoveryRank} · ${driver.pickupDistanceKm?.toFixed(1)} km from pickup · ` : ''}${isPreview ? 'Preview rider' : isFresh ? 'Rider' : 'Last known rider location'} ${driver.name}${driver.locationUpdatedAt ? ` · updated ${new Date(driver.locationUpdatedAt).toLocaleString()}` : ''}`,
        className: [
          isPreview
            ? 'maplibre-rider-preview-marker'
            : isFresh ? 'maplibre-rider-marker' : 'maplibre-rider-stale-marker',
          driver.id === selectedDriverId ? 'maplibre-rider-marker-selected' : ''
        ].filter(Boolean).join(' '),
        text: isPreview
          ? `Preview · ${driver.name}`
          : driver.discoveryRank
          ? `#${driver.discoveryRank} ${driver.name}`
          : isFresh ? driver.name : `Stale · ${driver.name}`,
        onClick: () => requestCallbacksRef.current.onDriverSelect?.(driver.id)
      });
    }
    for (const stop of stops) {
      if (isValidMapLocation(stop.pickupLat, stop.pickupLng)) {
        desiredMarkers.set(`pickup:${stop.id}`, {
          point: toMapLibrePoint(stop.pickupLat, stop.pickupLng),
          title: `Pickup · ${stop.pickupAddress || stop.name || 'Delivery'}`,
          className: 'maplibre-pickup-marker',
          text: 'Pickup'
        });
      }
      if (isValidMapLocation(stop.lat, stop.lng)) {
        desiredMarkers.set(`destination:${stop.id}`, {
          point: toMapLibrePoint(stop.lat, stop.lng),
          title: `Destination · ${stop.address || stop.name || 'Delivery'}`,
          className: 'maplibre-destination-marker',
          text: 'Dropoff'
        });
      }
    }
    reconcileMapMarkers(markerRefs.current, desiredMarkers, details => {
        const element = makeMarkerElement(details.className, details.title, details.text);
        element.addEventListener('click', details.onClick || (() => {}));
        return new MapLibreMarker({ element, anchor: 'bottom' })
          .setLngLat(details.point)
          .addTo(map);
      });
  }, [currentLocation?.lat, currentLocation?.lng, drivers, mapLoaded, now, selectedDriverId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getSource('delivery-routes')) return undefined;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const { drivers: currentDrivers, now: currentNow, stops: currentStops } = routeInputsRef.current;
      const liveDrivers = new Map(currentDrivers.filter(driver =>
        driver.isTracking
        && driver.locationUpdatedAt
        && currentNow - new Date(driver.locationUpdatedAt).getTime() < LOCATION_FRESHNESS_MS
        && isValidMapLocation(driver.lat, driver.lng)
      ).map(driver => [driver.id, driver]));
      const routes = currentStops.filter(stop =>
        isValidMapLocation(stop.pickupLat, stop.pickupLng)
        && isValidMapLocation(stop.lat, stop.lng)
        && ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus)
      ).slice(0, MAX_ROUTES);
      const features = [];
      const summaries = [];
      let allRoadRoutes = true;
      try {
        for (const stop of routes) {
          const driver = liveDrivers.get(stop.assignedDriverId);
          if (!driver) continue;
          const headingToPickup = ['RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP']
            .includes(stop.dispatchStatus);
          const from = { lat: driver.lat, lng: driver.lng };
          const to = headingToPickup
            ? { lat: stop.pickupLat, lng: stop.pickupLng }
            : { lat: stop.lat, lng: stop.lng };
          if (from.lat === to.lat && from.lng === to.lng) continue;

          const progress = routeProgressRef.current.get(stop.id);
          const sameLeg = progress
            && progress.destination.lat === to.lat
            && progress.destination.lng === to.lng
            && progress.status === stop.dispatchStatus;
          const deviated = Boolean(driver && sameLeg
            && distanceToRouteKm({ lat: driver.lat, lng: driver.lng }, progress.geometry)
              > ROUTE_DEVIATION_THRESHOLD_KM);
          const routeAge = progress ? Date.now() - progress.requestedAt : Infinity;
          const shouldRerouteForDeviation = deviated
            && routeAge >= DEVIATION_REROUTE_COOLDOWN_MS;
          let route = sameLeg ? progress.route : null;
          if (!route || routeAge >= ROUTE_REFRESH_MS || shouldRerouteForDeviation) {
            const query = new URLSearchParams({
              fromLat: String(from.lat),
              fromLng: String(from.lng),
              toLat: String(to.lat),
              toLng: String(to.lng)
            });
            try {
              const response = await fetch(`${apiBaseUrl}/api/routing/route?${query}`, {
                credentials: apiBaseUrl ? 'include' : 'same-origin',
                signal: controller.signal
              });
              if (!response.ok) throw new Error(`Route request failed (${response.status}).`);
              route = { ...(await response.json()), requestedAt: Date.now() };
            } catch (error) {
              if (controller.signal.aborted) return;
              console.error('Could not load a road route for the delivery map:', error);
              route = {
                mode: 'straight-line',
                geometry: straightLineGeometry(from, to),
                requestedAt: Date.now()
              };
            }
          }
          if (controller.signal.aborted) return;
          routeProgressRef.current.set(stop.id, {
            geometry: route.geometry,
            destination: to,
            status: stop.dispatchStatus,
            route,
            requestedAt: route.requestedAt
          });
          allRoadRoutes = allRoadRoutes && route.mode === 'road';
          features.push({
            type: 'Feature',
            properties: { color: headingToPickup ? '#b4d83d' : '#25271f' },
            geometry: route.geometry
          });
          summaries.push({
            stopId: stop.id,
            driverId: stop.assignedDriverId,
            status: stop.dispatchStatus,
            distanceKm: route.distanceKm,
            durationMinutes: route.durationMinutes,
            mode: route.mode,
            locationUpdatedAt: driver.locationUpdatedAt,
            deviated: shouldRerouteForDeviation
          });
        }
        if (controller.signal.aborted) return;
        map.getSource('delivery-routes')?.setData({ type: 'FeatureCollection', features });
        setUsingRoadRoutes(allRoadRoutes);
        setRouteSummaries(summaries);
      } finally {
        refreshing = false;
      }
    };

    refresh();
    const intervalId = window.setInterval(refresh, 10_000);
    return () => {
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, [apiBaseUrl, mapLoaded]);

  return (
    <div className="maplibre-fleet-map absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {mapError && (
        <p role="status" className="absolute inset-x-3 top-3 z-10 rounded-xl border border-amber-300 bg-amber-50/95 px-3 py-2 text-[10px] font-semibold text-amber-950 shadow">
          {mapError}
        </p>
      )}
      {(() => {
        const selectedStop = stops.find(stop =>
          stop.assignedDriverId === selectedDriverId
          && ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus)
        );
        const trackedStop = selectedStop || stops.find(stop =>
          stop.assignedDriverId && ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus)
        );
        if (!trackedStop) return null;
        const summary = routeSummaries.find(route => route.stopId === trackedStop.id);
        const rider = drivers.find(driver => driver.id === trackedStop.assignedDriverId);
        const locationIsFresh = Boolean(rider?.isTracking && rider.locationUpdatedAt
          && now - new Date(rider.locationUpdatedAt).getTime() < LOCATION_FRESHNESS_MS);
        return (
          <div className="absolute bottom-3 left-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-xl bg-white/95 px-3 py-2 text-[10px] font-semibold text-slate-800 shadow">
            <p className="font-extrabold">{trackedStop.name || 'Active delivery'}</p>
            {locationIsFresh && summary ? (
              <p>
                ETA {summary.durationMinutes ?? '—'} min · {summary.distanceKm ?? '—'} km
                {summary.status === 'RIDER_ASSIGNED' || summary.status === 'RIDER_ACCEPTED'
                  || summary.status === 'HEADING_TO_PICKUP'
                  ? ' to pickup'
                  : ' to destination'}
                {summary.mode !== 'road' ? ' · straight-line estimate' : ''}
                {summary.deviated ? ' · route recalculated' : ''}
              </p>
            ) : (
              <p>
                Last known location: {rider?.locationUpdatedAt
                  ? new Date(rider.locationUpdatedAt).toLocaleString()
                  : 'unavailable'} · ETA updates when live tracking resumes.
              </p>
            )}
          </div>
        );
      })()}
      {mapLoaded && !usingRoadRoutes && (
        <p className="absolute bottom-3 right-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-[10px] font-semibold text-slate-700 shadow">
          Showing straight-line estimates where road routes are unavailable.
        </p>
      )}
    </div>
  );
}
