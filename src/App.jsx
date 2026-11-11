import React, { Suspense, lazy, useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { io as createSocketClient } from 'socket.io-client';
import brandLogo from './assets/tobs-circuit-logo-purple.png';
import AdminDashboard from './AdminDashboard.jsx';
import { ADMIN_NAV_ITEMS } from './adminNavigation.js';
import SuperAdminDashboard from './SuperAdminDashboard.jsx';
const CustomerCareDashboard = lazy(() => import('./CustomerCareDashboard.jsx'));
import DeliveryChatPanel from './DeliveryChatPanel.jsx';
import DispatchCallControls from './DispatchCallControls.jsx';
import { applyBusinessRiderLocation } from './dispatch-map-state.js';
import {
  MapPin, CheckCircle2, XCircle, Clock, Package, Search, Plus, Trash2,
  ChevronRight, Check, AlertCircle, Truck, ExternalLink, Radio,
  ChevronLeft, Target, Users, UserPlus, Shield, PenTool,
 Send, ArrowDownUp, Copy, LogOut, User, Phone, ArrowUp, ArrowDown,
 MessageSquare,
 BellRing, Eye, EyeOff, Maximize2, Minimize2
} from 'lucide-react';

const startDepot = { id: 'depot_1', name: 'Ikeja Central Depot', lat: 6.6018, lng: 3.3515 };
let csrfTokenCache = '';
let csrfTokenRequest = null;

function AddressAutocomplete({ value, onChange, onSelect, placeholder, inputClassName, id }) {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2 || !isOpen) return undefined;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          q: query,
          limit: '5',
          lat: '6.5244',
          lon: '3.3792'
        });
        const data = await apiRequest(`/api/geocode/search?${params}`, {
          method: 'GET',
          signal: controller.signal
        });
        setSuggestions(data.features || []);
      } catch (lookupError) {
        if (!controller.signal.aborted) {
          console.error('Address suggestion lookup error:', lookupError);
          setSuggestions([]);
          setError('Address suggestions are unavailable right now.');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [value, isOpen]);

  const getSuggestionLabel = (feature) => {
    const properties = feature.properties;
    const parts = [
      properties.name,
      properties.housenumber,
      properties.street,
      properties.district,
      properties.city,
      properties.county,
      properties.state,
      properties.country
    ].filter(Boolean);
    return parts.filter((part, index) => parts.indexOf(part) === index).join(', ');
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        id={id}
        type="text"
        value={value}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        onChange={(event) => {
          onChange(event.target.value);
          setSuggestions([]);
          setIsLoading(false);
          setError('');
          setIsOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen && suggestions.length > 0}
        className={inputClassName}
      />
      {isOpen && (isLoading || error || suggestions.length > 0 || value.trim().length >= 2) && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
          {isLoading && <p className="px-3 py-2 text-[10px] text-slate-400">Searching addresses...</p>}
          {error && <p className="px-3 py-2 text-[10px] text-rose-300">{error}</p>}
          {suggestions.map((feature, index) => {
            const label = getSuggestionLabel(feature);
            return (
              <button
                key={`${feature.properties.osm_type}-${feature.properties.osm_id}-${index}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const [lng, lat] = feature.geometry.coordinates;
                  onSelect(label, { lat, lng });
                  setIsOpen(false);
                }}
                className="block w-full border-b border-slate-800 px-3 py-2 text-left text-[11px] text-slate-200 last:border-0 hover:bg-slate-800"
              >
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                  <span>{label}</span>
                </span>
              </button>
            );
          })}
          {!isLoading && !error && suggestions.length === 0 && value.trim().length >= 2 && (
            <p className="px-3 py-2 text-[10px] text-slate-400">No matching addresses found.</p>
          )}
          {suggestions.length > 0 && (
            <p className="px-3 py-1 text-[9px] text-slate-500">
              Address data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap contributors</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --- LOCAL STORAGE KEYS ---
const STORAGE_KEYS = { STOPS: 'lagos_circuit_stops' };
const DEMO_STOP_IDS = new Set(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
const BRAND_LOGO_URL = brandLogo;
const ORG_LOGOS_STORAGE_KEY = 'tobs_circuit_org_logos';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.DEV ? API_BASE_URL || window.location.origin : '');
const IS_GITHUB_PAGES_DEMO = (window.location.hostname === 'deeril.github.io'
  || (import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')))
  && !API_BASE_URL;
const PREVIEW_ADMIN = {
  id: 'preview-admin',
  name: 'Demo Dispatcher',
  email: 'dispatcher@example.test',
  role: 'ADMIN',
  orgName: 'Tobs Circuit Preview',
  status: 'ACTIVE'
};
const PREVIEW_DRIVERS = [
  {
    id: 'preview-driver-1',
    name: 'Rider One',
    email: 'rider1@example.test',
    role: 'DRIVER',
    orgName: PREVIEW_ADMIN.orgName,
    ownerAdminId: PREVIEW_ADMIN.id,
    zone: 'Ikeja',
    vehicle: 'Delivery bike',
    status: 'ACTIVE',
    lat: 6.6139,
    lng: 3.3582,
    speed: 0,
    isTracking: false,
    routeStatus: 'IN_PROGRESS',
    isPreviewFixture: true
  },
  {
    id: 'preview-driver-2',
    name: 'Rider Two',
    email: 'rider2@example.test',
    role: 'DRIVER',
    orgName: PREVIEW_ADMIN.orgName,
    ownerAdminId: PREVIEW_ADMIN.id,
    zone: 'Yaba',
    vehicle: 'Delivery bike',
    status: 'ACTIVE',
    lat: 6.5095,
    lng: 3.3711,
    speed: 0,
    isTracking: false,
    routeStatus: 'PENDING',
    isPreviewFixture: true
  }
];

function createPreviewStops() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 4);
  return [
    {
      id: 'preview-delivered-today',
      name: 'Ikeja Preview Delivery',
      address: 'Ikeja, Lagos',
      lat: 6.6139,
      lng: 3.3582,
      status: 'DELIVERED',
      deliveredAt: now.toISOString(),
      assignedDriverId: PREVIEW_DRIVERS[0].id,
      priority: 'NORMAL',
      packages: 1
    },
    {
      id: 'preview-delivered-yesterday',
      name: 'Yaba Preview Delivery',
      address: 'Yaba, Lagos',
      lat: 6.5095,
      lng: 3.3711,
      status: 'DELIVERED',
      deliveredAt: yesterday.toISOString(),
      assignedDriverId: PREVIEW_DRIVERS[1].id,
      priority: 'NORMAL',
      packages: 1
    },
    {
      id: 'preview-delivered-last-week',
      name: 'Maryland Preview Delivery',
      address: 'Maryland, Lagos',
      lat: 6.5683,
      lng: 3.3688,
      status: 'DELIVERED',
      deliveredAt: lastWeek.toISOString(),
      assignedDriverId: PREVIEW_DRIVERS[0].id,
      priority: 'NORMAL',
      packages: 1
    },
    {
      id: 'preview-pending',
      name: 'Pending Preview Delivery',
      pickupAddress: 'Ikeja Central Depot, Lagos',
      pickupLat: 6.6018,
      pickupLng: 3.3515,
      address: 'Victoria Island, Lagos',
      lat: 6.4261,
      lng: 3.4302,
      status: 'PENDING',
      dispatchStatus: 'RIDER_ACCEPTED',
      assignedDriverId: PREVIEW_DRIVERS[0].id,
      priority: 'HIGH',
      packages: 1
    }
  ];
}

function resizeLogoImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose an image file for the logo.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected logo could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('The selected logo could not be opened.'));
      image.onload = () => {
        const maxDimension = 512;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Image processing is unavailable in this browser.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function apiRequest(path, options = {}) {
  let response;
  const method = String(options.method || 'GET').toUpperCase();
  const publicMutation = [
    '/api/auth/login',
    '/api/auth/register-admin',
    '/api/auth/register-driver',
    '/api/auth/password-reset',
    '/api/auth/password-reset/complete'
  ].includes(path);
  try {
    let csrfToken = '';
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !publicMutation) {
      if (!csrfTokenRequest && !csrfTokenCache) {
        csrfTokenRequest = fetch(`${API_BASE_URL}/api/auth/csrf`, {
          credentials: API_BASE_URL ? 'include' : 'same-origin'
        }).then(async tokenResponse => {
          const payload = await tokenResponse.json();
          if (!tokenResponse.ok) throw new Error(payload.error || 'Could not verify this session.');
          csrfTokenCache = payload.csrfToken;
        }).finally(() => {
          csrfTokenRequest = null;
        });
      }
      if (csrfTokenRequest) await csrfTokenRequest;
      csrfToken = csrfTokenCache;
    }
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: API_BASE_URL ? 'include' : 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
      }
    });
    if (path === '/api/auth/login' || path === '/api/auth/register-admin' || path === '/api/auth/register-driver') {
      csrfTokenCache = '';
    }
    if (path === '/api/auth/logout' && response.ok) csrfTokenCache = '';
  } catch (error) {
    throw new Error(`Could not reach the account API. Check the deployment and network connection. ${error.message}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : {};
  if (!response.ok) {
    if (response.status === 502 || response.status === 504) {
      throw new Error('The deployment could not reach the account API. Confirm the latest deployment succeeded and check the service logs.');
    }
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error('The account API returned an unexpected response. Check the deployed API route.');
  }
  return payload;
}

// Haversine Distance Formula (Kilometers)
function calcHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getInviteApplicationUrl(invite) {
  if (invite.applicationUrl) return invite.applicationUrl;
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('invite', invite.token);
  return url.toString();
}

const DEFAULT_MAPLIBRE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MAPLIBRE_STYLE_URL = import.meta.env.VITE_MAPLIBRE_STYLE_URL || DEFAULT_MAPLIBRE_STYLE_URL;
const MapLibreFleetMap = lazy(() => import('./MapLibreFleetMap.jsx'));

function parseMapCoordinates(location) {
  if (location && typeof location === 'object'
    && Number.isFinite(location.lat) && Number.isFinite(location.lng)
    && Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180) {
    return { lat: location.lat, lng: location.lng };
  }
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(location || ''));
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

function openStreetMapSearchUrl(query) {
  const url = new URL('https://www.openstreetmap.org/search');
  url.searchParams.set('query', String(query || ''));
  return url.toString();
}

function openStreetMapDirectionsUrl(locations) {
  const points = locations.map(parseMapCoordinates);
  if (points.length >= 2 && points.every(Boolean)) {
    const url = new URL('https://www.openstreetmap.org/directions');
    url.searchParams.set('engine', 'fossgis_osrm_car');
    url.searchParams.set('route', points.map(point => `${point.lat},${point.lng}`).join(';'));
    return url.toString();
  }
  return openStreetMapSearchUrl(locations.at(-1));
}

function openStreetMapLocationUrl(location, zoom = 10) {
  const point = parseMapCoordinates(location);
  if (!point) return openStreetMapSearchUrl(location);
  return `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=${zoom}/${point.lat}/${point.lng}`;
}

function FleetMap(props) {
  return (
    <Suspense fallback={<div className="absolute inset-0 grid place-items-center bg-slate-100 text-xs font-semibold text-slate-600">Loading interactive map...</div>}>
      <MapLibreFleetMap
        {...props}
        styleUrl={MAPLIBRE_STYLE_URL}
        apiBaseUrl={API_BASE_URL}
      />
    </Suspense>
  );
}

function DeliveryRouteEstimate({ offer }) {
  const [routeState, setRouteState] = useState(null);
  const [errorState, setErrorState] = useState(null);
  const stop = offer.stop;
  const coordinatesValid = [stop.pickupLat, stop.pickupLng, stop.lat, stop.lng].every(Number.isFinite);
  const coordinatesKey = [stop.id, stop.pickupLat, stop.pickupLng, stop.lat, stop.lng].join(':');

  useEffect(() => {
    if (!coordinatesValid) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams({
      fromLat: String(stop.pickupLat),
      fromLng: String(stop.pickupLng),
      toLat: String(stop.lat),
      toLng: String(stop.lng)
    });
    apiRequest(`/api/routing/route?${params}`, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) {
          setRouteState({ key: coordinatesKey, route: result });
          setErrorState(null);
        }
      })
      .catch(lookupError => {
        if (!controller.signal.aborted) {
          console.error('Could not calculate the delivery route estimate:', lookupError);
          setErrorState({ key: coordinatesKey, message: 'Road estimate unavailable.' });
        }
      });
    return () => controller.abort();
  }, [coordinatesKey, coordinatesValid, stop.lat, stop.lng, stop.pickupLat, stop.pickupLng]);

  if (!coordinatesValid) return <p className="text-slate-500">Road estimate unavailable because coordinates are missing.</p>;
  if (errorState?.key === coordinatesKey) return <p className="text-slate-500">{errorState.message}</p>;
  const route = routeState?.key === coordinatesKey ? routeState.route : null;
  if (!route) return <p className="text-slate-500">Calculating delivery route...</p>;
  return (
    <div className="text-slate-500">
      {route.distanceKm.toFixed(1)} km · about {route.durationMinutes} min
      <span className="ml-1 text-[9px]">
        {route.mode === 'road' ? 'road estimate' : 'straight-line fallback'}
      </span>
      {route.warning && <p className="mt-1 text-[9px] text-amber-700">{route.warning}</p>}
    </div>
  );
}

function RoutePlannerApp() {
  // --- AUTH & PERSISTENCE STATES ---
  const invitationParams = new URLSearchParams(window.location.search);
  const invitationToken = invitationParams.get('invite') || '';
  const passwordResetToken = invitationParams.get('reset') || '';
  const [activePasswordResetToken, setActivePasswordResetToken] = useState(passwordResetToken);
  const [currentUser, setCurrentUser] = useState(null);
  const [isPreviewSession, setIsPreviewSession] = useState(false);
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);

  const [stops, setStops] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.STOPS);
    return saved ? JSON.parse(saved).filter(stop => !DEMO_STOP_IDS.has(stop.id)) : [];
  });
  const [routeDataReady, setRouteDataReady] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [showBrandSplash, setShowBrandSplash] = useState(true);
  const [logoUploadError, setLogoUploadError] = useState('');

  useEffect(() => {
    const splashTimeout = window.setTimeout(() => setShowBrandSplash(false), 5000);
    return () => window.clearTimeout(splashTimeout);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.STOPS, JSON.stringify(stops));
  }, [stops]);

  useEffect(() => {
    const syncStoredStops = (event) => {
      if (event.key !== STORAGE_KEYS.STOPS || !event.newValue) return;
      try {
        setStops(JSON.parse(event.newValue).filter(stop => !DEMO_STOP_IDS.has(stop.id)));
      } catch (error) {
        console.error('Could not synchronize route stops from another tab:', error);
      }
    };
    window.addEventListener('storage', syncStoredStops);
    return () => window.removeEventListener('storage', syncStoredStops);
  }, []);

  // Auth Form State
  const [authTab, setAuthTab] = useState(invitationToken ? 'REGISTER' : 'LOGIN'); // 'LOGIN' or 'REGISTER'
  const [authRole, setAuthRole] = useState(invitationToken ? 'DRIVER' : 'ADMIN'); // 'ADMIN' or 'DRIVER'
  const [rememberLogin, setRememberLogin] = useState(true);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showPasswordHelp, setShowPasswordHelp] = useState(Boolean(passwordResetToken));
  const [passwordHelpEmail, setPasswordHelpEmail] = useState('');
  const [passwordHelpMessage, setPasswordHelpMessage] = useState('');
  const [passwordResetCode, setPasswordResetCode] = useState('');
  const [passwordResetCodeSent, setPasswordResetCodeSent] = useState(Boolean(passwordResetToken));
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [passwordResetComplete, setPasswordResetComplete] = useState(false);
  const [orgLogoStore, setOrgLogoStore] = useState(() => {
    const saved = localStorage.getItem(ORG_LOGOS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : { byOrg: {}, byEmail: {} };
  });
  useEffect(() => {
    localStorage.setItem(ORG_LOGOS_STORAGE_KEY, JSON.stringify(orgLogoStore));
  }, [orgLogoStore]);
  const [activeAdminView, setActiveAdminView] = useState('ROUTES');
const [registerForm, setRegisterForm] = useState(() => ({
  name: '',
  email: '',
  password: '',
  orgName: '',
  inviteToken: invitationToken,
  zone: '',
  vehicle: '',
  phone: ''
}));

const [showRegisterPassword, setShowRegisterPassword] = useState(false);
const [showConfirmPassword, setShowConfirmPassword] = useState(false);
const [confirmPassword, setConfirmPassword] = useState('');

const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      try {
        const { user } = await apiRequest('/api/auth/session');
        if (!cancelled) {
          if (user.role === 'ADMIN') setActiveAdminView('ROUTES');
          setCurrentUser(user);
        }
      } catch (error) {
        if (!IS_GITHUB_PAGES_DEMO && error.message !== 'No active session.') {
          console.error('Could not restore the signed-in session:', error);
          if (!cancelled) setAuthError(`Account service unavailable: ${error.message}`);
        }
      } finally {
        if (!cancelled) setCredentialsReady(true);
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUser?.id || isPreviewSession || currentUser.role === 'CUSTOMER_CARE') return undefined;
    let cancelled = false;
    const refreshAccountData = async () => {
      try {
        const [accountData, routeData] = await Promise.all([
          apiRequest('/api/users'),
          apiRequest('/api/stops')
        ]);
        if (!cancelled) {
          setUsers(accountData.users);
          setStops(previous => JSON.stringify(previous) === JSON.stringify(routeData.stops)
            ? previous
            : routeData.stops);
          setRouteDataReady(true);
        }
        if (currentUser.role === 'ADMIN') {
          const { invitations } = await apiRequest('/api/invitations');
          if (!cancelled) setInvites(invitations);
        }
      } catch (error) {
        console.error('Could not refresh account data:', error);
        if (!cancelled) setAuthError(`Account data could not be loaded: ${error.message}`);
      }
    };
    refreshAccountData();
    const refreshInterval = window.setInterval(refreshAccountData, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (!currentUser?.id || !['ADMIN', 'DRIVER'].includes(currentUser.role) || isPreviewSession) {
      setDispatchNotifications([]);
      return undefined;
    }
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const { notifications } = await apiRequest('/api/dispatch/notifications');
        if (active) setDispatchNotifications(notifications);
      } catch (error) {
        console.error('Could not refresh dispatch notifications:', error);
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
  }, [currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (!currentUser?.id || !routeDataReady || isPreviewSession || currentUser.role === 'CUSTOMER_CARE') return undefined;
    const timerId = window.setTimeout(() => {
      apiRequest('/api/stops', {
        method: 'PUT',
        body: JSON.stringify({ stops })
      }).then(({ users: updatedUsers }) => {
        if (Array.isArray(updatedUsers)) setUsers(updatedUsers);
      }).catch(error => {
        console.error('Could not synchronize route stops with the fleet:', error);
        setAuthError(`Route changes could not be saved: ${error.message}`);
      });
    }, 250);
    return () => window.clearTimeout(timerId);
  }, [stops, routeDataReady, currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (!currentUser?.id || !['ADMIN', 'DRIVER'].includes(currentUser.role) || isPreviewSession) {
      setDeliveryOffers([]);
      return undefined;
    }

    let cancelled = false;
    const refreshDeliveryOffers = async () => {
      try {
        const { offers } = await apiRequest('/api/delivery-offers');
        if (cancelled) return;
        setDeliveryOffers(offers);
        if (currentUser.role === 'ADMIN') {
          const acceptedOffers = offers.filter(offer => offer.status === 'ACCEPTED');
          if (acceptedOffers.length > 0) {
            const assignedRiderId = acceptedOffers.find(offer => offer.rider?.id)?.rider.id;
            if (assignedRiderId) setActiveDriverId(assignedRiderId);
            const acceptedOffer = acceptedOffers.find(offer => offer.stop?.id);
            if (acceptedOffer) {
              const acceptedRiderName = acceptedOffer.rider?.name || 'The driver';
              setDeliverySearchFeedback({
                stopId: acceptedOffer.stop.id,
                state: 'accepted',
                message: `${acceptedRiderName} accepted the delivery. Their live approach to pickup is shown on the map while location sharing is active.`
              });
            }
            setStops(previous => {
              const acceptedByStop = new Map(acceptedOffers.map(offer => [offer.stop.id, offer.stop]));
              return previous.map(stop => acceptedByStop.has(stop.id)
                ? { ...stop, ...acceptedByStop.get(stop.id) }
                : stop);
            });
            setUsers(previous => {
              const ridersById = new Map(acceptedOffers
                .filter(offer => offer.rider)
                .map(offer => [offer.rider.id, offer.rider]));
              return previous.map(user => ridersById.has(user.id)
                ? { ...user, ...ridersById.get(user.id) }
                : user);
            });
          }
        }
        setDeliveryOfferError('');
      } catch (error) {
        console.error('Could not refresh delivery offers:', error);
        if (!cancelled) setDeliveryOfferError(`Delivery offers could not be refreshed: ${error.message}`);
      }
    };

    refreshDeliveryOffers();
    const refreshInterval = window.setInterval(refreshDeliveryOffers, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (currentUser?.role !== 'ADMIN' || isPreviewSession) return undefined;
    let cancelled = false;
    apiRequest('/api/dispatch/business-preferences')
      .then(({ allowsCrossBusinessBatch }) => {
        if (!cancelled) setBusinessBatchConsent(allowsCrossBusinessBatch === true);
      })
      .catch(error => {
        console.error('Could not load cross-business batching consent:', error);
        if (!cancelled) setDeliveryOfferError(`Dispatch preferences could not be loaded: ${error.message}`);
      });
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (currentUser?.role !== 'DRIVER') return;
    setDispatchProfileForm({
      maxPackageCount: currentUser.maxPackageCount ?? '',
      maxPackageWeightKg: currentUser.maxPackageWeightKg ?? '',
      maxPackageSize: currentUser.maxPackageSize ?? '',
      acceptsCrossBusinessBatches: currentUser.acceptsCrossBusinessBatches === true
    });
  }, [
    currentUser?.id,
    currentUser?.maxPackageCount,
    currentUser?.maxPackageWeightKg,
    currentUser?.maxPackageSize,
    currentUser?.acceptsCrossBusinessBatches,
    currentUser?.role
  ]);

  useEffect(() => {
    if (currentUser?.role !== 'ADMIN' || isPreviewSession) {
      setDispatchMapRiders([]);
      setDispatchMapError('');
      return undefined;
    }

    let cancelled = false;
    let refreshing = false;
    const refreshMapRiders = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const { riders } = await apiRequest('/api/dispatch/map-riders');
        if (cancelled) return;
        setDispatchMapRiders(Array.isArray(riders) ? riders : []);
        setDispatchMapError('');
      } catch (error) {
        console.error('Could not refresh authorized rider map locations:', error);
        if (!cancelled) setDispatchMapError('Rider locations could not be refreshed. Showing the last known positions.');
      } finally {
        refreshing = false;
      }
    };

    refreshMapRiders();
    const refreshInterval = window.setInterval(refreshMapRiders, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (currentUser?.role !== 'ADMIN' || isPreviewSession || !SOCKET_BASE_URL) return undefined;
    const socket = createSocketClient(SOCKET_BASE_URL, {
      withCredentials: true,
      transports: ['websocket']
    });
    const applyDriverLocation = event => {
      setDispatchMapRiders(previous => applyBusinessRiderLocation(previous, event, currentUser.id));
    };
    socket.on('driver:location', applyDriverLocation);
    socket.on('connect_error', error => {
      console.warn('Live map updates are unavailable; continuing with periodic location refreshes.', error.message);
    });
    return () => {
      socket.off('driver:location', applyDriverLocation);
      socket.disconnect();
    };
  }, [currentUser?.id, currentUser?.role, isPreviewSession]);

  useEffect(() => {
    if (!invitationToken) return undefined;
    let cancelled = false;
    apiRequest(`/api/invitations/${encodeURIComponent(invitationToken)}`)
      .then(({ email, orgName }) => {
        if (cancelled) return;
        setRegisterForm(prev => ({ ...prev, inviteToken: invitationToken, email, orgName }));
        setAuthError('');
        document.title = `Apply to drive with ${orgName} | Tobs Route Circuit`;
      })
      .catch(error => {
        if (!cancelled) setAuthError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [invitationToken]);

  // --- APP DASHBOARD STATES ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showCandidateMap, setShowCandidateMap] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [supportThreads, setSupportThreads] = useState([]);
  const [supportThreadId, setSupportThreadId] = useState('');
  const [supportDraft, setSupportDraft] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [activeDriverId, setActiveDriverId] = useState('');
  const [selectedStopId, setSelectedStopId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState('');

  useEffect(() => {
    if (!profileMenuOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      const clickedInsideButton = profileMenuRef.current?.contains(event.target);
      const clickedInsideMenu = document.querySelector('.profile-menu')?.contains(event.target);

      if (!clickedInsideButton && !clickedInsideMenu) {
        setProfileMenuOpen(false);
      }
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!currentUser || !['ADMIN', 'DRIVER'].includes(currentUser.role)) return undefined;

    let cancelled = false;
    apiRequest('/api/super-admin/customer-care?view=threads')
      .then(({ threads = [] }) => {
        if (cancelled) return;
        setSupportThreads(threads);
      })
      .catch(() => {
        if (!cancelled) setSupportThreads([]);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);
  // GPS State
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [gpsPos, setGpsPos] = useState(null);
  const [gpsSpeed, setGpsSpeed] = useState(0);
  const [gpsStatus, setGpsStatus] = useState('Not sharing');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const lastLocationSyncRef = useRef(0);
  const watchIdRef = useRef(null);
  const gpsPositionRef = useRef(null);
  const locationHeartbeatRef = useRef(null);

  useEffect(() => () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    if (locationHeartbeatRef.current !== null) {
      window.clearInterval(locationHeartbeatRef.current);
    }
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(timerId);
  }, []);

  // Modals
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddStopModal, setShowAddStopModal] = useState(false);
  const [deliveryOfferError, setDeliveryOfferError] = useState('');
  const [creatingDelivery, setCreatingDelivery] = useState(false);
  const [deliveryOffers, setDeliveryOffers] = useState([]);
  const [dispatchMapRiders, setDispatchMapRiders] = useState([]);
  const [dispatchMapError, setDispatchMapError] = useState('');
  const [deliveryEstimate, setDeliveryEstimate] = useState(null);
  const [deliveryEstimateError, setDeliveryEstimateError] = useState('');
  const estimateRequestKeyRef = useRef('');
  const [deliverySearchFeedback, setDeliverySearchFeedback] = useState(null);
  const [respondingOfferId, setRespondingOfferId] = useState('');
  const [dispatchNotifications, setDispatchNotifications] = useState([]);
  const markDispatchNotificationRead = async notification => {
    try {
      await apiRequest(`/api/dispatch/notifications/${encodeURIComponent(notification.notification_id)}/read`, {
        method: 'PATCH',
        body: JSON.stringify({})
      });
      setDispatchNotifications(previous => previous.map(item =>
        item.notification_id === notification.notification_id
          ? { ...item, read_at: new Date().toISOString() }
          : item
      ));
    } catch (error) {
      console.error('Could not mark dispatch notification as read:', error);
      setDeliveryOfferError(`Notification could not be marked read: ${error.message}`);
    }
  };
  const [businessBatchConsent, setBusinessBatchConsent] = useState(false);
  const [dispatchProfileSaving, setDispatchProfileSaving] = useState(false);
  const [dispatchProfileError, setDispatchProfileError] = useState('');
  const [dispatchProfileForm, setDispatchProfileForm] = useState({
    maxPackageCount: currentUser?.maxPackageCount ?? '',
    maxPackageWeightKg: currentUser?.maxPackageWeightKg ?? '',
    maxPackageSize: currentUser?.maxPackageSize ?? '',
    acceptsCrossBusinessBatches: currentUser?.acceptsCrossBusinessBatches === true
  });
  const [podStop, setPodStop] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInviteId, setGeneratedInviteId] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [inviteEmailFailed, setInviteEmailFailed] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [newStopForm, setNewStopForm] = useState({
    name: '',
    receiverPhone: '',
    pickupAddress: '',
    pickupLat: null,
    pickupLng: null,
    address: '',
    lat: null,
    lng: null,
    assignedDriverId: '',
    priority: 'NORMAL',
    timeWindow: '10:00 - 13:00',
    packages: 1,
    packageDescription: '',
    packageWeightKg: '',
    packageSize: '',
    riderEarningsNgn: '',
    deadlineAt: ''
  });
  const estimateCoordinatesKey = [
    newStopForm.pickupLat, newStopForm.pickupLng, newStopForm.lat, newStopForm.lng
  ].join(':');

  useEffect(() => {
    if (!showAddStopModal || currentUser?.role !== 'ADMIN' || isPreviewSession
      || ![newStopForm.pickupLat, newStopForm.pickupLng, newStopForm.lat, newStopForm.lng]
        .every(Number.isFinite)) {
      setDeliveryEstimate(null);
      return undefined;
    }
    const requestKey = estimateCoordinatesKey;
    estimateRequestKeyRef.current = requestKey;
    let cancelled = false;
    const timerId = window.setTimeout(async () => {
      setDeliveryEstimateError('');
      try {
        const quote = await apiRequest('/api/pricing/estimate', {
          method: 'POST',
          body: JSON.stringify({
            from: { lat: newStopForm.pickupLat, lng: newStopForm.pickupLng },
            to: { lat: newStopForm.lat, lng: newStopForm.lng }
          })
        });
        if (cancelled || estimateRequestKeyRef.current !== requestKey) return;
        setDeliveryEstimate({ ...quote, coordinatesKey: requestKey });
      } catch (error) {
        if (cancelled || estimateRequestKeyRef.current !== requestKey) return;
        setDeliveryEstimate(null);
        setDeliveryEstimateError(error.message);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [
    currentUser?.role,
    estimateCoordinatesKey,
    isPreviewSession,
    showAddStopModal,
    newStopForm.lat,
    newStopForm.lng,
    newStopForm.pickupLat,
    newStopForm.pickupLng
  ]);
  const [driverNameQuery, setDriverNameQuery] = useState('');
  const [isDriverSuggestionOpen, setIsDriverSuggestionOpen] = useState(false);
  const [riderDiscoveryZone, setRiderDiscoveryZone] = useState('ALL');
  const [riderDistanceSort, setRiderDistanceSort] = useState('NEAREST');
  const [showStopDistances, setShowStopDistances] = useState(false);
  const [routeOrigins, setRouteOrigins] = useState(() => {
    const saved = localStorage.getItem('lagos_circuit_route_origins');
    return saved ? JSON.parse(saved) : {};
  });
  const [routeOriginCoordinates, setRouteOriginCoordinates] = useState(() => {
    const saved = localStorage.getItem('lagos_circuit_route_origin_coordinates');
    return saved ? JSON.parse(saved) : {};
  });
  const routeOriginLookupRef = useRef(0);
  const routeOriginAddress = currentUser ? routeOrigins[currentUser.id] || '' : '';
  const [customerName, setCustomerName] = useState('');
  const [customerPhoto, setCustomerPhoto] = useState('');
  const [podError, setPodError] = useState('');
  const [podSaving, setPodSaving] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [signatureCaptured, setSignatureCaptured] = useState(false);

  // Signature Pad Canvas
  const canvasRef = useRef(null);
  const [isSigning, setIsSigning] = useState(false);
  const [driverNotes, setDriverNotes] = useState('');
  const photoInputRef = useRef(null);

  // Current Active Driver List
  const driversList = useMemo(() => {
    return users.filter(u => u.role === 'DRIVER');
  }, [users]);
  const generatedInvite = invites.find(invite => invite.id === generatedInviteId) || null;
  const driverSuggestions = useMemo(() => {
    const query = driverNameQuery.trim().toLowerCase();
    return driversList.filter(driver =>
      !query ||
      driver.name.toLowerCase().includes(query) ||
      driver.email.toLowerCase().includes(query) ||
      (driver.zone || '').toLowerCase().includes(query)
    );
  }, [driversList, driverNameQuery]);
  const nearbyAvailableRiders = useMemo(() => {
    const pickup = Number.isFinite(newStopForm.pickupLat) && Number.isFinite(newStopForm.pickupLng)
      ? { lat: newStopForm.pickupLat, lng: newStopForm.pickupLng }
      : routeOriginCoordinates[currentUser?.id];
    if (!pickup) return [];
    const unavailableStatuses = new Set(['DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED']);
    const mapRidersById = new Map(dispatchMapRiders.map(rider => [rider.id, rider]));
    const allDriversById = new Map(driversList.map(driver => [driver.id, driver]));
    for (const mapRider of dispatchMapRiders) {
      if (!allDriversById.has(mapRider.id)) {
        allDriversById.set(mapRider.id, {
          ...mapRider,
          status: 'ACTIVE',
          routeStatus: 'IDLE'
        });
      }
    }
    return [...allDriversById.values()]
      .filter(driver => {
        const mapRider = mapRidersById.get(driver.id);
        const current = mapRider ? { ...driver, ...mapRider } : driver;
        const locationTimestamp = new Date(current.locationUpdatedAt || '').getTime();
        const locationIsFresh = current.isTracking
          && Number.isFinite(locationTimestamp)
          && clockNow - locationTimestamp < 90_000
          && Number.isFinite(current.lat)
          && Number.isFinite(current.lng);
        const hasActiveDelivery = stops.some(stop =>
          stop.assignedDriverId === driver.id
          && !unavailableStatuses.has(String(stop.status || '').toUpperCase())
        );
        const zoneMatches = riderDiscoveryZone === 'ALL'
          || String(current.zone || '').trim().toLowerCase() === riderDiscoveryZone.toLowerCase();
        return (current.status === 'ACTIVE' || current.status === undefined)
          && current.isAvailable === true
          && driver.routeStatus === 'IDLE'
          && locationIsFresh
          && !hasActiveDelivery
          && zoneMatches;
      })
      .map(driver => {
        const current = mapRidersById.has(driver.id)
          ? { ...driver, ...mapRidersById.get(driver.id) }
          : driver;
        const distanceKm = calcHaversineDistance(pickup.lat, pickup.lng, current.lat, current.lng);
        return {
          ...current,
          status: driver.status,
          routeStatus: driver.routeStatus,
          distanceKm,
          etaMinutes: Math.max(1, Math.ceil((distanceKm / 20) * 60))
        };
      })
      .sort((left, right) => riderDistanceSort === 'FARTHEST'
        ? right.distanceKm - left.distanceKm
        : left.distanceKm - right.distanceKm);
  }, [
    clockNow, currentUser?.id, dispatchMapRiders, driversList, newStopForm.pickupLat,
    newStopForm.pickupLng, riderDiscoveryZone, riderDistanceSort, routeOriginCoordinates, stops
  ]);

  // Current Selected Driver Object
  const selectedDriver = useMemo(() => {
    return driversList.find(d => d.id === activeDriverId) || driversList[0] || null;
  }, [driversList, activeDriverId]);
  const currentOrgLogo = currentUser
    ? orgLogoStore.byOrg[(currentUser.orgName || '').trim().toLowerCase()] || BRAND_LOGO_URL
    : BRAND_LOGO_URL;
  const driverRouteStops = stops.filter(stop => stop.assignedDriverId === currentUser?.id);
  const driverRecord = users.find(user => user.id === currentUser?.id);
  const driverRouteStatus = driverRouteStops.length > 0 && (driverRecord?.routeStatus || currentUser?.routeStatus) === 'IDLE'
    ? 'PENDING'
    : driverRecord?.routeStatus || currentUser?.routeStatus || (driverRouteStops.length > 0 ? 'PENDING' : 'IDLE');
  const driverRouteStopCount = Math.max(driverRouteStops.length, driverRecord?.routeStopCount || 0);
  const hasPendingDriverRoute = currentUser?.role === 'DRIVER'
    && driverRouteStatus === 'PENDING'
    && driverRouteStops.length > 0;
  const activeChatStop = currentUser?.role === 'DRIVER'
    ? driverRouteStops.find(stop => stop.assignedDriverId === currentUser.id
      && !['DELIVERED', 'FAILED', 'CANCELLED'].includes(stop.dispatchStatus))
    : stops.find(stop => stop.id === selectedStopId && stop.assignedDriverId
      && !['DELIVERED', 'FAILED', 'CANCELLED'].includes(stop.dispatchStatus))
      || stops.find(stop => stop.assignedDriverId === activeDriverId
        && !['DELIVERED', 'FAILED', 'CANCELLED'].includes(stop.dispatchStatus));

  // Filtered Stops for Active Driver
  const activeDriverStops = useMemo(() => {
    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    let base = stops.filter(s => s.assignedDriverId === targetDriverId);
    if (!searchQuery) return base;
    return base.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.address.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [stops, currentUser, activeDriverId, searchQuery]);
  const mapStop = stops.find(stop => stop.id === selectedStopId)
    || activeDriverStops.find(stop => stop.id === selectedStopId)
    || activeDriverStops.find(stop => stop.status !== 'DELIVERED')
    || activeDriverStops[0]
    || null;
  const selectedMapRider = dispatchMapRiders.find(driver => driver.id === activeDriverId);
  const mapDriver = currentUser?.role === 'ADMIN'
    ? selectedMapRider ? { ...selectedDriver, ...selectedMapRider } : selectedDriver
    : currentUser;
  const mapDriverIsLive = Boolean(
    mapDriver?.isTracking &&
    mapDriver.locationUpdatedAt &&
    clockNow - new Date(mapDriver.locationUpdatedAt).getTime() < 90_000
  );
  const mapStopHasCoordinates = Number.isFinite(mapStop?.lat) && Number.isFinite(mapStop?.lng);
  const mapDriverHasCoordinates = Number.isFinite(mapDriver?.lat) && Number.isFinite(mapDriver?.lng);
  const mapRouteDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
  const mapRouteStops = stops.filter(stop => stop.assignedDriverId === mapRouteDriverId);
  const mapCenterStops = selectedStopId && mapStopHasCoordinates
    ? [mapStop]
    : mapRouteStops.filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
  const mapCenter = mapCenterStops.length > 0
    ? (showAddStopModal || showCandidateMap)
      && Number.isFinite(newStopForm.pickupLat) && Number.isFinite(newStopForm.pickupLng)
      ? { lat: newStopForm.pickupLat, lng: newStopForm.pickupLng }
      : {
      lat: mapCenterStops.reduce((total, stop) => total + stop.lat, 0) / mapCenterStops.length,
      lng: mapCenterStops.reduce((total, stop) => total + stop.lng, 0) / mapCenterStops.length
    }
    : (showAddStopModal || showCandidateMap)
      && Number.isFinite(newStopForm.pickupLat) && Number.isFinite(newStopForm.pickupLng)
      ? { lat: newStopForm.pickupLat, lng: newStopForm.pickupLng }
      : mapDriverIsLive && mapDriverHasCoordinates
      ? { lat: mapDriver.lat, lng: mapDriver.lng }
      : selectedMapRider && Number.isFinite(selectedMapRider.lat) && Number.isFinite(selectedMapRider.lng)
        ? { lat: selectedMapRider.lat, lng: selectedMapRider.lng }
      : { lat: startDepot.lat, lng: startDepot.lng };
  const openStreetMapUrl = mapStop && !mapStopHasCoordinates
    ? openStreetMapSearchUrl(mapStop.address)
    : openStreetMapLocationUrl(mapCenter);
  const liveMapDrivers = useMemo(() => (
    currentUser?.role === 'ADMIN'
      ? driversList
      : currentUser?.role === 'DRIVER' && currentUser
        ? [currentUser]
        : []
  ), [currentUser, driversList]);
  const mapDisplayDrivers = useMemo(() => {
    const driversById = new Map(liveMapDrivers.map(driver => [driver.id, driver]));
    for (const rider of dispatchMapRiders) {
      driversById.set(rider.id, { ...driversById.get(rider.id), ...rider });
    }
    if (showAddStopModal || showCandidateMap) {
      nearbyAvailableRiders.forEach((rider, index) => {
        const current = driversById.get(rider.id);
        if (current) {
          driversById.set(rider.id, {
            ...current,
            discoveryRank: index + 1,
            pickupDistanceKm: rider.distanceKm
          });
        }
      });
    }
    return [...driversById.values()];
  }, [dispatchMapRiders, liveMapDrivers, nearbyAvailableRiders, showAddStopModal, showCandidateMap]);
  const mapVisibleStops = useMemo(() => {
    if (!showAddStopModal && !showCandidateMap) return stops;
    return [
      ...stops,
      {
        id: 'delivery-draft-preview',
        name: newStopForm.name || 'New delivery',
        pickupAddress: newStopForm.pickupAddress,
        pickupLat: newStopForm.pickupLat,
        pickupLng: newStopForm.pickupLng,
        address: newStopForm.address,
        lat: newStopForm.lat,
        lng: newStopForm.lng,
        status: 'DRAFT'
      }
    ];
  }, [
    newStopForm.address, newStopForm.lat, newStopForm.lng, newStopForm.name,
    newStopForm.pickupAddress, newStopForm.pickupLat, newStopForm.pickupLng,
    showAddStopModal, showCandidateMap, stops
  ]);
  const dashboardMappedStops = stops.filter(stop =>
    Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
  );
  const dashboardMappedDrivers = mapDisplayDrivers.filter(driver =>
    Number.isFinite(driver.lat)
    && Number.isFinite(driver.lng)
    && (driver.isPreviewFixture === true
      || (driver.locationUpdatedAt
        && ((driver.isTracking && clockNow - new Date(driver.locationUpdatedAt).getTime() < 90_000)
          || driver.assigned === true)))
    );
  const focusedLiveDriver = dashboardMappedDrivers.find(driver => driver.id === activeDriverId);
  const freshMapDrivers = dashboardMappedDrivers.filter(driver =>
    driver.isTracking && clockNow - new Date(driver.locationUpdatedAt).getTime() < 90_000
  );
  const mapCenterDrivers = freshMapDrivers.length ? freshMapDrivers : dashboardMappedDrivers;
  const dashboardMapCenter = focusedLiveDriver
    ? { lat: focusedLiveDriver.lat, lng: focusedLiveDriver.lng }
    : mapCenterDrivers.length
      ? {
        lat: mapCenterDrivers.reduce((total, driver) => total + driver.lat, 0) / mapCenterDrivers.length,
        lng: mapCenterDrivers.reduce((total, driver) => total + driver.lng, 0) / mapCenterDrivers.length
      }
      : dashboardMappedStops.length
        ? {
          lat: dashboardMappedStops.reduce((total, stop) => total + stop.lat, 0) / dashboardMappedStops.length,
          lng: dashboardMappedStops.reduce((total, stop) => total + stop.lng, 0) / dashboardMappedStops.length
        }
        : mapCenter;
  const saveOrganizationLogo = (orgName, email, logoData) => {
    const orgKey = orgName.trim().toLowerCase();
    const emailKey = email.trim().toLowerCase();
    if (!orgKey || !emailKey) return;
    setOrgLogoStore(previous => ({
      byOrg: { ...previous.byOrg, [orgKey]: logoData },
      byEmail: { ...previous.byEmail, [emailKey]: logoData }
    }));
  };

  const startPreviewSession = (role) => {
    const previewUsers = [PREVIEW_ADMIN, ...PREVIEW_DRIVERS];
    setIsPreviewSession(true);
    setAuthError('');
    setUsers(previewUsers);
    setStops(createPreviewStops());
    setRouteDataReady(true);
    setActiveDriverId(PREVIEW_DRIVERS[0].id);
    setActiveAdminView('ROUTES');
    setShowPasswordHelp(false);
    setCurrentUser(role === 'ADMIN' ? PREVIEW_ADMIN : PREVIEW_DRIVERS[0]);
  };

  const handleOrganizationLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || currentUser?.role !== 'ADMIN') return;
    setLogoUploadError('');
    try {
      const logo = await resizeLogoImage(file);
      saveOrganizationLogo(currentUser.orgName, currentUser.email, logo);
    } catch (error) {
      setLogoUploadError(error.message);
    }
  };

  // --- AUTHENTICATION LOGIC ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (IS_GITHUB_PAGES_DEMO) {
      setAuthError('Account sign-in is unavailable in this static preview. Use one of the sample dashboard buttons below.');
      return;
    }
    if (!credentialsReady) {
      setAuthError('Account security is still initializing. Please try again in a moment.');
      return;
    }

    try {
      const { user } = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...loginForm, remember: rememberLogin })
      });
      if (user.role === 'ADMIN') setActiveAdminView('ROUTES');
      setCurrentUser(user);
      setAuthError('');
      setLoginForm({ email: '', password: '' });
      if (user.role === 'DRIVER') setActiveDriverId(user.id);
    } catch (error) {
      setAuthError(error.message);
    }
  };

 const handleRegister = async (e) => {
  e.preventDefault();
  setAuthError('');

  if (registerForm.password !== confirmPassword) {
    setAuthError('Passwords do not match. Please check and try again.');
    return;
  }

  if (!credentialsReady) {
    setAuthError('Connecting to the account service. Please try again in a moment.');
    return;
  }

    try {
      const endpoint = authRole === 'ADMIN'
        ? '/api/auth/register-admin'
        : '/api/auth/register-driver';
      const registration = authRole === 'ADMIN'
        ? {
          name: registerForm.name,
          email: registerForm.email,
          password: registerForm.password,
          orgName: registerForm.orgName
        }
        : {
          name: registerForm.name,
          email: registerForm.email,
          password: registerForm.password,
          inviteToken: registerForm.inviteToken,
          zone: registerForm.zone,
          vehicle: registerForm.vehicle,
          phone: registerForm.phone
        };
      const { user } = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(registration)
      });
      if (user.role === 'ADMIN') setActiveAdminView('ROUTES');
      setCurrentUser(user);
      setRegisterForm(prev => ({ ...prev, password: '' }));
      setAuthError('');
      if (user.role === 'DRIVER') setActiveDriverId(user.id);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const showPasswordRecoveryHelp = async (event) => {
    event.preventDefault();
    setPasswordHelpMessage('');
    if (IS_GITHUB_PAGES_DEMO || isPreviewSession) {
      setPasswordHelpMessage('Password recovery needs the live account service. Deploy and connect the API to enable recovery-code emails.');
      return;
    }
    try {
      const { message } = await apiRequest('/api/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: passwordHelpEmail })
      });
      setPasswordResetCodeSent(true);
      setPasswordHelpMessage(message);
    } catch (error) {
      setPasswordHelpMessage(error.message);
    }
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    setPasswordHelpMessage('');
    if (resetPassword.length < 12) {
      setPasswordHelpMessage('Choose a password with at least 12 characters.');
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setPasswordHelpMessage('The passwords do not match.');
      return;
    }
    try {
      await apiRequest('/api/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({
          token: activePasswordResetToken,
          code: activePasswordResetToken ? '' : passwordResetCode,
          password: resetPassword
        })
      });
      setPasswordResetComplete(true);
      setPasswordResetCode('');
      setResetPassword('');
      setResetPasswordConfirm('');
      setPasswordHelpMessage('Your password has been changed. You can now sign in.');
    } catch (error) {
      setPasswordHelpMessage(error.message);
    }
  };

  const handleLogout = async () => {
    if (isGpsActive) await toggleGpsBroadcast();
    if (!isPreviewSession) {
      try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      } catch (error) {
        console.error('Could not end the server session:', error);
      }
    }
    setCurrentUser(null);
    setUsers([]);
    setInvites([]);
    setSupportThreads([]);
    setSupportThreadId('');
    setRouteDataReady(false);
    setIsPreviewSession(false);
    setAuthTab('LOGIN');
    setAuthRole('ADMIN');
  };

  const sendSupportMessage = async (event) => {
    event.preventDefault();
    if (!currentUser || !['ADMIN', 'DRIVER'].includes(currentUser.role)) return;
    const trimmed = supportDraft.trim();
    if (!trimmed) {
      setSupportError('Type a question or issue before sending.');
      return;
    }

    setSupportBusy(true);
    setSupportError('');
    try {
      const { thread, reply } = await apiRequest('/api/super-admin/customer-care', {
        method: 'POST',
        body: JSON.stringify({
          action: 'chat',
          threadId: supportThreadId || activeSupportThread?.id || undefined,
          message: trimmed
        })
      });

      setSupportThreadId(thread.id);
      setSupportThreads(prev => {
        const next = prev.filter(item => item.id !== thread.id);
        return [thread, ...next];
      });
      setSupportDraft('');
      if (reply?.text) {
        setSupportError('');
      }
    } catch (error) {
      setSupportError(error.message);
    } finally {
      setSupportBusy(false);
    }
  };

  const activeSupportThread = supportThreads.find(thread => thread.id === supportThreadId) || supportThreads[0] || null;
  const unreadDispatchNotificationCount = dispatchNotifications.filter(notification => !notification.read_at).length;

  const profileMenu = currentUser && (
    <div className="relative flex items-center space-x-2" ref={profileMenuRef}>
      <button
        type="button"
        onClick={() => setProfileMenuOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={profileMenuOpen}
        aria-label={hasPendingDriverRoute || unreadDispatchNotificationCount
          ? `Open menu, ${unreadDispatchNotificationCount} unread dispatch notifications`
          : 'Open menu'}
        title={unreadDispatchNotificationCount
          ? `${unreadDispatchNotificationCount} unread dispatch notifications`
          : hasPendingDriverRoute ? 'New route awaiting acceptance' : 'Menu'}
        className="profile-menu-trigger relative ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-900 shadow-sm transition-colors hover:bg-violet-50"
      >
        <span className="profile-menu-initials" aria-hidden="true">
          {String(currentUser.name || 'Admin').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}
        </span>
        {(hasPendingDriverRoute || unreadDispatchNotificationCount > 0) && (
          <span className="profile-menu-notification-dot" aria-hidden="true" />
        )}
      </button>
     {profileMenuOpen && createPortal(
        <div
className="profile-menu fixed right-2 top-16 z-[99999] flex max-h-[calc(100dvh-5rem)] w-56 flex-col overflow-y-auto overscroll-contain touch-pan-y rounded-2xl border border-violet-200 bg-white p-2 shadow-xl sm:right-4 sm:top-20 sm:max-h-[calc(100dvh-6rem)]"
          aria-label="Profile menu"
        >
          <div className="border-b border-violet-100 px-3 py-2">
            <p className="truncate text-xs font-extrabold text-violet-950">{currentUser.name}</p>
            <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
              {currentUser.role === 'ADMIN' ? 'Administrator' : 'Driver'}
            </p>
          </div>
          {hasPendingDriverRoute && (
            <div className="profile-menu-route-notice" role="status">
              <span className="flex items-start gap-2">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block font-extrabold">New route assigned</span>
                  <span className="mt-0.5 block text-[10px]">
                    {driverRouteStopCount} stop{driverRouteStopCount === 1 ? '' : 's'} need your acceptance.
                  </span>
                </span>
              </span>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDriverRouteStatus(currentUser.id, 'ACCEPTED', driverRouteStopCount);
                  setProfileMenuOpen(false);
                }}
                className="profile-menu-accept-route"
              >
                Accept route
              </button>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setSupportChatOpen(true);
              setProfileMenuOpen(false);
            }}
            className="profile-menu-item"
          >
            <MessageSquare className="h-4 w-4" />
            <span>Customer Care chat</span>
          </button>
          {dispatchNotifications.length > 0 && (
            <section aria-label="Dispatch notifications" className="border-b border-violet-100 py-2">
              <p className="px-3 pb-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-500">
                Dispatch notifications
              </p>
              {dispatchNotifications.slice(0, 5).map(notification => (
                <button
                  key={notification.notification_id}
                  type="button"
                  onClick={() => markDispatchNotificationRead(notification)}
                  className={`block w-full px-3 py-2 text-left ${notification.read_at ? 'opacity-60' : 'bg-violet-50'}`}
                >
                  <span className="block text-[10px] font-bold text-slate-800">
                    {String(notification.notification_type).replaceAll('_', ' ').toLowerCase()}
                  </span>
                  <span className="block text-[8px] text-slate-500">
                    {new Date(notification.created_at).toLocaleString()}
                    {!notification.read_at ? ' · tap to mark read' : ''}
                  </span>
                </button>
              ))}
            </section>
          )}
          {currentUser.role === 'ADMIN' && (
            <>
              <label className="profile-menu-logo block cursor-pointer border-b border-violet-100 px-3 py-3 text-[10px] font-bold text-violet-950">
                <span className="block">Fleet logo</span>
                <span className="mt-1 block text-[9px] font-medium text-slate-500">Saved in this browser</span>
                <img
                  src={currentOrgLogo}
                  alt="Current fleet logo"
                  className="mt-2 h-10 w-16 rounded-lg border border-violet-100 bg-white object-contain p-1"
                />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleOrganizationLogoChange}
                  className="mt-2 block w-full text-[9px] text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-violet-700 file:px-2 file:py-1.5 file:font-bold file:text-white"
                />
                {logoUploadError && <span role="alert" className="mt-1 block text-[9px] text-rose-700">{logoUploadError}</span>}
              </label>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActiveAdminView('ROUTES');
                  setProfileMenuOpen(false);
                }}
                className="profile-menu-item"
              >
                <Truck className="h-4 w-4" />
                <span>Route planner</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActiveAdminView('ANALYTICS');
                  setProfileMenuOpen(false);
                }}
                className="profile-menu-item"
              >
                <Users className="h-4 w-4" />
                <span>Fleet analytics</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowInviteModal(true);
                  setProfileMenuOpen(false);
                }}
                className="profile-menu-item"
              >
                <UserPlus className="h-4 w-4" />
                <span>Invite drivers</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActiveAdminView('SETTINGS');
                  setProfileMenuOpen(false);
                }}
                className="profile-menu-item"
              >
                <User className="h-4 w-4" />
                <span>Profile settings</span>
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="profile-menu-item profile-menu-logout"
 >
            <LogOut className="h-4 w-4" />
            <span>Log out</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
  async function setDriverRouteStatus(driverId, routeStatus, routeStopCount) {
    if (isPreviewSession) {
      const updatedUser = users.find(user => user.id === driverId);
      if (!updatedUser) return;
      const update = { routeStatus, routeStopCount, routeUpdatedAt: new Date(clockNow).toISOString() };
      setUsers(prev => prev.map(item => item.id === driverId ? { ...item, ...update } : item));
      if (currentUser?.id === driverId) setCurrentUser(prev => prev ? { ...prev, ...update } : prev);
      return;
    }

    try {
      const { user, stops: updatedStops } = await apiRequest(`/api/users/${encodeURIComponent(driverId)}/route-status`, {
        method: 'PATCH',
        body: JSON.stringify({ routeStatus, routeStopCount })
      });
      setUsers(prev => prev.map(item => item.id === user.id ? user : item));
      if (currentUser?.id === user.id) setCurrentUser(user);
      if (Array.isArray(updatedStops)) {
        setStops(prev => prev.map(stop =>
          updatedStops.some(updatedStop => updatedStop.id === stop.id)
            ? updatedStops.find(updatedStop => updatedStop.id === stop.id)
            : stop
        ));
      }
    } catch (error) {
      console.error('Could not update the driver route status:', error);
      window.alert(`Route status could not be updated: ${error.message}`);
    }
  }

  const toggleRiderAvailability = async () => {
    if (currentUser?.role !== 'DRIVER') return;
    const isAvailable = !currentUser.isAvailable;
    if (isPreviewSession) {
      const update = { isAvailable, availabilityUpdatedAt: new Date(clockNow).toISOString() };
      setCurrentUser(previous => previous ? { ...previous, ...update } : previous);
      setUsers(previous => previous.map(user => user.id === currentUser.id ? { ...user, ...update } : user));
      return;
    }

    try {
      const { user } = await apiRequest('/api/users/me/availability', {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable })
      });
      setCurrentUser(user);
      setUsers(previous => previous.map(item => item.id === user.id ? user : item));
    } catch (error) {
      console.error('Could not update rider availability:', error);
      window.alert(`Rider availability could not be updated: ${error.message}`);
    }
  };

  const saveDispatchProfile = async () => {
    setDispatchProfileSaving(true);
    setDispatchProfileError('');
    try {
      const { user } = await apiRequest('/api/users/me/dispatch-profile', {
        method: 'PATCH',
        body: JSON.stringify({
          maxPackageCount: dispatchProfileForm.maxPackageCount === ''
            ? null
            : Number(dispatchProfileForm.maxPackageCount),
          maxPackageWeightKg: dispatchProfileForm.maxPackageWeightKg === ''
            ? null
            : Number(dispatchProfileForm.maxPackageWeightKg),
          maxPackageSize: dispatchProfileForm.maxPackageSize || null,
          acceptsCrossBusinessBatches: dispatchProfileForm.acceptsCrossBusinessBatches
        })
      });
      setCurrentUser(user);
      setUsers(previous => previous.map(item => item.id === user.id ? user : item));
    } catch (error) {
      console.error('Could not save rider dispatch profile:', error);
      setDispatchProfileError(error.message);
    } finally {
      setDispatchProfileSaving(false);
    }
  };

  const updateBusinessBatchConsent = async enabled => {
    setBusinessBatchConsent(enabled);
    try {
      const result = await apiRequest('/api/dispatch/business-preferences', {
        method: 'PATCH',
        body: JSON.stringify({ allowsCrossBusinessBatch: enabled })
      });
      setBusinessBatchConsent(result.allowsCrossBusinessBatch === true);
    } catch (error) {
      console.error('Could not update cross-business batching consent:', error);
      setBusinessBatchConsent(!enabled);
      setDeliveryOfferError(`Cross-business batching preference was not saved: ${error.message}`);
    }
  };

  const removeDriverAccount = async (driver) => {
    const assignedStops = stops.filter(stop => stop.assignedDriverId === driver.id);
    const confirmed = window.confirm(
      `Remove ${driver.name}'s driver account? ${assignedStops.length} assigned stop${assignedStops.length === 1 ? ' will' : 's will'} be kept but unassigned.`
    );
    if (!confirmed) return;

    try {
      if (!isPreviewSession) {
        await apiRequest(`/api/users/${encodeURIComponent(driver.id)}`, { method: 'DELETE' });
      }
      const remainingDrivers = driversList.filter(item => item.id !== driver.id);
      setUsers(prev => prev.filter(user => user.id !== driver.id));
      setStops(prev => prev.map(stop =>
        stop.assignedDriverId === driver.id ? { ...stop, assignedDriverId: '' } : stop
      ));
      setActiveDriverId(prev => prev === driver.id ? remainingDrivers[0]?.id || '' : prev);
      if (assignedStops.some(stop => stop.id === selectedStopId)) setSelectedStopId(null);
    } catch (error) {
      console.error('Could not remove the driver account:', error);
      window.alert(`Driver account could not be removed: ${error.message}`);
    }
  };

  const deleteStop = (stop) => {
    if (!window.confirm(`Delete "${stop.name}" from the route? This cannot be undone.`)) return;
    setStops(prev => prev.filter(item => item.id !== stop.id));
    if (selectedStopId === stop.id) setSelectedStopId(null);
    if (podStop?.id === stop.id) setPodStop(null);
  };

  const focusStopOnMap = (stop) => {
    setSelectedStopId(stop.id);
    setMapExpanded(true);
  };

  const openAddStopModal = () => {
    setShowCandidateMap(false);
    const assignedDriverId = currentUser.role === 'DRIVER' ? currentUser.id : '';
    const assignedDriver = driversList.find(driver => driver.id === assignedDriverId);
    const pickupAddress = routeOriginAddress.trim();
    const pickupCoordinates = routeOriginCoordinates[currentUser.id]
      || (() => {
        const match = pickupAddress.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
        return match ? { lat: Number(match[1]), lng: Number(match[2]) } : { lat: null, lng: null };
      })();
    setDeliveryOfferError('');
    setNewStopForm(prev => ({
      ...prev,
      assignedDriverId,
      pickupAddress,
      pickupLat: pickupCoordinates.lat,
      pickupLng: pickupCoordinates.lng
    }));
    setDriverNameQuery(assignedDriver?.name || '');
    setIsDriverSuggestionOpen(false);
    setShowAddStopModal(true);
  };

  const requestRidersForStop = async (stop, riderId = '') => {
    if (isPreviewSession || IS_GITHUB_PAGES_DEMO) {
      window.alert('Sending rider offers requires the connected dispatch service.');
      return;
    }
    setDeliverySearchFeedback({ stopId: stop.id, state: 'searching', message: `Searching for available drivers near ${stop.pickupAddress || 'the pickup'}…` });
    try {
      const { riderCount } = await apiRequest(`/api/stops/${encodeURIComponent(stop.id)}/offers`, {
        method: 'POST',
        body: JSON.stringify(riderId ? { riderId } : {})
      });
      setDeliverySearchFeedback({
        stopId: stop.id,
        state: riderCount > 0 ? 'offered' : 'empty',
        message: riderCount > 0
          ? `Offer sent to ${riderCount} ${riderId ? 'selected' : 'nearby'} driver${riderCount === 1 ? '' : 's'}. The driver appears on the live map after accepting.`
          : 'No eligible drivers were found within the current search radius. Check availability and live location, then search again.'
      });
    } catch (error) {
      console.error('Could not send rider offers:', error);
      setDeliverySearchFeedback({ stopId: stop.id, state: 'error', message: `Driver search failed: ${error.message}` });
    }
  };

  const createDeliveryStop = async findRider => {
    const address = newStopForm.address.trim();
    const pickupAddress = newStopForm.pickupAddress.trim();
    if (!address || !pickupAddress) {
      setDeliveryOfferError('Enter both pickup and delivery addresses.');
      return;
    }
    if (findRider && (
      !Number.isFinite(newStopForm.pickupLat) || !Number.isFinite(newStopForm.pickupLng)
      || !Number.isFinite(newStopForm.lat) || !Number.isFinite(newStopForm.lng)
    )) {
      setDeliveryOfferError('Select both pickup and delivery addresses from the map suggestions to send accurate rider offers.');
      return;
    }
    if (findRider && (!deliveryEstimate?.quoteToken
      || deliveryEstimate.coordinatesKey !== estimateCoordinatesKey)) {
      setDeliveryOfferError(deliveryEstimateError
        || 'Wait for a current delivery price estimate before confirming this delivery.');
      return;
    }
    const riderEarningsNgn = newStopForm.riderEarningsNgn === ''
      ? null
      : Number(newStopForm.riderEarningsNgn);
    const packageWeightKg = newStopForm.packageWeightKg === ''
      ? null
      : Number(newStopForm.packageWeightKg);
    if ((riderEarningsNgn !== null && (!Number.isFinite(riderEarningsNgn) || riderEarningsNgn < 0 || riderEarningsNgn > 1_000_000))
      || (packageWeightKg !== null && (!Number.isFinite(packageWeightKg) || packageWeightKg <= 0 || packageWeightKg > 500))) {
      setDeliveryOfferError('Enter a valid rider earning (up to NGN 1,000,000) and package weight (up to 500 kg).');
      return;
    }
    const deadlineTimestamp = newStopForm.deadlineAt
      ? new Date(newStopForm.deadlineAt).getTime()
      : null;
    if (deadlineTimestamp !== null
      && (!Number.isFinite(deadlineTimestamp) || deadlineTimestamp <= Date.now())) {
      setDeliveryOfferError('Choose a delivery deadline in the future.');
      return;
    }
    const deliveryDeadlineAt = deadlineTimestamp === null
      ? null
      : new Date(deadlineTimestamp).toISOString();

    const stopPayload = {
      id: `l_${crypto.randomUUID()}`,
      name: newStopForm.name.trim() || address,
      receiverPhone: newStopForm.receiverPhone.trim(),
      pickupAddress,
      pickupLat: newStopForm.pickupLat,
      pickupLng: newStopForm.pickupLng,
      address,
      lat: newStopForm.lat,
      lng: newStopForm.lng,
      priority: newStopForm.priority,
      timeWindow: newStopForm.timeWindow,
      packages: Math.max(1, Math.floor(Number(newStopForm.packages) || 1)),
      packageDescription: newStopForm.packageDescription.trim(),
      packageWeightKg,
      packageSize: newStopForm.packageSize,
      riderEarningsNgn,
      deliveryDeadlineAt,
      status: 'PENDING',
      assignedDriverId: findRider ? '' : newStopForm.assignedDriverId,
      ...(findRider ? {
        pricingQuoteToken: deliveryEstimate.quoteToken,
        estimatedPriceNgn: deliveryEstimate.estimate.amount,
        pricingCurrency: deliveryEstimate.estimate.currency,
        pricingRuleVersion: deliveryEstimate.estimate.ruleVersion,
        routeDistanceKm: deliveryEstimate.route.distanceKm,
        routeDurationMinutes: deliveryEstimate.route.durationMinutes
      } : {})
    };
    if (!findRider && !stopPayload.assignedDriverId) {
      setDeliveryOfferError('Choose an existing route assignment or select “Save & Find Riders”.');
      return;
    }

    setCreatingDelivery(true);
    setDeliveryOfferError('');
    setDeliverySearchFeedback(findRider
      ? { stopId: stopPayload.id, state: 'searching', message: 'Saving pickup and destination, then searching nearby drivers…' }
      : null);
    let savedStops;
    let savedUsers;
    try {
      if (isPreviewSession) {
        setStops(previous => [...previous, stopPayload]);
        setShowAddStopModal(false);
        return;
      }

      const saved = await apiRequest('/api/stops', {
        method: 'PUT',
        body: JSON.stringify({ stops: [...stops, stopPayload] })
      });
      savedStops = saved.stops;
      savedUsers = saved.users;
      setStops(savedStops);
      if (Array.isArray(savedUsers)) setUsers(savedUsers);
      if (findRider) {
        const { riderCount } = await apiRequest(`/api/stops/${encodeURIComponent(stopPayload.id)}/offers`, {
          method: 'POST',
          body: JSON.stringify({
            ...(newStopForm.assignedDriverId ? { riderId: newStopForm.assignedDriverId } : {})
          })
        });
        setDeliverySearchFeedback({
          stopId: stopPayload.id,
          state: riderCount > 0 ? 'offered' : 'empty',
          message: riderCount > 0
            ? `Searching live: offer sent to ${riderCount} eligible driver${riderCount === 1 ? '' : 's'}. When one accepts, their live approach will appear on the map.`
            : 'Delivery saved. No eligible drivers were found within the current search radius; you can retry from Unassigned Stops.'
        });
      }
      setNewStopForm({
        name: '',
        receiverPhone: '',
        pickupAddress,
        pickupLat: newStopForm.pickupLat,
        pickupLng: newStopForm.pickupLng,
        address: '',
        lat: null,
        lng: null,
        assignedDriverId: activeDriverId,
        priority: 'NORMAL',
        timeWindow: '10:00 - 13:00',
        packages: 1,
        packageDescription: '',
        packageWeightKg: '',
        packageSize: '',
        riderEarningsNgn: '',
        deadlineAt: ''
      });
      setDeliveryEstimate(null);
      setDeliveryEstimateError('');
      setDriverNameQuery(driversList.find(driver => driver.id === activeDriverId)?.name || '');
      setShowAddStopModal(false);
    } catch (error) {
      console.error(savedStops ? 'Delivery saved, but rider offers could not be sent:' : 'Could not create the delivery:', error);
      if (savedStops) {
        setDeliverySearchFeedback({
          stopId: stopPayload.id,
          state: 'error',
          message: `Delivery saved, but live driver search failed: ${error.message}. Retry from Unassigned Stops.`
        });
        setStops(savedStops);
        if (Array.isArray(savedUsers)) setUsers(savedUsers);
        setNewStopForm(previous => ({
          ...previous,
          name: '',
          receiverPhone: '',
          address: '',
          lat: null,
          lng: null,
          assignedDriverId: activeDriverId,
          packageDescription: '',
          packageWeightKg: '',
          packageSize: '',
          riderEarningsNgn: '',
          deadlineAt: ''
        }));
        setShowAddStopModal(false);
      } else {
        setDeliveryOfferError(error.message);
      }
    } finally {
      setCreatingDelivery(false);
    }
  };

  const respondToDeliveryOffer = async (offer, action) => {
    setRespondingOfferId(offer.id);
    setDeliveryOfferError('');
    try {
      const result = await apiRequest(`/api/delivery-offers/${encodeURIComponent(offer.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      setDeliveryOffers(previous => previous.filter(item => item.id !== offer.id));
      if (action === 'accept') {
        const acceptedStops = Array.isArray(result.stops) && result.stops.length
          ? result.stops
          : [result.stop];
        setStops(previous => {
          const byId = new Map(acceptedStops.map(stop => [stop.id, stop]));
          const existingIds = new Set(previous.map(stop => stop.id));
          return [
            ...previous.map(stop => byId.has(stop.id) ? { ...stop, ...byId.get(stop.id) } : stop),
            ...acceptedStops.filter(stop => !existingIds.has(stop.id))
          ];
        });
        setUsers(previous => previous.map(user =>
          user.id === result.rider.id ? { ...user, ...result.rider } : user
        ));
        setCurrentUser(result.rider);
        setActiveDriverId(result.rider.id);
        setDeliverySearchFeedback({
          stopId: acceptedStops[0].id,
          state: 'accepted',
          message: `${result.rider.name} accepted the delivery. Their live approach to pickup is now shown on the map while location sharing is active.`
        });
      }
    } catch (error) {
      console.error(`Could not ${action} delivery offer:`, error);
      setDeliveryOfferError(error.message);
    } finally {
      setRespondingOfferId('');
    }
  };

  const confirmDeliveryPickup = async stop => {
    try {
      if (isPreviewSession) {
        const pickedUpAt = new Date().toISOString();
        setStops(previous => previous.map(item => item.id === stop.id ? {
          ...item,
          status: 'IN_PROGRESS',
          dispatchStatus: 'HEADING_TO_DESTINATION',
          pickedUpAt
        } : item));
        return;
      }
      const { stop: updatedStop } = await apiRequest(`/api/stops/${encodeURIComponent(stop.id)}/pickup`, {
        method: 'PATCH',
        body: JSON.stringify({})
      });
      setStops(previous => previous.map(item => item.id === updatedStop.id ? updatedStop : item));
    } catch (error) {
      console.error('Could not confirm delivery pickup:', error);
      setDeliveryOfferError(error.message);
    }
  };

  const handleGenerateInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    setInviteError('');
    setInviteEmailFailed(false);
    if (IS_GITHUB_PAGES_DEMO || isPreviewSession) {
      setInviteError('Generating a reusable driver link needs the live account service. Connect a deployed API to enable invitations.');
      return;
    }
    setIsSendingInvite(true);
    try {
      const { invite, sent, emailWarning } = await apiRequest('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      setInvites(prev => [invite, ...prev.filter(item => !invite.email || item.email !== invite.email)]);
      setGeneratedInviteId(invite.id);
      setInviteEmailFailed(Boolean(email && !sent));
      setInviteNotice(emailWarning || (email && sent
        ? `The mail server accepted the invitation for ${invite.email}. Delivery may take a few minutes; check spam if needed. You can copy the link below as a backup.`
        : 'Link created. Copy and share it with your driver.'));
      setInviteError('');
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsSendingInvite(false);
    }
  };

  const copyInviteLinkToClipboard = (token) => {
    const invite = invites.find(item => item.token === token);
    if (!invite) {
      console.error('Cannot copy application link because the invitation was not found.');
      setInviteError('This invitation is no longer available.');
      return;
    }
    const fullLink = getInviteApplicationUrl(invite);
    if (!navigator.clipboard?.writeText) {
      window.prompt('Copy this application link:', fullLink);
      return;
    }
    navigator.clipboard.writeText(fullLink).then(() => {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 3000);
    }).catch(error => {
      console.error('Could not copy the application link:', error);
      window.prompt('Copy this application link:', fullLink);
    });
  };

  // --- "CLOSEST TO FARTHEST" ROUTE OPTIMIZATION ENGINE ---
  const getRouteStartPoint = () => {
    const savedCoordinates = currentUser ? routeOriginCoordinates[currentUser.id] : null;
    if (savedCoordinates && Number.isFinite(savedCoordinates.lat) && Number.isFinite(savedCoordinates.lng)) {
      return savedCoordinates;
    }

    const coordinates = routeOriginAddress.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordinates) {
      return { lat: Number(coordinates[1]), lng: Number(coordinates[2]) };
    }

    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    const driverObj = users.find(u => u.id === targetDriverId);
    if (currentUser?.role === 'DRIVER' && isGpsActive) return gpsPos;
    if (driverObj && Number.isFinite(driverObj.lat) && Number.isFinite(driverObj.lng)) {
      return { lat: driverObj.lat, lng: driverObj.lng };
    }
    return { lat: startDepot.lat, lng: startDepot.lng };
  };

  const optimizeClosestToFarthest = () => {
    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    const driverStops = stops.filter(s => s.assignedDriverId === targetDriverId);
    if (driverStops.length < 2) return;
    const startPoint = getRouteStartPoint();

    const orderedStops = [...driverStops].sort((a, b) => {
      const aHasCoordinates = Number.isFinite(a.lat) && Number.isFinite(a.lng);
      const bHasCoordinates = Number.isFinite(b.lat) && Number.isFinite(b.lng);
      if (aHasCoordinates !== bHasCoordinates) return aHasCoordinates ? -1 : 1;
      if (!aHasCoordinates) return 0;
      return calcHaversineDistance(startPoint.lat, startPoint.lng, a.lat, a.lng)
        - calcHaversineDistance(startPoint.lat, startPoint.lng, b.lat, b.lng);
    });

    setStops(prevStops => {
      const driverStopIndices = prevStops
        .map((stop, index) => stop.assignedDriverId === targetDriverId ? index : -1)
        .filter(index => index !== -1);
      const nextStops = [...prevStops];
      driverStopIndices.forEach((index, orderIndex) => {
        nextStops[index] = orderedStops[orderIndex];
      });
      return nextStops;
    });
    setShowStopDistances(true);
    focusStopOnMap(orderedStops[0]);
  };

  const moveStop = (stopId, direction) => {
    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    setStops(prevStops => {
      const driverStopIndices = prevStops
        .map((stop, index) => stop.assignedDriverId === targetDriverId ? index : -1)
        .filter(index => index !== -1);
      const currentIndex = driverStopIndices.findIndex(index => prevStops[index].id === stopId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= driverStopIndices.length) return prevStops;

      const nextStops = [...prevStops];
      const currentStopIndex = driverStopIndices[currentIndex];
      const nextStopIndex = driverStopIndices[nextIndex];
      [nextStops[currentStopIndex], nextStops[nextStopIndex]] = [nextStops[nextStopIndex], nextStops[currentStopIndex]];
      return nextStops;
    });
  };

  // --- LIVE GPS TRACKING SYSTEM ---
  const toggleGpsBroadcast = () => {
    if (isGpsActive) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (locationHeartbeatRef.current !== null) {
        window.clearInterval(locationHeartbeatRef.current);
        locationHeartbeatRef.current = null;
      }
      setIsGpsActive(false);
      setGpsStatus('Not sharing');
      gpsPositionRef.current = null;
      setGpsPos(null);
      setGpsSpeed(0);
      if (currentUser) {
        setCurrentUser(prev => prev ? {
          ...prev,
          isTracking: false,
          locationUpdatedAt: null,
          lat: null,
          lng: null,
          speed: 0
        } : prev);
        setUsers(prev => prev.map(user => user.id === currentUser.id
          ? { ...user, isTracking: false, locationUpdatedAt: null, lat: null, lng: null, speed: 0 }
          : user));
        if (!isPreviewSession) {
          return apiRequest('/api/users/me/location', {
            method: 'PATCH',
            body: JSON.stringify({ isTracking: false })
          }).catch(error => {
            console.error('Could not stop sharing the live location:', error);
            setAuthError(`Location sharing could not be stopped on the server: ${error.message}`);
          });
        }
      }
      return Promise.resolve();
    } else {
      if (isPreviewSession) {
        setGpsStatus('Unavailable in preview');
        window.alert('Live GPS sharing requires a signed-in driver account connected to the dispatch service.');
        return;
      }
      if (!navigator.geolocation || !window.isSecureContext) {
        setGpsStatus('HTTPS required for location');
        window.alert('Live location requires a browser with location access over a secure HTTPS connection.');
        return;
      }

      setIsGpsActive(true);
      setGpsStatus('Waiting for GPS signal');
      gpsPositionRef.current = null;
      setGpsPos(null);
      lastLocationSyncRef.current = 0;
      const publishLocation = position => {
        if (!position || !currentUser || isPreviewSession) return Promise.resolve();
        const location = {
          lat: position.lat,
          lng: position.lng,
          speed: position.speed,
          isTracking: true
        };
        const locationUpdatedAt = new Date().toISOString();
        setGpsStatus('Sharing live location');
        setGpsPos({ lat: location.lat, lng: location.lng });
        setGpsSpeed(location.speed);
        setCurrentUser(prev => prev ? { ...prev, ...location, locationUpdatedAt } : prev);
        setUsers(prev => prev.map(user => user.id === currentUser.id
          ? { ...user, ...location, locationUpdatedAt }
          : user));
        lastLocationSyncRef.current = Date.now();
        return apiRequest('/api/users/me/location', {
          method: 'PATCH',
          body: JSON.stringify(location)
        }).catch(error => {
          console.error('Could not share the driver location with dispatch:', error);
          setGpsStatus('Location sync retrying');
          setAuthError(`Live location could not be synchronized: ${error.message}`);
        });
      };
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, speed } = pos.coords;
          const position = {
            lat: latitude,
            lng: longitude,
            speed: speed === null ? 0 : Math.min(300, Math.max(0, Math.round(speed * 3.6)))
          };
          gpsPositionRef.current = position;
          if (Date.now() - lastLocationSyncRef.current >= 5000) {
            publishLocation(position);
          } else {
            setGpsPos({ lat: position.lat, lng: position.lng });
            setGpsSpeed(position.speed);
          }
          if (locationHeartbeatRef.current === null) {
            locationHeartbeatRef.current = window.setInterval(() => {
              if (gpsPositionRef.current) publishLocation(gpsPositionRef.current);
            }, 15_000);
          }
        },
        (err) => {
          console.error('GPS tracking error:', err);
          setIsGpsActive(false);
          setGpsStatus('GPS unavailable');
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          if (locationHeartbeatRef.current !== null) {
            window.clearInterval(locationHeartbeatRef.current);
            locationHeartbeatRef.current = null;
          }
          gpsPositionRef.current = null;
          setGpsPos(null);
          setGpsSpeed(0);
          setCurrentUser(prev => prev ? {
            ...prev,
            isTracking: false,
            locationUpdatedAt: null,
            lat: null,
            lng: null,
            speed: 0
          } : prev);
          setUsers(prev => prev.map(user => user.id === currentUser?.id
            ? { ...user, isTracking: false, locationUpdatedAt: null, lat: null, lng: null, speed: 0 }
            : user));
          if (currentUser && !isPreviewSession) {
            apiRequest('/api/users/me/location', {
              method: 'PATCH',
              body: JSON.stringify({ isTracking: false })
            }).catch(error => console.error('Could not clear the driver live-location status:', error));
          }
          window.alert(`Live location could not be shared: ${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
      );
    }

  };

  // --- OPENSTREETMAP DIRECT NAVIGATION ---
  const getNavigationOrigin = () => {
    const savedCoordinates = currentUser ? routeOriginCoordinates[currentUser.id] : null;
    if (savedCoordinates && Number.isFinite(savedCoordinates.lat) && Number.isFinite(savedCoordinates.lng)) {
      return `${savedCoordinates.lat},${savedCoordinates.lng}`;
    }
    if (routeOriginAddress.trim()) return routeOriginAddress.trim();

    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    const driverObj = users.find(u => u.id === targetDriverId);

    if (isGpsActive && gpsPos && currentUser?.role === 'DRIVER') {
      return `${gpsPos.lat},${gpsPos.lng}`;
    }

    if (driverObj && typeof driverObj.lat === 'number' && typeof driverObj.lng === 'number') {
      return `${driverObj.lat},${driverObj.lng}`;
    }

    return `${startDepot.lat},${startDepot.lng}`;
  };

  useEffect(() => {
    localStorage.setItem('lagos_circuit_route_origins', JSON.stringify(routeOrigins));
  }, [routeOrigins]);

  useEffect(() => {
    localStorage.setItem('lagos_circuit_route_origin_coordinates', JSON.stringify(routeOriginCoordinates));
  }, [routeOriginCoordinates]);

  const updateRouteOriginAddress = (address) => {
    if (!currentUser) return;
    routeOriginLookupRef.current += 1;
    setRouteOrigins(prev => ({ ...prev, [currentUser.id]: address }));
    setRouteOriginCoordinates(prev => {
      if (!prev[currentUser.id]) return prev;
      const next = { ...prev };
      delete next[currentUser.id];
      return next;
    });
  };

  const setRouteOriginToCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (!currentUser) return;
        const lookupId = ++routeOriginLookupRef.current;
        const userId = currentUser.id;
        const location = { lat: coords.latitude, lng: coords.longitude };
        const fallbackAddress = `${location.lat},${location.lng}`;
        setRouteOrigins(prev => ({ ...prev, [userId]: fallbackAddress }));
        setRouteOriginCoordinates(prev => ({ ...prev, [userId]: location }));

        try {
          const params = new URLSearchParams({ lat: String(location.lat), lon: String(location.lng) });
          const data = await apiRequest(`/api/geocode/reverse?${params}`);
          const properties = data.features?.[0]?.properties;
          if (!properties) throw new Error('No address was found for the current coordinates.');

          const address = [
            properties.name,
            properties.housenumber,
            properties.street,
            properties.district,
            properties.city,
            properties.county,
            properties.state,
            properties.country
          ].filter((part, index, parts) => part && parts.indexOf(part) === index).join(', ');
          if (!address) throw new Error('The address lookup returned no readable address.');
          if (routeOriginLookupRef.current === lookupId) {
            setRouteOrigins(prev => ({ ...prev, [userId]: address }));
          }
        } catch (error) {
          if (routeOriginLookupRef.current !== lookupId) return;
          console.error('Unable to find an address for the current location:', error);
          alert('Your current location was found, but its street address could not be looked up. Coordinates are shown instead.');
        }
      },
      (error) => {
        console.error('Unable to get starting location:', error);
        alert('Could not get your current location. Allow location access or enter coordinates.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const getStopDestination = (stop) => {
    if (typeof stop?.lat === 'number' && typeof stop?.lng === 'number') {
      return `${stop.lat},${stop.lng}`;
    }

    if (stop?.address) {
      return stop.address;
    }

    return stop?.name || 'delivery location';
  };

  const launchSingleStopMapNav = (stop, e) => {
    if (e) e.stopPropagation();
    const origin = getNavigationOrigin();
    const destination = getStopDestination(stop);
    window.open(openStreetMapDirectionsUrl([origin, destination]), '_blank', 'noopener,noreferrer');
  };

  const launchMultiStopMapNav = () => {
    if (activeDriverStops.length === 0) return;

    const origin = getNavigationOrigin();
    const routeStops = activeDriverStops.slice(0, 10);
    window.open(
      openStreetMapDirectionsUrl([origin, ...routeStops.map(getStopDestination)]),
      '_blank',
      'noopener,noreferrer'
    );
  };

  // --- SIGNATURE POD HANDLERS ---
  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const clientY = event.touches?.[0]?.clientY ?? event.clientY;

    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const startDrawing = (e) => {
    setIsSigning(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const point = getCanvasPoint(e);
    if (!point) return;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const draw = (e) => {
    if (!isSigning) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const point = getCanvasPoint(e);
    if (!point) return;
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    setSignatureCaptured(true);
  };

  const stopDrawing = () => setIsSigning(false);

  const handleCustomerPhoto = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError('');

    if (!file.type.startsWith('image/')) {
      setPhotoError('Choose an image file from the camera or gallery.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setPhotoError('The selected photo could not be read. Please try again.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => setPhotoError('The selected photo could not be opened. Please try another image.');
      image.onload = () => {
        const maxDimension = 1200;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        if (!context) {
          setPhotoError('Photo processing is unavailable in this browser.');
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setCustomerPhoto(canvas.toDataURL('image/jpeg', 0.75));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const confirmPODDelivery = async () => {
    if (!podStop) return;
    if (!customerName.trim()) {
      setPodError('Enter the name of the person receiving the delivery.');
      return;
    }
    if (!signatureCaptured) {
      setPodError('Please capture the customer’s signature before confirming delivery.');
      return;
    }

    const signatureData = canvasRef.current ? canvasRef.current.toDataURL('image/png') : '';
    const deliveryPayload = {
      status: 'DELIVERED',
      dispatchStatus: 'DELIVERED',
      driverNotes,
      customerName: customerName.trim(),
      customerSignature: signatureData,
      customerPhoto,
      deliveredAt: new Date().toISOString()
    };

    setPodSaving(true);
    try {
      if (isPreviewSession) {
        setStops(previous => previous.map(stop =>
          stop.id === podStop.id ? { ...stop, ...deliveryPayload } : stop
        ));
        const remainingStops = stops.filter(stop =>
          stop.id !== podStop.id
          && stop.assignedDriverId === currentUser?.id
          && !['DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED']
            .includes(String(stop.status || '').toUpperCase())
        );
        if (remainingStops.length === 0 && currentUser?.role === 'DRIVER') {
          setDriverRouteStatus(currentUser.id, 'IDLE', 0);
        }
      } else {
        const { stop: completedStop, user: completedDriver } = await apiRequest(
          `/api/stops/${encodeURIComponent(podStop.id)}/proof`,
          {
            method: 'POST',
            body: JSON.stringify({
              customerName: customerName.trim(),
              driverNotes,
              customerSignature: signatureData,
              customerPhoto
            })
          }
        );
        setStops(previous => previous.map(stop =>
          stop.id === completedStop.id ? { ...stop, ...completedStop } : stop
        ));
        if (completedDriver) {
          setUsers(previous => previous.map(user =>
            user.id === completedDriver.id ? completedDriver : user
          ));
          setCurrentUser(previous => previous?.id === completedDriver.id ? completedDriver : previous);
        }
      }
    } catch (error) {
      console.error('Could not save proof of delivery:', error);
      setPodError(`Delivery proof was not saved: ${error.message}`);
      setPodSaving(false);
      return;
    }

    setPodStop(null);
    setDriverNotes('');
    setCustomerName('');
    setCustomerPhoto('');
    setPodError('');
    setPhotoError('');
    setSignatureCaptured(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setPodSaving(false);
    window.alert('Delivery completed and proof of delivery saved.');
  };

  const clearActiveRoute = () => {
    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    const routeStops = stops.filter(stop => stop.assignedDriverId === targetDriverId);
    if (routeStops.length === 0) return;
    const confirmed = window.confirm(
      `Clear all ${routeStops.length} stops from this driver's route? This cannot be undone.`
    );
    if (!confirmed) return;

    setStops(prev => prev.filter(stop => stop.assignedDriverId !== targetDriverId));
    setSelectedStopId(null);
    setSearchQuery('');
  };

  // Dynamic Route Metrics
  const routeMetrics = useMemo(() => {
    let totalKm = 0;
    const mappedStops = activeDriverStops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    const path = [startDepot, ...mappedStops, startDepot];
    for (let i = 0; i < path.length - 1; i++) {
      totalKm += calcHaversineDistance(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng);
    }
    const mins = Math.round(totalKm * 2.8) + (activeDriverStops.length * 10);
    return {
      totalKm: totalKm.toFixed(1),
      hours: Math.floor(mins / 60),
      mins: mins % 60,
      completed: activeDriverStops.filter(s => s.status === 'DELIVERED').length,
      total: activeDriverStops.length
    };
  }, [activeDriverStops]);
  const analytics = useMemo(() => {
    const now = new Date(clockNow);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    const weekday = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - weekday);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const completed = stops.filter(stop => {
      if (stop.status !== 'DELIVERED' || !stop.deliveredAt) return false;
      return Number.isFinite(new Date(stop.deliveredAt).getTime());
    });
    const completedAtOrAfter = (date) => completed.filter(stop => {
      const timestamp = new Date(stop.deliveredAt).getTime();
      return timestamp >= date.getTime() && timestamp <= now.getTime();
    });
    const daily = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayStart);
      date.setDate(todayStart.getDate() - (6 - index));
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);
      return {
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        count: completed.filter(stop => {
          const deliveredAt = new Date(stop.deliveredAt);
          return deliveredAt >= date && deliveredAt < nextDate;
        }).length
      };
    });
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const nextDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      return {
        label: date.toLocaleDateString(undefined, { month: 'short' }),
        count: completed.filter(stop => {
          const deliveredAt = new Date(stop.deliveredAt);
          return deliveredAt >= date && deliveredAt < nextDate;
        }).length
      };
    });

    return {
      today: daily[6].count,
      thisWeek: completedAtOrAfter(weekStart).length,
      thisMonth: completedAtOrAfter(monthStart).length,
      totalCompleted: completed.length,
      driverCount: driversList.length,
      activeDrivers: driversList.filter(driver =>
        driver.isTracking &&
        driver.locationUpdatedAt &&
        now.getTime() - new Date(driver.locationUpdatedAt).getTime() < 90_000
      ).length,
      daily,
      monthly,
      byDriver: driversList.map(driver => ({
        ...driver,
        deliveries: completed.filter(stop => stop.assignedDriverId === driver.id).length
      })).sort((a, b) => b.deliveries - a.deliveries)
    };
  }, [stops, driversList, clockNow]);
  const [analyticsPeriod, setAnalyticsPeriod] = useState('WEEK');

  // =========================================================================
  // RENDER SCREEN 1: AUTHENTICATION & LOGIN / REGISTRATION
  // =========================================================================
  const brandSplash = showBrandSplash && (
    <main className="brand-splash" aria-hidden="true">
      <div className="brand-splash-art">
        <img className="brand-splash-logo" src={BRAND_LOGO_URL} alt="" />
        <svg className="brand-map-route" viewBox="0 0 300 64">
          <path
            id="brand-map-path"
            className="brand-map-path"
            d="M8 48 C55 48 53 15 105 15 S151 51 196 40 S244 15 292 15"
          />
          <g className="brand-map-arrow">
            <path d="M-7 -5 L8 0 L-7 5 L-3 0 Z" />
            <animateMotion dur="2.8s" repeatCount="indefinite" rotate="auto">
              <mpath href="#brand-map-path" />
            </animateMotion>
          </g>
        </svg>
      </div>
    </main>
  );

  if (!currentUser) {
    return (
      <>
      {brandSplash}
      <div className="auth-screen min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans select-none">
        <div className="max-h-[90dvh] w-full max-w-lg space-y-6 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-8">
          
          {/* LOGO & TITLE */}
          <div className="text-center space-y-2">
            <div className="mx-auto mb-1 flex h-24 w-48 items-center justify-center">
              <img
                src={orgLogoStore.byEmail[loginForm.email.trim().toLowerCase()] || BRAND_LOGO_URL}
                alt="Tobs Route Circuit"
                className={`max-h-full max-w-full object-contain ${
                  orgLogoStore.byEmail[loginForm.email.trim().toLowerCase()] ? '' : 'brand-logo-image'
                }`}
              />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">Lagos Circuit Route Planner</h1>
            <p className="text-xs text-slate-400 font-medium">Enterprise Driver Dispatch & Real-Time Logistics Platform</p>
          </div>

          {/* LOGIN vs REGISTER TAB SWITCHER */}
          {!invitationToken && !IS_GITHUB_PAGES_DEMO && (
          <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs font-bold">
            <button
              onClick={() => { setAuthTab('LOGIN'); setAuthError(''); }}
              className={`py-2 rounded-xl transition-all ${authTab === 'LOGIN' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Log In
            </button>
            <button
              onClick={() => { setAuthTab('REGISTER'); setAuthError(''); }}
              className={`py-2 rounded-xl transition-all ${authTab === 'REGISTER' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Register Account
            </button>
          </div>
          )}

          {authError && (
            <div className="p-3 bg-rose-500/20 border border-rose-500/50 rounded-xl text-xs text-rose-300 font-semibold flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{authError}</span>
            </div>
          )}
          {!credentialsReady && (
            <p className="text-center text-[10px] text-slate-400">Connecting to the secure account service...</p>
          )}
          {!invitationToken && (
            <p className="text-center text-[10px] text-slate-500">
              {IS_GITHUB_PAGES_DEMO
                ? 'This GitHub Pages preview uses sample data stored only in this browser.'
                : 'Accounts and driver invitations are securely managed by your fleet.'}
            </p>
          )}

          {IS_GITHUB_PAGES_DEMO && !invitationToken && (
            <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50 p-3">
              <p className="text-center text-[10px] font-bold text-violet-950">Choose how to continue</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => startPreviewSession('ADMIN')}
                  className="rounded-xl bg-violet-700 px-3 py-2.5 text-[10px] font-extrabold text-white hover:bg-violet-800"
                >
                  Log in as Admin
                </button>
                <button
                  type="button"
                  onClick={() => startPreviewSession('DRIVER')}
                  className="rounded-xl border border-violet-300 bg-white px-3 py-2.5 text-[10px] font-extrabold text-violet-900 hover:bg-violet-100"
                >
                  Log in as Driver
                </button>
              </div>
              <p className="text-center text-[9px] leading-relaxed text-violet-900">
                This browser-only preview uses sample data. Connect the deployed account API for real accounts, driver links, and cross-device tracking.
              </p>
            </div>
          )}

          {/* TAB 1: LOGIN FORM */}
          {!invitationToken && authTab === 'LOGIN' && (
            <form
              onSubmit={showPasswordHelp
                ? (passwordResetCodeSent ? handlePasswordReset : showPasswordRecoveryHelp)
                : handleLogin}
              className="space-y-4 text-xs"
            >
              {showPasswordHelp ? (
                <>
                  {passwordResetCodeSent ? (
                    passwordResetComplete ? (
                      <p role="status" className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-relaxed text-violet-900">
                        {passwordHelpMessage}
                      </p>
                    ) : (
                      <>
                        {!activePasswordResetToken && (
                          <div>
                            <label className="block text-slate-400 font-semibold mb-1">8-digit recovery code</label>
                            <input
                              type="text"
                              required
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              pattern="[0-9]{8}"
                              maxLength={8}
                              value={passwordResetCode}
                              onChange={event => setPasswordResetCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                              className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-slate-200 focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-slate-400 font-semibold mb-1">New password</label>
                          <input
                            type="password"
                            required
                            minLength={12}
                            autoComplete="new-password"
                            value={resetPassword}
                            onChange={event => setResetPassword(event.target.value)}
                            className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-slate-200 focus:border-violet-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 font-semibold mb-1">Confirm new password</label>
                          <input
                            type="password"
                            required
                            minLength={12}
                            autoComplete="new-password"
                            value={resetPasswordConfirm}
                            onChange={event => setResetPasswordConfirm(event.target.value)}
                            className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-slate-200 focus:border-violet-500 focus:outline-none"
                          />
                        </div>
                      </>
                    )
                  ) : (
                    <div>
                      <label className="block text-slate-400 font-semibold mb-1">Account Email</label>
                      <input
                        type="email"
                        required
                        value={passwordHelpEmail}
                        onChange={event => {
                          setPasswordHelpEmail(event.target.value);
                          setPasswordHelpMessage('');
                        }}
                        placeholder="you@company.com"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-slate-200 focus:border-violet-500 focus:outline-none"
                      />
                    </div>
                  )}

                  {passwordHelpMessage && (
                    <p role="status" className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-relaxed text-violet-900">
                      {passwordHelpMessage}
                    </p>
                  )}

                  {!passwordResetComplete && (
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-violet-700 py-3 text-sm font-black text-white hover:bg-violet-800"
                    >
                      {passwordResetCodeSent ? 'Save new password' : 'Send recovery code'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordHelp(false);
                      setPasswordHelpMessage('');
                      setAuthError('');
                      setPasswordResetCodeSent(false);
                      setPasswordResetCode('');
                      if (activePasswordResetToken) {
                        setActivePasswordResetToken('');
                        window.history.replaceState({}, '', window.location.pathname);
                      }
                    }}
                    className="w-full text-center text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Back to log in
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="admin@lagosexpress.com"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {orgLogoStore.byEmail[loginForm.email.trim().toLowerCase()] && (
                    <img
                      src={orgLogoStore.byEmail[loginForm.email.trim().toLowerCase()]}
                      alt="Your fleet logo"
                      className="mx-auto max-h-20 max-w-40 object-contain"
                    />
                  )}

                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 pr-11 text-slate-200 focus:outline-none focus:border-emerald-500"
                      />

                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(prev => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400"
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      >
                        {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={rememberLogin}
                      onChange={event => setRememberLogin(event.target.checked)}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    <span>Remember me on this device</span>
                  </label>

                  <button
                    type="submit"
                    disabled={!credentialsReady}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 text-slate-950 font-black text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                  >
                    Log In to Circuit Platform
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPasswordHelpEmail(loginForm.email);
                      setPasswordHelpMessage('');
                      setShowPasswordHelp(true);
                    }}
                    className="w-full text-right text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </>
              )}
            </form>
          )}

          {/* TAB 2: REGISTER FORM */}
          {!IS_GITHUB_PAGES_DEMO && authTab === 'REGISTER' && (
            <form onSubmit={handleRegister} className="space-y-3 text-xs">
              
              {/* ROLE SELECTOR */}
              {invitationToken ? (
                <p className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-center font-bold text-violet-900">
                  Driver application for {registerForm.orgName || 'your invited fleet'}
                </p>
              ) : (
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setAuthRole('ADMIN')}
                  className={`py-2 rounded-lg font-bold flex items-center justify-center space-x-1.5 ${authRole === 'ADMIN' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin / Dispatcher</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthRole('DRIVER')}
                  className={`py-2 rounded-lg font-bold flex items-center justify-center space-x-1.5 ${authRole === 'DRIVER' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>Delivery Driver</span>
                </button>
              </div>
              )}

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder={authRole === 'ADMIN' ? "e.g. Chief Dispatcher Alabi" : "e.g. Tunde Bakare"}
                  value={registerForm.name}
                  onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="user@domain.com"
                    readOnly={authRole === 'DRIVER' && Boolean(registerForm.inviteToken && registerForm.email)}
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

               <div>
  <label className="block text-slate-400 font-semibold mb-1">Password</label>
  <div className="relative">
    <input
      type={showRegisterPassword ? 'text' : 'password'}
      required
      minLength={12}
      placeholder="••••••••"
      value={registerForm.password}
      onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 pr-10 text-slate-200 focus:outline-none focus:border-emerald-500"
    />
    <button
      type="button"
      onClick={() => setShowRegisterPassword(prev => !prev)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400"
      aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
    >
      {showRegisterPassword ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  </div>
</div>

<div>
  <label className="block text-slate-400 font-semibold mb-1">Confirm Password</label>
  <div className="relative">
    <input
      type={showConfirmPassword ? 'text' : 'password'}
      required
      minLength={12}
      placeholder="Confirm your password"
      value={confirmPassword}
      onChange={(e) => setConfirmPassword(e.target.value)}
      aria-invalid={Boolean(confirmPassword && registerForm.password !== confirmPassword)}
      aria-describedby={
        confirmPassword && registerForm.password !== confirmPassword
          ? 'confirm-password-error'
          : undefined
      }
      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 pr-10 text-slate-200 focus:outline-none focus:border-emerald-500"
    />
    <button
      type="button"
      onClick={() => setShowConfirmPassword(prev => !prev)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400"
      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
    >
      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  </div>
  {confirmPassword && registerForm.password !== confirmPassword && (
    <p id="confirm-password-error" role="alert" className="mt-1 text-[10px] font-semibold text-rose-600">
      Passwords do not match.
    </p>
  )}
</div>
              </div>

              {/* ADMIN REGISTRATION: ORGANIZATION NAME */}
              {authRole === 'ADMIN' ? (
                <div className="space-y-3">
                  <label className="block text-slate-400 font-semibold mb-1">Organization / Fleet Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Lagos Express Courier Hub"
                    value={registerForm.orgName}
                    onChange={(e) => setRegisterForm({ ...registerForm, orgName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ) : (
                /* DRIVER REGISTRATION: INVITE DETAILS & VEHICLE */
                <div className="space-y-2">
                  <p className="rounded-xl border border-violet-200 bg-violet-50 p-2.5 text-[10px] leading-relaxed text-violet-900">
                    Complete your driver profile. An email tied to this link is locked; otherwise enter the email you use for your account.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      aria-label="Operating zone"
                      placeholder="Operating Zone (e.g. Lekki / VI)"
                      value={registerForm.zone}
                      onChange={(e) => setRegisterForm({ ...registerForm, zone: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none"
                    />
                    <input
                      type="text"
                      required
                      aria-label="Vehicle plate number"
                      placeholder="Vehicle Plate Number"
                      value={registerForm.vehicle}
                      onChange={(e) => setRegisterForm({ ...registerForm, vehicle: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!credentialsReady}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 text-slate-950 font-black text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20"
              >
                Create {authRole === 'ADMIN' ? 'Dispatcher Admin' : 'Driver'} Account
              </button>
            </form>
          )}

          {!IS_GITHUB_PAGES_DEMO && !invitationToken && authTab === 'REGISTER' && (
            <button
              type="button"
              onClick={() => { setAuthTab('LOGIN'); setAuthError(''); }}
              className="w-full text-center text-xs font-semibold text-violet-700 hover:underline"
            >
              Already have an account? Log in
            </button>
          )}

        </div>
      </div>
      </>
    );
  }

  if (currentUser.role === 'CUSTOMER_CARE') {
    return (
      <React.Suspense fallback={<main className="cc-loading" role="status">Loading Customer Care…</main>}>
        <CustomerCareDashboard currentUser={currentUser} onLogout={handleLogout} request={apiRequest} />
      </React.Suspense>
    );
  }

  // =========================================================================
  // MAIN APP INTERFACE (LOGGED IN STATE)
  // =========================================================================
  return (
    <>
    {brandSplash}
    <div className={`app-shell ${currentUser.role === 'ADMIN' ? 'admin-dashboard' : 'driver-dashboard'} ${currentUser.role === 'ADMIN' && activeAdminView === 'ROUTES' ? 'is-route-planner' : ''} flex h-dvh min-h-0 w-full flex-col overflow-y-auto bg-slate-950 font-sans text-slate-100 select-none md:flex-row md:overflow-hidden`}>
      {currentUser.role === 'ADMIN' && mobileSidebarOpen && (
        <button
          type="button"
          className="admin-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* --- SIDEBAR PANEL (~25% WIDTH) --- */}
      <div className={`admin-dashboard-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''} ${mobileSidebarOpen ? 'is-mobile-open' : ''} z-20 flex max-h-[55dvh] w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900 shadow-2xl transition-all duration-300 md:h-full md:max-h-none md:border-b-0 md:border-r ${
        sidebarCollapsed ? 'md:w-16' : 'md:w-80 md:max-w-[24rem]'
      }`}>

        {/* SIDEBAR HEADER */}
        <div className="admin-sidebar-header p-3.5 border-b border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="admin-route-standard-brand flex items-center space-x-2 min-w-0">
                <img
                  src={currentOrgLogo}
                  alt={`${currentUser.orgName || 'Fleet'} logo`}
                  className={`h-8 w-16 shrink-0 object-contain ${currentOrgLogo === BRAND_LOGO_URL ? 'brand-logo-image' : ''}`}
                />
                <div className="truncate">
                  <h1 className="font-black text-sm tracking-tight text-emerald-400 truncate">
                    Tobs Circuit
                  </h1>
                  <p className="text-[10px] font-bold text-slate-400 flex items-center space-x-1">
                    <User className="w-3 h-3 text-blue-400" />
                    <span>{currentUser.orgName || 'Fleet workspace'}</span>
                  </p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <img
                src={currentOrgLogo}
                alt={`${currentUser.orgName || 'Fleet'} logo`}
                className={`admin-route-collapsed-logo h-6 w-8 shrink-0 object-contain ${currentOrgLogo === BRAND_LOGO_URL ? 'brand-logo-image' : ''}`}
              />
            )}

            {currentUser.role === 'ADMIN' && activeAdminView === 'ROUTES' && (
              <div className="admin-route-mobile-greeting">
                <img src={currentOrgLogo} alt="" />
                <div>
                  <strong>Good</strong>
                  <p><User aria-hidden="true" />{currentUser.name} (ADMIN)</p>
                </div>
              </div>
            )}

            <button
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-lg border bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

        </div>

        {currentUser.role === 'ADMIN' && (
          <nav className="admin-sidebar-nav" aria-label="Admin navigation">
            {ADMIN_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={activeAdminView === id ? 'page' : undefined}
                aria-label={sidebarCollapsed ? label : undefined}
                title={sidebarCollapsed ? label : undefined}
                onClick={() => {
                  setActiveAdminView(id);
                  setMobileSidebarOpen(false);
                }}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}

        {/* SIDEBAR MAIN CONTROLS */}
        {(!sidebarCollapsed || (currentUser.role === 'ADMIN' && activeAdminView === 'ROUTES')) && (
          <div className="admin-sidebar-controls flex-1 overflow-y-auto p-3.5 space-y-3">
            {isPreviewSession && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-[9px] leading-relaxed text-amber-950">
                Static preview: changes stay in this browser. Email, password reset and cross-device live tracking are disabled.
              </p>
            )}
            <section className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <h2 className="mb-2 truncate text-xs font-extrabold text-slate-200">
                {currentUser.role === 'ADMIN' ? selectedDriver?.name || 'Select a driver' : currentUser.name}
              </h2>
              <div className="grid grid-cols-3 gap-2 text-[9px] font-semibold text-slate-400">
                <div className="flex min-w-0 items-center gap-1">
                  <Truck className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                  <span>{routeMetrics.totalKm} km</span>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>{routeMetrics.hours}h {routeMetrics.mins}m</span>
                </div>
                <div className="flex min-w-0 items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{routeMetrics.completed}/{routeMetrics.total} delivered</span>
                </div>
              </div>
            </section>
            {/* ADMIN FLEET SELECTION WORKFLOW */}
            {currentUser.role === 'ADMIN' ? (
              <>
              <div className="admin-fleet-card p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <span>Step 1: Select Driver Fleet</span>
                  <Users className="w-3.5 h-3.5 text-emerald-400" />
                </div>

                <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto">
                  {driversList.map(d => {
                    const isSelected = d.id === activeDriverId;
                    const stopCount = stops.filter(s => s.assignedDriverId === d.id).length;

                    return (
                      <div key={d.id} className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setActiveDriverId(d.id);
                            setSelectedStopId(null);
                          }}
                          className={`min-w-0 flex-1 p-2 rounded-lg text-left transition-all flex items-center justify-between border ${
                            isSelected
                              ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <div className="text-xs truncate">{d.name}</div>
                            <div className="text-[9px] text-slate-500 truncate">
                              {d.zone} · {d.routeStatus === 'IN_PROGRESS'
                                ? 'On journey'
                                : d.routeStatus === 'ACCEPTED'
                                  ? 'Route accepted'
                                  : d.routeStatus === 'PENDING'
                                    ? 'Route assigned'
                                    : 'Available'}
                            </div>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                            isSelected ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {stopCount} stops
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${d.name}'s driver account`}
                          title="Remove driver account"
                          onClick={() => removeDriverAccount(d)}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-950/30 p-2.5 text-[9px] text-sky-100">
                <input
                  type="checkbox"
                  checked={businessBatchConsent}
                  onChange={event => updateBusinessBatchConsent(event.target.checked)}
                  disabled={isPreviewSession}
                  className="mt-0.5 accent-sky-500"
                />
                <span>
                  Allow cross-business delivery batches. Other businesses and the rider must also opt in.
                </span>
              </label>
              {stops.some(stop => !stop.assignedDriverId) && (
                <div className="rounded-xl border border-amber-500/30 bg-slate-950 p-2.5">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Unassigned Stops
                  </p>
                  <div className="space-y-1.5">
                    {stops.filter(stop => !stop.assignedDriverId).map(stop => (
                      <div key={stop.id} className="space-y-1">
                        <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 p-2">
                          <button
                            type="button"
                            onClick={() => focusStopOnMap(stop)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-[10px] font-bold text-slate-200">{stop.name}</span>
                            <span className="block truncate text-[9px] text-slate-500">{stop.address}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => requestRidersForStop(stop)}
                            className="rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[9px] font-bold text-violet-200 hover:bg-violet-500/20"
                          >
                            Find riders
                          </button>
                          <button
                            type="button"
                            disabled={!activeDriverId}
                            onClick={() => requestRidersForStop(stop, activeDriverId)}
                            className="rounded-md bg-emerald-500/15 px-2 py-1 text-[9px] font-bold text-emerald-300 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Offer selected
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${stop.name}`}
                            onClick={() => deleteStop(stop)}
                            className="rounded-md p-1 text-rose-300 hover:bg-rose-500/15"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        {deliverySearchFeedback?.stopId === stop.id && (
                          <p
                            role={deliverySearchFeedback.state === 'error' ? 'alert' : 'status'}
                            className={`rounded-lg px-2 py-1.5 text-[9px] ${
                              deliverySearchFeedback.state === 'error'
                                ? 'bg-rose-950/50 text-rose-200'
                                : deliverySearchFeedback.state === 'accepted'
                                  ? 'bg-emerald-950/50 text-emerald-200'
                                  : 'bg-violet-950/50 text-violet-200'
                            }`}
                          >
                            {deliverySearchFeedback.message}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </>
            ) : (
              <div className="space-y-3">
                {deliveryOfferError && (
                  <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-2.5 text-[10px] font-semibold text-rose-800">
                    {deliveryOfferError}
                  </p>
                )}
                {deliveryOffers.length > 0 && (
                  <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-extrabold text-amber-950">Delivery offers</h3>
                      <span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-amber-800">
                        {deliveryOffers.length} available
                      </span>
                    </div>
                    {deliveryOffers.map(offer => {
                      const pickupPoint = `${offer.stop.pickupLat},${offer.stop.pickupLng}`;
                      const deliveryPoint = `${offer.stop.lat},${offer.stop.lng}`;
                      const mapUrl = openStreetMapDirectionsUrl([pickupPoint, deliveryPoint]);
                      return (
                        <article key={offer.id} className="rounded-xl border border-amber-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[11px] font-extrabold text-slate-900">{offer.businessName}</p>
                              <p className="mt-0.5 text-[9px] text-slate-500">
                                Offer expires {new Date(offer.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <span className="rounded-md bg-violet-50 px-2 py-1 text-[9px] font-bold text-violet-800">
                              {offer.stop.priority || 'NORMAL'}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1.5 text-[10px]">
                            {offer.batch && offer.batchStops?.length > 1 && (
                              <div className="rounded-lg bg-violet-50 p-2 text-violet-950">
                                <p className="font-extrabold">
                                  Optimized route · {offer.batchStops.length} deliveries
                                </p>
                                {offer.batchStops.map((batchStop, index) => (
                                  <p key={batchStop.id} className="mt-1 text-slate-700">
                                    {index + 1}. {batchStop.pickupAddress} → {batchStop.address}
                                    {batchStop.deliveryDeadlineAt
                                      ? ` · due ${new Date(batchStop.deliveryDeadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                      : ''}
                                  </p>
                                ))}
                                {Number.isFinite(offer.route?.distanceKm) && (
                                  <p className="mt-1 font-semibold">
                                    Road route {offer.route.distanceKm.toFixed(1)} km · ETA {new Date(offer.route.estimatedArrivalAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                )}
                              </div>
                            )}
                            <p><strong className="text-slate-700">Pickup:</strong> <span className="text-slate-600">{offer.stop.pickupAddress}</span></p>
                            <p><strong className="text-slate-700">Delivery:</strong> <span className="text-slate-600">{offer.stop.address}</span></p>
                            <p className="text-slate-500">
                              {offer.pickupDistanceKm?.toFixed(1) ?? '—'} km straight-line to pickup
                            </p>
                            <DeliveryRouteEstimate offer={offer} />
                            <p className="text-slate-500">
                              {offer.stop.packages || 1} package(s)
                              {offer.stop.packageDescription ? ` · ${offer.stop.packageDescription}` : ''}
                              {offer.stop.packageSize ? ` · ${offer.stop.packageSize.toLowerCase()}` : ''}
                              {offer.stop.packageWeightKg ? ` · ${offer.stop.packageWeightKg} kg` : ''}
                            </p>
                            {offer.stop.riderEarningsNgn !== null && offer.stop.riderEarningsNgn !== undefined && (
                              <p className="font-bold text-emerald-800">
                                Proposed earnings: NGN {Number(offer.stop.riderEarningsNgn).toLocaleString()}
                              </p>
                            )}
                          </div>
                          <a
                            href={mapUrl.toString()}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[9px] font-bold text-violet-800 hover:bg-violet-50"
                          >
                            <MapPin className="h-3 w-3" />
                            View pickup and delivery map
                          </a>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={respondingOfferId === offer.id}
                              onClick={() => respondToDeliveryOffer(offer, 'accept')}
                              className="rounded-lg bg-emerald-600 px-2 py-2 text-[10px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {respondingOfferId === offer.id
                                ? 'Submitting...'
                                : offer.batch && offer.batchStops?.length > 1
                                  ? `Accept ${offer.batchStops.length}-delivery route`
                                  : 'Accept delivery'}
                            </button>
                            <button
                              type="button"
                              disabled={respondingOfferId === offer.id}
                              onClick={() => respondToDeliveryOffer(offer, 'reject')}
                              className="rounded-lg border border-slate-300 px-2 py-2 text-[10px] font-extrabold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                )}
                {driverRouteStatus !== 'IDLE' && (
                  <div className="rounded-2xl border border-violet-200 bg-violet-50 p-3.5">
                    <div className="flex items-start gap-3">
                      <span className="rounded-xl bg-white p-2 text-violet-700 shadow-sm">
                        <Radio className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-extrabold text-violet-950">
                          {driverRouteStatus === 'PENDING' ? 'New route assigned' : driverRouteStatus === 'ACCEPTED' ? 'Route accepted' : 'Journey in progress'}
                        </p>
                        <p className="mt-1 text-[10px] text-violet-800">
                          {driverRouteStopCount} stop{driverRouteStopCount === 1 ? '' : 's'} · {driverRouteStops.filter(stop => stop.status === 'DELIVERED').length} completed
                        </p>
                      </div>
                    </div>
                    {driverRouteStatus === 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => setDriverRouteStatus(currentUser.id, 'ACCEPTED')}
                        className="mt-3 w-full rounded-xl bg-violet-700 py-2.5 text-xs font-extrabold text-white hover:bg-violet-800"
                      >
                        Accept route
                      </button>
                    )}
                    {driverRouteStatus === 'ACCEPTED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setDriverRouteStatus(currentUser.id, 'IN_PROGRESS');
                          if (!isGpsActive) toggleGpsBroadcast();
                        }}
                        className="mt-3 w-full rounded-xl bg-violet-700 py-2.5 text-xs font-extrabold text-white hover:bg-violet-800"
                      >
                        Start journey
                      </button>
                    )}
                  </div>
                )}
                <div className="rounded-2xl border border-violet-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-violet-950">Delivery availability</p>
                      <p className="mt-1 text-[9px] text-slate-500">
                        This is separate from sharing your live location.
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={currentUser.isAvailable === true}
                      onClick={toggleRiderAvailability}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-extrabold ${
                        currentUser.isAvailable
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {currentUser.isAvailable ? 'Available' : 'Unavailable'}
                    </button>
                  </div>
                  {currentUser.isAvailable && !(isGpsActive || currentUser.isTracking) && (
                    <p className="text-[9px] text-amber-700">
                      Turn on live location to appear in nearby rider discovery.
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-violet-200 bg-white p-3">
                  <p className="text-xs font-bold text-violet-950">Delivery capacity and consent</p>
                  <p className="mt-1 text-[9px] text-slate-500">
                    Batching is offered only when capacity, package sizes and delivery deadlines are known.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-[9px] font-semibold text-slate-600">
                      Maximum packages
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={dispatchProfileForm.maxPackageCount}
                        onChange={event => setDispatchProfileForm(previous => ({
                          ...previous,
                          maxPackageCount: event.target.value === '' ? '' : Number(event.target.value)
                        }))}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800"
                      />
                    </label>
                    <label className="text-[9px] font-semibold text-slate-600">
                      Maximum load (kg)
                      <input
                        type="number"
                        min="0.1"
                        max="1000"
                        step="0.1"
                        value={dispatchProfileForm.maxPackageWeightKg}
                        onChange={event => setDispatchProfileForm(previous => ({
                          ...previous,
                          maxPackageWeightKg: event.target.value === '' ? '' : Number(event.target.value)
                        }))}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800"
                      />
                    </label>
                  </div>
                  <label className="mt-2 block text-[9px] font-semibold text-slate-600">
                    Largest package size
                    <select
                      value={dispatchProfileForm.maxPackageSize}
                      onChange={event => setDispatchProfileForm(previous => ({
                        ...previous,
                        maxPackageSize: event.target.value
                      }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800"
                    >
                      <option value="">Not specified</option>
                      <option value="SMALL">Small</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="LARGE">Large</option>
                    </select>
                  </label>
                  <label className="mt-2 flex items-start gap-2 text-[9px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={dispatchProfileForm.acceptsCrossBusinessBatches}
                      onChange={event => setDispatchProfileForm(previous => ({
                        ...previous,
                        acceptsCrossBusinessBatches: event.target.checked
                      }))}
                      className="mt-0.5 accent-violet-700"
                    />
                    <span>I consent to eligible batches containing deliveries from other businesses.</span>
                  </label>
                  {dispatchProfileError && (
                    <p role="alert" className="mt-2 text-[9px] text-rose-700">{dispatchProfileError}</p>
                  )}
                  <button
                    type="button"
                    onClick={saveDispatchProfile}
                    disabled={dispatchProfileSaving}
                    className="mt-2 w-full rounded-lg bg-violet-700 py-2 text-[10px] font-extrabold text-white disabled:opacity-50"
                  >
                    {dispatchProfileSaving ? 'Saving...' : 'Save dispatch profile'}
                  </button>
                </div>
                <div className="rounded-2xl border border-violet-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-violet-950">
                    <span className="flex items-center gap-1.5">
                      <Radio className={`h-4 w-4 ${isGpsActive ? 'animate-pulse text-violet-700' : 'text-slate-400'}`} />
                      <span>Live location</span>
                    </span>
                    <span className="max-w-[55%] text-right text-[10px] font-semibold leading-tight text-slate-500" role="status" aria-live="polite">
                      {isGpsActive && gpsPos && gpsStatus === 'Sharing live location' ? `${gpsSpeed} km/h` : gpsStatus}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-pressed={isGpsActive}
                    onClick={toggleGpsBroadcast}
                    className={`w-full rounded-xl py-2.5 text-xs font-extrabold transition-all ${
                      isGpsActive ? 'bg-rose-50 text-rose-700' : 'bg-violet-700 text-white hover:bg-violet-800'
                    }`}
                  >
                    <span>{isGpsActive ? 'Stop sharing location' : 'Share live location'}</span>
                  </button>
                  <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                    Your recent location is visible to dispatchers while sharing is on. Keep this app open for ongoing updates.
                  </p>
                </div>
              </div>
            )}

            {/* ROUTE ACTIONS: ADD STOP MANUALLY & OPTIMIZE */}
            {currentUser.role === 'ADMIN' && (
            <div className="admin-route-actions space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={openAddStopModal}
                  className="py-2.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-1 transition-all"
                >
                  <Plus className="w-4 h-4 stroke-3" />
                  <span>Add Stop Manually</span>
                </button>

                <button
                  onClick={optimizeClosestToFarthest}
                  disabled={stops.filter(stop =>
                    stop.assignedDriverId === (currentUser.role === 'DRIVER' ? currentUser.id : activeDriverId)
                  ).length < 2}
                  className="py-2.5 px-2 bg-amber-500 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center space-x-1 transition-all"
                >
                  <ArrowDownUp className="w-4 h-4 stroke-[3]" />
                  <span>Sort Closest to Farthest</span>
                </button>
              </div>
              <p className="text-[9px] text-slate-500">
                Sort two or more stops to show each stop’s approximate straight-line distance from your starting location.
              </p>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-400">Starting location</label>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    value={routeOriginAddress}
                    onChange={(event) => updateRouteOriginAddress(event.target.value)}
                    placeholder="Driver location or enter coordinates"
                    className="min-w-0 flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={setRouteOriginToCurrentLocation}
                    className="shrink-0 py-2 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-[10px] rounded-xl"
                  >
                    Use current location
                  </button>
                </div>
                <p className="text-[9px] text-slate-500">Leave blank to use the driver’s saved location.</p>
              </div>

              <button
                onClick={launchMultiStopMapNav}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Open {Math.min(activeDriverStops.length, 10)}-Stop Route in OpenStreetMap
                </span>
              </button>
              <button
                onClick={clearActiveRoute}
                disabled={!stops.some(stop =>
                  stop.assignedDriverId === (currentUser.role === 'DRIVER' ? currentUser.id : activeDriverId)
                )}
                className="w-full py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-rose-300 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear This Route</span>
              </button>

              {/* SEARCH INPUT */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter stops or addresses..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            )}

            <DeliveryChatPanel
              deliveryId={activeChatStop?.id}
              currentUserId={currentUser.id}
              request={apiRequest}
            />

            {/* STOP LIST */}
            <div className="admin-stop-list space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-semibold">
                <span>Stops ({activeDriverStops.length})</span>
                {currentUser.role === 'ADMIN' && (
                  <span className="text-[10px] text-amber-400">Use arrows to reorder</span>
                )}
              </div>

              {activeDriverStops.length === 0 ? (
                <div className="p-4 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                  <MapPin className="w-6 h-6 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-500 font-medium">No stops assigned to this route yet.</p>
                  {currentUser.role === 'ADMIN' && (
                    <button
                      onClick={openAddStopModal}
                      className="text-xs text-emerald-400 font-bold hover:underline"
                    >
                      + Add first manual stop
                    </button>
                  )}
                </div>
              ) : (
                activeDriverStops.map((stop, idx) => {
                  const isSelected = selectedStopId === stop.id;
                  const routeStartPoint = getRouteStartPoint();
                  const stopDistance = Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
                    ? calcHaversineDistance(routeStartPoint.lat, routeStartPoint.lng, stop.lat, stop.lng)
                    : null;

                  return (
                    <div
                      key={stop.id}
                      onClick={() => focusStopOnMap(stop)}
                      className={`p-3 border rounded-xl transition-all cursor-pointer relative space-y-2 ${
                        isSelected
                          ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start space-x-2.5">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] font-mono mt-0.5 shrink-0 ${
                          stop.status === 'DELIVERED'
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-blue-600 text-white'
                        }`}>
                          {idx + 1}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold truncate text-slate-200">{stop.name}</h4>
                            <span className="text-[8px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-extrabold">
                              {stop.priority}
                            </span>
                          </div>

                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{stop.address}</p>
                          {stop.dispatchStatus && (
                            <span className="mt-1 inline-block rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[8px] font-bold text-violet-200">
                              {stop.dispatchStatus.replaceAll('_', ' ')}
                            </span>
                          )}
                          {currentUser.role === 'ADMIN' && stop.assignedDriverId && (
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-[9px] text-slate-400">
                                {(() => {
                                  const assignedRider = driversList.find(driver => driver.id === stop.assignedDriverId);
                                  return `Rider: ${assignedRider?.name || 'Assigned'}${assignedRider?.vehicle ? ` · ${assignedRider.vehicle}` : ''}`;
                                })()}
                              </span>
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  setActiveDriverId(stop.assignedDriverId);
                                  setMapExpanded(true);
                                }}
                                className="shrink-0 rounded-md border border-violet-500/30 px-1.5 py-0.5 text-[8px] font-bold text-violet-200 hover:bg-violet-500/10"
                              >
                                Track rider
                              </button>
                            </div>
                          )}
                          {currentUser.role === 'ADMIN'
                            && stop.assignedDriverId
                            && driversList.find(driver => driver.id === stop.assignedDriverId)?.phone && (
                              <a
                                href={`tel:${driversList.find(driver => driver.id === stop.assignedDriverId).phone}`}
                                onClick={event => event.stopPropagation()}
                                className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-300 hover:text-emerald-200"
                              >
                                <Phone className="h-3 w-3" />
                                Contact rider
                              </a>
                            )}
                          {stop.receiverPhone && (
                            <a
                              href={`tel:${stop.receiverPhone}`}
                              onClick={event => event.stopPropagation()}
                              className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 hover:text-emerald-200"
                            >
                              <Phone className="h-3 w-3" />
                              <span>{stop.receiverPhone}</span>
                            </a>
                          )}
                          {showStopDistances && (
                            <p className="mt-1 text-[10px] font-semibold text-emerald-300">
                              {stopDistance === null
                                ? 'Select an address suggestion to calculate distance'
                                : `~${stopDistance.toFixed(1)} km from start`}
                            </p>
                          )}

                          <div className="flex items-center space-x-2 mt-1 text-[9px] text-slate-400 font-mono">
                            <span className="flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              <span>{stop.timeWindow}</span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <Package className="w-3 h-3 text-slate-500" />
                              <span>{stop.packages} pkgs</span>
                            </span>
                          </div>
                          {stop.status === 'DELIVERED' && stop.customerName && (
                            <div className="mt-2 flex items-center space-x-2 text-[10px] text-emerald-300">
                              <span>Received by {stop.customerName}</span>
                              {stop.customerPhoto && (
                                <a href={stop.customerPhoto} target="_blank" rel="noreferrer">
                                  <img
                                    src={stop.customerPhoto}
                                    alt={`Delivery proof for ${stop.name}`}
                                    className="h-8 w-8 rounded border border-slate-700 object-cover"
                                  />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* STOP CARD BUTTONS */}
                      <div className="pt-2 border-t border-slate-800/80 flex items-center space-x-1.5">
                        {currentUser.role === 'ADMIN' && (
                        <>
                        <button
                          type="button"
                          aria-label={`Move ${stop.name} closer in the route`}
                          title="Move closer"
                          disabled={idx === 0 || Boolean(searchQuery)}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveStop(stop.id, -1);
                          }}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${stop.name} farther in the route`}
                          title="Move farther"
                          disabled={idx === activeDriverStops.length - 1 || Boolean(searchQuery)}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveStop(stop.id, 1);
                          }}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        </>
                        )}
                        <button
                          onClick={(e) => launchSingleStopMapNav(stop, e)}
                          className="flex-1 py-1 px-2 bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-400 font-bold text-[10px] rounded-lg flex items-center justify-center space-x-1 transition-all"
                        >
                          <Target className="w-3 h-3" />
                          <span>OpenStreetMap</span>
                        </button>

                        {currentUser.role === 'DRIVER' && stop.dispatchStatus === 'HEADING_TO_PICKUP' && (
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation();
                              confirmDeliveryPickup(stop);
                            }}
                            className="rounded-lg bg-amber-500 px-2 py-1 text-[9px] font-extrabold text-slate-950 hover:bg-amber-400"
                          >
                            Confirm pickup
                          </button>
                        )}

                        {stop.status !== 'DELIVERED' ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                            setCustomerName('');
                            setCustomerPhoto('');
                            setPhotoError('');
                            setPodError('');
                            setSignatureCaptured(false);
                            setDriverNotes('');
                            setPodStop(stop);
                          }}
                          aria-label={`Mark ${stop.name} delivered`}
                          className="py-1 px-2 bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-300 font-bold text-[10px] rounded-lg flex items-center space-x-1"
                          >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Mark Delivered</span>
                          </button>
                        ) : (
                          <span className="py-1 px-2 bg-emerald-500/10 text-emerald-400 font-extrabold text-[9px] rounded flex items-center space-x-1">
                            <Check className="w-3 h-3" />
                            <span>Delivered</span>
                          </span>
                        )}
                        {currentUser.role === 'ADMIN' && (
                          <button
                            type="button"
                            aria-label={`Delete ${stop.name}`}
                            title="Delete stop"
                            onClick={event => {
                              event.stopPropagation();
                              deleteStop(stop);
                            }}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                    </div>
                  );
                })
              )}
            </div>

          </div>
        )}

      </div>

      {currentUser.role === 'ADMIN' && activeAdminView !== 'ROUTES' ? (
        <AdminDashboard
          page={activeAdminView}
          currentUser={currentUser}
          stops={stops}
          drivers={driversList}
          now={clockNow}
          mapContent={(
            <div className="relative h-full w-full">
              <FleetMap
                center={dashboardMapCenter}
                drivers={mapDisplayDrivers}
                stops={mapVisibleStops}
                now={clockNow}
                selectedDriverId={activeDriverId}
                onDriverSelect={driverId => setActiveDriverId(driverId)}
              />
              {dispatchMapError && (
                <p role="status" className="absolute left-3 top-3 z-20 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 text-[10px] font-semibold text-amber-950 shadow">
                  {dispatchMapError}
                </p>
              )}
            </div>
          )}
          profileMenu={profileMenu}
          search={dashboardSearchQuery}
          onSearchChange={setDashboardSearchQuery}
          onTrackDriver={driverId => {
            setActiveDriverId(driverId);
            setActiveAdminView('LIVE_TRACKING');
          }}
          onNavigate={view => {
            setActiveAdminView(view);
            setMobileSidebarOpen(false);
          }}
          onOpenMenu={() => {
            setSidebarCollapsed(false);
            setMobileSidebarOpen(true);
          }}
        />
      ) : currentUser.role === 'ADMIN' && activeAdminView === 'LEGACY_ANALYTICS' ? (
      <main className="flex min-h-[42dvh] flex-1 flex-col overflow-y-auto bg-violet-50 p-4 text-slate-950 sm:p-6 md:min-h-0 md:p-8">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-700">Admin dashboard</p>
              <h2 className="mt-1 text-2xl font-black text-violet-950">Fleet analytics</h2>
              <p className="mt-1 text-xs text-slate-600">Completed delivery stops across your fleet. Fuel and cash costs are not tracked.</p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="hidden rounded-full border border-violet-200 bg-white px-3 py-1 text-[10px] font-bold text-violet-800 sm:inline">
                Updated from recorded deliveries
              </span>
              {profileMenu}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: 'Delivered today', value: analytics.today },
              { label: 'Delivered this week', value: analytics.thisWeek },
              { label: 'Delivered this month', value: analytics.thisMonth },
              { label: 'Drivers in your fleet', value: analytics.driverCount }
            ].map(metric => (
              <section key={metric.label} className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{metric.label}</p>
                <p className="mt-2 text-3xl font-black text-violet-800">{metric.value}</p>
              </section>
            ))}
          </div>

          <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-violet-950">Delivery activity</h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  {analyticsPeriod === 'WEEK' ? 'Daily completed deliveries over the last 7 days' : 'Monthly completed deliveries over the last 6 months'}
                </p>
              </div>
              <div className="flex gap-1 rounded-xl bg-violet-50 p-1">
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('WEEK')}
                  aria-pressed={analyticsPeriod === 'WEEK'}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-bold ${
                    analyticsPeriod === 'WEEK' ? 'bg-violet-700 text-white' : 'text-violet-800'
                  }`}
                >
                  Week
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('MONTH')}
                  aria-pressed={analyticsPeriod === 'MONTH'}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-bold ${
                    analyticsPeriod === 'MONTH' ? 'bg-violet-700 text-white' : 'text-violet-800'
                  }`}
                >
                  Month
                </button>
              </div>
            </div>
            {(() => {
              const chartData = analyticsPeriod === 'WEEK' ? analytics.daily : analytics.monthly;
              const maximum = Math.max(1, ...chartData.map(item => item.count));
              return (
                <div className="grid h-48 grid-cols-7 items-end gap-2 sm:h-56 sm:gap-4">
                  {chartData.map(item => (
                    <div key={item.label} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
                      <span className="text-[10px] font-bold text-violet-900">{item.count}</span>
                      <div className="flex h-36 w-full items-end rounded-t-lg bg-violet-50 sm:h-44">
                        <div
                          className="w-full rounded-t-lg bg-violet-600 transition-all"
                          style={{ height: `${Math.max(item.count ? 8 : 2, (item.count / maximum) * 100)}%` }}
                          title={`${item.count} deliveries`}
                        />
                      </div>
                      <span className="text-[9px] font-semibold text-slate-500">{item.label}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>

          <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-violet-950">Driver activity</h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  {analytics.activeDrivers} driver{analytics.activeDrivers === 1 ? '' : 's'} currently sharing a recent live location
                </p>
              </div>
              <Users className="h-5 w-5 text-violet-700" />
            </div>
            {analytics.byDriver.length === 0 ? (
              <p className="rounded-xl bg-violet-50 p-3 text-xs text-slate-600">No drivers have joined this fleet yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {analytics.byDriver.map(driver => (
                  <div key={driver.id} className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-800">{driver.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{driver.zone || driver.email}</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-extrabold text-violet-800">
                      {driver.deliveries} delivered
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      ) : (
      <>
      {/* --- COMPACT GOOGLE MAP DISPLAY --- */}
      <div className={`admin-map-panel relative flex w-full min-w-0 flex-col overflow-hidden bg-slate-950 md:w-auto md:flex-1 ${
        mapExpanded
          ? 'is-expanded fixed inset-0 z-50 h-dvh'
          : 'h-[42dvh] min-h-[280px] shrink-0 md:h-full md:min-h-0'
      }`}>

        <div className="admin-map-toolbar z-10 flex min-h-12 items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/90 px-3 py-2 backdrop-blur-md sm:px-4">
          <button
            type="button"
            onClick={() => {
              if (mapExpanded) setShowCandidateMap(false);
              setMapExpanded(!mapExpanded);
            }}
            aria-label={mapExpanded ? 'Return to route' : 'Expand map'}
            title={mapExpanded ? 'Return to route' : 'Expand map'}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-800 hover:bg-slate-50"
          >
            {mapExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{mapExpanded ? 'Back' : 'Expand map'}</span>
          </button>
          <div className="admin-map-actions flex items-center gap-2">
            <a
              href={openStreetMapUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold text-emerald-300 hover:bg-emerald-500/20 sm:px-2.5 sm:text-[10px]"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">Open in OpenStreetMap</span>
              <span className="sm:hidden">OpenStreetMap</span>
            </a>
            {profileMenu}
          </div>
        </div>

        {/* Map follows the selected driver's next stop, or the selected stop. */}
        <div className="admin-map-canvas flex-1 relative w-full h-full">
          <FleetMap
            center={mapCenter}
            drivers={mapDisplayDrivers}
            stops={mapVisibleStops}
            now={clockNow}
            selectedDriverId={activeDriverId}
            onDriverSelect={driverId => {
              if (currentUser.role === 'ADMIN') setActiveDriverId(driverId);
            }}
          />
          {dispatchMapError && currentUser.role === 'ADMIN' && (
            <p role="status" className="absolute left-3 top-3 z-20 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 text-[10px] font-semibold text-amber-950 shadow">
              {dispatchMapError}
            </p>
          )}

        </div>

      </div>
      </>
      )}

      {/* --- MODAL 1: DRIVER INVITATION GENERATOR --- */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-5 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 text-xs shadow-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-950">
                  <UserPlus className="h-5 w-5 text-violet-700" />
                  <span>Invite a driver</span>
                </h3>
                <p className="mt-1 text-[11px] text-slate-500">Generate a one-use driver application link for {currentUser.orgName}. Email is optional.</p>
              </div>
              <button onClick={() => setShowInviteModal(false)} aria-label="Close invite window" className="text-slate-400 hover:text-slate-900">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={event => {
                event.preventDefault();
                handleGenerateInvite();
              }}
              className="space-y-3"
            >
              <label htmlFor="driver-invite-email" className="block font-bold text-slate-700">Driver email address (optional)</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="driver-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={event => {
                    setInviteEmail(event.target.value);
                    setInviteError('');
                    setInviteNotice('');
                    setInviteEmailFailed(false);
                    setGeneratedInviteId('');
                  }}
                  placeholder="driver@example.com"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-violet-500"
                />
                <button
                  type="submit"
                  disabled={isSendingInvite}
                  className="flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 font-extrabold text-white hover:bg-violet-800 disabled:cursor-wait disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {isSendingInvite ? 'Generating...' : 'Generate link'}
                </button>
              </div>
              {inviteError && <p role="alert" className="text-[11px] font-semibold text-rose-700">{inviteError}</p>}
              {inviteNotice && (
                <p
                  role={inviteEmailFailed ? 'alert' : 'status'}
                  className={`text-[11px] font-semibold ${inviteEmailFailed ? 'text-rose-700' : 'text-emerald-700'}`}
                >
                  {inviteNotice}
                </p>
              )}
            </form>

            {generatedInvite && (
              <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50 p-3.5">
                <div>
                  <p className="font-extrabold text-violet-950">Driver application link ready</p>
                  <p className="mt-1 text-[10px] text-violet-800">
                    {generatedInvite.email
                      ? `This link is reserved for ${generatedInvite.email}.`
                      : 'Share this link with your driver. They will enter their own email address.'}
                  </p>
                </div>
                <div className="break-all rounded-lg border border-violet-100 bg-white p-2.5 font-mono text-[10px] text-slate-600">
                  {getInviteApplicationUrl(generatedInvite)}
                </div>
                <button
                  type="button"
                  onClick={() => copyInviteLinkToClipboard(generatedInvite.token)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-white py-2.5 font-bold text-violet-800 hover:bg-violet-100"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedLink ? 'Copied' : 'Copy application link'}
                </button>
              </div>
            )}

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Recent invitations</span>
              {invites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                  <div>
                    <span className="block truncate font-bold text-slate-800">{inv.email || 'Legacy invitation'}</span>
                    <span className="text-[9px] text-slate-500">
                      {inv.status === 'REGISTERED' ? 'Application completed' : 'Link created · awaiting application'}
                    </span>
                  </div>
                  {inv.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => {
                        setGeneratedInviteId(inv.id);
                        setInviteEmail(inv.email);
                      }}
                      className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-bold text-violet-800 hover:bg-violet-50"
                    >
                      View link
                    </button>
                  )}
                </div>
              ))}
              {invites.length === 0 && <p className="text-[10px] text-slate-500">Invitations you create will appear here.</p>}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: ADD STOP MANUALLY --- */}
      {showAddStopModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs shadow-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>Add Stop Manually</span>
              </h3>
              <button onClick={() => setShowAddStopModal(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Pickup Address</label>
                <AddressAutocomplete
                  value={newStopForm.pickupAddress}
                  onChange={pickupAddress => setNewStopForm(previous => ({
                    ...previous,
                    pickupAddress,
                    pickupLat: null,
                    pickupLng: null
                  }))}
                  onSelect={(pickupAddress, location) => {
                    setNewStopForm(previous => ({ ...previous, pickupAddress, pickupLat: location.lat, pickupLng: location.lng }));
                    setRouteOrigins(previous => ({ ...previous, [currentUser.id]: pickupAddress }));
                    setRouteOriginCoordinates(previous => ({ ...previous, [currentUser.id]: location }));
                  }}
                  placeholder="Search and select the package pickup location"
                  inputClassName="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Receiver Name</label>
                <input
                  type="text"
                  value={newStopForm.name}
                  onChange={(e) => setNewStopForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Jane Doe"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Receiver Phone Number</label>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={newStopForm.receiverPhone}
                  onChange={(e) => setNewStopForm(prev => ({ ...prev, receiverPhone: e.target.value }))}
                  placeholder="e.g. +234 801 234 5678"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Delivery Address</label>
                <AddressAutocomplete
                  value={newStopForm.address}
                  onChange={(address) => setNewStopForm(prev => ({ ...prev, address, lat: null, lng: null }))}
                  onSelect={(address, location) =>
                    setNewStopForm(prev => ({ ...prev, address, ...location }))
                  }
                  placeholder="Type the full delivery address here before navigating..."
                  inputClassName="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
                <p className="mt-1 text-[9px] text-slate-500">
                  Select a suggestion to save its map location for closest-to-farthest sorting.
                </p>
              </div>

              {currentUser.role === 'ADMIN' && (
                <section className="rounded-xl border border-slate-700 bg-slate-950 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-slate-200">Nearby available riders</h4>
                      <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
                        Live candidates are ranked from the selected pickup. Only available drivers with a fresh location and no active route are shown.
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select
                      aria-label="Filter available riders by zone"
                      value={riderDiscoveryZone}
                      onChange={event => setRiderDiscoveryZone(event.target.value)}
                      className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-200"
                    >
                      <option value="ALL">All zones</option>
                      {[...new Set([...driversList, ...dispatchMapRiders]
                        .map(driver => String(driver.zone || '').trim())
                        .filter(Boolean))]
                        .sort((left, right) => left.localeCompare(right))
                        .map(zone => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                    <select
                      aria-label="Sort drivers by distance from pickup"
                      value={riderDistanceSort}
                      onChange={event => setRiderDistanceSort(event.target.value)}
                      className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-200"
                    >
                      <option value="NEAREST">Closest first</option>
                      <option value="FARTHEST">Farthest first</option>
                    </select>
                  </div>
                  {nearbyAvailableRiders.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {nearbyAvailableRiders.map((rider, index) => (
                        <article key={rider.id} className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-bold text-slate-100">
                                <span className="mr-1 text-emerald-300">#{index + 1}</span>{rider.name}
                              </p>
                              <p className="truncate text-[9px] text-slate-400">
                                {rider.vehicle || 'Vehicle not listed'} · {rider.zone || 'Zone not listed'}
                              </p>
                            </div>
                            <p className="shrink-0 text-right text-[9px] font-semibold text-emerald-300">
                              {rider.distanceKm.toFixed(1)} km · ~{rider.etaMinutes} min
                            </p>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setNewStopForm(previous => ({ ...previous, assignedDriverId: rider.id }));
                                setDriverNameQuery(rider.name);
                              }}
                              className="flex-1 rounded-lg bg-emerald-500/15 px-2 py-1.5 text-[9px] font-bold text-emerald-300 hover:bg-emerald-500/25"
                            >
                              Select rider
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveDriverId(rider.id);
                                setSelectedStopId(null);
                                setShowAddStopModal(false);
                                setShowCandidateMap(true);
                                setMapExpanded(true);
                              }}
                              className="rounded-lg border border-slate-700 px-2 py-1.5 text-[9px] font-bold text-slate-300 hover:bg-slate-800"
                            >
                              Show on map
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg bg-slate-900 p-2.5 text-[10px] text-slate-400">
                      {Number.isFinite(newStopForm.pickupLat) && Number.isFinite(newStopForm.pickupLng)
                        ? 'No nearby drivers match this zone. Drivers must be available and sharing a location updated within the last 90 seconds.'
                        : 'Select the pickup address from the suggestions to search and rank drivers by distance.'}
                    </p>
                  )}
                  <p className="mt-2 text-[9px] text-slate-500">
                    Map pins are numbered in the same order as this list. Distance is straight-line; arrival time is an estimate, not a routed ETA.
                  </p>
                </section>
              )}

              {currentUser.role === 'ADMIN' && (
                <div className="relative">
                  <label htmlFor="stop-driver-search" className="mb-1 block font-semibold text-slate-400">
                    Preferred driver (optional)
                  </label>
                  <input
                    id="stop-driver-search"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isDriverSuggestionOpen}
                    aria-controls="stop-driver-suggestions"
                    value={driverNameQuery}
                    onFocus={() => setIsDriverSuggestionOpen(true)}
                    onBlur={() => window.setTimeout(() => setIsDriverSuggestionOpen(false), 150)}
                    onChange={event => {
                      setDriverNameQuery(event.target.value);
                      setNewStopForm(prev => ({ ...prev, assignedDriverId: '' }));
                      setIsDriverSuggestionOpen(true);
                    }}
                    placeholder="Type a driver's name"
                    autoComplete="off"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                  {isDriverSuggestionOpen && (
                    <div
                      id="stop-driver-suggestions"
                      role="listbox"
                      className="absolute z-30 mt-1 max-h-40 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl"
                    >
                      {driverSuggestions.length > 0 ? driverSuggestions.map(driver => (
                        <button
                          key={driver.id}
                          type="button"
                          role="option"
                          aria-selected={newStopForm.assignedDriverId === driver.id}
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => {
                            setNewStopForm(prev => ({ ...prev, assignedDriverId: driver.id }));
                            setDriverNameQuery(driver.name);
                            setIsDriverSuggestionOpen(false);
                          }}
                          className="block w-full border-b border-slate-800 px-3 py-2 text-left last:border-0 hover:bg-slate-800"
                        >
                          <span className="block text-slate-200">{driver.name}</span>
                          <span className="block text-[10px] text-slate-500">{driver.zone || driver.email}</span>
                        </button>
                      )) : (
                        <p className="px-3 py-2 text-[10px] text-slate-400">
                          {driversList.length ? 'No matching drivers found.' : 'No drivers are registered yet.'}
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-[9px] text-slate-500">
                    {newStopForm.assignedDriverId
                      ? 'The selected driver receives an offer and must accept before assignment.'
                      : 'Leave empty to offer this delivery to all eligible nearby drivers.'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Priority</label>
                  <select
                    value={newStopForm.priority}
                    onChange={(e) => setNewStopForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Packages</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={newStopForm.packages}
                    onChange={(e) => setNewStopForm(prev => ({
                      ...prev,
                      packages: e.target.value === '' ? '' : Number(e.target.value)
                    }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Latest delivery time</label>
                <input
                  type="datetime-local"
                  value={newStopForm.deadlineAt}
                  onChange={event => setNewStopForm(previous => ({ ...previous, deadlineAt: event.target.value }))}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[9px] text-slate-500">
                  A deadline is required before this delivery can be grouped with other orders.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Package description</label>
                  <input
                    type="text"
                    maxLength={160}
                    value={newStopForm.packageDescription}
                    onChange={event => setNewStopForm(previous => ({ ...previous, packageDescription: event.target.value }))}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Package size</label>
                  <select
                    value={newStopForm.packageSize}
                    onChange={event => setNewStopForm(previous => ({ ...previous, packageSize: event.target.value }))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">Not specified</option>
                    <option value="SMALL">Small</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LARGE">Large</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Weight (kg)</label>
                  <input
                    type="number"
                    min="0.1"
                    max="500"
                    step="0.1"
                    value={newStopForm.packageWeightKg}
                    onChange={event => setNewStopForm(previous => ({
                      ...previous,
                      packageWeightKg: event.target.value === '' ? '' : Number(event.target.value)
                    }))}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Proposed rider earnings (NGN)</label>
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="50"
                    value={newStopForm.riderEarningsNgn}
                    onChange={event => setNewStopForm(previous => ({
                      ...previous,
                      riderEarningsNgn: event.target.value === '' ? '' : Number(event.target.value)
                    }))}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {deliveryOfferError && (
                <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-[10px] font-semibold text-rose-200">
                  {deliveryOfferError}
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => createDeliveryStop(true)}
                  disabled={creatingDelivery
                    || !Number.isFinite(newStopForm.pickupLat)
                    || !Number.isFinite(newStopForm.pickupLng)
                    || !Number.isFinite(newStopForm.lat)
                    || !Number.isFinite(newStopForm.lng)}
                  className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingDelivery ? 'Saving and sending offers...' : newStopForm.assignedDriverId ? 'Save & send selected driver an offer' : 'Save & find nearby drivers'}
                 </button>

                <button
                  type="button"
                  onClick={() => {
                    const address = newStopForm.address.trim();
                    if (!address) return;
                    const origin = getNavigationOrigin();
                    window.open(openStreetMapDirectionsUrl([origin, address]), '_blank', 'noopener,noreferrer');
                  }}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl"
                >
                  Map It
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {currentUser && ['ADMIN', 'DRIVER'].includes(currentUser.role) && supportChatOpen && createPortal(
        <div className="fixed inset-0 z-[100000] flex items-end justify-end bg-slate-950/35 p-3 sm:items-center sm:justify-center sm:p-6" onClick={() => setSupportChatOpen(false)}>
          <div
            className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-violet-700 px-4 py-3 text-white">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-100">Support</p>
                <h3 className="text-base font-extrabold">Customer Care bot</h3>
              </div>
              <button type="button" onClick={() => setSupportChatOpen(false)} className="rounded-full border border-white/30 p-1.5 hover:bg-white/10" aria-label="Close support chat">
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto bg-slate-50 p-4">
              {activeSupportThread && (
                <DispatchCallControls
                  supportThreadId={activeSupportThread.id}
                  currentUserId={currentUser.id}
                  request={apiRequest}
                />
              )}
              {(activeSupportThread?.messages || []).map(message => (
                <div
                  key={message.id}
                  className={`flex ${message.sender === 'USER' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                      message.sender === 'USER'
                        ? 'bg-violet-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))}

              {(!activeSupportThread || !activeSupportThread.messages?.length) && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-[11px] text-slate-500">
                  Ask about login, route, tracking, or delivery issues. Every chat creates a Customer Care case automatically.
                </div>
              )}
            </div>

            <form onSubmit={sendSupportMessage} className="border-t border-slate-200 bg-white p-3">
              {supportError && <p className="mb-2 text-[10px] font-semibold text-rose-700">{supportError}</p>}
              <label htmlFor="support-chat-message" className="sr-only">Support message</label>
              <textarea
                id="support-chat-message"
                rows={3}
                value={supportDraft}
                onChange={event => setSupportDraft(event.target.value)}
                placeholder="Describe your issue..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-800 outline-none focus:border-violet-500"
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                  {activeSupportThread?.caseId ? `Case ${activeSupportThread.caseId}` : 'New case'}
                </span>
                <button
                  type="submit"
                  disabled={supportBusy}
                  className="rounded-xl bg-violet-700 px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-violet-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {supportBusy ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* --- MODAL 3: DELIVERY CONFIRMATION --- */}
      {podStop && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs shadow-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                <PenTool className="w-4 h-4 text-emerald-400" />
                <span>Confirm Delivery</span>
              </h3>
              <button onClick={() => setPodStop(null)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="font-bold text-slate-200">{podStop.name}</div>
              <div className="text-[10px] text-slate-400">{podStop.address}</div>
            </div>

            <div>
              <label htmlFor="delivery-customer-name" className="text-slate-400 font-semibold block mb-1">
                Customer Name <span className="text-rose-300">(required)</span>
              </label>
              <input
                id="delivery-customer-name"
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Name of the person receiving the delivery"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-400 font-semibold block mb-1">
                Customer Signature <span className="text-rose-300">(required)</span>
              </label>
              <p className="mb-1 text-[10px] text-slate-500">Ask the customer to sign in the box below.</p>
              <canvas
                ref={canvasRef}
                width={360}
                height={120}
                aria-label="Customer signature pad"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full h-28 bg-slate-950 border border-slate-800 rounded-xl cursor-crosshair touch-none"
              />
              <button
                type="button"
                onClick={() => {
                  const canvas = canvasRef.current;
                  const context = canvas?.getContext('2d');
                  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
                  setSignatureCaptured(false);
                  setPodError('');
                }}
                className="mt-1 text-[10px] font-semibold text-slate-400 hover:text-white"
              >
                Clear signature
              </button>
            </div>

            <div className="space-y-2">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCustomerPhoto}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold rounded-xl"
              >
                Take / Choose Delivery Photo
              </button>
              {customerPhoto && (
                <img
                  src={customerPhoto}
                  alt="Delivery proof"
                  className="max-h-40 w-full rounded-xl border border-slate-800 object-contain bg-slate-950"
                />
              )}
              {photoError && <p className="text-rose-300">{photoError}</p>}
            </div>

            <div>
              <label className="text-slate-400 font-semibold block mb-1">Driver Notes</label>
              <textarea
                value={driverNotes}
                onChange={(e) => setDriverNotes(e.target.value)}
                rows={3}
                placeholder="Delivery confirmation notes..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {podError && <p className="text-rose-300 font-semibold">{podError}</p>}

            <button
              onClick={confirmPODDelivery}
              disabled={podSaving}
              className="w-full py-3 bg-emerald-500 text-slate-950 font-bold rounded-xl hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 transition-all shadow-lg"
            >
              {podSaving ? 'Saving proof...' : 'Confirm delivery and save proof'}
            </button>
          </div>
        </div>
      )}

    </div>
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  return route === '#/super-admin'
    ? <SuperAdminDashboard />
    : <RoutePlannerApp />;
}