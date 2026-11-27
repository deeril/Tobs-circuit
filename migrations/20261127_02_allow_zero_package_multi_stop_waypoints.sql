BEGIN;

ALTER TABLE dispatch_deliveries
  DROP CONSTRAINT IF EXISTS dispatch_deliveries_package_count_check,
  ADD CONSTRAINT dispatch_deliveries_package_count_check
    CHECK (package_count >= 0);

COMMIT;
