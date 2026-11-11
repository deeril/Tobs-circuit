export const PUBLIC_MARKETPLACE_DRIVERS_SQL = `
  SELECT profile.rider_id, profile.vehicle_type,
         location.latitude AS lat, location.longitude AS lng,
         location.recorded_at AS location_updated_at,
         driver.name, driver.vehicle, driver.zone,
         6371 * 2 * ASIN(SQRT(
           POWER(SIN(RADIANS(location.latitude - $1) / 2), 2)
           + COS(RADIANS($1)) * COS(RADIANS(location.latitude))
           * POWER(SIN(RADIANS(location.longitude - $2) / 2), 2)
         )) AS distance_km
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
    LIMIT 1
  ) AS driver ON TRUE
  WHERE profile.is_active = TRUE AND profile.is_available = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM delivery_assignments AS assignment
      WHERE assignment.rider_id = profile.rider_id AND assignment.status = 'ACTIVE'
    )
    AND ($3::boolean = FALSE OR (
      location.latitude BETWEEN $1 - 10 / 110.574 AND $1 + 10 / 110.574
      AND location.longitude BETWEEN $2
        - 10 / (111.320 * GREATEST(0.1, ABS(COS(RADIANS($1)))))
        AND $2 + 10 / (111.320 * GREATEST(0.1, ABS(COS(RADIANS($1)))))
    ))
  ORDER BY distance_km, profile.rider_id
`;
