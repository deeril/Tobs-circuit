BEGIN;

ALTER TABLE delivery_batch_offer_items
  DROP CONSTRAINT IF EXISTS delivery_batch_offer_items_sequence_number_check,
  ADD CONSTRAINT delivery_batch_offer_items_sequence_number_check
    CHECK (sequence_number BETWEEN 1 AND 5);

DROP INDEX IF EXISTS delivery_one_active_assignment_per_rider_idx;
CREATE UNIQUE INDEX delivery_one_active_assignment_per_rider_idx
  ON delivery_assignments (rider_id)
  WHERE status = 'ACTIVE' AND batch_offer_id IS NULL;
DROP INDEX IF EXISTS delivery_active_assignments_rider_idx;
CREATE INDEX delivery_active_assignments_rider_idx
  ON delivery_assignments (rider_id)
  WHERE status = 'ACTIVE';

COMMIT;
