CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX auth_sessions_active_token_idx ON auth_sessions (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);

CREATE TABLE auth_login_transactions (
  id UUID PRIMARY KEY,
  handle_hash TEXT NOT NULL UNIQUE,
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier_ciphertext TEXT NOT NULL,
  nonce_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_login_transactions_expiry_idx ON auth_login_transactions (expires_at);
