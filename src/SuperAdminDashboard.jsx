import { useEffect, useMemo, useState } from 'react';
import brandLogo from './assets/tobs-circuit-logo-purple.png';
import {
  Activity,
  BadgeCheck,
  Bell,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Database,
  FileCheck2,
  FileClock,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Package,
  Search,
  Settings,
  Send,
  Shield,
  ShieldAlert,
  Truck,
  UserCog,
  Users
} from 'lucide-react';
import './SuperAdminDashboard.css';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const REFRESH_INTERVAL = 15_000;

const PLATFORM_NAV = [
  { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'BUSINESSES', label: 'Business Management', icon: Building2 },
  { id: 'DRIVERS', label: 'Driver Management', icon: Users },
  { id: 'APPLICATIONS', label: 'Applications', icon: ClipboardList },
  { id: 'VERIFICATION', label: 'Verification Centre', icon: FileCheck2 },
  { id: 'DELIVERIES', label: 'Delivery Management', icon: Package },
  { id: 'TRACKING', label: 'Live Tracking', icon: MapPin },
  { id: 'REPORTS', label: 'Reports & Analytics', icon: Activity },
  { id: 'FINANCIAL', label: 'Financial Management', icon: CreditCard },
  { id: 'SUPPORT', label: 'Support & Disputes', icon: MessageSquare },
  { id: 'NOTIFICATIONS', label: 'Notifications', icon: Bell },
  { id: 'PERMISSIONS', label: 'Admin & Permissions', icon: UserCog },
  { id: 'ACTIVITY', label: 'Activity Logs', icon: FileClock },
  { id: 'HEALTH', label: 'System Health', icon: HeartPulse },
  { id: 'SETTINGS', label: 'Platform Settings', icon: Settings }
];

async function superAdminRequest(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: API_BASE_URL ? 'include' : 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new Error(`Could not reach the platform API. Check the connection and deployment. ${error.message}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!contentType.includes('application/json')) {
    throw new Error('The platform API returned an unexpected response.');
  }
  return payload;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function StatusBadge({ value }) {
  const status = String(value || 'UNKNOWN').toUpperCase();
  const tone = ['ACTIVE', 'DELIVERED', 'REGISTERED', 'OPERATIONAL', 'IN_PROGRESS'].includes(status)
    ? 'good'
    : ['PENDING', 'IDLE', 'UNKNOWN'].includes(status)
      ? 'pending'
      : 'muted';
  return <span className={`sa-status sa-status-${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

function RecordsTable({ columns, rows, emptyMessage }) {
  return (
    <div className="sa-table-wrap">
      <table className="sa-table">
        <thead>
          <tr>{columns.map(column => <th key={column.label}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || `${row.email || row.name || row.label}-${index}`}>
              {columns.map(column => <td key={column.label}>{column.render(row)}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="sa-table-empty" colSpan={columns.length}>{emptyMessage}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Notice({ icon: Icon = ShieldAlert, children, tone = 'info' }) {
  return (
    <div className={`sa-notice sa-notice-${tone}`}>
      <Icon size={17} />
      <p>{children}</p>
    </div>
  );
}

function UnavailableSection({ title, children }) {
  return (
    <section className="sa-card sa-unavailable">
      <span className="sa-unavailable-icon"><ShieldAlert size={20} /></span>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
        <span className="sa-readonly">Not connected to an app data source</span>
      </div>
    </section>
  );
}

function OwnerSignIn({ onRequestCode, onVerifyCode, busy, error }) {
  const email = 'ayodeletobs@gmail.com';
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');

  const requestCode = async () => {
    try {
      const challenge = await onRequestCode(email, password);
      setChallengeId(challenge.challengeId);
      setCode('');
    } catch {
      return;
    }
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (challengeId) {
      await onVerifyCode(challengeId, code);
      return;
    }
    await requestCode();
  };

  return (
    <main className="sa-access-page">
      <form className="sa-access-card" onSubmit={handleSubmit}>
        <img src={brandLogo} alt="" />
        <span className="sa-eyebrow">PRIVATE PLATFORM ACCESS</span>
        <h1>{challengeId ? 'Verify your email' : 'Owner sign in'}</h1>
        <p>{challengeId
          ? 'Enter the one-time code sent to ayodeletobs@gmail.com. The code expires in 10 minutes.'
          : 'A one-time code will be sent to the registered owner email after your password is verified.'}</p>
        {!challengeId ? (
          <>
            <label>
              Registered owner email
              <input type="email" autoComplete="username" value={email} readOnly />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <label>
            Six-digit sign-in code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
        )}
        {error && <p className="sa-access-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy
          ? challengeId ? 'Verifying…' : 'Sending code…'
          : challengeId ? 'Verify and sign in' : 'Email me a sign-in code'}</button>
        {challengeId && (
          <button type="button" className="sa-secondary-action" disabled={busy} onClick={requestCode}>
            Send a new code
          </button>
        )}
        <span className="sa-access-footnote"><Shield size={13} /> Owner access requires a password and a one-time email code.</span>
      </form>
    </main>
  );
}

function AccessMessage({ title, message, action, onAction }) {
  return (
    <main className="sa-access-page">
      <section className="sa-access-card sa-access-message">
        <img src={brandLogo} alt="" />
        <span className="sa-eyebrow">PRIVATE PLATFORM ACCESS</span>
        <h1>{title}</h1>
        <p role="status">{message}</p>
        {action && <button type="button" onClick={onAction}>{action}</button>}
        <a href={window.location.pathname}>Return to Tobs Circuit</a>
      </section>
    </main>
  );
}

export default function SuperAdminDashboard() {
  const [activePage, setActivePage] = useState('DASHBOARD');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState(null);
  const [overview, setOverview] = useState(null);
  const [accessState, setAccessState] = useState('loading');
  const [accessError, setAccessError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [customerCareForm, setCustomerCareForm] = useState({
    name: 'Customer Care',
    email: '',
    password: ''
  });
  const [customerCareBusy, setCustomerCareBusy] = useState(false);
  const [customerCareError, setCustomerCareError] = useState('');
  const [customerCareNotice, setCustomerCareNotice] = useState('');
  const [supportThreads, setSupportThreads] = useState([]);
  const [selectedSupportThreadId, setSelectedSupportThreadId] = useState('');
  const [supportReplyDraft, setSupportReplyDraft] = useState('');
  const [supportReplyBusy, setSupportReplyBusy] = useState(false);
  const [supportThreadError, setSupportThreadError] = useState('');

  const updateAccessError = error => {
    setAccessError(error.status === 401 && error.message === 'No active session.' ? '' : error.message);
    setAccessState(error.status === 401
      ? 'signed-out'
      : error.status === 403
        ? 'denied'
        : error.status === 503
          ? 'configuration'
          : 'error');
  };

  const loadOverview = async () => {
    const data = await superAdminRequest('/api/super-admin/overview');
    setOverview(data);
    setRefreshError('');
  };

  useEffect(() => {
    let cancelled = false;
    const restoreOwnerAccess = async () => {
      try {
        const sessionData = await superAdminRequest('/api/super-admin/session');
        if (cancelled) return;
        if (sessionData.status === 'signed-out') {
          setAccessState('signed-out');
          return;
        }
        if (sessionData.status === 'denied') {
          setUser(sessionData.user);
          setAccessState('denied');
          return;
        }
        if (sessionData.status === 'needs-verification') {
          setUser(sessionData.user);
          setAccessError('Your owner session needs email verification. Sign in again to request a code.');
          setAccessState('signed-out');
          return;
        }
        setUser(sessionData.user);
        const data = await superAdminRequest('/api/super-admin/overview');
        if (cancelled) return;
        setOverview(data);
        setAccessState('ready');
      } catch (error) {
        if (!cancelled) updateAccessError(error);
      }
    };
    restoreOwnerAccess();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (accessState !== 'ready') return undefined;
    const timerId = window.setInterval(() => {
      loadOverview().catch(error => {
        console.error('Could not refresh the owner dashboard:', error);
        setRefreshError(error.message);
      });
    }, REFRESH_INTERVAL);
    return () => window.clearInterval(timerId);
  }, [accessState]);

  useEffect(() => {
    if (accessState !== 'ready' || activePage !== 'SUPPORT') return undefined;
    let cancelled = false;
    const loadSupportThreads = async () => {
      try {
        const { threads = [] } = await superAdminRequest('/api/super-admin/customer-care?view=threads');
        if (cancelled) return;
        setSupportThreads(threads);
        setSelectedSupportThreadId(previous => previous && threads.some(thread => thread.id === previous)
          ? previous
          : threads[0]?.id || '');
        setSupportThreadError('');
      } catch (error) {
        if (!cancelled) setSupportThreadError(error.message);
      }
    };
    loadSupportThreads();
    const timerId = window.setInterval(loadSupportThreads, REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [accessState, activePage]);

  const filtered = useMemo(() => {
    if (!overview) return { businesses: [], drivers: [], deliveries: [], invitations: [] };
    const query = search.trim().toLowerCase();
    if (!query) return overview;
    const includesQuery = row => Object.values(row)
      .some(value => String(value ?? '').toLowerCase().includes(query));
    return {
      ...overview,
      businesses: overview.businesses.filter(includesQuery),
      drivers: overview.drivers.filter(includesQuery),
      deliveries: overview.deliveries.filter(includesQuery),
      invitations: overview.invitations.filter(includesQuery)
    };
  }, [overview, search]);

  const selectedSupportThread = supportThreads.find(thread => thread.id === selectedSupportThreadId) || null;

  const requestSignInCode = async (email, password) => {
    setIsSigningIn(true);
    setAccessError('');
    try {
      return await superAdminRequest('/api/super-admin/login/request-code', {
        method: 'POST',
        body: { email, password, remember: true }
      });
    } catch (error) {
      setAccessError(error.message);
      throw error;
    } finally {
      setIsSigningIn(false);
    }
  };

  const verifySignInCode = async (challengeId, code) => {
    setIsSigningIn(true);
    setAccessError('');
    try {
      const { user: signedInUser } = await superAdminRequest('/api/super-admin/login/verify-code', {
        method: 'POST',
        body: { challengeId, code }
      });
      setUser(signedInUser);
      await loadOverview();
      setAccessState('ready');
    } catch (error) {
      setAccessError(error.message);
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOut = async () => {
    try {
      await superAdminRequest('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setOverview(null);
      setAccessError('');
      setAccessState('signed-out');
    } catch (error) {
      setRefreshError(error.message);
    }
  };

  const selectPage = id => {
    setActivePage(id);
    setMobileMenuOpen(false);
    setSearch('');
  };

  const createCustomerCareAccount = async (event) => {
    event.preventDefault();
    setCustomerCareError('');
    setCustomerCareNotice('');

    if (!customerCareForm.email || !customerCareForm.password) {
      setCustomerCareError('Enter the Customer Care email address and a temporary password.');
      return;
    }

    setCustomerCareBusy(true);
    try {
      const { user } = await superAdminRequest('/api/super-admin/customer-care', {
        method: 'POST',
        body: {
          name: customerCareForm.name || 'Customer Care',
          email: customerCareForm.email,
          password: customerCareForm.password
        }
      });
      setCustomerCareNotice(`Customer Care account created for ${user.email}.`);
      setCustomerCareForm({ name: 'Customer Care', email: '', password: '' });
      await loadOverview();
    } catch (error) {
      setCustomerCareError(error.message);
    } finally {
      setCustomerCareBusy(false);
    }
  };

  const updateOwnerSupportThread = thread => {
    setSupportThreads(previous => [thread, ...previous.filter(item => item.id !== thread.id)]
      .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt)));
  };

  const sendOwnerSupportReply = async event => {
    event.preventDefault();
    const text = supportReplyDraft.trim();
    if (!selectedSupportThread || !text || supportReplyBusy) return;

    setSupportReplyBusy(true);
    setSupportThreadError('');
    try {
      const { thread } = await superAdminRequest('/api/super-admin/customer-care', {
        method: 'POST',
        body: { action: 'reply', threadId: selectedSupportThread.id, text }
      });
      updateOwnerSupportThread(thread);
      setSupportReplyDraft('');
    } catch (error) {
      setSupportThreadError(error.message);
    } finally {
      setSupportReplyBusy(false);
    }
  };

  const setOwnerSupportStatus = async status => {
    if (!selectedSupportThread) return;
    setSupportThreadError('');
    try {
      const { thread } = await superAdminRequest('/api/super-admin/customer-care', {
        method: 'PATCH',
        body: { threadId: selectedSupportThread.id, status }
      });
      updateOwnerSupportThread(thread);
    } catch (error) {
      setSupportThreadError(error.message);
    }
  };

  if (accessState === 'loading') {
    return <AccessMessage title="Checking owner access" message="Verifying your signed-in account with the platform API…" />;
  }
  if (accessState === 'signed-out') {
    return <OwnerSignIn onRequestCode={requestSignInCode} onVerifyCode={verifySignInCode} busy={isSigningIn} error={accessError} />;
  }
  if (accessState === 'denied') {
    return (
      <AccessMessage
        title="Owner access only"
        message={`The signed-in account${user?.email ? ` (${user.email})` : ''} is not authorized to view platform administration.`}
        action="Sign out"
        onAction={signOut}
      />
    );
  }
  if (accessState === 'configuration') {
    return (
      <AccessMessage
        title="Owner access needs configuration"
        message={`${accessError} Add the exact owner app sign-in email as a server-side Vercel environment variable, then redeploy the API.`}
      />
    );
  }
  if (accessState === 'error') {
    return <AccessMessage title="Platform data unavailable" message={accessError} action="Try again" onAction={() => window.location.reload()} />;
  }

  const currentPage = PLATFORM_NAV.find(item => item.id === activePage) || PLATFORM_NAV[0];
  const businesses = filtered.businesses;
  const drivers = filtered.drivers;
  const deliveries = filtered.deliveries;
  const invitations = filtered.invitations;
  const allDeliveries = overview.deliveries;
  const deliveredCount = allDeliveries.filter(delivery => delivery.status === 'DELIVERED').length;
  const pendingCount = allDeliveries.filter(delivery => !['DELIVERED', 'FAILED', 'CANCELLED'].includes(delivery.status)).length;
  const failedCount = allDeliveries.filter(delivery => ['FAILED', 'CANCELLED'].includes(delivery.status)).length;
  const activeDriverCount = overview.drivers.filter(driver => driver.status === 'ACTIVE').length;
  const trackingDriverCount = overview.drivers.filter(driver => driver.isTracking).length;
  const pendingInviteCount = overview.invitations.filter(invite => invite.status === 'PENDING').length;
  const businessColumns = [
    { label: 'Business', render: row => <strong>{row.name}</strong> },
    { label: 'Administrator', render: row => <span>{row.administrator}<small>{row.email}</small></span> },
    { label: 'Drivers', render: row => row.driverCount },
    { label: 'Deliveries', render: row => row.deliveryCount },
    { label: 'Status', render: row => <StatusBadge value={row.status} /> }
  ];
  const driverColumns = [
    { label: 'Driver', render: row => <span><strong>{row.name}</strong><small>{row.email}</small></span> },
    { label: 'Business', render: row => row.businessName },
    { label: 'Phone', render: row => row.phone || '—' },
    { label: 'Route status', render: row => <StatusBadge value={row.routeStatus} /> },
    { label: 'Tracking', render: row => <StatusBadge value={row.isTracking ? 'ACTIVE' : 'IDLE'} /> }
  ];
  const deliveryColumns = [
    { label: 'Recipient / stop', render: row => <span><strong>{row.name || 'Delivery'}</strong><small>{row.address || 'Address unavailable'}</small></span> },
    { label: 'Business', render: row => row.businessName },
    { label: 'Driver', render: row => row.driverName },
    { label: 'Packages', render: row => row.packages },
    { label: 'Status', render: row => <StatusBadge value={row.status} /> }
  ];

  return (
    <div className="sa-shell">
      {mobileMenuOpen && <button type="button" className="sa-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />}
      <aside className={`sa-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileMenuOpen ? 'is-open' : ''}`}>
        <div className="sa-brand">
          <img src={brandLogo} alt="" />
          {!collapsed && <span><strong>Tobs Circuit</strong><small>Platform administration</small></span>}
          <button type="button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}><Menu size={17} /></button>
        </div>
        {!collapsed && <p className="sa-nav-label">PLATFORM</p>}
        <nav className="sa-nav" aria-label="Super Admin navigation">
          {PLATFORM_NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={collapsed ? label : undefined}
              aria-current={activePage === id ? 'page' : undefined}
              onClick={() => selectPage(id)}
            >
              <Icon size={17} />{!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
        {!collapsed && (
          <div className="sa-sidebar-account">
            <span className="sa-avatar">{(user?.name || 'Owner').slice(0, 1).toUpperCase()}</span>
            <span><strong>{user?.name || 'Platform owner'}</strong><small>{user?.email}</small></span>
          </div>
        )}
      </aside>

      <main className="sa-main">
        <header className="sa-topbar">
          <div>
            <button className="sa-mobile-menu" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <span className="sa-breadcrumb">Platform <span>/</span> {currentPage.label}</span>
            <h1>{currentPage.label}</h1>
          </div>
          <div className="sa-topbar-actions">
            <label className="sa-search"><Search size={16} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search platform records" aria-label="Search platform records" /></label>
            <span className="sa-live-pill"><i /> Live data</span>
            <button className="sa-signout" type="button" onClick={signOut} title="Sign out"><LogOut size={16} /><span>Sign out</span></button>
          </div>
        </header>

        <div className="sa-content">
          {refreshError && <Notice tone="warning">Live refresh failed: {refreshError} Previously loaded data may be out of date.</Notice>}
          <div className="sa-update-line">
            <span><Shield size={13} /> Owner access verified by the API</span>
            <span>Last updated {formatDate(overview.generatedAt)} · refreshes every 15 seconds</span>
          </div>

          {activePage === 'DASHBOARD' && (
            <>
              <div className="sa-intro"><div><h2>Platform overview</h2><p>A live view of business accounts, drivers, and deliveries stored in Tobs Circuit.</p></div><span className="sa-readonly">Read only</span></div>
              <section className="sa-metrics">
                <Metric icon={Building2} label="Business accounts" value={overview.businesses.length} tone="blue" />
                <Metric icon={Users} label="Drivers" value={overview.drivers.length} tone="violet" />
                <Metric icon={Truck} label="Drivers active" value={activeDriverCount} caption={`${trackingDriverCount} sharing location`} tone="green" />
                <Metric icon={Package} label="Deliveries" value={allDeliveries.length} caption={`${pendingCount} currently open`} tone="cyan" />
                <Metric icon={BadgeCheck} label="Delivered" value={deliveredCount} tone="green" />
                <Metric icon={ClipboardList} label="Pending invites" value={pendingInviteCount} tone="amber" />
              </section>
              <div className="sa-two-column">
                <section className="sa-card">
                  <CardHeading title="Delivery status" detail="Current status of all recorded stops" />
                  <StatusBar label="Delivered" value={deliveredCount} total={allDeliveries.length} tone="green" />
                  <StatusBar label="Open" value={pendingCount} total={allDeliveries.length} tone="blue" />
                  <StatusBar label="Failed or cancelled" value={failedCount} total={allDeliveries.length} tone="red" />
                  {allDeliveries.length === 0 && <p className="sa-empty-note">No delivery records are available yet.</p>}
                </section>
                <section className="sa-card">
                  <CardHeading title="System health" detail="API and configured storage" />
                  <div className="sa-health-row"><span><i className="sa-health-dot" />API status</span><StatusBadge value={overview.health.status} /></div>
                  <div className="sa-health-row"><span><Database size={16} />Storage</span><strong>{overview.health.storage}</strong></div>
                  <div className="sa-health-row"><span><Activity size={16} />Process uptime</span><strong>{formatUptime(overview.health.uptimeSeconds)}</strong></div>
                </section>
              </div>
              <section className="sa-card">
                <CardHeading title="Business accounts" detail="Organization administrators registered on the platform" />
                <RecordsTable columns={businessColumns} rows={businesses.slice(0, 8)} emptyMessage="No business accounts found." />
              </section>
              <section className="sa-card">
                <CardHeading title="Recent deliveries" detail="Latest platform delivery records" />
                <RecordsTable columns={deliveryColumns} rows={[...deliveries].slice(-8).reverse()} emptyMessage="No deliveries found." />
              </section>
            </>
          )}

          {activePage === 'BUSINESSES' && <LiveSection title="Business Management" description="All business administrator accounts and their recorded fleet activity." columns={businessColumns} rows={businesses} emptyMessage="No business accounts found." />}
          {activePage === 'DRIVERS' && <LiveSection title="Driver Management" description="Driver profiles, account status, assigned business, and route status." columns={driverColumns} rows={drivers} emptyMessage="No driver accounts found." />}
          {activePage === 'APPLICATIONS' && (
            <section className="sa-card">
              <CardHeading title="Driver onboarding invitations" detail={`${pendingInviteCount} pending invitation${pendingInviteCount === 1 ? '' : 's'}`} />
              <Notice>These are driver invitations recorded by the current app. It does not store submitted driver applications or review decisions.</Notice>
              <RecordsTable
                columns={[
                  { label: 'Applicant email', render: row => row.email || 'Open invitation' },
                  { label: 'Business', render: row => row.businessName },
                  { label: 'Created', render: row => formatDate(row.createdAt) },
                  { label: 'Registered', render: row => formatDate(row.registeredAt) },
                  { label: 'Status', render: row => <StatusBadge value={row.status} /> }
                ]}
                rows={invitations}
                emptyMessage="No driver invitations found."
              />
            </section>
          )}
          {activePage === 'VERIFICATION' && <UnavailableSection title="Verification Centre">The current app does not collect identity documents or record verification reviews.</UnavailableSection>}
          {activePage === 'DELIVERIES' && <LiveSection title="Delivery Management" description="Stops and deliveries across all business accounts." columns={deliveryColumns} rows={deliveries} emptyMessage="No delivery records found." />}
          {activePage === 'TRACKING' && (
            <section className="sa-card">
              <CardHeading title="Live driver locations" detail={`${trackingDriverCount} driver${trackingDriverCount === 1 ? '' : 's'} currently marked as tracking`} />
              <Notice>Locations refresh with platform data every 15 seconds. Map pins are shown when a driver has shared valid coordinates.</Notice>
              <RecordsTable
                columns={[
                  { label: 'Driver', render: row => <span><strong>{row.name}</strong><small>{row.businessName}</small></span> },
                  { label: 'Location', render: row => Number.isFinite(row.lat) && Number.isFinite(row.lng) ? <a className="sa-map-link" href={`https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}`} target="_blank" rel="noreferrer">{row.lat.toFixed(5)}, {row.lng.toFixed(5)}</a> : 'No location shared' },
                  { label: 'Updated', render: row => formatDate(row.locationUpdatedAt) },
                  { label: 'Tracking', render: row => <StatusBadge value={row.isTracking ? 'ACTIVE' : 'IDLE'} /> }
                ]}
                rows={drivers}
                emptyMessage="No driver accounts found."
              />
            </section>
          )}
          {activePage === 'REPORTS' && (
            <>
              <section className="sa-metrics sa-report-metrics">
                <Metric icon={Package} label="Total deliveries" value={allDeliveries.length} tone="blue" />
                <Metric icon={CheckCircle2} label="Delivery success rate" value={allDeliveries.length ? `${Math.round((deliveredCount / allDeliveries.length) * 100)}%` : '—'} tone="green" />
                <Metric icon={Truck} label="Active drivers" value={activeDriverCount} tone="violet" />
                <Metric icon={Building2} label="Businesses" value={overview.businesses.length} tone="cyan" />
              </section>
              <LiveSection title="Delivery report" description="Live delivery status and business totals; the current app has no historical analytics store." columns={deliveryColumns} rows={deliveries} emptyMessage="No delivery records available for reporting." />
            </>
          )}
          {activePage === 'FINANCIAL' && <UnavailableSection title="Financial Management">Subscriptions, invoices, and payment transactions are not currently stored or connected to a billing provider.</UnavailableSection>}
          {activePage === 'SUPPORT' && (
            <section className="sa-card">
              <CardHeading title="Support & Disputes" detail="Protected support queue and Customer Care account management" />
              <Notice tone="info">Customer Care agents and the verified platform owner can reply to support cases. Owner replies are labeled separately in the conversation.</Notice>

              <form className="sa-form-grid" onSubmit={createCustomerCareAccount}>
                <label>
                  Customer Care name
                  <input
                    type="text"
                    value={customerCareForm.name}
                    onChange={event => setCustomerCareForm(prev => ({ ...prev, name: event.target.value }))}
                  />
                </label>
                <label>
                  Email address
                  <input
                    type="email"
                    value={customerCareForm.email}
                    onChange={event => setCustomerCareForm(prev => ({ ...prev, email: event.target.value }))}
                    placeholder="support@example.com"
                  />
                </label>
                <label>
                  Temporary password
                  <input
                    type="password"
                    value={customerCareForm.password}
                    onChange={event => setCustomerCareForm(prev => ({ ...prev, password: event.target.value }))}
                    placeholder="At least 8 characters"
                  />
                </label>
                <div className="sa-form-actions">
                  <button type="submit" disabled={customerCareBusy}>{customerCareBusy ? 'Creating…' : 'Create Customer Care account'}</button>
                </div>
              </form>

              {customerCareError && <p className="sa-access-error" role="alert">{customerCareError}</p>}
              {customerCareNotice && <p className="sa-success-message" role="status">{customerCareNotice}</p>}

              <div className="sa-support-workspace">
                <div className="sa-support-list">
                  <div className="sa-support-list-heading">
                    <strong>Cases</strong>
                    <span>{supportThreads.length}</span>
                  </div>
                  {supportThreads.length ? supportThreads.map(thread => {
                    const lastMessage = thread.messages?.[thread.messages.length - 1];
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        className={`sa-support-row ${selectedSupportThreadId === thread.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedSupportThreadId(thread.id)}
                      >
                        <span className="sa-support-header">
                          <strong>{thread.userName || 'App user'}</strong>
                          <StatusBadge value={thread.status} />
                        </span>
                        <small>{thread.caseId} · {thread.userRole} · {thread.assignedTo}</small>
                        <span className="sa-support-preview">{lastMessage?.text || 'No messages yet'}</span>
                      </button>
                    );
                  }) : (
                    <p className="sa-empty-note">{supportThreadError || 'No support chats or escalations have been created yet.'}</p>
                  )}
                </div>

                <section className="sa-support-conversation" aria-label="Selected support conversation">
                  {selectedSupportThread ? (
                    <>
                      <header className="sa-support-conversation-header">
                        <div>
                          <strong>{selectedSupportThread.userName || 'App user'}</strong>
                          <small>{selectedSupportThread.caseId} · {selectedSupportThread.userRole} · Assigned to {selectedSupportThread.assignedTo}</small>
                        </div>
                        <button
                          type="button"
                          className="sa-support-resolve"
                          onClick={() => setOwnerSupportStatus(selectedSupportThread.status === 'RESOLVED' ? 'IN_PROGRESS' : 'RESOLVED')}
                        >
                          <CheckCheck size={15} />
                          {selectedSupportThread.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}
                        </button>
                      </header>
                      <div className="sa-support-messages">
                        {selectedSupportThread.messages?.map(message => {
                          const isUser = message.sender === 'USER';
                          const senderLabel = message.sender === 'SUPER_ADMIN'
                            ? 'Super Admin'
                            : message.sender === 'CUSTOMER_CARE'
                              ? message.senderName || 'Customer Care'
                              : message.sender === 'BOT'
                                ? 'Support bot'
                                : selectedSupportThread.userName || 'App user';
                          return (
                            <div key={message.id} className={`sa-support-message-row ${isUser ? 'from-user' : 'from-team'}`}>
                              <div className={`sa-support-message ${message.sender === 'SUPER_ADMIN' ? 'is-owner' : message.sender === 'CUSTOMER_CARE' ? 'is-agent' : isUser ? 'is-user' : 'is-bot'}`}>
                                <span>{senderLabel}</span>
                                <p>{message.text}</p>
                                <small>{formatDate(message.createdAt)}</small>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {supportThreadError && <p className="sa-access-error" role="alert">{supportThreadError}</p>}
                      <form className="sa-support-reply" onSubmit={sendOwnerSupportReply}>
                        <label htmlFor="owner-support-reply" className="sa-visually-hidden">Reply as Super Admin</label>
                        <textarea
                          id="owner-support-reply"
                          rows={2}
                          maxLength={2000}
                          value={supportReplyDraft}
                          onChange={event => setSupportReplyDraft(event.target.value)}
                          placeholder="Reply as Super Admin…"
                        />
                        <button type="submit" disabled={!supportReplyDraft.trim() || supportReplyBusy} aria-label="Send Super Admin reply" title="Send reply">
                          <Send size={16} />
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="sa-support-no-selection">
                      <MessageSquare size={22} />
                      <strong>{supportThreadError || 'Select a case to read and reply.'}</strong>
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}
          {activePage === 'NOTIFICATIONS' && <UnavailableSection title="Notifications">The app can send invitation and password emails, but it does not keep a platform-wide notification or delivery log.</UnavailableSection>}
          {activePage === 'PERMISSIONS' && (
            <section className="sa-card">
              <CardHeading title="Administrative accounts" detail="Existing app roles are fleet Admin and Driver; platform-level role editing is not configured." />
              <RecordsTable
                columns={[
                  { label: 'Administrator', render: row => <span><strong>{row.administrator}</strong><small>{row.email}</small></span> },
                  { label: 'Business', render: row => row.name },
                  { label: 'Drivers', render: row => row.driverCount },
                  { label: 'Role', render: () => <StatusBadge value="ADMIN" /> },
                  { label: 'Status', render: row => <StatusBadge value={row.status} /> }
                ]}
                rows={businesses}
                emptyMessage="No administrator accounts found."
              />
            </section>
          )}
          {activePage === 'ACTIVITY' && <UnavailableSection title="Activity Logs">Historical audit events are not collected. This dashboard shows current records and statuses only, as requested.</UnavailableSection>}
          {activePage === 'HEALTH' && (
            <section className="sa-card">
              <CardHeading title="System health" detail="Status reported by the authenticated platform API" />
              <div className="sa-health-row"><span><i className="sa-health-dot" />API status</span><StatusBadge value={overview.health.status} /></div>
              <div className="sa-health-row"><span><Database size={16} />Storage mode</span><strong>{overview.health.storage}</strong></div>
              <div className="sa-health-row"><span><Activity size={16} />Process uptime</span><strong>{formatUptime(overview.health.uptimeSeconds)}</strong></div>
              <p className="sa-footnote">Infrastructure metrics, database resource usage, and alerting are not exposed by the current deployment.</p>
            </section>
          )}
          {activePage === 'SETTINGS' && <UnavailableSection title="Platform Settings">Global platform settings are not stored in the app. Server and deployment configuration must be managed in the hosting provider.</UnavailableSection>}
        </div>

        <footer className="sa-footer">
          <span>TOBS CIRCUIT · PRIVATE OWNER DASHBOARD</span>
          <span><Shield size={13} /> Signed in as {user?.email}</span>
        </footer>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, caption, tone }) {
  return (
    <article className={`sa-metric sa-metric-${tone}`}>
      <span className="sa-metric-icon"><Icon size={18} /></span>
      <div><p>{label}</p><strong>{value}</strong><small>{caption || 'Across all app accounts'}</small></div>
    </article>
  );
}

function CardHeading({ title, detail }) {
  return <div className="sa-card-heading"><div><h2>{title}</h2><p>{detail}</p></div><ChevronDown size={16} /></div>;
}

function StatusBar({ label, value, total, tone }) {
  const width = total ? `${Math.max(value ? 2 : 0, (value / total) * 100)}%` : '0%';
  return (
    <div className="sa-status-bar-row">
      <div><span>{label}</span><strong>{value}</strong></div>
      <span className="sa-status-bar"><i className={`sa-status-bar-${tone}`} style={{ width }} /></span>
    </div>
  );
}

function LiveSection({ title, description, columns, rows, emptyMessage }) {
  return (
    <section className="sa-card">
      <CardHeading title={title} detail={description} />
      <RecordsTable columns={columns} rows={rows} emptyMessage={emptyMessage} />
    </section>
  );
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}
