export const AUTHORIZED_MAP_RIDERS_SQL = `
  WITH visible_riders AS (
    SELECT delivery.delivery_id,
           delivery.status AS dispatch_status,
           offer.rider_id,
           offer.created_at AS visible_since,
           FALSE AS assigned
    FROM dispatch_offers AS offer
    JOIN dispatch_deliveries AS delivery
      ON delivery.delivery_id = offer.delivery_id
     AND delivery.business_id = offer.business_id
    JOIN rider_dispatch_profiles AS profile
      ON profile.rider_id = offer.rider_id
     AND profile.is_active = TRUE
     AND profile.is_available = TRUE
    JOIN rider_current_locations AS location
      ON location.rider_id = offer.rider_id
     AND location.sharing_enabled = TRUE
     AND location.recorded_at > NOW() - INTERVAL '90 seconds'
    WHERE offer.business_id = $1
      AND offer.status = 'PENDING'
      AND offer.expires_at > NOW()
    UNION ALL
    SELECT delivery.delivery_id,
           delivery.status AS dispatch_status,
           batch.rider_id,
           batch.created_at AS visible_since,
           FALSE AS assigned
    FROM delivery_batch_offers AS batch
    JOIN delivery_batch_offer_items AS item
      ON item.batch_offer_id = batch.batch_offer_id
    JOIN dispatch_deliveries AS delivery
      ON delivery.delivery_id = item.delivery_id
     AND delivery.business_id = item.business_id
    JOIN dispatch_business_riders AS membership
      ON membership.business_id = item.business_id
     AND membership.rider_id = batch.rider_id
     AND membership.active = TRUE
    JOIN rider_dispatch_profiles AS profile
      ON profile.rider_id = batch.rider_id
     AND profile.is_active = TRUE
     AND profile.is_available = TRUE
    JOIN rider_current_locations AS location
      ON location.rider_id = batch.rider_id
     AND location.sharing_enabled = TRUE
     AND location.recorded_at > NOW() - INTERVAL '90 seconds'
    WHERE item.business_id = $1
      AND batch.status = 'PENDING'
      AND batch.expires_at > NOW()
      AND delivery.status IN ('UNASSIGNED', 'FINDING_RIDER')
    UNION ALL
    SELECT delivery.delivery_id,
           delivery.status AS dispatch_status,
           assignment.rider_id,
           assignment.assigned_at AS visible_since,
           TRUE AS assigned
    FROM delivery_assignments AS assignment
    JOIN dispatch_deliveries AS delivery
      ON delivery.delivery_id = assignment.delivery_id
     AND delivery.business_id = assignment.business_id
    JOIN rider_dispatch_profiles AS profile
      ON profile.rider_id = assignment.rider_id
     AND profile.is_active = TRUE
    JOIN rider_current_locations AS location
      ON location.rider_id = assignment.rider_id
     AND location.sharing_enabled = TRUE
    WHERE assignment.business_id = $1
      AND assignment.status = 'ACTIVE'
      AND delivery.status IN (
        'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'HEADING_TO_PICKUP',
        'ARRIVED_AT_PICKUP', 'HEADING_TO_DESTINATION'
      )
    UNION ALL
    SELECT NULL::text AS delivery_id,
           NULL::text AS dispatch_status,
           profile.rider_id,
           location.recorded_at AS visible_since,
           FALSE AS assigned
    FROM rider_dispatch_profiles AS profile
    JOIN rider_current_locations AS location
      ON location.rider_id = profile.rider_id
     AND location.sharing_enabled = TRUE
     AND location.recorded_at > NOW() - INTERVAL '90 seconds'
    WHERE profile.is_active = TRUE
      AND profile.is_available = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM delivery_assignments AS active_assignment
        WHERE active_assignment.rider_id = profile.rider_id
          AND active_assignment.status = 'ACTIVE'
      )
  )
  SELECT DISTINCT ON (visible.rider_id)
         visible.delivery_id,
         visible.dispatch_status,
         visible.rider_id,
         visible.assigned,
         location.latitude AS lat,
         location.longitude AS lng,
         location.recorded_at AS location_updated_at
  FROM visible_riders AS visible
  JOIN rider_current_locations AS location
    ON location.rider_id = visible.rider_id
   AND location.sharing_enabled = TRUE
  ORDER BY visible.rider_id, visible.assigned DESC, visible.visible_since DESC
`;
