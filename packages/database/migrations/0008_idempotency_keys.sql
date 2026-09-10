CREATE TABLE api_idempotency_keys (
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  response_status INTEGER NULL CHECK (response_status BETWEEN 200 AND 599),
  response_body JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_id, operation, idempotency_key),
  CHECK (
    (status = 'pending' AND response_status IS NULL AND response_body IS NULL)
    OR (status = 'completed' AND response_status IS NOT NULL AND response_body IS NOT NULL)
  )
);

CREATE INDEX api_idempotency_keys_expiry_idx ON api_idempotency_keys (expires_at);
