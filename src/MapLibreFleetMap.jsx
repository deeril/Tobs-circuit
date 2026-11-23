import React, { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  NavigationControl,
  Popup as MapLibrePopup,
  setWorkerUrl
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, LocateOff } from 'lucide-react';
import { buildRiderRoutePlan, distanceToRouteKm } from './dispatch-geo.js';
import {
  getLocalMapZoom,
  getRiderMarkerState,
  isValidMapLocation,
  reconcileMapMarkers,
  toMapLibrePoint
} from './maplibre-markers.js';

setWorkerUrl(maplibreWorkerUrl);

const LOCATION_FRESHNESS_MS = 90_000;
const ROUTE_REFRESH_MS = 10_000;
const DEVIATION_REROUTE_COOLDOWN_MS = 15_000;
const ROUTE_DEVIATION_THRESHOLD_KM = 0.5;
const MAX_ROUTE_WAYPOINTS = 32;
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
  selectedStopId,
  onReadyChange,
  onDriverSelect,
  onStopSelect
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const initialCenterRef = useRef(center);
  const mapHasLoadedRef = useRef(false);
  const markerRefs = useRef(new Map());
  const popupRef = useRef(null);
  const routeProgressRef = useRef(new Map());
  const routeInputsRef = useRef({ drivers, now, selectedDriverId, stops });
  const lastRouteFitKeyRef = useRef('');
  const followPositionRef = useRef({ riderId: '', locationUpdatedAt: '', following: false });
  const requestCallbacksRef = useRef({ onReadyChange, onDriverSelect, onStopSelect });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [usingRoadRoutes, setUsingRoadRoutes] = useState(true);
  const [routeSummaries, setRouteSummaries] = useState([]);
  const [mapError, setMapError] = useState('');
  const [followState, setFollowState] = useState({ riderId: '', enabled: true });
  const followSelectedRider = Boolean(selectedDriverId)
    && (followState.riderId !== selectedDriverId || followState.enabled);

  useEffect(() => {
    requestCallbacksRef.current = { onReadyChange, onDriverSelect, onStopSelect };
  }, [onReadyChange, onDriverSelect, onStopSelect]);

  useEffect(() => {
    routeInputsRef.current = { drivers, now, selectedDriverId, stops };
  }, [drivers, now, selectedDriverId, stops]);

  useEffect(() => {
    const container = containerRef.current;
    const markers = markerRefs.current;
    if (!styleUrl || !container) return undefined;
    let active = true;
    const map = new MapLibreMap({
      container,
      style: styleUrl,
      center: [initialCenterRef.current.lng, initialCenterRef.current.lat],
      zoom: getLocalMapZoom({
        latitude: initialCenterRef.current.lat,
        width: container.clientWidth,
        height: container.clientHeight
      }),
      cooperativeGestures: false,
      attributionControl: true
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
    const stopFollowing = () => setFollowState({
      riderId: routeInputsRef.current.selectedDriverId || '',
      enabled: false
    });
    map.on('dragstart', stopFollowing);
    map.on('wheel', stopFollowing);
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
          'line-width': ['case', ['get', 'live'], 6, 4],
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
    if (!map || !mapLoaded || selectedDriverId
      || !isValidMapLocation(centerLat, centerLng)) return;
    map.setCenter([centerLng, centerLat]);
  }, [centerLat, centerLng, mapLoaded, selectedDriverId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const assignedStops = stops.filter(stop => stop.assignedDriverId === selectedDriverId);
    const rider = drivers.find(driver => driver.id === selectedDriverId);
    const riderHasLocation = isValidMapLocation(rider?.lat, rider?.lng);
    const points = [
      ...(riderHasLocation ? [[rider.lng, rider.lat]] : []),
      ...assignedStops.flatMap(stop => [
        ...(isValidMapLocation(stop.pickupLat, stop.pickupLng) ? [[stop.pickupLng, stop.pickupLat]] : []),
        ...(isValidMapLocation(stop.lat, stop.lng) ? [[stop.lng, stop.lat]] : [])
      ])
    ];
    const fitKey = selectedDriverId
      ? `${selectedDriverId}:${riderHasLocation}:${assignedStops.map(stop => stop.id).join(',')}:${assignedStops.map(stop => `${stop.pickupLat},${stop.pickupLng},${stop.lat},${stop.lng}`).join('|')}`
      : '';
    if (!fitKey || fitKey === lastRouteFitKeyRef.current || points.length === 0) return;

    lastRouteFitKeyRef.current = fitKey;
    const isMobileMap = map.getContainer().clientWidth < 768;
    if (points.length === 1) {
      map.easeTo({ center: points[0], zoom: 14, duration: 450 });
      return;
    }
    const bounds = points.reduce(
      (result, point) => result.extend(point),
      new LngLatBounds()
    );
    map.fitBounds(bounds, {
      padding: isMobileMap
        ? { top: 76, right: 32, bottom: Math.round(map.getContainer().clientHeight * 0.68), left: 32 }
        : 76,
      maxZoom: isMobileMap ? 13 : 14,
      duration: 450
    });
  }, [drivers, mapLoaded, selectedDriverId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || selectedDriverId
      || !isValidMapLocation(currentLocation?.lat, currentLocation?.lng)) return;
    const frameId = window.requestAnimationFrame(() => {
      const currentMap = mapRef.current;
      if (!currentMap) return;
      currentMap.resize();
      const isMobileMap = currentMap.getContainer().clientWidth < 768;
      currentMap.flyTo({
        center: [currentLocation.lng, currentLocation.lat],
        zoom: isMobileMap ? 15 : 16,
        duration: 900,
        essential: true
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [currentLocation?.lat, currentLocation?.lng, currentLocation?.requestedAt, mapLoaded, selectedDriverId]);

  const selectedRider = drivers.find(driver => driver.id === selectedDriverId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedDriverId
      || !isValidMapLocation(selectedRider?.lat, selectedRider?.lng)) return;
    const previous = followPositionRef.current;
    const riderChanged = previous.riderId !== selectedDriverId;
    const locationChanged = previous.locationUpdatedAt !== selectedRider.locationUpdatedAt;
    const followWasReenabled = !previous.following && followSelectedRider;
    if (followSelectedRider && !riderChanged
      && (locationChanged || followWasReenabled)) {
      map.easeTo({
        center: [selectedRider.lng, selectedRider.lat],
        zoom: map.getZoom(),
        duration: 450
      });
    }
    followPositionRef.current = {
      riderId: selectedDriverId,
      locationUpdatedAt: selectedRider.locationUpdatedAt || '',
      following: followSelectedRider
    };
  }, [followSelectedRider, mapLoaded, selectedDriverId, selectedRider?.locationUpdatedAt, selectedRider?.lat, selectedRider?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const desiredMarkers = new Map();
    if (isValidMapLocation(currentLocation?.lat, currentLocation?.lng)) {
      desiredMarkers.set('current-location', {
        point: toMapLibrePoint(currentLocation.lat, currentLocation.lng),
        title: 'Your current location',
        className: 'maplibre-current-location-marker',
        text: '',
        heading: Number.isFinite(currentLocation.heading) ? currentLocation.heading : 135,
        anchor: 'center'
      });
    }
    const activeRiderIds = new Set(stops
      .filter(stop => ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus))
      .map(stop => stop.assignedDriverId)
      .filter(Boolean));
    const stopOrderById = new Map();
    const nextStopNumberByRider = new Map();
    const completedStopIds = new Set();
    for (const stop of stops) {
      if (!stop.assignedDriverId) continue;
      const stopNumber = (nextStopNumberByRider.get(stop.assignedDriverId) || 0) + 1;
      nextStopNumberByRider.set(stop.assignedDriverId, stopNumber);
      stopOrderById.set(stop.id, stopNumber);
      const status = String(stop.dispatchStatus || stop.status || '').toUpperCase();
      if (status === 'DELIVERED') completedStopIds.add(stop.id);
    }
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
          driver.id === selectedDriverId ? 'maplibre-rider-marker-selected' : '',
          selectedDriverId && driver.id !== selectedDriverId ? 'maplibre-rider-marker-muted' : ''
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
      const stopNumber = stopOrderById.get(stop.id);
      const stopAddress = stop.address || stop.name || 'Delivery address unavailable';
      const stopClass = [
        'maplibre-destination-marker',
        completedStopIds.has(stop.id) ? 'maplibre-destination-marker-completed' : '',
        stop.id === selectedStopId ? 'maplibre-destination-marker-selected' : '',
        selectedDriverId && stop.assignedDriverId !== selectedDriverId
          ? 'maplibre-destination-marker-muted'
          : ''
      ].filter(Boolean).join(' ');
      const selectStop = (point, address) => {
        requestCallbacksRef.current.onStopSelect?.(stop.id, stop.assignedDriverId);
        popupRef.current?.remove();
        const content = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = stopNumber ? `Delivery ${stopNumber}` : 'Delivery';
        const addressLine = document.createElement('p');
        addressLine.textContent = address;
        content.append(heading, addressLine);
        popupRef.current = new MapLibrePopup({ closeButton: true, closeOnClick: false })
          .setDOMContent(content)
          .setLngLat(point)
          .addTo(map);
      };
      if (isValidMapLocation(stop.pickupLat, stop.pickupLng)) {
        const pickupPoint = toMapLibrePoint(stop.pickupLat, stop.pickupLng);
        desiredMarkers.set(`pickup:${stop.id}`, {
          point: pickupPoint,
          title: `Pickup for ${stopNumber ? `delivery ${stopNumber}` : 'unassigned delivery'} · ${stop.pickupAddress || stop.name || 'Pickup address unavailable'}`,
          className: [
            'maplibre-pickup-marker',
            selectedDriverId && stop.assignedDriverId !== selectedDriverId
              ? 'maplibre-pickup-marker-muted'
              : ''
          ].filter(Boolean).join(' '),
          text: stopNumber ? `P${stopNumber}` : 'P?',
          onClick: () => selectStop(pickupPoint, stop.pickupAddress || 'Pickup address unavailable')
        });
      }
      if (isValidMapLocation(stop.lat, stop.lng)) {
        const destinationPoint = toMapLibrePoint(stop.lat, stop.lng);
        desiredMarkers.set(`destination:${stop.id}`, {
          point: destinationPoint,
          title: `${stopNumber ? `Delivery ${stopNumber}` : 'Unassigned delivery'} · ${stopAddress}`,
          className: stopClass,
          text: String(stopNumber || '?'),
          onClick: () => selectStop(destinationPoint, stopAddress)
        });
      }
    }
    reconcileMapMarkers(markerRefs.current, desiredMarkers, details => {
        const element = makeMarkerElement(details.className, details.title, details.text);
        if (Number.isFinite(details.heading)) {
          element.style.setProperty('--location-heading', `${details.heading}deg`);
        }
        element.onclick = details.onClick || null;
      return new MapLibreMarker({ element, anchor: details.anchor || 'bottom' })
          .setLngLat(details.point)
          .addTo(map);
      });
  }, [currentLocation?.heading, currentLocation?.lat, currentLocation?.lng, drivers, mapLoaded, now, selectedDriverId, selectedStopId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getSource('delivery-routes')) return undefined;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const {
        drivers: currentDrivers,
        now: currentNow,
        selectedDriverId: currentSelectedDriverId,
        stops: currentStops
      } = routeInputsRef.current;
      const rider = currentDrivers.find(driver => driver.id === currentSelectedDriverId);
      const plan = buildRiderRoutePlan(currentStops, currentSelectedDriverId);
      console.debug('Selected rider route refresh', {
        riderId: currentSelectedDriverId,
        hasCoordinates: isValidMapLocation(rider?.lat, rider?.lng),
        waypointCount: plan.waypoints.length
      });
      const features = [];
      const summaries = [];
      let allRoadRoutes = false;
      if (!rider || !isValidMapLocation(rider.lat, rider.lng) || plan.waypoints.length === 0) {
        map.getSource('delivery-routes')?.setData({ type: 'FeatureCollection', features });
        setUsingRoadRoutes(true);
        setRouteSummaries([]);
        refreshing = false;
        return;
      }

      allRoadRoutes = true;
      let from = { lat: rider.lat, lng: rider.lng };
      let routeWaypoints = plan.waypoints.slice(0, MAX_ROUTE_WAYPOINTS);
      if (routeWaypoints.length < plan.waypoints.length) allRoadRoutes = false;
      try {
        for (let index = 0; index < routeWaypoints.length; index += 1) {
          const waypoint = routeWaypoints[index];
          const to = waypoint.point;
          const isLiveLeg = index === 0;
          const legKey = isLiveLeg
            ? `live:${currentSelectedDriverId}:${waypoint.stopId}:${waypoint.kind}`
            : `${currentSelectedDriverId}:${from.lat},${from.lng}:${to.lat},${to.lng}`;
          const progress = routeProgressRef.current.get(legKey);
          const deviated = Boolean(isLiveLeg && progress
            && distanceToRouteKm({ lat: rider.lat, lng: rider.lng }, progress.geometry)
              > ROUTE_DEVIATION_THRESHOLD_KM);
          const routeAge = progress ? Date.now() - progress.requestedAt : Infinity;
          const shouldRerouteForDeviation = deviated && routeAge >= DEVIATION_REROUTE_COOLDOWN_MS;
          let route = progress?.route || null;
          if (!route || (isLiveLeg && routeAge >= ROUTE_REFRESH_MS) || shouldRerouteForDeviation) {
            const query = new URLSearchParams({
              fromLat: String(from.lat),
              fromLng: String(from.lng),
              toLat: String(to.lat),
              toLng: String(to.lng)
            });
            try {
              const response = await fetch(`${apiBaseUrl}/api/routing/route?${query}`, {
                credentials: apiBaseUrl ? 'include' : 'same-origin'
              });
              if (!response.ok) throw new Error(`Route request failed (${response.status}).`);
              route = { ...(await response.json()), requestedAt: Date.now() };
            } catch (error) {
              if (!active) return;
              console.error('Could not load a road route for the selected rider:', error);
              route = {
                mode: 'straight-line',
                geometry: straightLineGeometry(from, to),
                distanceKm: null,
                durationMinutes: null,
                requestedAt: Date.now()
              };
            }
          }
          if (!active) return;
          routeProgressRef.current.set(legKey, {
            geometry: route.geometry,
            route,
            requestedAt: route.requestedAt
          });
          allRoadRoutes = allRoadRoutes && route.mode === 'road';
          features.push({
            type: 'Feature',
            properties: { color: '#b4d83d', live: isLiveLeg },
            geometry: route.geometry
          });
          summaries.push({
            stopId: waypoint.stopId,
            driverId: currentSelectedDriverId,
            routeNumber: waypoint.routeNumber,
            kind: waypoint.kind,
            address: waypoint.address,
            distanceKm: route.distanceKm,
            durationMinutes: route.durationMinutes,
            mode: route.mode,
            locationUpdatedAt: rider.locationUpdatedAt,
            locationIsFresh: Boolean(rider.isTracking && rider.locationUpdatedAt
              && currentNow - new Date(rider.locationUpdatedAt).getTime() < LOCATION_FRESHNESS_MS),
            deviated: shouldRerouteForDeviation,
            live: isLiveLeg
          });
          from = to;
        }
        if (!active) return;
        map.getSource('delivery-routes')?.setData({ type: 'FeatureCollection', features });
        setUsingRoadRoutes(allRoadRoutes);
        setRouteSummaries(summaries);
      } finally {
        refreshing = false;
      }
    };

    refresh();
    const intervalId = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [apiBaseUrl, mapLoaded, selectedDriverId, stops]);

  return (
    <div className="maplibre-fleet-map absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {selectedDriverId && (
        <button
          type="button"
          aria-label={followSelectedRider ? 'Stop following rider' : 'Follow rider'}
          aria-pressed={followSelectedRider}
          title={followSelectedRider ? 'Stop following rider' : 'Follow rider'}
          className="maplibre-follow-control absolute right-3 top-3 z-10"
          onClick={() => {
            const next = !followSelectedRider;
            setFollowState({ riderId: selectedDriverId, enabled: next });
            if (next && isValidMapLocation(selectedRider?.lat, selectedRider?.lng)) {
              mapRef.current?.easeTo({
                center: [selectedRider.lng, selectedRider.lat],
                zoom: mapRef.current.getZoom(),
                duration: 450
              });
            }
          }}
        >
          {followSelectedRider ? <LocateFixed size={17} /> : <LocateOff size={17} />}
          <span>{followSelectedRider ? 'Following' : 'Follow rider'}</span>
        </button>
      )}
      {mapError && (
        <p role="status" className="absolute inset-x-3 top-3 z-10 rounded-xl border border-amber-300 bg-amber-50/95 px-3 py-2 text-[10px] font-semibold text-amber-950 shadow">
          {mapError}
        </p>
      )}
      {(() => {
        if (!selectedDriverId) return null;
        const plan = buildRiderRoutePlan(stops, selectedDriverId);
        const selectedRoute = routeSummaries.filter(route => route.driverId === selectedDriverId);
        const nextDeliveryIndex = selectedRoute.findIndex(route => route.kind === 'delivery');
        const nextDeliveryRoute = nextDeliveryIndex >= 0
          ? selectedRoute.slice(0, nextDeliveryIndex + 1)
          : [];
        const sumMetric = routes => routes.length > 0
          && routes.every(route => Number.isFinite(route.distanceKm))
          ? routes.reduce((total, route) => total + route.distanceKm, 0)
          : null;
        const sumEta = routes => routes.length > 0
          && routes.every(route => Number.isFinite(route.durationMinutes))
          ? routes.reduce((total, route) => total + route.durationMinutes, 0)
          : null;
        const nextDeliveryDistance = sumMetric(nextDeliveryRoute);
        const nextDeliveryEta = sumEta(nextDeliveryRoute);
        const totalDistance = sumMetric(selectedRoute);
        const totalEta = sumEta(selectedRoute);
        const rider = selectedRider;
        const locationIsFresh = Boolean(rider?.isTracking && rider.locationUpdatedAt
          && now - new Date(rider.locationUpdatedAt).getTime() < LOCATION_FRESHNESS_MS);
        const nextWaypoint = plan.waypoints[0];
        return (
          <div className="maplibre-route-summary absolute bottom-3 left-3 z-10">
            <p className="font-extrabold">{rider?.name || 'Selected rider'}{!locationIsFresh ? ' · Last known location' : ' · Live'}</p>
            {nextWaypoint ? (
              <>
                <p>Next: {nextWaypoint.address}</p>
                <p>
                  To delivery {nextDeliveryDistance === null ? '—' : `${nextDeliveryDistance.toFixed(1)} km`}
                  {' · '}{nextDeliveryEta === null ? 'ETA —' : `ETA ${nextDeliveryEta} min`}
                </p>
                <p>
                  Remaining route: {totalDistance === null ? '—' : `${totalDistance.toFixed(1)} km`}
                  {' · '}{totalEta === null ? 'ETA —' : `${totalEta} min`}
                  {' · '}{plan.remainingStops.length} stop{plan.remainingStops.length === 1 ? '' : 's'}
                </p>
                {selectedRoute.some(route => route.mode !== 'road') && (
                  <p className="text-amber-800">Some road routes are unavailable; shown legs are estimates.</p>
                )}
              </>
            ) : plan.remainingStops.length === 0 ? (
              <p>All assigned deliveries are complete.</p>
            ) : (
              <p>Waiting for this rider’s location and route calculation.</p>
            )}
            {!locationIsFresh && rider?.locationUpdatedAt && (
              <p>Last update {new Date(rider.locationUpdatedAt).toLocaleTimeString()}</p>
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
