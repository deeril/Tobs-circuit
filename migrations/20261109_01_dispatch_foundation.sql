BEGIN;

LOCK TABLE tobs_app_state IN SHARE MODE;

DO $$
DECLARE
  duplicate_delivery_id TEXT;
BEGIN
  SELECT stop->>'id'
  INTO duplicate_delivery_id
  FROM tobs_app_state AS app_state
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'stops', '[]'::jsonb)) AS stop
  WHERE NULLIF(stop->>'id', '') IS NOT NULL
  GROUP BY stop->>'id'
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF duplicate_delivery_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch migration preflight found duplicate legacy delivery ID: %',
      duplicate_delivery_id;
  END IF;

END $$;

CREATE TABLE dispatch_deliveries (
  delivery_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'UNASSIGNED', 'FINDING_RIDER', 'RIDER_ASSIGNED', 'RIDER_ACCEPTED',
    'HEADING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION',
    'DELIVERED', 'FAILED', 'CANCELLED'
  )),
  zone_id TEXT,
  pickup_address TEXT NOT NULL DEFAULT '',
  pickup_lat DOUBLE PRECISION CHECK (pickup_lat IS NULL OR pickup_lat BETWEEN -90 AND 90),
  pickup_lng DOUBLE PRECISION CHECK (pickup_lng IS NULL OR pickup_lng BETWEEN -180 AND 180),
  destination_address TEXT NOT NULL DEFAULT '',
  destination_lat DOUBLE PRECISION CHECK (destination_lat IS NULL OR destination_lat BETWEEN -90 AND 90),
  destination_lng DOUBLE PRECISION CHECK (destination_lng IS NULL OR destination_lng BETWEEN -180 AND 180),
  package_count INTEGER NOT NULL DEFAULT 1 CHECK (package_count > 0),
  package_description TEXT NOT NULL DEFAULT '',
  package_size TEXT,
  package_weight_kg NUMERIC CHECK (package_weight_kg IS NULL OR package_weight_kg > 0),
  required_vehicle_type TEXT,
  rider_earnings_ngn NUMERIC CHECK (rider_earnings_ngn IS NULL OR rider_earnings_ngn >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX dispatch_delivery_business_idx
  ON dispatch_deliveries (business_id, updated_at DESC);

CREATE TABLE dispatch_business_riders (
  business_id TEXT NOT NULL,
  rider_id TEXT NOT NULL,
  zone_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, rider_id)
);
CREATE INDEX dispatch_business_riders_rider_idx
  ON dispatch_business_riders (rider_id, active);

CREATE TABLE rider_dispatch_profiles (
  rider_id TEXT PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_type TEXT,
  max_package_size TEXT,
  max_package_weight_kg NUMERIC
    CHECK (max_package_weight_kg IS NULL OR max_package_weight_kg > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rider_current_locations (
  rider_id TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  sharing_enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX rider_current_locations_fresh_idx
  ON rider_current_locations (recorded_at)
  WHERE sharing_enabled = TRUE;

CREATE TABLE dispatch_offers (
  offer_id UUID PRIMARY KEY,
  batch_id UUID NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  business_id TEXT NOT NULL,
  rider_id TEXT NOT NULL,
  search_radius_km SMALLINT NOT NULL CHECK (search_radius_km IN (3, 5, 10)),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REASSIGNED'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  UNIQUE (offer_id, delivery_id)
);
CREATE UNIQUE INDEX dispatch_one_pending_offer_per_rider_idx
  ON dispatch_offers (delivery_id, rider_id)
  WHERE status = 'PENDING';
CREATE INDEX dispatch_offer_expiry_idx
  ON dispatch_offers (expires_at)
  WHERE status = 'PENDING';
CREATE INDEX dispatch_offer_rider_idx
  ON dispatch_offers (rider_id, status, expires_at);
CREATE INDEX dispatch_offer_batch_idx
  ON dispatch_offers (batch_id, rider_id, status);
CREATE INDEX dispatch_offer_business_delivery_idx
  ON dispatch_offers (business_id, delivery_id, status, expires_at);

CREATE TABLE delivery_assignments (
  assignment_id UUID PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  offer_id UUID,
  rider_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'ACTIVE', 'CANCELLED', 'COMPLETED', 'REASSIGNED'
  )),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  FOREIGN KEY (offer_id, delivery_id)
    REFERENCES dispatch_offers (offer_id, delivery_id)
);
CREATE UNIQUE INDEX delivery_one_active_assignment_idx
  ON delivery_assignments (delivery_id)
  WHERE status = 'ACTIVE';
CREATE INDEX delivery_assignment_history_idx
  ON delivery_assignments (delivery_id, assigned_at DESC);

CREATE TABLE delivery_assignment_history (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES delivery_assignments(assignment_id),
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ASSIGNED', 'CANCELLED', 'COMPLETED', 'REASSIGNED'
  )),
  actor_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX delivery_assignment_events_idx
  ON delivery_assignment_history (delivery_id, occurred_at);

CREATE TABLE delivery_status_history (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  status TEXT NOT NULL,
  actor_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX delivery_status_events_idx
  ON delivery_status_history (delivery_id, occurred_at);

CREATE TABLE rider_location_history (
  location_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rider_id TEXT NOT NULL,
  delivery_id TEXT REFERENCES dispatch_deliveries(delivery_id),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  context TEXT NOT NULL CHECK (context IN (
    'AVAILABLE_FOR_MATCHING', 'ACTIVE_DELIVERY'
  )),
  recorded_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (context = 'ACTIVE_DELIVERY' AND delivery_id IS NOT NULL)
    OR (context = 'AVAILABLE_FOR_MATCHING' AND delivery_id IS NULL)
  )
);
CREATE INDEX rider_location_history_retention_idx
  ON rider_location_history (recorded_at);
CREATE INDEX rider_location_history_rider_idx
  ON rider_location_history (rider_id, recorded_at DESC);

CREATE TABLE rider_location_access_audit (
  access_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rider_id TEXT NOT NULL,
  delivery_id TEXT,
  actor_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO dispatch_deliveries (
  delivery_id, business_id, status, zone_id, pickup_address, pickup_lat, pickup_lng,
  destination_address, destination_lat, destination_lng, package_count,
  package_description, package_size, package_weight_kg, required_vehicle_type,
  rider_earnings_ngn, updated_at
)
SELECT
  stop->>'id',
  stop->>'ownerAdminId',
  CASE
    WHEN upper(COALESCE(stop->>'dispatchStatus', '')) IN (
      'FINDING_RIDER', 'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP',
      'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION', 'DELIVERED', 'FAILED', 'CANCELLED'
    ) THEN upper(stop->>'dispatchStatus')
    WHEN upper(COALESCE(stop->>'status', '')) = 'DELIVERED' THEN 'DELIVERED'
    WHEN upper(COALESCE(stop->>'status', '')) IN ('FAILED', 'UNDELIVERED', 'DELIVERY_FAILED') THEN 'FAILED'
    WHEN upper(COALESCE(stop->>'status', '')) = 'CANCELLED' THEN 'CANCELLED'
    WHEN NULLIF(stop->>'assignedDriverId', '') IS NOT NULL THEN 'RIDER_ASSIGNED'
    ELSE 'UNASSIGNED'
  END,
  NULLIF(stop->>'zoneId', ''),
  COALESCE(stop->>'pickupAddress', ''),
  CASE WHEN jsonb_typeof(stop->'pickupLat') = 'number'
        AND (stop->>'pickupLat')::double precision BETWEEN -90 AND 90
    THEN (stop->>'pickupLat')::double precision END,
  CASE WHEN jsonb_typeof(stop->'pickupLng') = 'number'
        AND (stop->>'pickupLng')::double precision BETWEEN -180 AND 180
    THEN (stop->>'pickupLng')::double precision END,
  COALESCE(stop->>'address', ''),
  CASE WHEN jsonb_typeof(stop->'lat') = 'number'
        AND (stop->>'lat')::double precision BETWEEN -90 AND 90
    THEN (stop->>'lat')::double precision END,
  CASE WHEN jsonb_typeof(stop->'lng') = 'number'
        AND (stop->>'lng')::double precision BETWEEN -180 AND 180
    THEN (stop->>'lng')::double precision END,
  CASE WHEN stop->>'packages' ~ '^[0-9]+$'
    THEN GREATEST(1, (stop->>'packages')::integer) ELSE 1 END,
  COALESCE(stop->>'packageDescription', ''),
  NULLIF(stop->>'packageSize', ''),
  CASE WHEN jsonb_typeof(stop->'packageWeightKg') = 'number' THEN (stop->>'packageWeightKg')::numeric END,
  NULLIF(stop->>'requiredVehicleType', ''),
  CASE WHEN jsonb_typeof(stop->'riderEarningsNgn') = 'number' THEN (stop->>'riderEarningsNgn')::numeric END,
  NOW()
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'stops', '[]'::jsonb)) AS stop
WHERE NULLIF(stop->>'id', '') IS NOT NULL
  AND NULLIF(stop->>'ownerAdminId', '') IS NOT NULL
ON CONFLICT (delivery_id) DO NOTHING;

INSERT INTO dispatch_business_riders (business_id, rider_id, zone_id)
SELECT DISTINCT user_record->>'ownerAdminId', user_record->>'id', NULLIF(user_record->>'zone', '')
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'users', '[]'::jsonb)) AS user_record
WHERE user_record->>'role' = 'DRIVER'
  AND NULLIF(user_record->>'ownerAdminId', '') IS NOT NULL
  AND NULLIF(user_record->>'id', '') IS NOT NULL
ON CONFLICT (business_id, rider_id) DO NOTHING;

INSERT INTO rider_dispatch_profiles (
  rider_id, is_active, is_available, vehicle_type, max_package_size,
  max_package_weight_kg, updated_at
)
SELECT user_record->>'id',
       COALESCE(user_record->>'status', 'ACTIVE') = 'ACTIVE',
       COALESCE((user_record->>'isAvailable')::boolean, FALSE),
       NULLIF(user_record->>'vehicleType', ''),
       NULLIF(user_record->>'maxPackageSize', ''),
       CASE
         WHEN jsonb_typeof(user_record->'maxPackageWeightKg') = 'number'
           THEN (user_record->>'maxPackageWeightKg')::numeric
       END,
       NOW()
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'users', '[]'::jsonb)) AS user_record
WHERE user_record->>'role' = 'DRIVER'
  AND NULLIF(user_record->>'id', '') IS NOT NULL
ON CONFLICT (rider_id) DO NOTHING;

INSERT INTO rider_current_locations (
  rider_id, latitude, longitude, recorded_at, sharing_enabled
)
SELECT user_record->>'id',
       (user_record->>'lat')::double precision,
       (user_record->>'lng')::double precision,
       (user_record->>'locationUpdatedAt')::timestamptz,
       TRUE
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'users', '[]'::jsonb)) AS user_record
WHERE user_record->>'role' = 'DRIVER'
  AND COALESCE((user_record->>'isTracking')::boolean, FALSE)
  AND jsonb_typeof(user_record->'lat') = 'number'
  AND jsonb_typeof(user_record->'lng') = 'number'
  AND (user_record->>'lat')::double precision BETWEEN -90 AND 90
  AND (user_record->>'lng')::double precision BETWEEN -180 AND 180
  AND (user_record->>'locationUpdatedAt')::timestamptz > NOW() - INTERVAL '90 seconds'
ON CONFLICT (rider_id) DO NOTHING;

INSERT INTO dispatch_offers (
  offer_id, batch_id, delivery_id, business_id, rider_id, search_radius_km,
  status, created_at, expires_at, responded_at
)
SELECT
  CASE
    WHEN offer->>'acceptedRiderId' = rider_id
      THEN CASE WHEN offer->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (offer->>'id')::uuid ELSE md5(offer->>'id')::uuid END
    ELSE md5((offer->>'id') || ':' || rider_id)::uuid
  END,
  CASE WHEN offer->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (offer->>'id')::uuid ELSE md5(offer->>'id')::uuid END,
  offer->>'stopId',
  offer->>'ownerAdminId',
  rider_id,
  5,
  CASE
    WHEN offer->>'acceptedRiderId' = rider_id THEN 'ACCEPTED'
    WHEN COALESCE(offer->'rejectedByIds', '[]'::jsonb) ? rider_id THEN 'REJECTED'
    WHEN (offer->>'expiresAt')::timestamptz <= NOW() THEN 'EXPIRED'
    WHEN offer->>'status' = 'OPEN' THEN 'PENDING'
    ELSE 'CANCELLED'
  END,
  COALESCE((offer->>'createdAt')::timestamptz, NOW()),
  COALESCE((offer->>'expiresAt')::timestamptz, NOW()),
  CASE
    WHEN offer->>'acceptedRiderId' = rider_id
      THEN COALESCE((offer->>'acceptedAt')::timestamptz, NOW())
    WHEN COALESCE(offer->'rejectedByIds', '[]'::jsonb) ? rider_id THEN NOW()
  END
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'deliveryOffers', '[]'::jsonb)) AS offer
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(offer->'riderIds', '[]'::jsonb)) AS rider_id
WHERE NULLIF(offer->>'id', '') IS NOT NULL
  AND offer->>'id' ~* '^[a-z0-9_-]{1,100}$'
  AND NULLIF(offer->>'stopId', '') IS NOT NULL
  AND NULLIF(offer->>'ownerAdminId', '') IS NOT NULL
  AND NULLIF(rider_id, '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM dispatch_deliveries AS delivery
    WHERE delivery.delivery_id = offer->>'stopId'
      AND delivery.business_id = offer->>'ownerAdminId'
  )
ON CONFLICT (offer_id) DO NOTHING;

INSERT INTO delivery_assignments (
  assignment_id, delivery_id, offer_id, rider_id, business_id, status,
  assigned_at, ended_at, end_reason
)
SELECT
  gen_random_uuid(),
  assignment_record->>'deliveryId',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM dispatch_offers AS offer
      WHERE offer.offer_id = CASE
          WHEN assignment_record->>'offerId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (assignment_record->>'offerId')::uuid
          ELSE NULL
        END
        AND offer.delivery_id = assignment_record->>'deliveryId'
        AND offer.rider_id = assignment_record->>'riderId'
        AND offer.status = 'ACCEPTED'
    ) THEN (assignment_record->>'offerId')::uuid
  END,
  assignment_record->>'riderId',
  assignment_record->>'ownerAdminId',
  CASE
    WHEN stop->>'assignedDriverId' = assignment_record->>'riderId'
      AND upper(COALESCE(stop->>'status', '')) NOT IN (
        'DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED'
      )
      AND upper(COALESCE(stop->>'dispatchStatus', '')) NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
      THEN 'ACTIVE'
    WHEN upper(COALESCE(stop->>'status', '')) = 'DELIVERED'
      OR upper(COALESCE(stop->>'dispatchStatus', '')) = 'DELIVERED' THEN 'COMPLETED'
    ELSE 'CANCELLED'
  END,
  COALESCE((assignment_record->>'acceptedAt')::timestamptz, NOW()),
  CASE
    WHEN stop->>'assignedDriverId' = assignment_record->>'riderId'
      AND upper(COALESCE(stop->>'status', '')) NOT IN (
        'DELIVERED', 'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED'
      )
      AND upper(COALESCE(stop->>'dispatchStatus', '')) NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
      THEN NULL
    ELSE COALESCE((stop->>'deliveredAt')::timestamptz, NOW())
  END,
  CASE
    WHEN upper(COALESCE(stop->>'status', '')) = 'DELIVERED'
      OR upper(COALESCE(stop->>'dispatchStatus', '')) = 'DELIVERED'
      THEN 'DELIVERED_BEFORE_DISPATCH_MIGRATION'
    ELSE 'HISTORICAL_OR_SUPERSEDED_ASSIGNMENT'
  END
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'stops', '[]'::jsonb)) AS stop
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'deliveryAssignments', '[]'::jsonb)) AS assignment_record
WHERE assignment_record->>'deliveryId' = stop->>'id'
  AND NULLIF(assignment_record->>'riderId', '') IS NOT NULL
  AND NULLIF(assignment_record->>'ownerAdminId', '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM dispatch_deliveries AS delivery
    WHERE delivery.delivery_id = stop->>'id'
      AND delivery.business_id = assignment_record->>'ownerAdminId'
  );

INSERT INTO delivery_assignments (
  assignment_id, delivery_id, offer_id, rider_id, business_id, status,
  assigned_at, ended_at, end_reason
)
SELECT
  gen_random_uuid(),
  stop->>'id',
  NULL,
  stop->>'assignedDriverId',
  stop->>'ownerAdminId',
  CASE
    WHEN upper(COALESCE(stop->>'status', '')) = 'DELIVERED'
      OR upper(COALESCE(stop->>'dispatchStatus', '')) = 'DELIVERED' THEN 'COMPLETED'
    WHEN upper(COALESCE(stop->>'status', '')) IN (
      'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED'
    ) OR upper(COALESCE(stop->>'dispatchStatus', '')) IN ('FAILED', 'CANCELLED')
      THEN 'CANCELLED'
    ELSE 'ACTIVE'
  END,
  COALESCE((stop->>'acceptedAt')::timestamptz, (stop->>'assignedAt')::timestamptz, NOW()),
  CASE
    WHEN upper(COALESCE(stop->>'status', '')) = 'DELIVERED'
      OR upper(COALESCE(stop->>'dispatchStatus', '')) = 'DELIVERED'
      OR upper(COALESCE(stop->>'status', '')) IN (
        'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED'
      ) OR upper(COALESCE(stop->>'dispatchStatus', '')) IN ('FAILED', 'CANCELLED')
      THEN COALESCE((stop->>'deliveredAt')::timestamptz, NOW())
  END,
  CASE
    WHEN upper(COALESCE(stop->>'status', '')) = 'DELIVERED'
      OR upper(COALESCE(stop->>'dispatchStatus', '')) = 'DELIVERED'
      THEN 'DELIVERED_BEFORE_DISPATCH_MIGRATION'
    WHEN upper(COALESCE(stop->>'status', '')) IN (
      'FAILED', 'UNDELIVERED', 'DELIVERY_FAILED', 'CANCELLED'
    ) OR upper(COALESCE(stop->>'dispatchStatus', '')) IN ('FAILED', 'CANCELLED')
      THEN 'TERMINAL_BEFORE_DISPATCH_MIGRATION'
    ELSE 'LEGACY_STOP_ASSIGNMENT'
  END
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'stops', '[]'::jsonb)) AS stop
WHERE NULLIF(stop->>'assignedDriverId', '') IS NOT NULL
  AND NULLIF(stop->>'id', '') IS NOT NULL
  AND NULLIF(stop->>'ownerAdminId', '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM delivery_assignments AS assignment
    WHERE assignment.delivery_id = stop->>'id'
      AND assignment.rider_id = stop->>'assignedDriverId'
  );

INSERT INTO rider_location_history (
  rider_id, delivery_id, latitude, longitude, context, recorded_at
)
SELECT location.rider_id,
       active_assignment.delivery_id,
       location.latitude,
       location.longitude,
       CASE WHEN active_assignment.delivery_id IS NULL
         THEN 'AVAILABLE_FOR_MATCHING' ELSE 'ACTIVE_DELIVERY' END,
       location.recorded_at
FROM rider_current_locations AS location
JOIN rider_dispatch_profiles AS profile ON profile.rider_id = location.rider_id
LEFT JOIN LATERAL (
  SELECT assignment.delivery_id
  FROM delivery_assignments AS assignment
  WHERE assignment.rider_id = location.rider_id AND assignment.status = 'ACTIVE'
  ORDER BY assignment.assigned_at DESC
  LIMIT 1
) AS active_assignment ON TRUE
WHERE location.sharing_enabled = TRUE
  AND (active_assignment.delivery_id IS NOT NULL OR profile.is_available = TRUE);

INSERT INTO delivery_assignment_history (
  assignment_id, delivery_id, event_type, actor_id, occurred_at, details
)
SELECT assignment.assignment_id,
       assignment.delivery_id,
       CASE assignment.status
         WHEN 'ACTIVE' THEN 'ASSIGNED'
         WHEN 'COMPLETED' THEN 'COMPLETED'
         WHEN 'REASSIGNED' THEN 'REASSIGNED'
         ELSE 'CANCELLED'
       END,
       assignment.rider_id,
       assignment.assigned_at,
       jsonb_build_object('source', 'jsonb_backfill', 'assignmentStatus', assignment.status)
FROM delivery_assignments AS assignment;

INSERT INTO delivery_status_history (delivery_id, status, occurred_at, actor_id)
SELECT stop->>'id',
       history_entry->>'status',
       COALESCE((history_entry->>'at')::timestamptz, NOW()),
       NULLIF(history_entry->>'riderId', '')
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'stops', '[]'::jsonb)) AS stop
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(stop->'dispatchStatusHistory', '[]'::jsonb)) AS history_entry
WHERE NULLIF(stop->>'id', '') IS NOT NULL
  AND NULLIF(history_entry->>'status', '') IS NOT NULL;

INSERT INTO delivery_status_history (delivery_id, status, occurred_at, actor_id)
SELECT delivery.delivery_id,
       delivery.status,
       delivery.updated_at,
       delivery.business_id
FROM dispatch_deliveries AS delivery
WHERE NOT EXISTS (
  SELECT 1
  FROM delivery_status_history AS history
  WHERE history.delivery_id = delivery.delivery_id
);

COMMIT;
