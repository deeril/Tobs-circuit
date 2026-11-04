import { useState } from 'react';
import brandLogo from './assets/tobs-circuit-logo-purple.png';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  Database,
  FileClock,
  Filter,
  LayoutDashboard,
  Mail,
  Menu,
  Package,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import './SuperAdminPreview.css';

const PLATFORM_NAV = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'BUSINESSES', label: 'Businesses', icon: Building2 },
  { id: 'USERS', label: 'Business Users', icon: Users },
  { id: 'ORDERS', label: 'Orders & Deliveries', icon: Package },
  { id: 'EMAIL', label: 'Email Management', icon: Mail },
  { id: 'INTEGRATIONS', label: 'Integrations', icon: Database },
  { id: 'BILLING', label: 'Subscriptions & Billing', icon: CreditCard },
  { id: 'SUPPORT', label: 'Support Centre', icon: CircleHelp },
  { id: 'ANALYTICS', label: 'Analytics & Reports', icon: Activity },
  { id: 'AUDIT', label: 'Audit Logs', icon: FileClock },
  { id: 'SETTINGS', label: 'Platform Settings', icon: Settings }
];

const OVERVIEW_METRICS = [
  { label: 'Registered businesses', icon: Building2, tone: 'blue' },
  { label: 'Active businesses', icon: CheckCircle2, tone: 'green' },
  { label: 'Suspended businesses', icon: ShieldAlert, tone: 'amber' },
  { label: 'Business users', icon: Users, tone: 'violet' },
  { label: 'Total orders', icon: Package, tone: 'blue' },
  { label: 'Total deliveries', icon: Truck, tone: 'cyan' },
  { label: 'Successful deliveries', icon: BadgeCheck, tone: 'green' },
  { label: 'Failed deliveries', icon: ArrowDownRight, tone: 'red' },
  { label: 'Emails sent', icon: Mail, tone: 'violet' },
  { label: 'Failed email notifications', icon: Mail, tone: 'amber' }
];

function PlatformMetric({ icon: Icon, label, tone }) {
  return (
    <article className={`platform-metric platform-tone-${tone}`}>
      <span className="platform-metric-icon"><Icon size={18} /></span>
      <div>
        <p>{label}</p>
        <strong aria-label={`${label}: not connected`}>—</strong>
        <span className="platform-metric-caption">Platform data not connected</span>
      </div>
    </article>
  );
}

function ChartPlaceholder({ title, description, period }) {
  return (
    <section className="platform-card platform-chart-card">
      <div className="platform-card-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className="platform-select" disabled aria-label={`${period} time period`}>
          {period}<ChevronDown size={14} />
        </button>
      </div>
      <div className="platform-chart-placeholder" aria-label={`${title} chart has no platform data`}>
        <div className="platform-chart-grid">
          <span /><span /><span /><span />
        </div>
        <div className="platform-chart-message">
          <Activity size={19} />
          <strong>Waiting for platform data</strong>
          <span>Analytics will appear after the platform data service is connected.</span>
        </div>
        <div className="platform-chart-axis">
          <span>—</span><span>—</span><span>—</span><span>—</span><span>—</span>
        </div>
      </div>
      <div className="platform-chart-legend">
        <span><i className="legend-business" /> Business registrations</span>
        <span><i className="legend-delivery" /> Delivery activity</span>
      </div>
    </section>
  );
}

function BusinessListPreview({ filter, onFilterChange, search, onSearchChange }) {
  return (
    <section className="platform-card platform-business-card">
      <div className="platform-card-heading">
        <div>
          <h2>Businesses</h2>
          <p>Business workspaces on the Tobs Circuit platform</p>
        </div>
        <button className="platform-outline-button" type="button" disabled title="Business management is not connected">
          Business management <ArrowRight size={14} />
        </button>
      </div>
      <div className="platform-table-tools">
        <label className="platform-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search businesses"
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            aria-label="Search businesses"
          />
        </label>
        <label className="platform-filter">
          <Filter size={14} />
          <select value={filter} onChange={event => onFilterChange(event.target.value)} aria-label="Filter businesses by status">
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </label>
      </div>
      <div className="platform-table-wrap">
        <table className="platform-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Business ID</th>
              <th>Administrator</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Registered</th>
              <th><span className="platform-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="7">
                <div className="platform-empty-state">
                  <span><Building2 size={20} /></span>
                  <strong>{search || filter !== 'ALL' ? 'No matching businesses' : 'No platform businesses connected'}</strong>
                  <p>This Phase 1 preview has no access to business records. Business data and management controls require the platform API and Super Admin authorization.</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="platform-table-footer">
        <span>Business records are unavailable in this UI preview</span>
        <div><button disabled type="button">Previous</button><span>—</span><button disabled type="button">Next</button></div>
      </div>
    </section>
  );
}

function EmailHealthCard() {
  return (
    <section className="platform-card platform-email-card">
      <div className="platform-card-heading">
        <div><h2>Email delivery</h2><p>Platform-wide notification health</p></div>
        <span className="platform-service-status"><i />Not connected</span>
      </div>
      <div className="platform-email-metrics">
        <div><span>Successful</span><strong>—</strong></div>
        <div><span>Failed</span><strong>—</strong></div>
        <div><span>Pending</span><strong>—</strong></div>
      </div>
      <div className="platform-email-notice">
        <Mail size={16} />
        <span>Email logs, retry controls, and delivery status will be available when platform email services are integrated.</span>
      </div>
    </section>
  );
}

function PagePlaceholder({ page }) {
  const nav = PLATFORM_NAV.find(item => item.id === page) || PLATFORM_NAV[0];
  const Icon = nav.icon;
  return (
    <section className="platform-card platform-page-placeholder">
      <span className="platform-placeholder-icon"><Icon size={23} /></span>
      <h2>{nav.label}</h2>
      <p>This section is represented in the Phase 1 interface. Platform data, authorization, and management actions are not connected in this preview.</p>
      <span className="platform-readonly-label"><Shield size={13} /> Read-only preview</span>
    </section>
  );
}

export default function SuperAdminPreview() {
  const [activePage, setActivePage] = useState('OVERVIEW');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [businessFilter, setBusinessFilter] = useState('ALL');
  const [profileOpen, setProfileOpen] = useState(false);
  const [range, setRange] = useState('Last 30 days');
  const currentPage = PLATFORM_NAV.find(item => item.id === activePage) || PLATFORM_NAV[0];
  const isOverview = activePage === 'OVERVIEW';

  const selectPage = id => {
    setActivePage(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="platform-preview-shell">
      {mobileMenuOpen && (
        <button className="platform-sidebar-backdrop" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />
      )}
      <aside className={`platform-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileMenuOpen ? 'is-open' : ''}`}>
        <div className="platform-brand">
          <img src={brandLogo} alt="" />
          {!collapsed && <div><strong>Tobs Circuit</strong><span>Platform administration</span></div>}
          <button className="platform-collapse-button" type="button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Menu size={17} />
          </button>
        </div>
        {!collapsed && <p className="platform-nav-caption">PLATFORM</p>}
        <nav className="platform-nav" aria-label="Super Admin navigation">
          {PLATFORM_NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={collapsed ? label : undefined}
              aria-current={activePage === id ? 'page' : undefined}
              onClick={() => selectPage(id)}
            >
              <Icon size={17} />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
        <div className="platform-sidebar-bottom">
          {!collapsed && (
            <div className="platform-sidebar-support">
              <span><CircleHelp size={15} /></span>
              <div><strong>Need a hand?</strong><small>Platform support centre</small></div>
            </div>
          )}
          <button className="platform-account" type="button" onClick={() => setProfileOpen(value => !value)} aria-expanded={profileOpen}>
            <span className="platform-avatar">TC</span>
            {!collapsed && <span className="platform-account-copy"><strong>Platform Owner</strong><small>Super Admin preview</small></span>}
            {!collapsed && <ChevronDown size={15} />}
          </button>
          {profileOpen && !collapsed && <div className="platform-profile-popover">Preview mode only. No account is signed in.</div>}
        </div>
      </aside>

      <main className="platform-main">
        <header className="platform-topbar">
          <div className="platform-heading">
            <button className="platform-mobile-menu" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div className="platform-breadcrumb"><span>Platform</span><span>/</span><strong>{currentPage.label}</strong></div>
            <h1>{isOverview ? 'Platform overview' : currentPage.label}</h1>
          </div>
          <div className="platform-topbar-actions">
            <label className="platform-global-search">
              <Search size={16} />
              <input type="search" placeholder="Search platform" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search platform" />
            </label>
            <span className="platform-preview-pill"><i /> UI preview</span>
            <button className="platform-icon-button" type="button" title="No new platform notifications" aria-label="Platform notifications unavailable" disabled><Bell size={18} /></button>
            <div className="platform-topbar-profile"><span className="platform-avatar">TC</span><span><strong>Platform Owner</strong><small>Super Admin preview</small></span></div>
          </div>
        </header>

        <div className="platform-preview-notice" role="status">
          <ShieldAlert size={16} />
          <p><strong>Read-only UI preview.</strong> No platform data or Super Admin authorization is connected. Management actions are intentionally unavailable.</p>
          <span>Phase 1</span>
        </div>

        {isOverview ? (
          <div className="platform-content">
            <div className="platform-content-intro">
              <div><h2>Platform at a glance</h2><p>Monitor business workspaces, logistics activity, and platform services.</p></div>
              <button className="platform-select platform-range-select" type="button" onClick={() => setRange(value => value === 'Last 30 days' ? 'Last 90 days' : 'Last 30 days')}>
                <Clock3 size={14} />{range}<ChevronDown size={14} />
              </button>
            </div>

            <section className="platform-metrics-grid" aria-label="Platform statistics">
              {OVERVIEW_METRICS.map(metric => <PlatformMetric key={metric.label} {...metric} />)}
            </section>

            <section className="platform-charts-grid">
              <ChartPlaceholder title="Platform growth" description="Business registrations and active workspaces" period="Monthly" />
              <ChartPlaceholder title="Delivery activity" description="Successful and failed deliveries across businesses" period="Monthly" />
            </section>

            <section className="platform-lower-grid">
              <BusinessListPreview
                filter={businessFilter}
                onFilterChange={setBusinessFilter}
                search={search}
                onSearchChange={setSearch}
              />
              <EmailHealthCard />
            </section>
          </div>
        ) : activePage === 'BUSINESSES' ? (
          <div className="platform-content"><BusinessListPreview filter={businessFilter} onFilterChange={setBusinessFilter} search={search} onSearchChange={setSearch} /></div>
        ) : activePage === 'EMAIL' ? (
          <div className="platform-content"><EmailHealthCard /><section className="platform-card platform-email-history"><div><h2>Email history</h2><p>Send attempts and notification delivery records</p></div><div className="platform-empty-state"><span><Mail size={20} /></span><strong>No email log source connected</strong><p>History, failure details, and retry actions are unavailable in the Phase 1 preview.</p></div></section></div>
        ) : (
          <div className="platform-content"><PagePlaceholder page={activePage} /></div>
        )}

        <footer className="platform-footer"><span>TOBS CIRCUIT PLATFORM</span><span><Shield size={12} /> No tenant data is loaded in this preview</span></footer>
      </main>
    </div>
  );
}
