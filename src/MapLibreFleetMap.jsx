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
  getLocalMapZoom,
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

function makeMarkerElement(className, label, text, icon) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.setAttribute('aria-label', label);
  element.title = label;
  const content = document.createElement('span');
  content.className = 'maplibre-marker-content';
  if (icon) {
    const iconElement = document.createElement('span');
    iconElement.className = 'maplibre-marker-icon';
    iconElement.setAttribute('aria-hidden', 'true');
    iconElement.textContent = icon;
    content.append(iconElement);
  }
  const labelElement = document.createElement('span');
  labelElement.className = 'maplibre-marker-label';
  labelElement.textContent = text;
  content.append(labelElement);
  element.append(content);
  return element;
}

function getVehicleMarkerIcon(driver) {
  const type = String(driver.vehicleType || driver.vehicle_type || '').trim().toUpperCase();
  if (type === 'CAR') return '🚗';
  if (type === 'BICYCLE') return '🚲';
  if (type === 'MOTORCYCLE' || type === 'MOTORBIKE' || type === 'BIKE') return '🏍️';
  const vehicle = String(driver.vehicle || '').toLowerCase();
  return vehicle.includes('car') ? '🚗' : vehicle.includes('bicycle') ? '🚲' : '🏍️';
}

export default function MapLibreFleetMap({
  styleUrl,
  apiBaseUrl = '',
  center,
  currentLocation = null,
  followDriverLocation = false,
  mobileBottomSheetVisible = false,
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
  const manualMapViewRef = useRef(false);
  const mapHasLoadedRef = useRef(false);
  const markerRefs = useRef(new Map());
  const routeProgressRef = useRef(new Map());
  const routeInputsRef = useRef({ drivers, now, stops, selectedDriverId, currentLocation });
  const lastCandidateFitKeyRef = useRef('');
  const lastActiveRideFitKeyRef = useRef('');
  const requestCallbacksRef = useRef({ onReadyChange, onDriverSelect, onStopSelect });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [usingRoadRoutes, setUsingRoadRoutes] = useState(true);
  const [routeSummaries, setRouteSummaries] = useState([]);
  const [mapError, setMapError] = useState('');
  const [followEnabled, setFollowEnabled] = useState(Boolean(followDriverLocation));

  useEffect(() => {
    requestCallbacksRef.current = { onReadyChange, onDriverSelect, onStopSelect };
  }, [onReadyChange, onDriverSelect, onStopSelect]);

  useEffect(() => {
    routeInputsRef.current = { drivers, now, stops, selectedDriverId, currentLocation };
  }, [currentLocation, drivers, now, selectedDriverId, stops]);

  useEffect(() => {
    setFollowEnabled(Boolean(followDriverLocation));
  }, [followDriverLocation]);

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
      cooperativeGestures: true,
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
          'line-width': ['coalesce', ['get', 'width'], 4],
          'line-opacity': ['coalesce', ['get', 'opacity'], 0.78]
        }
      });
      const handleUserMapGesture = event => {
        if (!event.originalEvent) return;
        manualMapViewRef.current = true;
        setFollowEnabled(false);
      };
      map.on('dragstart', handleUserMapGesture);
      map.on('zoomstart', handleUserMapGesture);
      map.on('rotatestart', handleUserMapGesture);
      map.on('pitchstart', handleUserMapGesture);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return undefined;
    const updateMobilePadding = () => {
      const container = map.getContainer();
      let top = 0;
      let bottom = 0;
      if (mobileBottomSheetVisible && container.clientWidth < 768) {
        const mapBounds = container.getBoundingClientRect();
        const mapPanel = container.closest('.admin-map-panel');
        const toolbar = mapPanel?.querySelector('.admin-map-toolbar');
        const toolbarBounds = toolbar?.getBoundingClientRect();
        const sidebar = container.closest('.app-shell')?.querySelector('.admin-dashboard-sidebar');
        const sidebarBounds = sidebar?.getBoundingClientRect();
        top = toolbarBounds
          && toolbarBounds.top < mapBounds.bottom
          && toolbarBounds.bottom > mapBounds.top
          ? Math.ceil(toolbarBounds.bottom - mapBounds.top + 12)
          : 76;
        bottom = sidebarBounds
          && sidebarBounds.top < mapBounds.bottom
          && sidebarBounds.bottom > mapBounds.top
          ? Math.ceil(mapBounds.bottom - sidebarBounds.top + 16)
          : Math.ceil(Math.min(window.innerHeight * 0.62, 580) + 16);
      }
      map.setPadding({ top, right: 0, bottom, left: 0 });
    };
    updateMobilePadding();
    map.on('resize', updateMobilePadding);
    window.addEventListener('resize', updateMobilePadding);
    return () => {
      map.off('resize', updateMobilePadding);
      window.removeEventListener('resize', updateMobilePadding);
    };
  }, [mapLoaded, mobileBottomSheetVisible]);

  const centerLat = center.lat;
  const centerLng = center.lng;
  const selectedStop = stops.find(stop => stop.id === selectedStopId);
  const selectedStopLat = selectedStop?.lat;
  const selectedStopLng = selectedStop?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isValidMapLocation(centerLat, centerLng)) return;
    if (followDriverLocation) {
      if (followEnabled) {
        const rider = drivers.find(driver => driver.id === selectedDriverId)
          || drivers.find(driver => isValidMapLocation(driver.lat, driver.lng));
        const point = isValidMapLocation(currentLocation?.lat, currentLocation?.lng)
          ? [currentLocation.lng, currentLocation.lat]
          : rider && isValidMapLocation(rider.lat, rider.lng)
            ? [rider.lng, rider.lat]
            : null;
        if (point) map.easeTo({ center: point, duration: 750 });
      }
      return;
    }
    if (manualMapViewRef.current) return;
    map.setCenter([centerLng, centerLat]);
  }, [
    centerLat, centerLng, currentLocation, drivers, followDriverLocation,
    followEnabled, mapLoaded, selectedDriverId
  ]);

  useEffect(() => {
    if (!selectedStopId) return;
    if (!isValidMapLocation(selectedStopLat, selectedStopLng)) return;
    setFollowEnabled(false);
    mapRef.current?.easeTo({
      center: [selectedStopLng, selectedStopLat],
      zoom: Math.max(mapRef.current.getZoom(), 14),
      duration: 500
    });
  }, [selectedStopId, selectedStopLat, selectedStopLng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (followDriverLocation || isValidMapLocation(currentLocation?.lat, currentLocation?.lng)) {
      lastActiveRideFitKeyRef.current = '';
      lastCandidateFitKeyRef.current = '';
      return;
    }
    if (manualMapViewRef.current) return;
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
        selectedDriverId || activeStops[0].assignedDriverId,
        ...activeStops.map(stop => [
          stop.id,
          stop.dispatchStatus,
          stop.routeOrder ?? stop.routeSequence ?? '',
          stop.pickupLng ?? '',
          stop.pickupLat ?? '',
          stop.lng ?? '',
          stop.lat ?? ''
        ].join(':'))
      ].join('|');

      if (focusCoordinates.length > 0
        && fitKey !== lastActiveRideFitKeyRef.current) {
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
  }, [currentLocation, drivers, followDriverLocation, mapLoaded, selectedDriverId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const desiredMarkers = new Map();
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
        icon: getVehicleMarkerIcon(driver),
        rotation: Number.isFinite(driver.heading) ? driver.heading : 0,
        onClick: () => requestCallbacksRef.current.onDriverSelect?.(driver.id)
      });
    }
    const plannedStops = stops.filter(stop => Number.isInteger(stop.routeSequence) && stop.routeSequence > 0);
    const routeStart = plannedStops
      .filter(stop => isValidMapLocation(stop.routeStartLocation?.lat, stop.routeStartLocation?.lng))
      .sort((left, right) => left.routeSequence - right.routeSequence)[0]?.routeStartLocation;
    if (routeStart) {
      desiredMarkers.set('route-start', {
        point: toMapLibrePoint(routeStart.lat, routeStart.lng),
        title: 'Route starting location · rider GPS when the sequence was calculated',
        className: 'maplibre-route-start-marker',
        text: 'Start',
        icon: 'S'
      });
    }
    for (const stop of stops) {
      if (isValidMapLocation(stop.pickupLat, stop.pickupLng)) {
        desiredMarkers.set(`pickup:${stop.id}`, {
          point: toMapLibrePoint(stop.pickupLat, stop.pickupLng),
          title: `Pickup location · ${stop.pickupAddress || stop.name || 'Delivery'}`,
          className: 'maplibre-pickup-marker',
          text: 'Pickup location',
          icon: '📍'
        });
      }
      if (isValidMapLocation(stop.lat, stop.lng)) {
        const isCompleted = ['DELIVERED', 'COMPLETED'].includes(
          String(stop.dispatchStatus || stop.status || '').toUpperCase()
        );
        const sequenceText = Number.isInteger(stop.routeSequence) && stop.routeSequence > 0
          ? `Stop ${stop.routeSequence}`
          : 'Dropoff';
        desiredMarkers.set(`destination:${stop.id}`, {
          point: toMapLibrePoint(stop.lat, stop.lng),
          title: `${sequenceText} · ${stop.address || stop.name || 'Delivery'} · ${stop.dispatchStatus || stop.status || 'Pending'}`,
          className: [
            'maplibre-destination-marker',
            isCompleted ? 'maplibre-destination-marker-completed' : '',
            stop.id === selectedStopId ? 'maplibre-destination-marker-selected' : ''
          ].filter(Boolean).join(' '),
          text: sequenceText,
          icon: isCompleted ? '✓' : null,
          onClick: () => requestCallbacksRef.current.onStopSelect?.(stop.id)
        });
      }
    }
    if (isValidMapLocation(currentLocation?.lat, currentLocation?.lng)) {
      desiredMarkers.set('current-location', {
        point: toMapLibrePoint(currentLocation.lat, currentLocation.lng),
        title: 'Your current location',
        className: 'maplibre-current-location-marker',
        text: '',
        icon: null
      });
    }
    reconcileMapMarkers(markerRefs.current, desiredMarkers, details => {
        const element = makeMarkerElement(details.className, details.title, details.text, details.icon);
          const iconElement = element.querySelector('.maplibre-marker-icon');
          if (iconElement && Number.isFinite(details.rotation)) {
            iconElement.style.transform = `rotate(${details.rotation}deg)`;
          }
          element.addEventListener('click', details.onClick || (() => {}));
        const marker = new MapLibreMarker({ element, anchor: 'bottom' })
          .setLngLat(details.point)
          .addTo(map);
        return marker;
      });
  }, [currentLocation, drivers, mapLoaded, now, selectedDriverId, selectedStopId, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getSource('delivery-routes')) return undefined;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const {
        drivers: currentDrivers,
        now: currentNow,
        stops: currentStops,
      } = routeInputsRef.current;
      const liveDrivers = new Map(currentDrivers.filter(driver =>
        driver.isTracking
        && driver.locationUpdatedAt
        && currentNow - new Date(driver.locationUpdatedAt).getTime() < LOCATION_FRESHNESS_MS
        && isValidMapLocation(driver.lat, driver.lng)
      ).map(driver => [driver.id, driver]));
      const sequencedStops = currentStops.filter(stop =>
        Number.isInteger(stop.routeSequence) && stop.routeSequence > 0
      );
      const legacyRoutes = currentStops.filter(stop =>
        !Number.isInteger(stop.routeSequence)
        && isValidMapLocation(stop.pickupLat, stop.pickupLng)
        && isValidMapLocation(stop.lat, stop.lng)
        && ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus)
      ).slice(0, MAX_ROUTES);
      const features = [];
      const summaries = [];
      let allRoadRoutes = true;
      try {
        for (const stop of sequencedStops) {
          if (stop.routeLegGeometry?.type !== 'LineString'
            || !Array.isArray(stop.routeLegGeometry.coordinates)
            || stop.routeLegGeometry.coordinates.length < 2) continue;
          const completed = ['DELIVERED', 'COMPLETED'].includes(
            String(stop.dispatchStatus || stop.status || '').toUpperCase()
          );
          features.push({
            type: 'Feature',
            properties: {
              color: completed ? '#16a34a' : '#2563eb',
              width: completed ? 4 : 3.5,
              opacity: completed ? 0.9 : 0.68
            },
            geometry: stop.routeLegGeometry
          });
        }

        const sequencedByDriver = new Map();
        for (const stop of sequencedStops) {
          if (!stop.assignedDriverId || ['DELIVERED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(
            String(stop.dispatchStatus || stop.status || '').toUpperCase()
          )) continue;
          const group = sequencedByDriver.get(stop.assignedDriverId) || [];
          group.push(stop);
          sequencedByDriver.set(stop.assignedDriverId, group);
        }
        for (const [driverId, routeStops] of sequencedByDriver) {
          const driver = liveDrivers.get(driverId);
          if (!driver) continue;
          routeStops.sort((left, right) =>
            (left.routeOrder ?? left.routeSequence) - (right.routeOrder ?? right.routeSequence)
          );
          const stop = routeStops[0];
          const headingToPickup = ['RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP']
            .includes(stop.dispatchStatus);
          const from = { lat: driver.lat, lng: driver.lng };
          const to = headingToPickup
            && isValidMapLocation(stop.pickupLat, stop.pickupLng)
            ? { lat: stop.pickupLat, lng: stop.pickupLng }
            : { lat: stop.lat, lng: stop.lng };
          if (from.lat === to.lat && from.lng === to.lng) continue;
          const progressKey = `live:${driverId}`;
          const progress = routeProgressRef.current.get(progressKey);
          const sameLeg = progress
            && progress.destination.lat === to.lat
            && progress.destination.lng === to.lng
            && progress.status === stop.dispatchStatus;
          const deviated = Boolean(sameLeg
            && distanceToRouteKm(from, progress.geometry) > ROUTE_DEVIATION_THRESHOLD_KM);
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
              console.error('Could not load a road route for the next rider stop:', error);
              route = {
                mode: 'straight-line',
                geometry: straightLineGeometry(from, to),
                requestedAt: Date.now()
              };
            }
          }
          if (controller.signal.aborted) return;
          routeProgressRef.current.set(progressKey, {
            geometry: route.geometry,
            destination: to,
            status: stop.dispatchStatus,
            route,
            requestedAt: route.requestedAt
          });
          allRoadRoutes = allRoadRoutes && route.mode === 'road';
          features.push({
            type: 'Feature',
            properties: { color: '#f59e0b', width: 5, opacity: 0.92 },
            geometry: route.geometry
          });
          summaries.push({
            stopId: stop.id,
            driverId,
            status: stop.dispatchStatus,
            distanceKm: route.distanceKm,
            durationMinutes: route.durationMinutes,
            mode: route.mode,
            locationUpdatedAt: driver.locationUpdatedAt,
            deviated: shouldRerouteForDeviation
          });
        }

        for (const stop of legacyRoutes) {
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
      <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={!followDriverLocation}
          aria-pressed={followEnabled}
          onClick={() => setFollowEnabled(value => {
            const nextValue = !value;
            if (nextValue) manualMapViewRef.current = false;
            return nextValue;
          })}
          className="rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-[10px] font-bold text-slate-800 shadow disabled:cursor-not-allowed disabled:opacity-70"
          title={followDriverLocation ? 'Toggle automatic rider following' : 'Follow mode is available while fresh rider GPS is being shared'}
        >
          {followDriverLocation && followEnabled ? 'Following rider' : 'Follow rider'}
        </button>
        <span
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-[10px] font-bold text-amber-950 shadow"
          title="No verified live traffic provider is configured for this service area."
        >
          Traffic unavailable
        </span>
      </div>
      {(() => {
        const activeSequence = stops.filter(stop =>
          stop.assignedDriverId
          && Number.isInteger(stop.routeSequence)
          && !['DELIVERED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(
            String(stop.dispatchStatus || stop.status || '').toUpperCase()
          )
        ).sort((left, right) =>
          (left.routeOrder ?? left.routeSequence) - (right.routeOrder ?? right.routeSequence)
        );
        const trackedStop = selectedStop
          || activeSequence[0]
          || stops.find(stop =>
            stop.assignedDriverId && ACTIVE_DELIVERY_STATUSES.includes(stop.dispatchStatus)
          );
        if (!trackedStop) return null;
        const summary = routeSummaries.find(route => route.stopId === trackedStop.id);
        const rider = drivers.find(driver => driver.id === trackedStop.assignedDriverId);
        const locationIsFresh = Boolean(rider?.isTracking && rider.locationUpdatedAt
          && now - new Date(rider.locationUpdatedAt).getTime() < LOCATION_FRESHNESS_MS);
        return (
          <div className="absolute bottom-3 left-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))] rounded-xl bg-white/95 px-3 py-2 text-[10px] font-semibold text-slate-800 shadow">
            <p className="font-extrabold">
              {selectedStop ? `Stop ${selectedStop.routeSequence || ''} · ` : 'Next destination · '}
              {trackedStop.name || 'Active delivery'}
            </p>
            <p className="truncate">{trackedStop.address || 'Delivery address unavailable'}</p>
            <p>Status: {String(trackedStop.dispatchStatus || trackedStop.status || 'Pending').replaceAll('_', ' ')}</p>
            {summary && locationIsFresh ? (
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
                {locationIsFresh ? 'Waiting for next road estimate' : `Last known location: ${rider?.locationUpdatedAt
                  ? new Date(rider.locationUpdatedAt).toLocaleString()
                  : 'unavailable'} · ETA updates when live tracking resumes.`}
              </p>
            )}
            {activeSequence.length > 0 && (
              <p className="mt-1 truncate font-bold">
                Route: Start → {activeSequence.map(stop => `Stop ${stop.routeSequence}`).join(' → ')}
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
