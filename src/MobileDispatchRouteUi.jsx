import { useState } from 'react';
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Menu,
  Navigation,
  Plus,
  Search,
  Truck,
  X
} from 'lucide-react';

const COMPLETED_STATUSES = new Set(['DELIVERED', 'COMPLETED']);
const TERMINAL_STATUSES = new Set([
  ...COMPLETED_STATUSES,
  'FAILED',
  'UNDELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED'
]);

function getStopStatus(stop) {
  return String(stop.dispatchStatus || stop.status || '').toUpperCase();
}

export default function MobileDispatchRouteUi({
  currentUser,
  visible = true,
  activeAdminView,
  navItems,
  activeDriver,
  drivers,
  stops,
  routeStops,
  selectedStopId,
  routeMetrics,
  routeSequenceSummary,
  routeSequenceSaving,
  canOptimizeRoute,
  deliveryOfferError,
  mapExpanded,
  menuOpen,
  onOpenMenu,
  onToggleProfileMenu,
  onCloseMenu,
  onToggleMap,
  onNavigate,
  onPickDriver,
  onOpenAddStop,
  onOptimizeRoute,
  onOpenRoute,
  onSelectStop,
  onNavigateNext
}) {
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const [driverPickerOpen, setDriverPickerOpen] = useState(false);
  const nextStop = routeStops.find(stop => !TERMINAL_STATUSES.has(getStopStatus(stop)));
  const driverStatus = activeDriver?.routeStatus === 'IN_PROGRESS'
    ? 'On route'
    : activeDriver?.isTracking
      ? 'Live location'
      : activeDriver?.isAvailable
        ? 'Available'
        : 'Offline';

  return (
    <div className={`mobile-dispatch-ui${mapExpanded ? ' is-map-expanded' : ''}${visible ? '' : ' is-hidden'}`}>
      <header className="mobile-dispatch-topbar">
        <button
          type="button"
          className="mobile-dispatch-icon-button"
          aria-label="Open navigation"
          onClick={onOpenMenu}
        >
          <Menu aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mobile-dispatch-driver-pill"
          aria-expanded={driverPickerOpen}
          aria-label={`Selected rider: ${activeDriver?.name || 'Choose a rider'}`}
          onClick={() => setDriverPickerOpen(open => !open)}
        >
          <span className={`mobile-dispatch-status-dot${activeDriver?.isTracking ? ' is-live' : ''}`} />
          <span className="mobile-dispatch-driver-name">{activeDriver?.name || 'Choose rider'}</span>
          {Number.isFinite(activeDriver?.speed) && (
            <span className="mobile-dispatch-speed">{Math.round(activeDriver.speed)} km/h</span>
          )}
          <ChevronDown aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mobile-dispatch-profile"
          aria-label="Open account menu"
          onClick={onToggleProfileMenu}
        >
          {String(currentUser.name || 'Tobs').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}
        </button>
      </header>

      <button
        type="button"
        className="mobile-dispatch-map-toggle"
        aria-label={mapExpanded ? 'Return to route' : 'Expand map'}
        onClick={onToggleMap}
      >
        {mapExpanded ? <ChevronDown aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
      </button>

      {driverPickerOpen && (
        <div className="mobile-dispatch-driver-picker" role="listbox" aria-label="Choose a rider">
          <div className="mobile-dispatch-picker-heading">
            <span>Riders</span>
            <button type="button" aria-label="Close rider list" onClick={() => setDriverPickerOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>
          {drivers.map(driver => {
            const isSelected = driver.id === activeDriver?.id;
            const stopCount = stops.filter(stop => stop.assignedDriverId === driver.id).length;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                key={driver.id}
                className={`mobile-dispatch-driver-option${isSelected ? ' is-selected' : ''}`}
                onClick={() => {
                  onPickDriver(driver.id);
                  setDriverPickerOpen(false);
                }}
              >
                <span className="mobile-dispatch-driver-avatar">
                  {String(driver.name || 'R').charAt(0).toUpperCase()}
                </span>
                <span className="mobile-dispatch-driver-option-copy">
                  <strong>{driver.name}</strong>
                  <small>{driver.vehicle || driver.zone || 'Rider'}</small>
                </span>
                <span className="mobile-dispatch-stop-count">{stopCount} stops</span>
              </button>
            );
          })}
          {drivers.length === 0 && <p className="mobile-dispatch-empty">No riders available.</p>}
        </div>
      )}

      {!mapExpanded && (
        <section
          className={`mobile-dispatch-sheet${sheetExpanded ? ' is-expanded' : ' is-peek'}`}
          aria-label="Active delivery route"
        >
          <button
            type="button"
            className="mobile-dispatch-sheet-handle"
            aria-label={sheetExpanded ? 'Collapse route sheet' : 'Expand route sheet'}
            aria-expanded={sheetExpanded}
            onClick={() => setSheetExpanded(expanded => !expanded)}
          >
            <span />
          </button>

          <div className="mobile-dispatch-sheet-intro">
            <button type="button" className="mobile-dispatch-add-search" onClick={onOpenAddStop}>
              <span className="mobile-dispatch-add-copy">
                <Search aria-hidden="true" />
                <span>
                  <strong>Where to?</strong>
                  <small>Add a delivery stop</small>
                </span>
              </span>
              <span className="mobile-dispatch-add-pill"><Plus aria-hidden="true" /> Add</span>
            </button>

            <div className="mobile-dispatch-quick-actions">
              <button type="button" disabled={!canOptimizeRoute || routeSequenceSaving} onClick={onOptimizeRoute}>
                <ArrowDownUp aria-hidden="true" />
                <span>{routeSequenceSaving ? 'Calculating route' : 'Closest → Farthest'}</span>
              </button>
              <button type="button" onClick={onOpenRoute}>
                <Navigation aria-hidden="true" />
                <span>Open route</span>
              </button>
              <button type="button" onClick={() => setDriverPickerOpen(true)}>
                <Truck aria-hidden="true" />
                <span>Riders</span>
              </button>
            </div>

            <div className="mobile-dispatch-route-summary">
              <span>
                {routeMetrics.completed}/{routeMetrics.total} stops
                {routeMetrics.total > 0 && ` · ${routeMetrics.totalKm} km · ~${routeMetrics.hours}h ${routeMetrics.mins}m`}
              </span>
              <button
                type="button"
                aria-label={sheetExpanded ? 'Collapse route sheet' : 'Expand route sheet'}
                onClick={() => setSheetExpanded(expanded => !expanded)}
              >
                {sheetExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
              </button>
            </div>
            {routeSequenceSummary && (
              <p className="mobile-dispatch-route-status" role="status">
                Road route saved · {routeSequenceSummary.distanceKm.toFixed(1)} km · about {routeSequenceSummary.durationMinutes} min
              </p>
            )}
            {deliveryOfferError && (
              <p className="mobile-dispatch-route-error" role="alert">{deliveryOfferError}</p>
            )}
          </div>

          <div className="mobile-dispatch-stops">
            {routeStops.length === 0 ? (
              <div className="mobile-dispatch-empty-stops">
                <MapPin aria-hidden="true" />
                <p>No stops on this route yet.</p>
                <button type="button" onClick={onOpenAddStop}>Add the first stop</button>
              </div>
            ) : routeStops.map((stop, index) => {
              const status = getStopStatus(stop);
              const isCompleted = COMPLETED_STATUSES.has(status);
              const isSelected = stop.id === selectedStopId;
              const stopNumber = stop.routeSequence ?? stop.routeOrder ?? index + 1;
              return (
                <button
                  type="button"
                  key={stop.id}
                  className={`mobile-dispatch-stop${isSelected ? ' is-selected' : ''}${isCompleted ? ' is-completed' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelectStop(stop.id)}
                >
                  <span className={`mobile-dispatch-stop-number${isCompleted ? ' is-completed' : ''}${isSelected ? ' is-selected' : ''}`}>
                    {isCompleted ? <Check aria-label={`Stop ${stopNumber} completed`} /> : stopNumber}
                  </span>
                  <span className="mobile-dispatch-stop-copy">
                    <strong>{stop.name || `Delivery ${stopNumber}`}</strong>
                    <small>{stop.address || 'Address not provided'}</small>
                    <span>
                      {stop.recipientName || stop.receiverName || stop.recipient || ''}
                      {stop.packages ? ` · ${stop.packages} package${stop.packages === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  <span className="mobile-dispatch-stop-meta">
                    {stop.priority && <small>{String(stop.priority).replaceAll('_', ' ')}</small>}
                    <Navigation aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>

          <footer className="mobile-dispatch-sheet-footer">
            {nextStop ? (
              <button type="button" className="mobile-dispatch-next-stop" onClick={() => onNavigateNext(nextStop)}>
                <Navigation aria-hidden="true" />
                <span>
                  <strong>Navigate next stop</strong>
                  <small>{nextStop.address || nextStop.name}</small>
                </span>
              </button>
            ) : (
              <button type="button" className="mobile-dispatch-next-stop" onClick={onOpenAddStop}>
                <Plus aria-hidden="true" />
                <span><strong>All stops complete · Add more</strong></span>
              </button>
            )}
          </footer>
        </section>
      )}

      {menuOpen && (
        <div className="mobile-dispatch-menu-layer">
          <button
            type="button"
            className="mobile-dispatch-menu-backdrop"
            aria-label="Close navigation"
            onClick={onCloseMenu}
          />
          <nav className="mobile-dispatch-menu" aria-label="Admin navigation">
            <div className="mobile-dispatch-menu-heading">
              <div>
                <strong>Tobs Circuit</strong>
                <small>{currentUser.name} · {currentUser.orgName || 'Fleet'}</small>
              </div>
              <button type="button" aria-label="Close navigation" onClick={onCloseMenu}>
                <X aria-hidden="true" />
              </button>
            </div>
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                aria-current={activeAdminView === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{driverStatus}</span>
    </div>
  );
}
