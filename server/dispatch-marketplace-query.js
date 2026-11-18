export const PUBLIC_MARKETPLACE_DRIVERS_SQL = `
  SELECT profile.rider_id, profile.vehicle_type,
         location.latitude AS lat, location.longitude AS lng,
         location.recorded_at AS location_updated_at,
         driver.name, driver.vehicle, driver.zone,
         search_distance.distance_km
  FROM rider_dispatch_profiles AS profile
  JOIN rider_current_locations AS location
    ON location.rider_id = profile.rider_id
   AND location.sharing_enabled = TRUE
   AND location.recorded_at > NOW() - INTERVAL '90 seconds'
  JOIN LATERAL (
    SELECT state_user->>'name' AS name,
           state_user->>'vehicle' AS vehicle,
           state_user->>'zone' AS zone
    FROM tobs_app_state AS app_state
    CROSS JOIN LATERAL jsonb_array_elements(app_state.state->'users') AS state_user
    WHERE state_user->>'id' = profile.rider_id
      AND state_user->>'role' = 'DRIVER'
      AND state_user->>'status' = 'ACTIVE'
      AND COALESCE(state_user->>'driverProfileComplete', 'true') = 'true'
    LIMIT 1
  ) AS driver ON TRUE
  CROSS JOIN LATERAL (
    SELECT MIN(6371 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(location.latitude - center.latitude) / 2), 2)
      + COS(RADIANS(center.latitude)) * COS(RADIANS(location.latitude))
      * POWER(SIN(RADIANS(location.longitude - center.longitude) / 2), 2)
    ))) AS distance_km
    FROM (VALUES
      ($1::double precision, $2::double precision, $5::boolean),
      ($3::double precision, $4::double precision, $6::boolean)
    ) AS center(latitude, longitude, enabled)
    WHERE center.enabled = TRUE
  ) AS search_distance
  WHERE profile.is_active = TRUE AND profile.is_available = TRUE
    AND ($5::boolean = TRUE OR $6::boolean = TRUE)
    AND NOT EXISTS (
      SELECT 1 FROM delivery_assignments AS assignment
      WHERE assignment.rider_id = profile.rider_id AND assignment.status = 'ACTIVE'
    )
    AND search_distance.distance_km <= 5
  ORDER BY search_distance.distance_km, profile.rider_id
`;
