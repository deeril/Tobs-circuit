BEGIN;

ALTER TABLE rider_dispatch_profiles
  ADD COLUMN zone_id TEXT;

ALTER TABLE dispatch_deliveries
  ADD COLUMN estimated_price_ngn NUMERIC
    CHECK (estimated_price_ngn IS NULL OR estimated_price_ngn >= 0),
  ADD COLUMN pricing_rule_version INTEGER
    CHECK (pricing_rule_version IS NULL OR pricing_rule_version > 0),
  ADD COLUMN route_distance_km NUMERIC
    CHECK (route_distance_km IS NULL OR route_distance_km >= 0),
  ADD COLUMN route_duration_minutes INTEGER
    CHECK (route_duration_minutes IS NULL OR route_duration_minutes > 0);

CREATE TABLE platform_pricing_rules (
  rule_id SMALLINT PRIMARY KEY CHECK (rule_id = 1),
  version INTEGER NOT NULL CHECK (version > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  base_fee NUMERIC NOT NULL CHECK (base_fee >= 0),
  per_kilometre NUMERIC NOT NULL CHECK (per_kilometre >= 0),
  per_minute NUMERIC NOT NULL CHECK (per_minute >= 0),
  additional_fee NUMERIC NOT NULL CHECK (additional_fee >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL
);

COMMIT;
