BEGIN;

ALTER TABLE delivery_messages
  ADD COLUMN client_message_id UUID;

CREATE UNIQUE INDEX delivery_messages_sender_client_id_idx
  ON delivery_messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE TABLE dispatch_calls (
  call_id UUID PRIMARY KEY,
  delivery_id TEXT REFERENCES dispatch_deliveries(delivery_id),
  support_thread_id TEXT,
  business_id TEXT,
  rider_id TEXT,
  caller_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'RINGING', 'ACCEPTED', 'REJECTED', 'MISSED', 'ENDED', 'FAILED'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  CHECK (caller_id <> recipient_id),
  CHECK (
    (delivery_id IS NOT NULL AND support_thread_id IS NULL
      AND business_id IS NOT NULL AND rider_id IS NOT NULL)
    OR
    (delivery_id IS NULL AND support_thread_id IS NOT NULL)
  )
);
CREATE INDEX dispatch_calls_delivery_history_idx
  ON dispatch_calls (delivery_id, created_at DESC)
  WHERE delivery_id IS NOT NULL;
CREATE INDEX dispatch_calls_support_history_idx
  ON dispatch_calls (support_thread_id, created_at DESC)
  WHERE support_thread_id IS NOT NULL;
CREATE INDEX dispatch_calls_participant_status_idx
  ON dispatch_calls (recipient_id, status, created_at DESC);
CREATE UNIQUE INDEX dispatch_one_live_call_per_delivery_idx
  ON dispatch_calls (delivery_id)
  WHERE delivery_id IS NOT NULL AND status IN ('RINGING', 'ACCEPTED');
CREATE UNIQUE INDEX dispatch_one_live_call_per_support_thread_idx
  ON dispatch_calls (support_thread_id)
  WHERE support_thread_id IS NOT NULL AND status IN ('RINGING', 'ACCEPTED');

COMMIT;
