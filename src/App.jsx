import React, { useState, useEffect, useRef, useMemo } from 'react';
import brandLogo from './assets/tobs-circuit-logo-purple.png';
import {
  MapPin, CheckCircle2, XCircle, Clock, Package, Search, Plus, Trash2,
  ChevronRight, Check, AlertCircle, Truck, ExternalLink, Radio,
  ChevronLeft, Target, UserCheck, Users, UserPlus, Shield, PenTool,
  Send, ArrowDownUp, Copy, LogOut, User, ArrowUp, ArrowDown
} from 'lucide-react';

const startDepot = { id: 'depot_1', name: 'Ikeja Central Depot', lat: 6.6018, lng: 3.3515 };

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
        const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Address lookup failed (${response.status}).`);
        const data = await response.json();
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
const IS_GITHUB_PAGES_DEMO = window.location.hostname === 'deeril.github.io';
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
    routeStatus: 'IN_PROGRESS'
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
    routeStatus: 'PENDING'
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
      address: 'Victoria Island, Lagos',
      lat: 6.4261,
      lng: 3.4302,
      status: 'PENDING',
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
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
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

export default function App() {
  // --- AUTH & PERSISTENCE STATES ---
  const invitationParams = new URLSearchParams(window.location.search);
  const invitationToken = invitationParams.get('invite') || '';
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
  const [showPasswordHelp, setShowPasswordHelp] = useState(false);
  const [passwordHelpEmail, setPasswordHelpEmail] = useState('');
  const [passwordHelpMessage, setPasswordHelpMessage] = useState('');
  const [registerOrgLogo, setRegisterOrgLogo] = useState('');
  const [logoError, setLogoError] = useState('');
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
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      try {
        const { user } = await apiRequest('/api/auth/session');
        if (!cancelled) {
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
    if (!currentUser?.id || isPreviewSession) return undefined;
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
    if (!currentUser?.id || !routeDataReady || isPreviewSession) return undefined;
    const timerId = window.setTimeout(() => {
      apiRequest('/api/stops', {
        method: 'PUT',
        body: JSON.stringify({ stops })
      }).catch(error => {
        console.error('Could not synchronize route stops with the fleet:', error);
        setAuthError(`Route changes could not be saved: ${error.message}`);
      });
    }, 250);
    return () => window.clearTimeout(timerId);
  }, [stops, routeDataReady, currentUser?.id, isPreviewSession]);

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
  const [mapExpanded, setMapExpanded] = useState(false);
  const [activeDriverId, setActiveDriverId] = useState('');
  const [selectedStopId, setSelectedStopId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // GPS State
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [gpsPos, setGpsPos] = useState({ lat: 6.5244, lng: 3.3792 });
  const [gpsSpeed, setGpsSpeed] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const lastLocationSyncRef = useRef(0);
  const watchIdRef = useRef(null);

  useEffect(() => {
    const timerId = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(timerId);
  }, []);

  // Modals
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddStopModal, setShowAddStopModal] = useState(false);
  const [podStop, setPodStop] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInviteId, setGeneratedInviteId] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [newStopForm, setNewStopForm] = useState({
    name: '',
    address: '',
    lat: null,
    lng: null,
    assignedDriverId: '',
    priority: 'NORMAL',
    timeWindow: '10:00 - 13:00',
    packages: 1
  });
  const [driverNameQuery, setDriverNameQuery] = useState('');
  const [isDriverSuggestionOpen, setIsDriverSuggestionOpen] = useState(false);
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
  const [photoError, setPhotoError] = useState('');
  const [signatureCaptured, setSignatureCaptured] = useState(false);
  const DELIVERY_EMAIL = 'tobiayodele95@gmail.com';

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
  const mapDriver = currentUser?.role === 'ADMIN' ? selectedDriver : currentUser;
  const mapDriverIsLive = Boolean(
    mapDriver?.isTracking &&
    mapDriver.locationUpdatedAt &&
    clockNow - new Date(mapDriver.locationUpdatedAt).getTime() < 90_000
  );
  const mapSearchQuery = mapDriverIsLive && Number.isFinite(mapDriver.lat) && Number.isFinite(mapDriver.lng)
    ? `${mapDriver.lat},${mapDriver.lng}`
    : mapStop && Number.isFinite(mapStop.lat) && Number.isFinite(mapStop.lng)
    ? `${mapStop.lat},${mapStop.lng}`
    : mapStop?.address || 'Lagos, Nigeria';
  const googleMapsEmbedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(mapSearchQuery)}&z=14&output=embed`;
  const googleMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapSearchQuery)}`;

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
    setCurrentUser(role === 'ADMIN' ? PREVIEW_ADMIN : PREVIEW_DRIVERS[0]);
  };

  const handleRegisterLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoError('');
    try {
      setRegisterOrgLogo(await resizeLogoImage(file));
    } catch (error) {
      setLogoError(error.message);
    }
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
      if (user.role === 'ADMIN' && registerOrgLogo) {
        saveOrganizationLogo(user.orgName, user.email, registerOrgLogo);
      }
      setCurrentUser(user);
      setRegisterOrgLogo('');
      setRegisterForm(prev => ({ ...prev, password: '' }));
      setAuthError('');
      if (user.role === 'DRIVER') setActiveDriverId(user.id);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const showPasswordRecoveryHelp = (event) => {
    event.preventDefault();
    setPasswordHelpMessage(
      'Password reset email is not available on this GitHub Pages demo. Contact your fleet administrator to recover access.'
    );
  };

  const handleLogout = async () => {
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
    setRouteDataReady(false);
    setIsPreviewSession(false);
    setAuthTab('LOGIN');
    setAuthRole('ADMIN');
  };

  const setDriverRouteStatus = async (driverId, routeStatus, routeStopCount) => {
    if (isPreviewSession) {
      const updatedUser = users.find(user => user.id === driverId);
      if (!updatedUser) return;
      const update = { routeStatus, routeStopCount, routeUpdatedAt: new Date(clockNow).toISOString() };
      setUsers(prev => prev.map(item => item.id === driverId ? { ...item, ...update } : item));
      if (currentUser?.id === driverId) setCurrentUser(prev => prev ? { ...prev, ...update } : prev);
      return;
    }

    try {
      const { user } = await apiRequest(`/api/users/${encodeURIComponent(driverId)}/route-status`, {
        method: 'PATCH',
        body: JSON.stringify({ routeStatus, routeStopCount })
      });
      setUsers(prev => prev.map(item => item.id === user.id ? user : item));
      if (currentUser?.id === user.id) setCurrentUser(user);
    } catch (error) {
      console.error('Could not update the driver route status:', error);
      window.alert(`Route status could not be updated: ${error.message}`);
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
    if (currentUser?.role === 'ADMIN' && stop.assignedDriverId) {
      const remainingCount = Math.max(0, stops.filter(item => item.assignedDriverId === stop.assignedDriverId).length - 1);
      setDriverRouteStatus(stop.assignedDriverId, remainingCount ? 'PENDING' : 'IDLE', remainingCount);
    }
    if (selectedStopId === stop.id) setSelectedStopId(null);
    if (podStop?.id === stop.id) setPodStop(null);
  };

  const focusStopOnMap = (stop) => {
    setSelectedStopId(stop.id);
    setMapExpanded(true);
  };

  const openAddStopModal = () => {
    const assignedDriverId = currentUser.role === 'DRIVER' ? currentUser.id : activeDriverId;
    const assignedDriver = driversList.find(driver => driver.id === assignedDriverId);
    setNewStopForm(prev => ({ ...prev, assignedDriverId }));
    setDriverNameQuery(assignedDriver?.name || '');
    setIsDriverSuggestionOpen(false);
    setShowAddStopModal(true);
  };

  const handleGenerateInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    setInviteError('');
    if (IS_GITHUB_PAGES_DEMO || isPreviewSession) {
      setInviteError('Driver invitation emails need the fleet email service, which is not available in this static preview.');
      return;
    }
    if (!email) {
      setInviteError('Enter the driver’s email address first.');
      return;
    }
    setIsSendingInvite(true);
    try {
      const { invite } = await apiRequest('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      setInvites(prev => [invite, ...prev.filter(item => item.email !== invite.email)]);
      setGeneratedInviteId(invite.id);
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
      setIsGpsActive(false);
      if (currentUser) {
        setCurrentUser(prev => prev ? { ...prev, isTracking: false, speed: 0 } : prev);
        setUsers(prev => prev.map(user => user.id === currentUser.id
          ? { ...user, isTracking: false, speed: 0 }
          : user));
        if (!isPreviewSession) {
          apiRequest('/api/users/me/location', {
            method: 'PATCH',
            body: JSON.stringify({ isTracking: false })
          }).catch(error => {
            console.error('Could not stop sharing the live location:', error);
            setAuthError(`Location sharing could not be stopped on the server: ${error.message}`);
          });
        }
      }
    } else {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }

      setIsGpsActive(true);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, speed } = pos.coords;
          const newPos = { lat: latitude, lng: longitude };
          const speedKph = speed ? Math.round(speed * 3.6) : 0;
          const locationUpdatedAt = new Date().toISOString();
          setGpsPos(newPos);
          setGpsSpeed(speedKph);

          if (currentUser) {
            const location = {
              lat: latitude,
              lng: longitude,
              speed: speedKph,
              isTracking: true,
              locationUpdatedAt
            };
            setCurrentUser(prev => prev ? { ...prev, ...location } : prev);
            setUsers(prev => prev.map(user => user.id === currentUser.id ? { ...user, ...location } : user));
            if (!isPreviewSession && Date.now() - lastLocationSyncRef.current >= 5000) {
              lastLocationSyncRef.current = Date.now();
              apiRequest('/api/users/me/location', {
                method: 'PATCH',
                body: JSON.stringify({
                  lat: latitude,
                  lng: longitude,
                  speed: speedKph,
                  isTracking: true
                })
              }).catch(error => {
                console.error('Could not share the driver location with dispatch:', error);
                setAuthError(`Live location could not be synchronized: ${error.message}`);
              });
            }
          }
        },
        (err) => {
          console.error('GPS tracking error:', err);
          setIsGpsActive(false);
          if (currentUser && !isPreviewSession) {
            apiRequest('/api/users/me/location', {
              method: 'PATCH',
              body: JSON.stringify({ isTracking: false })
            }).catch(error => console.error('Could not clear the driver live-location status:', error));
          }
          window.alert(`Live location could not be shared: ${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  };

  // --- GOOGLE MAPS DIRECT NAVIGATION ---
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
          const response = await fetch(`https://photon.komoot.io/reverse?${params}`);
          if (!response.ok) throw new Error(`Reverse geocoding failed (${response.status}).`);
          const data = await response.json();
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

  const launchSingleStopGoogleNav = (stop, e) => {
    if (e) e.stopPropagation();
    const origin = getNavigationOrigin();
    const destination = getStopDestination(stop);
    const mapsUrl = new URL('https://www.google.com/maps/dir/');
    mapsUrl.searchParams.set('api', '1');
    mapsUrl.searchParams.set('origin', origin);
    mapsUrl.searchParams.set('destination', destination);
    mapsUrl.searchParams.set('travelmode', 'driving');
    window.open(mapsUrl.toString(), '_blank');
  };

  const launchMultiStopGoogleNav = () => {
    if (activeDriverStops.length === 0) return;

    const origin = getNavigationOrigin();
    const routeStops = activeDriverStops.slice(0, 10);
    const destinationStop = routeStops[routeStops.length - 1];
    const waypoints = routeStops.slice(0, -1);

    const mapsUrl = new URL('https://www.google.com/maps/dir/');
    mapsUrl.searchParams.set('api', '1');
    mapsUrl.searchParams.set('origin', origin);
    mapsUrl.searchParams.set('destination', getStopDestination(destinationStop));
    if (waypoints.length > 0) {
      mapsUrl.searchParams.set('waypoints', waypoints.map(getStopDestination).join('|'));
    }
    mapsUrl.searchParams.set('travelmode', 'driving');

    window.open(mapsUrl.toString(), '_blank');
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

  const confirmPODDelivery = () => {
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
      driverNotes,
      customerName: customerName.trim(),
      customerSignature: signatureData,
      customerPhoto,
      deliveredAt: new Date().toISOString(),
      deliveryEmail: DELIVERY_EMAIL
    };

    setStops(prev => prev.map(s => s.id === podStop.id ? { ...s, ...deliveryPayload } : s));

    const body = encodeURIComponent(
      `Delivery Confirmation\n\nCustomer: ${customerName.trim()}\nAddress: ${podStop.address}\nLocation: ${podStop.name}\nDriver notes: ${driverNotes || 'None'}\nDelivered at: ${new Date().toLocaleString()}\n\nCustomer signature${customerPhoto ? ' and delivery photo are' : ' is'} saved in the app.`
    );

    const mailtoUrl = `mailto:${DELIVERY_EMAIL}?subject=${encodeURIComponent('Proof of Delivery - ' + podStop.name)}&body=${body}`;
    window.location.href = mailtoUrl;

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
    if (targetDriverId) {
      setDriverRouteStatus(targetDriverId, 'IDLE', 0);
    }
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
      <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans select-none">
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

          {/* TAB 1: LOGIN FORM */}
          {!invitationToken && authTab === 'LOGIN' && (
            <form onSubmit={showPasswordHelp ? showPasswordRecoveryHelp : handleLogin} className="space-y-4 text-xs">
              {showPasswordHelp ? (
                <>
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
                  {passwordHelpMessage && (
                    <p role="status" className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-relaxed text-violet-900">
                      {passwordHelpMessage}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-violet-700 py-3 text-sm font-black text-white hover:bg-violet-800"
                  >
                    Password recovery help
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordHelp(false);
                      setPasswordHelpMessage('');
                      setAuthError('');
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
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
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
                    readOnly={authRole === 'DRIVER' && Boolean(registerForm.inviteToken)}
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Password</label>
                  <input
                    type="password"
                    required
                    minLength={12}
                    placeholder="••••••••"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
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
                  <label className="block text-slate-400 font-semibold">
                    Fleet logo (optional; saved in this browser)
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleRegisterLogoChange}
                      className="mt-1 block w-full text-[10px] text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-100 file:px-3 file:py-2 file:font-bold file:text-violet-800"
                    />
                  </label>
                  {registerOrgLogo && (
                    <img src={registerOrgLogo} alt="Fleet logo preview" className="h-16 max-w-36 object-contain" />
                  )}
                  {logoError && <p role="alert" className="text-[10px] text-rose-700">{logoError}</p>}
                </div>
              ) : (
                /* DRIVER REGISTRATION: INVITE DETAILS & VEHICLE */
                <div className="space-y-2">
                  <p className="rounded-xl border border-violet-200 bg-violet-50 p-2.5 text-[10px] leading-relaxed text-violet-900">
                    Driver applications require a valid personal link sent to your invited email address.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Operating Zone (e.g. Lekki / VI)"
                      value={registerForm.zone}
                      onChange={(e) => setRegisterForm({ ...registerForm, zone: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Vehicle / Plate Number"
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

          {IS_GITHUB_PAGES_DEMO && !invitationToken && (
            <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50 p-3">
              <p className="text-[10px] font-bold text-violet-950">Open a sample dashboard</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => startPreviewSession('ADMIN')}
                  className="rounded-xl bg-violet-700 px-3 py-2.5 text-[10px] font-extrabold text-white hover:bg-violet-800"
                >
                  Preview admin
                </button>
                <button
                  type="button"
                  onClick={() => startPreviewSession('DRIVER')}
                  className="rounded-xl border border-violet-300 bg-white px-3 py-2.5 text-[10px] font-extrabold text-violet-900 hover:bg-violet-100"
                >
                  Preview rider
                </button>
              </div>
              <p className="text-[9px] leading-relaxed text-violet-900">
                Preview accounts are not secure and do not send email or share location across devices.
              </p>
            </div>
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

  // =========================================================================
  // MAIN APP INTERFACE (LOGGED IN STATE)
  // =========================================================================
  return (
    <>
    {brandSplash}
    <div className={`app-shell ${currentUser.role === 'ADMIN' ? 'admin-dashboard' : 'driver-dashboard'} flex h-dvh min-h-0 w-full flex-col overflow-y-auto bg-slate-950 font-sans text-slate-100 select-none md:flex-row md:overflow-hidden`}>

      {/* --- SIDEBAR PANEL (~25% WIDTH) --- */}
      <div className={`admin-dashboard-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''} z-20 flex max-h-[55dvh] w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900 shadow-2xl transition-all duration-300 md:h-full md:max-h-none md:border-b-0 md:border-r ${
        sidebarCollapsed ? 'md:w-16' : 'md:w-80 md:max-w-[24rem]'
      }`}>

        {/* SIDEBAR HEADER */}
        <div className="admin-sidebar-header p-3.5 border-b border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center space-x-2 min-w-0">
                <img
                  src={currentOrgLogo}
                  alt={`${currentUser.orgName || 'Fleet'} logo`}
                  className={`h-8 w-16 shrink-0 object-contain ${currentOrgLogo === BRAND_LOGO_URL ? 'brand-logo-image' : ''}`}
                />
                <div className="truncate">
                  <h1 className="font-black text-sm tracking-tight text-emerald-400 truncate">
                    {currentUser.orgName || 'Lagos Circuit'}
                  </h1>
                  <p className="text-[10px] font-bold text-slate-400 flex items-center space-x-1">
                    <User className="w-3 h-3 text-blue-400" />
                    <span>{currentUser.name} ({currentUser.role})</span>
                  </p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <img
                src={currentOrgLogo}
                alt={`${currentUser.orgName || 'Fleet'} logo`}
                className={`h-6 w-8 shrink-0 object-contain ${currentOrgLogo === BRAND_LOGO_URL ? 'brand-logo-image' : ''}`}
              />
            )}

            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-lg border bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
              {currentUser.role === 'ADMIN' && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="py-1 px-2.5 bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold text-[10px] rounded-lg flex items-center space-x-1 hover:bg-blue-600/30 transition-all"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite Drivers</span>
                </button>
              )}

              <button
                onClick={handleLogout}
                className="py-1 px-2.5 bg-rose-500/20 border border-rose-500/40 text-rose-400 font-bold text-[10px] rounded-lg flex items-center space-x-1 hover:bg-rose-500/30 transition-all ml-auto"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          )}
        </div>

        {/* SIDEBAR MAIN CONTROLS */}
        {!sidebarCollapsed && (
          <div className="admin-sidebar-controls flex-1 overflow-y-auto p-3.5 space-y-3">
            {isPreviewSession && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-[9px] leading-relaxed text-amber-950">
                Static preview: changes stay in this browser. Email, password reset and cross-device live tracking are disabled.
              </p>
            )}
            {currentUser.role === 'ADMIN' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveAdminView('ROUTES')}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-extrabold ${
                      activeAdminView === 'ROUTES'
                        ? 'border-violet-700 bg-violet-700 text-white'
                        : 'border-violet-200 bg-violet-50 text-violet-900'
                    }`}
                  >
                    Route dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminView('ANALYTICS')}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-extrabold ${
                      activeAdminView === 'ANALYTICS'
                        ? 'border-violet-700 bg-violet-700 text-white'
                        : 'border-violet-200 bg-violet-50 text-violet-900'
                    }`}
                  >
                    Fleet analytics
                  </button>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-2.5">
                  <label className="block text-[10px] font-bold text-violet-950">
                    Fleet logo (saved in this browser)
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleOrganizationLogoChange}
                      className="mt-1 block w-full text-[9px] text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-violet-700 file:px-2 file:py-1.5 file:font-bold file:text-white"
                    />
                  </label>
                  {logoUploadError && <p role="alert" className="mt-1 text-[9px] text-rose-700">{logoUploadError}</p>}
                </div>
              </>
            )}

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
              {stops.some(stop => !stop.assignedDriverId) && (
                <div className="rounded-xl border border-amber-500/30 bg-slate-950 p-2.5">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Unassigned Stops
                  </p>
                  <div className="space-y-1.5">
                    {stops.filter(stop => !stop.assignedDriverId).map(stop => (
                      <div key={stop.id} className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 p-2">
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
                          disabled={!activeDriverId}
                          onClick={() => {
                            setStops(prev => prev.map(item =>
                              item.id === stop.id ? { ...item, assignedDriverId: activeDriverId } : item
                            ));
                            setDriverRouteStatus(
                              activeDriverId,
                              'PENDING',
                              stops.filter(item => item.assignedDriverId === activeDriverId).length + 1
                            );
                          }}
                          className="rounded-md bg-emerald-500/15 px-2 py-1 text-[9px] font-bold text-emerald-300 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Assign
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
                    ))}
                  </div>
                </div>
              )}
              </>
            ) : (
              <div className="space-y-3">
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
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-violet-950">
                    <span className="flex items-center gap-1.5">
                      <Radio className={`h-4 w-4 ${isGpsActive ? 'animate-pulse text-violet-700' : 'text-slate-400'}`} />
                      <span>Live location</span>
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {isGpsActive ? `${gpsSpeed} km/h` : 'Not sharing'}
                    </span>
                  </div>
                  <button
                    onClick={toggleGpsBroadcast}
                    className={`w-full rounded-xl py-2.5 text-xs font-extrabold transition-all ${
                      isGpsActive ? 'bg-rose-50 text-rose-700' : 'bg-violet-700 text-white hover:bg-violet-800'
                    }`}
                  >
                    <span>{isGpsActive ? 'Stop sharing location' : 'Share live location'}</span>
                  </button>
                  <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                    Location is visible to dispatchers while sharing is on.
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

              {/* BATCH GOOGLE MAPS DIRECT LINK */}
              <button
                onClick={launchMultiStopGoogleNav}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Launch {Math.min(activeDriverStops.length, 10)}-Stop Route in Google Maps App
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
                          onClick={(e) => launchSingleStopGoogleNav(stop, e)}
                          className="flex-1 py-1 px-2 bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-400 font-bold text-[10px] rounded-lg flex items-center justify-center space-x-1 transition-all"
                        >
                          <Target className="w-3 h-3" />
                          <span>Google Nav</span>
                        </button>

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

      {currentUser.role === 'ADMIN' && activeAdminView === 'ANALYTICS' ? (
      <main className="flex min-h-[42dvh] flex-1 flex-col overflow-y-auto bg-violet-50 p-4 text-slate-950 sm:p-6 md:min-h-0 md:p-8">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-700">Admin dashboard</p>
              <h2 className="mt-1 text-2xl font-black text-violet-950">Fleet analytics</h2>
              <p className="mt-1 text-xs text-slate-600">Completed delivery stops across your fleet. Fuel and cash costs are not tracked.</p>
            </div>
            <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[10px] font-bold text-violet-800">
              Updated from recorded deliveries
            </span>
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
          ? 'fixed inset-0 z-50 h-dvh'
          : 'h-[42dvh] min-h-[280px] shrink-0 md:h-full md:min-h-0'
      }`}>

        {/* MAP TOP METRICS HEADER */}
        {mapExpanded && (
          <button
            type="button"
            onClick={() => setMapExpanded(false)}
            className="absolute left-3 top-14 z-30 flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs font-bold text-white shadow-xl hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back to route</span>
          </button>
        )}
        <div className="admin-map-toolbar z-10 flex min-h-12 flex-wrap items-center justify-between gap-y-2 border-b border-slate-800/80 bg-slate-900/90 px-3 py-2 backdrop-blur-md sm:px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:gap-x-5 sm:text-xs">
            <div className="flex items-center space-x-1.5">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-slate-200">
                {currentUser.role === 'ADMIN' ? selectedDriver?.name : currentUser.name}
              </span>
            </div>
            <div className="flex items-center space-x-1.5 font-mono text-slate-300">
              <Truck className="w-4 h-4 text-blue-400" />
              <span>{routeMetrics.totalKm} km</span>
            </div>
            <div className="flex items-center space-x-1.5 font-mono text-slate-300">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>{routeMetrics.hours}h {routeMetrics.mins}m</span>
            </div>
            <div className="flex items-center space-x-1 font-mono text-emerald-400">
              <span>{routeMetrics.completed}/{routeMetrics.total} Delivered</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <a
              href={googleMapsSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20 sm:text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Open in Google Maps</span>
            </a>
            <div className="flex items-center space-x-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-mono font-bold text-emerald-400 sm:px-2.5 sm:text-xs">
              <span className={`w-2 h-2 rounded-full ${mapDriverIsLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              <span>{mapDriverIsLive ? 'Driver live' : 'Location unavailable'}</span>
            </div>
          </div>
        </div>

        {/* Map follows the selected driver's next stop, or the selected stop. */}
        <div className="admin-map-canvas flex-1 relative w-full h-full">
          <iframe
            title={mapStop ? `Map for ${mapStop.name}` : 'Lagos, Nigeria map'}
            className="h-full w-full border-none"
            src={googleMapsEmbedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />

          {/* OVERLAY MAP DRIVER RADAR BEACON */}
          <div className="admin-driver-locations absolute right-2 top-2 z-20 max-h-[35%] w-[min(18rem,calc(100%-1rem))] space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-2.5 shadow-2xl backdrop-blur-md sm:right-4 sm:top-4 sm:p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Driver locations</span>
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            </div>

            <div className="space-y-1.5 text-xs">
              {driversList.map(d => (
                <div key={d.id} className="p-1.5 bg-slate-950 rounded-lg border border-slate-800/80 flex items-center justify-between">
                  <div className="truncate pr-2">
                    <span className="font-bold text-slate-200 block truncate">{d.name}</span>
                    <span className="text-[9px] text-slate-400 font-mono">{d.zone}</span>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                    d.isTracking && d.locationUpdatedAt && clockNow - new Date(d.locationUpdatedAt).getTime() < 90_000
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}>
                    {d.isTracking && d.locationUpdatedAt && clockNow - new Date(d.locationUpdatedAt).getTime() < 90_000
                      ? `${d.speed ?? 0} km/h`
                      : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
          </div>
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
                <p className="mt-1 text-[11px] text-slate-500">Send a secure driver application link for {currentUser.orgName}.</p>
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
              <label htmlFor="driver-invite-email" className="block font-bold text-slate-700">Driver email address</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="driver-invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={event => {
                    setInviteEmail(event.target.value);
                    setInviteError('');
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
                  {isSendingInvite ? 'Sending...' : 'Send link'}
                </button>
              </div>
              {inviteError && <p role="alert" className="text-[11px] font-semibold text-rose-700">{inviteError}</p>}
            </form>

            {generatedInvite && (
              <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50 p-3.5">
                <div>
                  <p className="font-extrabold text-violet-950">Application link sent</p>
                  <p className="mt-1 text-[10px] text-violet-800">An email with the personal link was sent to {generatedInvite.email}.</p>
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
                      {inv.status === 'REGISTERED' ? 'Application completed' : 'Email sent · awaiting application'}
                    </span>
                  </div>
                  {inv.status === 'PENDING' && inv.email && (
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
                <label className="block text-slate-400 mb-1 font-semibold">Stop Name</label>
                <input
                  type="text"
                  value={newStopForm.name}
                  onChange={(e) => setNewStopForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Island Business Plaza"
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
                <div className="relative">
                  <label htmlFor="stop-driver-search" className="mb-1 block font-semibold text-slate-400">
                    Assign to driver
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
                      ? 'This stop will be assigned to the selected driver.'
                      : 'Choose a driver from the suggestions to assign this stop.'}
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
                    value={newStopForm.packages}
                    onChange={(e) => setNewStopForm(prev => ({ ...prev, packages: Number(e.target.value) || 1 }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const address = newStopForm.address.trim();
                    if (!address) return;
                    const stopPayload = {
                      id: `l_${Date.now()}`,
                      name: newStopForm.name.trim() || address,
                      address,
                      lat: newStopForm.lat,
                      lng: newStopForm.lng,
                      priority: newStopForm.priority,
                      timeWindow: newStopForm.timeWindow,
                      packages: newStopForm.packages,
                      status: 'PENDING',
                      assignedDriverId: currentUser.role === 'DRIVER' ? currentUser.id : newStopForm.assignedDriverId
                    };

                    setStops(prev => [...prev, stopPayload]);
                    if (currentUser.role === 'ADMIN') {
                      setDriverRouteStatus(
                        stopPayload.assignedDriverId,
                        'PENDING',
                        stops.filter(item => item.assignedDriverId === stopPayload.assignedDriverId).length + 1
                      );
                    }
                    setNewStopForm({
                      name: '', address: '', lat: null, lng: null,
                      assignedDriverId: '',
                      priority: 'NORMAL', timeWindow: '10:00 - 13:00', packages: 1
                    });
                    setDriverNameQuery('');
                    setShowAddStopModal(false);
                  }}
                  disabled={currentUser.role === 'ADMIN' && !driversList.some(driver => driver.id === newStopForm.assignedDriverId)}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl"
                >
                  Save Address & Route
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const address = newStopForm.address.trim();
                    if (!address) return;
                    const origin = getNavigationOrigin();
                    const mapsUrl = new URL('https://www.google.com/maps/dir/');
                    mapsUrl.searchParams.set('api', '1');
                    mapsUrl.searchParams.set('origin', origin);
                    mapsUrl.searchParams.set('destination', address);
                    mapsUrl.searchParams.set('travelmode', 'driving');
                    window.open(mapsUrl.toString(), '_blank');
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
              className="w-full py-3 bg-emerald-500 text-slate-950 font-bold rounded-xl hover:bg-emerald-400 transition-all shadow-lg"
            >
              Confirm Delivery & Prepare Email
            </button>
          </div>
        </div>
      )}

    </div>
    </>
  );
}