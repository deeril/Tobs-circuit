const TERMINAL_STATUSES = new Set([
  'DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'COMPLETED', 'REASSIGNED'
]);

export function hasActiveRiderAssignment(assignments, stops, riderId) {
  if (!riderId) return false;
  if (Array.isArray(assignments) && assignments.some(assignment =>
    assignment.riderId === riderId && !TERMINAL_STATUSES.has(String(assignment.status || '').toUpperCase())
  )) return true;
  return Array.isArray(stops) && stops.some(stop =>
    stop.assignedDriverId === riderId
    && !TERMINAL_STATUSES.has(String(stop.status || '').toUpperCase())
    && !TERMINAL_STATUSES.has(String(stop.dispatchStatus || '').toUpperCase())
  );
}