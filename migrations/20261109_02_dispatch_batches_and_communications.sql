BEGIN;

ALTER TABLE dispatch_deliveries
  ADD COLUMN deadline_at TIMESTAMPTZ;

ALTER TABLE rider_dispatch_profiles
  ADD COLUMN max_package_count INTEGER
    CHECK (max_package_count IS NULL OR max_package_count > 0),
  ADD COLUMN accepts_cross_business_batches BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE dispatch_business_batch_preferences (
  business_id TEXT PRIMARY KEY,
  allows_cross_business_batch BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE delivery_batch_offers (
  batch_offer_id UUID PRIMARY KEY,
  rider_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'
  )),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  route JSONB NOT NULL CHECK (jsonb_typeof(route) = 'object')
);
CREATE INDEX delivery_batch_offer_rider_idx
  ON delivery_batch_offers (rider_id, status, expires_at);

CREATE TABLE delivery_batch_offer_items (
  batch_offer_id UUID NOT NULL REFERENCES delivery_batch_offers(batch_offer_id),
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  business_id TEXT NOT NULL,
  sequence_number SMALLINT NOT NULL CHECK (sequence_number BETWEEN 1 AND 3),
  PRIMARY KEY (batch_offer_id, delivery_id),
  UNIQUE (batch_offer_id, sequence_number)
);
CREATE INDEX delivery_batch_offer_item_delivery_idx
  ON delivery_batch_offer_items (delivery_id, batch_offer_id);

ALTER TABLE delivery_assignments
  ADD COLUMN batch_offer_id UUID REFERENCES delivery_batch_offers(batch_offer_id);

CREATE TABLE delivery_messages (
  message_id UUID PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  business_id TEXT NOT NULL,
  rider_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);
CREATE INDEX delivery_messages_conversation_idx
  ON delivery_messages (delivery_id, sent_at, message_id);

CREATE TABLE dispatch_notifications (
  notification_id UUID PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  delivery_id TEXT REFERENCES dispatch_deliveries(delivery_id),
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX dispatch_notifications_recipient_idx
  ON dispatch_notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE delivery_proofs (
  proof_id UUID PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES dispatch_deliveries(delivery_id),
  assignment_id UUID NOT NULL REFERENCES delivery_assignments(assignment_id),
  rider_id TEXT NOT NULL,
  proof_type TEXT NOT NULL CHECK (proof_type IN ('PHOTO', 'SIGNATURE', 'RECIPIENT_CODE')),
  storage_reference TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX delivery_proofs_delivery_idx
  ON delivery_proofs (delivery_id, captured_at DESC);

COMMIT;
