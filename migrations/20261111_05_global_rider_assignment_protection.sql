BEGIN;

INSERT INTO delivery_assignments (
  assignment_id, delivery_id, offer_id, rider_id, business_id, status, assigned_at
)
SELECT gen_random_uuid(), delivery.delivery_id, NULL, stop->>'assignedDriverId',
       delivery.business_id, 'ACTIVE', NOW()
FROM tobs_app_state AS app_state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(app_state.state->'stops', '[]'::jsonb)) AS stop
JOIN dispatch_deliveries AS delivery
  ON delivery.delivery_id = stop->>'id'
 AND delivery.business_id = stop->>'ownerAdminId'
WHERE NULLIF(stop->>'assignedDriverId', '') IS NOT NULL
  AND delivery.status IN (
    'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP',
    'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION'
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  duplicate_rider_id TEXT;
BEGIN
  SELECT rider_id
  INTO duplicate_rider_id
  FROM delivery_assignments
  WHERE status = 'ACTIVE'
  GROUP BY rider_id
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF duplicate_rider_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch migration found multiple active deliveries for rider %. Resolve active assignments before applying the global rider guard.',
      duplicate_rider_id;
  END IF;
END $$;

CREATE UNIQUE INDEX delivery_one_active_assignment_per_rider_idx
  ON delivery_assignments (rider_id)
  WHERE status = 'ACTIVE';

COMMIT;