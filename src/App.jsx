import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MapPin, Navigation, Play, Pause, RotateCcw, CheckCircle2, XCircle, Clock,
  Package, Search, Plus, Trash2, Zap, Download,
  Layers, ChevronRight, Check, AlertCircle,
  Truck, Compass, Crosshair, ExternalLink, Radio, Signal,
  ChevronLeft, Target, UserCheck, Users, UserPlus,
  Shield, PenTool, Phone, Map, Send, RefreshCw, ArrowDownUp, Edit3,
  Copy, Link, LogOut, User, Building, QrCode, Smartphone,
  CheckCircle, ArrowRight, Eye, Key, Share2, Layers as LayersIcon
} from 'lucide-react';

// --- LOCAL STORAGE KEYS ---
const STORAGE_KEYS = {
  USERS: 'lagos_circuit_users',
  CURRENT_USER: 'lagos_circuit_current_user',
  INVITES: 'lagos_circuit_invites',
  STOPS: 'lagos_circuit_stops'
};

// --- DEMO INITIAL DATA ---
const DEMO_ORGANIZATION = "Lagos Express Logistics";

const DEMO_USERS = [
  {
    id: 'user_admin_1',
    email: 'admin@lagosexpress.com',
    password: 'password123',
    name: 'Chief Dispatcher Alabi',
    role: 'ADMIN',
    orgName: DEMO_ORGANIZATION,
    phone: '+234 801 999 8888'
  },
  {
    id: 'drv_1',
    email: 'tunde@lagosexpress.com',
    password: 'password123',
    name: 'Tunde Bakare',
    role: 'DRIVER',
    orgName: DEMO_ORGANIZATION,
    zone: 'Lekki / Victoria Island Corridor',
    vehicle: 'Toyota HiAce - KJA-482XY',
    phone: '+234 802 345 6789',
    status: 'ACTIVE',
    lat: 6.4474,
    lng: 3.4723,
    speed: 28
  },
  {
    id: 'drv_2',
    email: 'chidi@lagosexpress.com',
    password: 'password123',
    name: 'Chidi Okonkwo',
    role: 'DRIVER',
    orgName: DEMO_ORGANIZATION,
    zone: 'Mainland Express (Yaba / Surulere)',
    vehicle: 'Suzuki Mini Bus - LSR-912AB',
    phone: '+234 803 987 6543',
    status: 'ACTIVE',
    lat: 6.5095,
    lng: 3.3711,
    speed: 0
  },
  {
    id: 'drv_3',
    email: 'amina@lagosexpress.com',
    password: 'password123',
    name: 'Amina Bello',
    role: 'DRIVER',
    orgName: DEMO_ORGANIZATION,
    zone: 'Ikeja / Maryland Circuit',
    vehicle: 'Hyundai Van - APP-304ZZ',
    phone: '+234 811 222 3344',
    status: 'ACTIVE',
    lat: 6.6139,
    lng: 3.3582,
    speed: 42
  }
];

const DEMO_STOPS = [
  { id: 'l1', name: 'Ikeja City Mall (ICM)', address: 'Obafemi Awolowo Way, Ikeja', priority: 'HIGH', timeWindow: '08:30 - 10:30', duration: 15, packages: 5, phone: '+234 801 111 2222', notes: 'Deliver to loading bay at back', lat: 6.6139, lng: 3.3582, status: 'PENDING', assignedDriverId: 'drv_3' },
  { id: 'l2', name: 'Maryland Mall', address: 'Ikorodu Road, Maryland, Lagos', priority: 'NORMAL', timeWindow: '10:00 - 12:00', duration: 10, packages: 2, phone: '+234 802 222 3333', notes: 'Ground floor retail unit', lat: 6.5683, lng: 3.3688, status: 'PENDING', assignedDriverId: 'drv_3' },
  { id: 'l3', name: 'Yaba Tech Tech-Hub', address: 'Herbert Macaulay Way, Yaba', priority: 'URGENT', timeWindow: '09:00 - 11:30', duration: 20, packages: 4, phone: '+234 803 333 4444', notes: 'Urgent hardware delivery to 2nd floor', lat: 6.5095, lng: 3.3711, status: 'IN_TRANSIT', assignedDriverId: 'drv_2' },
  { id: 'l4', name: 'Ikoyi Golf Club & Residences', address: 'Alfred Rewane Rd, Ikoyi, Lagos', priority: 'NORMAL', timeWindow: '12:00 - 14:00', duration: 12, packages: 3, phone: '+234 804 444 5555', notes: 'Security check at main gate', lat: 6.4520, lng: 3.4280, status: 'PENDING', assignedDriverId: 'drv_1' },
  { id: 'l5', name: 'Eko Hotels & Suites VI', address: 'Adetokunbo Ademola St, VI', priority: 'HIGH', timeWindow: '13:00 - 15:30', duration: 15, packages: 6, phone: '+234 805 555 6666', notes: 'Call receptionist on arrival', lat: 6.4261, lng: 3.4302, status: 'PENDING', assignedDriverId: 'drv_1' },
  { id: 'l6', name: 'Lekki Phase 1 Plaza', address: 'Admiralty Way, Lekki Phase 1', priority: 'NORMAL', timeWindow: '14:30 - 17:00', duration: 10, packages: 2, phone: '+234 806 666 7777', notes: 'Drop off at customer desk', lat: 6.4474, lng: 3.4723, status: 'PENDING', assignedDriverId: 'drv_1' }
];

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

export default function App() {
  // --- AUTH & PERSISTENCE STATES ---
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    return saved ? JSON.parse(saved) : null;
  });

  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USERS);
    return saved ? JSON.parse(saved) : DEMO_USERS;
  });

  const [invites, setInvites] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.INVITES);
    return saved ? JSON.parse(saved) : [
      { id: 'inv_1', token: 'DRV-89A2', orgName: DEMO_ORGANIZATION, createdAt: 'Today', status: 'PENDING' }
    ];
  });

  const [stops, setStops] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.STOPS);
    return saved ? JSON.parse(saved) : DEMO_STOPS;
  });

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.INVITES, JSON.stringify(invites));
  }, [invites]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.STOPS, JSON.stringify(stops));
  }, [stops]);

  // Auth Form State
  const [authTab, setAuthTab] = useState('LOGIN'); // 'LOGIN' or 'REGISTER'
  const [authRole, setAuthRole] = useState('ADMIN'); // 'ADMIN' or 'DRIVER'
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    name: '', email: '', password: '', orgName: '', inviteToken: '', zone: '', vehicle: '', phone: ''
  });
  const [authError, setAuthError] = useState('');

  // Check URL parameters for invitation links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteParam = params.get('invite');
    if (inviteParam) {
      setAuthTab('REGISTER');
      setAuthRole('DRIVER');
      setRegisterForm(prev => ({ ...prev, inviteToken: inviteParam }));
    }
  }, []);

  // --- APP DASHBOARD STATES ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeDriverId, setActiveDriverId] = useState('drv_1');
  const [selectedStopId, setSelectedStopId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // GPS State
  const [isGpsActive, setIsGpsActive] = useState(false);
  const [gpsPos, setGpsPos] = useState({ lat: 6.5244, lng: 3.3792 });
  const [gpsSpeed, setGpsSpeed] = useState(0);
  const watchIdRef = useRef(null);

  // Modals
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddStopModal, setShowAddStopModal] = useState(false);
  const [podStop, setPodStop] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [newStopForm, setNewStopForm] = useState({
    name: '',
    address: '',
    priority: 'NORMAL',
    timeWindow: '10:00 - 13:00',
    packages: 1
  });
  const [routeOrigins, setRouteOrigins] = useState(() => {
    const saved = localStorage.getItem('lagos_circuit_route_origins');
    return saved ? JSON.parse(saved) : {};
  });
  const routeOriginAddress = currentUser ? routeOrigins[currentUser.id] || '' : '';
  const [customerName, setCustomerName] = useState('');
  const [customerPhoto, setCustomerPhoto] = useState('');
  const [podError, setPodError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [signatureCaptured, setSignatureCaptured] = useState(false);
  const DELIVERY_EMAIL = 'tobiayodele95@gmail.com';

  // Map DOM & Google Maps API Refs
  const mapContainerRef = useRef(null);
  const googleMapRef = useRef(null);
  const mapMarkersRef = useRef([]);
  const polylineRef = useRef(null);

  // Signature Pad Canvas
  const canvasRef = useRef(null);
  const [isSigning, setIsSigning] = useState(false);
  const [driverNotes, setDriverNotes] = useState('');
  const photoInputRef = useRef(null);

  // Depot Default
  const startDepot = { id: 'depot_1', name: 'Ikeja Central Depot', lat: 6.6018, lng: 3.3515 };

  // Current Active Driver List
  const driversList = useMemo(() => {
    return users.filter(u => u.role === 'DRIVER');
  }, [users]);

  // Current Selected Driver Object
  const selectedDriver = useMemo(() => {
    return driversList.find(d => d.id === activeDriverId) || driversList[0] || null;
  }, [driversList, activeDriverId]);

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

  // --- AUTHENTICATION LOGIC ---
  const handleLogin = (e) => {
    e.preventDefault();
    setAuthError('');
    const user = users.find(u => u.email.toLowerCase() === loginForm.email.toLowerCase() && u.password === loginForm.password);
    if (user) {
      setCurrentUser(user);
      if (user.role === 'DRIVER') setActiveDriverId(user.id);
    } else {
      setAuthError('Invalid email or password. Please try again.');
    }
  };

  const handleRegister = (e) => {
    e.preventDefault();
    setAuthError('');

    if (users.some(u => u.email.toLowerCase() === registerForm.email.toLowerCase())) {
      setAuthError('Account with this email already exists.');
      return;
    }

    let finalOrgName = registerForm.orgName;

    // Validate driver invitation token if provided
    if (authRole === 'DRIVER' && registerForm.inviteToken) {
      const foundInvite = invites.find(i => i.token === registerForm.inviteToken);
      if (foundInvite) {
        finalOrgName = foundInvite.orgName;
        // Mark invite as registered
        setInvites(prev => prev.map(i => i.token === registerForm.inviteToken ? { ...i, status: 'REGISTERED' } : i));
      } else {
        setAuthError('Invalid or expired invitation token.');
        return;
      }
    }

    const newUser = {
      id: `usr_${Date.now()}`,
      email: registerForm.email,
      password: registerForm.password,
      name: registerForm.name,
      role: authRole,
      orgName: finalOrgName || 'Lagos Delivery Network',
      zone: registerForm.zone || 'Lagos Central Zone',
      vehicle: registerForm.vehicle || 'Logistics Bike / Van',
      phone: registerForm.phone || '+234 800 000 0000',
      status: 'ACTIVE',
      lat: 6.5244,
      lng: 3.3792,
      speed: 0
    };

    setUsers(prev => [...prev, newUser]);
    setCurrentUser(newUser);
    if (newUser.role === 'DRIVER') setActiveDriverId(newUser.id);
  };

  const loadDemoFleet = () => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(DEMO_USERS));
    localStorage.setItem(STORAGE_KEYS.STOPS, JSON.stringify(DEMO_STOPS));
    setUsers(DEMO_USERS);
    setStops(DEMO_STOPS);
    setCurrentUser(DEMO_USERS[0]); // Log in as Chief Dispatcher Admin
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  };

  // --- GENERATE DRIVER INVITE LINK ---
  const handleGenerateInvite = () => {
    const token = `DRV-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const newInvite = {
      id: `inv_${Date.now()}`,
      token,
      orgName: currentUser?.orgName || DEMO_ORGANIZATION,
      createdAt: 'Just now',
      status: 'PENDING'
    };
    setInvites(prev => [newInvite, ...prev]);
  };

  const copyInviteLinkToClipboard = (token) => {
    const fullLink = `${window.location.origin}${window.location.pathname}?invite=${token}`;
    navigator.clipboard.writeText(fullLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  // --- "CLOSEST TO FARTHEST" ROUTE OPTIMIZATION ENGINE ---
  const optimizeClosestToFarthest = () => {
    const targetDriverId = currentUser?.role === 'DRIVER' ? currentUser.id : activeDriverId;
    const driverStops = stops.filter(s => s.assignedDriverId === targetDriverId);
    if (driverStops.length === 0) return;

    // Start point: Driver's live GPS if available, or selected driver's location, or depot
    const driverObj = users.find(u => u.id === targetDriverId);
    const startPoint = (isGpsActive && gpsPos) 
      ? gpsPos 
      : (driverObj && driverObj.lat) 
        ? { lat: driverObj.lat, lng: driverObj.lng } 
        : { lat: startDepot.lat, lng: startDepot.lng };

    let unvisited = driverStops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    const addressOnlyStops = driverStops.filter(s => !Number.isFinite(s.lat) || !Number.isFinite(s.lng));
    let sortedStops = [];
    let currentPoint = startPoint;

    // Nearest Neighbor algorithm (Closest to Farthest)
    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = calcHaversineDistance(currentPoint.lat, currentPoint.lng, unvisited[0].lat, unvisited[0].lng);

      for (let i = 1; i < unvisited.length; i++) {
        const dist = calcHaversineDistance(currentPoint.lat, currentPoint.lng, unvisited[i].lat, unvisited[i].lng);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIdx = i;
        }
      }

      const nextStop = unvisited.splice(nearestIdx, 1)[0];
      sortedStops.push(nextStop);
      currentPoint = nextStop;
    }

    // Update stops state with new optimized order
    setStops(prevStops => {
      const otherDriverStops = prevStops.filter(s => s.assignedDriverId !== targetDriverId);
      return [...otherDriverStops, ...sortedStops, ...addressOnlyStops];
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
          setGpsPos(newPos);
          setGpsSpeed(speed ? Math.round(speed * 3.6) : 0);

          // Update current user's lat/lng in user roster for admin view
          if (currentUser) {
            setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, lat: latitude, lng: longitude, speed: speed ? Math.round(speed * 3.6) : 0 } : u));
          }
        },
        (err) => {
          console.error('GPS tracking error:', err);
          setIsGpsActive(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  };

  // --- GOOGLE MAPS DIRECT NAVIGATION ---
  const getNavigationOrigin = () => {
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

  const updateRouteOriginAddress = (address) => {
    if (!currentUser) return;
    setRouteOrigins(prev => ({ ...prev, [currentUser.id]: address }));
  };

  const setRouteOriginToGps = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => updateRouteOriginAddress(`${coords.latitude},${coords.longitude}`),
      (error) => {
        console.error('Unable to get starting location:', error);
        alert('Could not get your location. Allow location access or type a starting address.');
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
    const totalStops = Math.min(activeDriverStops.length, 5);
    const routeStops = activeDriverStops.slice(0, totalStops);
    const destinationStop = routeStops[routeStops.length - 1];
    const waypoints = routeStops.length > 1 ? routeStops.slice(0, -1) : [];

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
    ctx.strokeStyle = '#10b981';
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
  }, [startDepot, activeDriverStops]);

  // =========================================================================
  // RENDER SCREEN 1: AUTHENTICATION & LOGIN / REGISTRATION
  // =========================================================================
  if (!currentUser) {
    return (
      <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans select-none">
        <div className="max-h-[90dvh] w-full max-w-lg space-y-6 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-8">
          
          {/* LOGO & TITLE */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center p-3 bg-emerald-500 rounded-2xl text-slate-950 font-black shadow-lg shadow-emerald-500/20 mb-1">
              <Compass className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">Lagos Circuit Route Planner</h1>
            <p className="text-xs text-slate-400 font-medium">Enterprise Driver Dispatch & Real-Time Logistics Platform</p>
          </div>

          {/* QUICK DEMO LOGIN BANNER */}
          <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div className="text-xs">
              <span className="font-bold text-amber-400 block">Want a quick live test drive?</span>
              <span className="text-[10px] text-slate-400">Loads Lagos drivers, presets & dispatch routes.</span>
            </div>
            <button
              onClick={loadDemoFleet}
              className="py-1.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Load Demo Fleet</span>
            </button>
          </div>

          {/* LOGIN vs REGISTER TAB SWITCHER */}
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

          {authError && (
            <div className="p-3 bg-rose-500/20 border border-rose-500/50 rounded-xl text-xs text-rose-300 font-semibold flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{authError}</span>
            </div>
          )}

          {/* TAB 1: LOGIN FORM */}
          {authTab === 'LOGIN' && (
            <form onSubmit={handleLogin} className="space-y-4 text-xs">
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

              <button
                type="submit"
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20"
              >
                Log In to Circuit Platform
              </button>
            </form>
          )}

          {/* TAB 2: REGISTER FORM */}
          {authTab === 'REGISTER' && (
            <form onSubmit={handleRegister} className="space-y-3 text-xs">
              
              {/* ROLE SELECTOR */}
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
                    placeholder="••••••••"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* ADMIN REGISTRATION: ORGANIZATION NAME */}
              {authRole === 'ADMIN' ? (
                <div>
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
                /* DRIVER REGISTRATION: INVITE TOKEN & VEHICLE DETAILS */
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Driver Invitation Token (Optional if invited)</label>
                    <input
                      type="text"
                      placeholder="e.g. DRV-89A2"
                      value={registerForm.inviteToken}
                      onChange={(e) => setRegisterForm({ ...registerForm, inviteToken: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-amber-400 font-mono font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>

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
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20"
              >
                Create {authRole === 'ADMIN' ? 'Dispatcher Admin' : 'Driver'} Account
              </button>
            </form>
          )}

        </div>
      </div>
    );
  }

  // =========================================================================
  // MAIN APP INTERFACE (LOGGED IN STATE)
  // =========================================================================
  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-y-auto bg-slate-950 font-sans text-slate-100 select-none md:flex-row md:overflow-hidden">

      {/* --- SIDEBAR PANEL (~25% WIDTH) --- */}
      <div className={`z-20 flex max-h-[55dvh] w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900 shadow-2xl transition-all duration-300 md:h-full md:max-h-none md:border-b-0 md:border-r ${
        sidebarCollapsed ? 'md:w-16' : 'md:w-80 md:max-w-[24rem]'
      }`}>

        {/* SIDEBAR HEADER */}
        <div className="p-3.5 border-b border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center space-x-2 min-w-0">
                <div className="p-2 bg-emerald-500 rounded-xl text-slate-950 font-black shadow-lg">
                  <Compass className="w-5 h-5" />
                </div>
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
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">

            {/* ADMIN FLEET SELECTION WORKFLOW */}
            {currentUser.role === 'ADMIN' ? (
              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <span>Step 1: Select Driver Fleet</span>
                  <Users className="w-3.5 h-3.5 text-emerald-400" />
                </div>

                <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto">
                  {driversList.map(d => {
                    const isSelected = d.id === activeDriverId;
                    const stopCount = stops.filter(s => s.assignedDriverId === d.id).length;

                    return (
                      <button
                        key={d.id}
                        onClick={() => setActiveDriverId(d.id)}
                        className={`w-full p-2 rounded-lg text-left transition-all flex items-center justify-between border ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="text-xs truncate">{d.name}</div>
                          <div className="text-[9px] text-slate-500 truncate">{d.zone}</div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                          isSelected ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {stopCount} stops
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* DRIVER ROLE DASHBOARD GPS BANNER */
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
                  <span className="flex items-center space-x-1">
                    <Radio className="w-4 h-4 animate-pulse" />
                    <span>Driver Live GPS Broadcast</span>
                  </span>
                  <span className="text-[10px] font-mono">{gpsSpeed} km/h</span>
                </div>
                <button
                  onClick={toggleGpsBroadcast}
                  className={`w-full py-2 rounded-xl text-xs font-extrabold flex items-center justify-center space-x-1.5 transition-all shadow-md ${
                    isGpsActive ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-slate-950'
                  }`}
                >
                  <Signal className="w-3.5 h-3.5" />
                  <span>{isGpsActive ? 'Stop Live GPS Broadcast' : 'Broadcast Live GPS Location'}</span>
                </button>
              </div>
            )}

            {/* ROUTE ACTIONS: ADD STOP MANUALLY & OPTIMIZE */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowAddStopModal(true)}
                  className="py-2.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-1 transition-all"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Add Stop Manually</span>
                </button>

                <button
                  onClick={optimizeClosestToFarthest}
                  className="py-2.5 px-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center space-x-1 transition-all"
                >
                  <ArrowDownUp className="w-4 h-4 stroke-[3]" />
                  <span>Closest to Farthest</span>
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-400">Starting location (optional)</label>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    value={routeOriginAddress}
                    onChange={(e) => updateRouteOriginAddress(e.target.value)}
                    placeholder="Driver profile location or enter an address"
                    className="min-w-0 flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={setRouteOriginToGps}
                    className="shrink-0 py-2 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-[10px] rounded-xl"
                  >
                    Use GPS
                  </button>
                </div>
                <p className="text-[9px] text-slate-500">Leave blank to use the driver's saved location.</p>
              </div>

              {/* BATCH GOOGLE MAPS DIRECT LINK */}
              <button
                onClick={launchMultiStopGoogleNav}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                <span>Launch {Math.min(5, activeDriverStops.length)}-Stop Route in Google Maps App</span>
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

            {/* WAYPOINT LIST */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-semibold">
                <span>Waypoints ({activeDriverStops.length})</span>
                <span className="text-[10px] text-amber-400">Closest ➔ Farthest</span>
              </div>

              {activeDriverStops.length === 0 ? (
                <div className="p-4 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                  <MapPin className="w-6 h-6 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-500 font-medium">No stops assigned to this route yet.</p>
                  <button
                    onClick={() => setShowAddStopModal(true)}
                    className="text-xs text-emerald-400 font-bold hover:underline"
                  >
                    + Add first manual stop
                  </button>
                </div>
              ) : (
                activeDriverStops.map((stop, idx) => {
                  const isSelected = selectedStopId === stop.id;

                  return (
                    <div
                      key={stop.id}
                      onClick={() => setSelectedStopId(stop.id)}
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
                            className="py-1 px-2 bg-blue-600/20 border border-blue-500/40 hover:bg-blue-600/30 text-blue-400 font-bold text-[10px] rounded-lg flex items-center space-x-1"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>POD</span>
                          </button>
                        ) : (
                          <span className="py-1 px-2 bg-emerald-500/10 text-emerald-400 font-extrabold text-[9px] rounded flex items-center space-x-1">
                            <Check className="w-3 h-3" />
                            <span>Delivered</span>
                          </span>
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

      {/* --- WIDE MAP CANVAS DISPLAY (~75% WIDTH) --- */}
      <div className="relative flex min-h-[45dvh] flex-1 flex-col overflow-hidden bg-slate-950 md:min-h-0">

        {/* MAP TOP METRICS HEADER */}
        <div className="z-10 flex min-h-12 flex-wrap items-center justify-between gap-y-2 border-b border-slate-800/80 bg-slate-900/90 px-3 py-2 backdrop-blur-md sm:px-4">
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
            <div className="flex items-center space-x-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-mono font-bold text-emerald-400 sm:px-2.5 sm:text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Lagos Live Network</span>
            </div>
          </div>
        </div>

        {/* INTERACTIVE LEAFLET / OSM MAP CANVAS */}
        <div className="flex-1 relative w-full h-full">
          <iframe
            title="Lagos Nigeria Interactive Map Canvas"
            className="w-full h-full border-none filter brightness-90 contrast-125"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=3.25%2C6.40%2C3.65%2C6.65&layer=mapnik`}
          />

          {/* OVERLAY MAP DRIVER RADAR BEACON */}
          <div className="absolute right-2 top-2 z-20 max-h-[40%] w-[min(18rem,calc(100%-1rem))] space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-2.5 shadow-2xl backdrop-blur-md sm:right-4 sm:top-4 sm:p-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Live Radar Radar</span>
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            </div>

            <div className="space-y-1.5 text-xs">
              {driversList.map(d => (
                <div key={d.id} className="p-1.5 bg-slate-950 rounded-lg border border-slate-800/80 flex items-center justify-between">
                  <div className="truncate pr-2">
                    <span className="font-bold text-slate-200 block truncate">{d.name}</span>
                    <span className="text-[9px] text-slate-400 font-mono">{d.zone}</span>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-mono font-bold">
                    {d.speed || 24} km/h
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* --- MODAL 1: DRIVER INVITATION GENERATOR --- */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs shadow-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                <UserPlus className="w-4 h-4 text-blue-400" />
                <span>Invite Drivers to {currentUser.orgName}</span>
              </h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={handleGenerateInvite}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Generate New Driver Invite Token</span>
            </button>

            <div className="space-y-2 max-h-48 overflow-y-auto pt-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Active Invite Links</span>
              {invites.map(inv => (
                <div key={inv.id} className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-amber-400 text-xs block">{inv.token}</span>
                    <span className="text-[9px] text-slate-500">Status: {inv.status}</span>
                  </div>
                  <button
                    onClick={() => copyInviteLinkToClipboard(inv.token)}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg flex items-center space-x-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span className="text-[10px]">{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                </div>
              ))}
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
                <textarea
                  value={newStopForm.address}
                  onChange={(e) => setNewStopForm(prev => ({ ...prev, address: e.target.value }))}
                  rows={3}
                  placeholder="Type the full delivery address here before navigating..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

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
                      priority: newStopForm.priority,
                      timeWindow: newStopForm.timeWindow,
                      packages: newStopForm.packages,
                      status: 'PENDING',
                      assignedDriverId: currentUser.role === 'DRIVER' ? currentUser.id : activeDriverId
                    };

                    setStops(prev => [...prev, stopPayload]);
                    setNewStopForm({ name: '', address: '', priority: 'NORMAL', timeWindow: '10:00 - 13:00', packages: 1 });
                    setShowAddStopModal(false);
                  }}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl"
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

      {/* --- MODAL 3: PROOF OF DELIVERY (POD) --- */}
      {podStop && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs shadow-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-1.5">
                <PenTool className="w-4 h-4 text-emerald-400" />
                <span>Proof of Delivery (POD)</span>
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
              <label className="text-slate-400 font-semibold block mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Jane Smith"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-400 font-semibold block mb-1">Customer Digital Signature</label>
              <canvas
                ref={canvasRef}
                width={360}
                height={120}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full h-28 bg-slate-950 border border-slate-800 rounded-xl cursor-crosshair touch-none"
              />
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
              Confirm & Send to {DELIVERY_EMAIL}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}