CREATE TABLE actor_identities (
  id UUID PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_authenticated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE INDEX actor_identities_issuer_subject_idx ON actor_identities (issuer, subject);
