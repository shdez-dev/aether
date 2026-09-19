CREATE TABLE evaluation_standard_adoptions (
  id UUID PRIMARY KEY,
  standard_id UUID NOT NULL REFERENCES evaluation_standards(id),
  adopted_by_actor_id TEXT NOT NULL,
  adopted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX evaluation_standard_adoptions_standard_idx
  ON evaluation_standard_adoptions (standard_id, adopted_at DESC);
