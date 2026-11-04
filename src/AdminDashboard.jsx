import { useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Clock3,
  ExternalLink,
  Filter,
  MapPin,
  Menu,
  Package,
  Route,
  Search,
  Truck,
  X
} from 'lucide-react';
import { ADMIN_NAV_ITEMS } from './adminNavigation.js';
import './AdminDashboard.css';

const FAILED_STATUSES = new Set(['FAILED', 'UNDELIVERED', 'DELIVERY_FAILED']);
const isDelivered = stop => stop.status === 'DELIVERED';
const isFailed = stop => FAILED_STATUSES.has(String(stop.status || '').toUpperCase());
const getStopDate = stop => stop.deliveredAt || stop.failedAt || stop.createdAt || stop.createdOn || null;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelativeTime(value, now) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getStatusLabel(status) {
  if (isDelivered({ status })) return 'Completed';
  if (isFailed({ status })) return 'Failed';
  if (status === 'IN_PROGRESS') return 'In progress';
  return 'Pending';
}

function getPeriodRows(stops, period, now) {
  const count = period === 'MONTHLY' ? 6 : period === 'WEEKLY' ? 7 : 7;
  const rows = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(now);
    if (period === 'MONTHLY') {
      start.setDate(1);
      start.setMonth(start.getMonth() - index);
    } else if (period === 'WEEKLY') {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (index * 7));
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(start.getDate() - index);
      start.setHours(0, 0, 0, 0);
    }

    const end = new Date(start);
    if (period === 'MONTHLY') end.setMonth(end.getMonth() + 1);
    else if (period === 'WEEKLY') end.setDate(end.getDate() + 7);
    else end.setDate(end.getDate() + 1);

    const datedStops = stops.filter(stop => {
      const value = getStopDate(stop);
      if (!value) return false;
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
    });

    rows.push({
      label: period === 'MONTHLY'
        ? start.toLocaleDateString(undefined, { month: 'short' })
        : period === 'WEEKLY'
          ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : start.toLocaleDateString(undefined, { weekday: 'short' }),
      total: datedStops.length,
      completed: datedStops.filter(isDelivered).length,
      failed: datedStops.filter(isFailed).length,
      pending: datedStops.filter(stop => !isDelivered(stop) && !isFailed(stop)).length
    });
  }
  return rows;
}

function makeActivityItems(stops, drivers) {
  const items = [];
  stops.forEach(stop => {
    const customer = stop.customerName || stop.name || 'Delivery';
    const driver = drivers.find(item => item.id === stop.assignedDriverId);
    [
      { date: stop.createdAt || stop.createdOn, label: 'New delivery created', detail: customer, icon: Package },
      { date: stop.assignedAt, label: 'Driver assigned', detail: driver?.name || customer, icon: Truck },
      { date: stop.acceptedAt, label: 'Delivery accepted', detail: driver?.name || customer, icon: CheckCircle2 },
      { date: stop.pickedUpAt, label: 'Package picked up', detail: customer, icon: MapPin },
      { date: stop.deliveredAt, label: 'Delivery completed', detail: customer, icon: CheckCircle2 },
      { date: stop.failedAt, label: 'Failed delivery reported', detail: customer, icon: CircleAlert }
    ].forEach(activity => {
      if (activity.date && Number.isFinite(new Date(activity.date).getTime())) {
        items.push({ ...activity, id: `${stop.id}-${activity.label}` });
      }
    });
  });
  drivers.forEach(driver => {
    if (driver.routeUpdatedAt && Number.isFinite(new Date(driver.routeUpdatedAt).getTime())) {
      items.push({
        id: `${driver.id}-route-updated`,
        date: driver.routeUpdatedAt,
        label: driver.routeStatus === 'PENDING' ? 'Driver assigned' : 'Route updated',
        detail: driver.name,
        icon: Truck
      });
    }
  });
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);
}

function StatCard({ icon: Icon, label, value, note, tone }) {
  return (
    <article className={`admin-stat-card tone-${tone}`}>
      <div className="admin-stat-icon"><Icon size={19} strokeWidth={2} /></div>
      <div className="admin-stat-copy">
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </article>
  );
}

function DeliveryChart({ stops, now }) {
  const [period, setPeriod] = useState('DAILY');
  const rows = useMemo(() => getPeriodRows(stops, period, new Date(now)), [stops, period, now]);
  const maximum = Math.max(1, ...rows.map(row => row.total));
  const series = [
    { key: 'completed', label: 'Successful', color: 'var(--dashboard-green)' },
    { key: 'failed', label: 'Failed', color: 'var(--dashboard-red)' },
    { key: 'pending', label: 'Pending', color: 'var(--dashboard-blue)' }
  ];
  const hasDatedRecords = rows.some(row => row.total > 0);

  return (
    <section className="admin-panel admin-chart-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Delivery performance</h2>
          <p>Delivery outcomes from recorded delivery dates</p>
        </div>
        <div className="admin-period-tabs" aria-label="Chart period">
          {[
            ['DAILY', 'Daily'],
            ['WEEKLY', 'Weekly'],
            ['MONTHLY', 'Monthly']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              aria-pressed={period === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-chart-summary">
        <strong>{rows.reduce((sum, row) => sum + row.total, 0)}</strong>
        <span>deliveries in selected period</span>
      </div>
      {hasDatedRecords ? (
        <div className="admin-chart" role="img" aria-label={`Delivery outcomes, ${period.toLowerCase()}`}>
          {rows.map(row => (
            <div className="admin-chart-column" key={row.label} title={`${row.label}: ${row.total} total, ${row.completed} successful, ${row.failed} failed, ${row.pending} pending`}>
              <span className="admin-chart-total">{row.total}</span>
              <div className="admin-chart-track">
                {row.total > 0 && series.map(item => (
                  row[item.key] > 0 && (
                    <span
                      key={item.key}
                      className="admin-chart-segment"
                      style={{
                        backgroundColor: item.color,
                        height: `${Math.max(3, (row[item.key] / maximum) * 100)}%`
                      }}
                    />
                  )
                ))}
              </div>
              <span className="admin-chart-label">{row.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-chart-empty">Delivery trends will appear here when dated delivery records are available.</div>
      )}
      <div className="admin-chart-legend">
        {series.map(item => (
          <span key={item.key}><i style={{ backgroundColor: item.color }} />{item.label}</span>
        ))}
      </div>
    </section>
  );
}

function DeliveryTable({ stops, drivers, onViewDelivery, search, onSearchChange }) {
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stops.filter(stop => {
      const status = isDelivered(stop) ? 'COMPLETED' : isFailed(stop) ? 'FAILED' : 'PENDING';
      if (filter !== 'ALL' && status !== filter) return false;
      if (!query) return true;
      const driver = drivers.find(item => item.id === stop.assignedDriverId);
      return [
        stop.id,
        stop.trackingId,
        stop.name,
        stop.customerName,
        stop.address,
        stop.pickupAddress,
        driver?.name
      ].some(value => String(value || '').toLowerCase().includes(query));
    }).sort((a, b) => {
      const aDate = new Date(getStopDate(a) || 0).getTime();
      const bDate = new Date(getStopDate(b) || 0).getTime();
      return bDate - aDate;
    });
  }, [stops, drivers, search, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const changeFilter = value => {
    setFilter(value);
    setPage(1);
  };

  return (
    <section className="admin-panel admin-deliveries-panel">
      <div className="admin-panel-heading admin-table-heading">
        <div>
          <h2>Recent deliveries</h2>
          <p>Search and review deliveries recorded in your fleet</p>
        </div>
        <div className="admin-table-controls">
          <label className="admin-table-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={event => {
                onSearchChange(event.target.value);
                setPage(1);
              }}
              placeholder="Search deliveries"
              aria-label="Search deliveries"
            />
          </label>
          <label className="admin-filter-select">
            <Filter size={15} aria-hidden="true" />
            <select value={filter} onChange={event => changeFilter(event.target.value)} aria-label="Filter by status">
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
            </select>
          </label>
        </div>
      </div>
      <div className="admin-table-scroll">
        <table className="admin-deliveries-table">
          <thead>
            <tr>
              <th>Tracking ID</th>
              <th>Customer</th>
              <th>Pickup location</th>
              <th>Destination</th>
              <th>Assigned driver</th>
              <th>Delivery date</th>
              <th>Status</th>
              <th><span className="admin-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(stop => {
              const driver = drivers.find(item => item.id === stop.assignedDriverId);
              const label = getStatusLabel(stop.status);
              const pickup = stop.pickupAddress || stop.pickupLocation || '—';
              return (
                <tr key={stop.id}>
                  <td className="admin-tracking-id">{stop.trackingId || stop.id}</td>
                  <td>{stop.customerName || '—'}</td>
                  <td>{pickup}</td>
                  <td>{stop.address || stop.name || '—'}</td>
                  <td>{driver?.name || 'Unassigned'}</td>
                  <td>{formatDate(getStopDate(stop))}</td>
                  <td><span className={`admin-status-badge status-${label.toLowerCase().replace(' ', '-')}`}>{label}</span></td>
                  <td>
                    <button className="admin-view-button" type="button" onClick={() => onViewDelivery(stop)}>
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td className="admin-table-empty" colSpan="8">No deliveries match your search and filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-table-footer">
        <span>{filtered.length ? `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length}` : 'No deliveries'}</span>
        <div>
          <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={currentPage === 1}>Previous</button>
          <span>Page {currentPage} of {pages}</span>
          <button type="button" onClick={() => setPage(current => Math.min(pages, current + 1))} disabled={currentPage === pages}>Next</button>
        </div>
      </div>
    </section>
  );
}

function DriversPanel({ drivers, stops, now, onViewDriver }) {
  if (!drivers.length) {
    return <section className="admin-panel admin-empty-panel"><Truck size={24} /><h2>No drivers yet</h2><p>Drivers added to your fleet will appear here.</p></section>;
  }
  return (
    <section className="admin-panel admin-driver-panel">
      <div className="admin-panel-heading">
        <div><h2>Drivers</h2><p>Driver availability and assigned delivery workload</p></div>
        <span className="admin-panel-count">{drivers.length} total</span>
      </div>
      <div className="admin-driver-list">
        {drivers.map(driver => {
          const fresh = Boolean(
            driver.isTracking &&
            driver.locationUpdatedAt &&
            now - new Date(driver.locationUpdatedAt).getTime() < 90_000
          );
          const assignedCount = stops.filter(stop => stop.assignedDriverId === driver.id && !isDelivered(stop)).length;
          const initials = String(driver.name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
          return (
            <article className="admin-driver-card" key={driver.id}>
              <div className="admin-driver-avatar">{initials}</div>
              <div className="admin-driver-info">
                <strong>{driver.name}</strong>
                <span>{driver.vehicle || driver.zone || driver.email || 'Fleet driver'}</span>
              </div>
              <span className={`admin-driver-status ${fresh ? 'is-online' : ''}`}>
                <i />{fresh ? 'On duty' : driver.routeStatus === 'IN_PROGRESS' ? 'On route' : 'Offline'}
              </span>
              <div className="admin-driver-deliveries"><strong>{assignedCount}</strong><span>assigned</span></div>
              <button type="button" className="admin-view-button" onClick={() => onViewDriver(driver)}>View profile</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActivityPanel({ stops, drivers, now }) {
  const items = useMemo(() => makeActivityItems(stops, drivers), [stops, drivers]);
  return (
    <section className="admin-panel admin-activity-panel">
      <div className="admin-panel-heading"><div><h2>Recent activity</h2><p>Updates with timestamps recorded by your fleet</p></div><Activity size={18} /></div>
      {items.length ? (
        <ol className="admin-activity-list">
          {items.map(item => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <span className="admin-activity-icon"><Icon size={15} /></span>
                <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                <time dateTime={new Date(item.date).toISOString()}>{formatRelativeTime(item.date, now)}</time>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="admin-activity-empty">Activity will appear when delivery or route events include recorded timestamps.</div>
      )}
    </section>
  );
}

function MapPanel({ mapContent, deliveries, onOpenTracking }) {
  const mappedDeliveries = deliveries.filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
  const mappedCount = mappedDeliveries.length;
  return (
    <section className="admin-panel admin-live-map-panel">
      <div className="admin-panel-heading">
        <div><h2>Live delivery map</h2><p>Delivery locations and fresh driver GPS updates</p></div>
        <button type="button" className="admin-text-link" onClick={onOpenTracking}>Open Live Tracking <ExternalLink size={14} /></button>
      </div>
      <div className="admin-map-frame">{mapContent}</div>
      <div className="admin-map-caption">
        <span><i className="map-key-delivery" /> Delivery destinations <b>{mappedCount}</b></span>
        <span><i className="map-key-driver" /> Fresh driver locations</span>
      </div>
      {mappedDeliveries.length > 0 && (
        <div className="admin-map-location-list" aria-label="Mapped delivery destinations">
          {mappedDeliveries.slice(0, 3).map(stop => (
            <span key={stop.id}><MapPin size={12} />{stop.customerName || stop.name || 'Delivery'} · {stop.address || `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`}</span>
          ))}
          {mappedDeliveries.length > 3 && <span>+{mappedDeliveries.length - 3} more destinations</span>}
        </div>
      )}
      <p className="admin-map-note">Driver markers appear only while a driver is sharing a recent GPS location. Delivery markers use saved coordinates.</p>
    </section>
  );
}

function PlaceholderPage({ page, stops, onNavigate }) {
  const item = ADMIN_NAV_ITEMS.find(nav => nav.id === page);
  const Icon = item?.icon || Building2;
  const isNotifications = page === 'NOTIFICATIONS';
  const pending = stops.filter(stop => !isDelivered(stop) && !isFailed(stop));
  return (
    <section className="admin-panel admin-placeholder-panel">
      <span className="admin-placeholder-icon"><Icon size={22} /></span>
      <h2>{item?.label || 'Dashboard'}</h2>
      {isNotifications ? (
        <>
          <p>{pending.length ? `${pending.length} delivery${pending.length === 1 ? '' : 'ies'} currently awaiting completion.` : 'There are no pending deliveries requiring attention.'}</p>
          {pending.length > 0 && <button type="button" className="admin-primary-button" onClick={() => onNavigate('DELIVERIES')}>Review pending deliveries</button>}
        </>
      ) : (
        <>
          <p>This section is ready for a future phase. Your existing route planning, deliveries, driver tracking, and analytics remain available.</p>
          <button type="button" className="admin-primary-button" onClick={() => onNavigate('OVERVIEW')}>Back to overview</button>
        </>
      )}
    </section>
  );
}

export default function AdminDashboard({
  page = 'OVERVIEW',
  currentUser,
  stops,
  drivers,
  now,
  mapContent,
  profileMenu,
  search,
  onSearchChange,
  onNavigate,
  onOpenMenu,
  onTrackDriver
}) {
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const total = stops.length;
  const completed = stops.filter(isDelivered).length;
  const failed = stops.filter(isFailed).length;
  const pending = total - completed - failed;
  const activeDrivers = drivers.filter(driver =>
    driver.isTracking &&
    driver.locationUpdatedAt &&
    now - new Date(driver.locationUpdatedAt).getTime() < 90_000
  ).length;
  const notifications = pending;
  const title = ADMIN_NAV_ITEMS.find(item => item.id === page)?.label || 'Dashboard';

  const changePercent = useMemo(() => {
    const currentPeriodStart = now - (30 * 24 * 60 * 60 * 1000);
    const previousPeriodStart = currentPeriodStart - (30 * 24 * 60 * 60 * 1000);
    const current = stops.filter(stop => isDelivered(stop) && stop.deliveredAt && new Date(stop.deliveredAt).getTime() >= currentPeriodStart).length;
    const previous = stops.filter(stop => isDelivered(stop) && stop.deliveredAt && new Date(stop.deliveredAt).getTime() >= previousPeriodStart && new Date(stop.deliveredAt).getTime() < currentPeriodStart).length;
    if (!previous) return 'No prior-period baseline';
    const percent = Math.round(((current - previous) / previous) * 100);
    return `${percent > 0 ? '+' : ''}${percent}% vs prior 30 days`;
  }, [stops, now]);

  const openDelivery = stop => {
    setSelectedDelivery(stop);
  };

  const overview = page === 'OVERVIEW';
  const isFullMap = page === 'LIVE_TRACKING';
  const showDeliveries = overview || page === 'DELIVERIES';
  const showDrivers = overview || page === 'DRIVERS';
  const showAnalytics = overview || page === 'ANALYTICS';

  return (
    <main className="tobs-admin-dashboard">
      <header className="admin-topbar">
        <div className="admin-topbar-heading">
          <button type="button" className="admin-mobile-menu-button" onClick={onOpenMenu} aria-label="Open navigation">
            <Menu size={19} />
          </button>
          <div className="admin-breadcrumb"><span>Workspace</span><span>/</span><strong>{title}</strong></div>
          <h1>{overview ? `Welcome back, ${currentUser.name?.split(' ')[0] || 'Admin'}` : title}</h1>
          <p>{overview ? 'Here is what is happening across your fleet today.' : 'Manage and monitor your Tobs Circuit operations.'}</p>
        </div>
        <div className="admin-topbar-actions">
          <label className="admin-global-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search deliveries..."
              value={search}
              onChange={event => onSearchChange(event.target.value)}
              aria-label="Search deliveries"
            />
          </label>
          <button
            type="button"
            className="admin-icon-button admin-notification-button"
            title={`${notifications} pending deliveries`}
            aria-label={`${notifications} pending deliveries`}
            onClick={() => onNavigate('NOTIFICATIONS')}
          >
            <Bell size={18} />
            {notifications > 0 && <span>{notifications > 99 ? '99+' : notifications}</span>}
          </button>
          <button type="button" className="admin-icon-button" title="Help and support" aria-label="Help and support">
            <CircleHelp size={18} />
          </button>
          <div className="admin-profile">
            <div className="admin-profile-copy"><strong>{currentUser.name}</strong><span>Administrator</span></div>
            {profileMenu || <ChevronDown size={16} />}
          </div>
        </div>
      </header>

      {isFullMap ? (
        <div className="admin-page-content admin-full-map-page">
          <div className="admin-map-page-heading">
            <div><h2>Live Tracking</h2><p>Only current, driver-shared GPS locations are shown on the map.</p></div>
            <span className="admin-live-indicator"><i />{activeDrivers} drivers sharing location</span>
          </div>
          <div className="admin-map-frame admin-map-frame-full">{mapContent}</div>
          <div className="admin-map-caption"><span><i className="map-key-delivery" /> Delivery destinations</span><span><i className="map-key-driver" /> Fresh driver locations</span></div>
        </div>
      ) : page === 'ROUTES' ? (
        <section className="admin-panel admin-placeholder-panel">
          <span className="admin-placeholder-icon"><Route size={22} /></span>
          <h2>Route Planner</h2>
          <p>Use the route planning workspace to create, assign, and optimize delivery routes.</p>
          <button type="button" className="admin-primary-button" onClick={() => onNavigate('OVERVIEW')}>Back to overview</button>
        </section>
      ) : (showDeliveries || showAnalytics || showDrivers) ? (
        <div className="admin-page-content">
          {overview && (
            <section className="admin-stats-grid" aria-label="Delivery statistics">
              <StatCard icon={Package} label="Total deliveries" value={total.toLocaleString()} note={`${completed.toLocaleString()} completed to date`} tone="blue" />
              <StatCard icon={Clock3} label="Pending deliveries" value={pending.toLocaleString()} note="Awaiting completion" tone="amber" />
              <StatCard icon={CheckCircle2} label="Completed deliveries" value={completed.toLocaleString()} note={changePercent} tone="green" />
              <StatCard icon={Truck} label="Active drivers" value={activeDrivers.toLocaleString()} note={`${drivers.length} drivers in fleet`} tone="purple" />
            </section>
          )}
          {showAnalytics && <DeliveryChart stops={stops} now={now} />}
          {overview && (
            <MapPanel
              mapContent={mapContent}
              deliveries={stops}
              onOpenTracking={() => onNavigate('LIVE_TRACKING')}
            />
          )}
          {showDeliveries && (
            <DeliveryTable
              stops={stops}
              drivers={drivers}
              onViewDelivery={openDelivery}
              search={search}
              onSearchChange={onSearchChange}
            />
          )}
          {showDrivers && <DriversPanel drivers={drivers} stops={stops} now={now} onViewDriver={setSelectedDriver} />}
          {overview && <ActivityPanel stops={stops} drivers={drivers} now={now} />}
        </div>
      ) : (
        <div className="admin-page-content"><PlaceholderPage page={page} stops={stops} onNavigate={onNavigate} /></div>
      )}

      {selectedDelivery && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setSelectedDelivery(null);
        }}>
          <section className="admin-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-details-title">
            <div className="admin-dialog-heading">
              <div><span>Delivery details</span><h2 id="delivery-details-title">{selectedDelivery.trackingId || selectedDelivery.id}</h2></div>
              <button type="button" className="admin-icon-button" onClick={() => setSelectedDelivery(null)} aria-label="Close details"><X size={18} /></button>
            </div>
            <dl>
              <div><dt>Customer</dt><dd>{selectedDelivery.customerName || '—'}</dd></div>
              <div><dt>Pickup location</dt><dd>{selectedDelivery.pickupAddress || selectedDelivery.pickupLocation || '—'}</dd></div>
              <div><dt>Destination</dt><dd>{selectedDelivery.address || '—'}</dd></div>
              <div><dt>Assigned driver</dt><dd>{drivers.find(driver => driver.id === selectedDelivery.assignedDriverId)?.name || 'Unassigned'}</dd></div>
              <div><dt>Delivery date</dt><dd>{formatDate(getStopDate(selectedDelivery))}</dd></div>
              <div><dt>Status</dt><dd><span className={`admin-status-badge status-${getStatusLabel(selectedDelivery.status).toLowerCase().replace(' ', '-')}`}>{getStatusLabel(selectedDelivery.status)}</span></dd></div>
            </dl>
            {selectedDelivery.customerName && <p className="admin-delivery-recipient">Received by {selectedDelivery.customerName}</p>}
          </section>
        </div>
      )}

      {selectedDriver && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setSelectedDriver(null);
        }}>
          <section className="admin-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="driver-profile-title">
            <div className="admin-dialog-heading">
              <div><span>Driver profile</span><h2 id="driver-profile-title">{selectedDriver.name}</h2></div>
              <button type="button" className="admin-icon-button" onClick={() => setSelectedDriver(null)} aria-label="Close driver profile"><X size={18} /></button>
            </div>
            <dl>
              <div><dt>Vehicle</dt><dd>{selectedDriver.vehicle || '—'}</dd></div>
              <div><dt>Operating zone</dt><dd>{selectedDriver.zone || '—'}</dd></div>
              <div><dt>Email</dt><dd>{selectedDriver.email || '—'}</dd></div>
              <div><dt>Phone</dt><dd>{selectedDriver.phone || '—'}</dd></div>
              <div><dt>Current status</dt><dd>{selectedDriver.isTracking && selectedDriver.locationUpdatedAt && now - new Date(selectedDriver.locationUpdatedAt).getTime() < 90_000 ? 'On duty · sharing location' : selectedDriver.routeStatus === 'IN_PROGRESS' ? 'On route' : 'Offline'}</dd></div>
              <div><dt>Last GPS update</dt><dd>{selectedDriver.isTracking && selectedDriver.locationUpdatedAt ? formatRelativeTime(selectedDriver.locationUpdatedAt, now) : 'Not sharing'}</dd></div>
              <div><dt>Assigned deliveries</dt><dd>{stops.filter(stop => stop.assignedDriverId === selectedDriver.id && !isDelivered(stop)).length}</dd></div>
            </dl>
            {selectedDriver.isTracking
              && selectedDriver.locationUpdatedAt
              && now - new Date(selectedDriver.locationUpdatedAt).getTime() < 90_000
              && Number.isFinite(selectedDriver.lat)
              && Number.isFinite(selectedDriver.lng) && (
              <button
                type="button"
                className="admin-primary-button"
                onClick={() => {
                  onTrackDriver(selectedDriver.id);
                  setSelectedDriver(null);
                }}
              >
                Track driver on map
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
