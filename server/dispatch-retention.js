export const DISPATCH_GPS_RETENTION_DAYS = 14;

export const DELETE_EXPIRED_GPS_BATCH_SQL = `
  WITH expired_locations AS (
    SELECT location_id
    FROM public.rider_location_history
    WHERE recorded_at < NOW() - ($1::integer * INTERVAL '1 day')
    ORDER BY recorded_at
    LIMIT 1000
  )
  DELETE FROM public.rider_location_history AS history
  USING expired_locations
  WHERE history.location_id = expired_locations.location_id
  RETURNING history.location_id
`;
