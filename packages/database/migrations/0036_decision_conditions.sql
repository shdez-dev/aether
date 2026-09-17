CREATE TABLE initiative_decision_conditions (
  id UUID PRIMARY KEY,
  decision_id UUID NOT NULL REFERENCES initiative_decisions(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  responsible_actor_id TEXT NOT NULL,
  due_on DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'fulfilled', 'exempted')),
  resolved_by_actor_id TEXT NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolution_note TEXT NULL,
  CHECK ((status = 'pending' AND resolved_by_actor_id IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (status IN ('fulfilled', 'exempted') AND resolved_by_actor_id IS NOT NULL AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL))
);
CREATE INDEX initiative_decision_conditions_pending_idx ON initiative_decision_conditions (decision_id, due_on) WHERE status = 'pending';
