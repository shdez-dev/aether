ALTER TABLE initiatives DROP CONSTRAINT initiatives_status_check;
UPDATE initiatives SET status = 'cancelled' WHERE status = 'withdrawn';
ALTER TABLE initiatives ADD CONSTRAINT initiatives_status_check
  CHECK (status IN ('draft', 'presented', 'under_review', 'returned', 'approved', 'rejected', 'cancelled'));

CREATE TABLE evaluation_standards (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  criteria JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL,
  published_by_actor_id TEXT NOT NULL,
  UNIQUE (organization_id, name, version)
);
CREATE UNIQUE INDEX evaluation_standards_one_active_per_organization_idx
  ON evaluation_standards (organization_id) WHERE is_active;

CREATE TABLE initiative_evaluations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  initiative_version INTEGER NOT NULL,
  standard_id UUID NOT NULL REFERENCES evaluation_standards(id),
  standard_version INTEGER NOT NULL,
  criteria JSONB NOT NULL,
  coverage JSONB NOT NULL,
  evaluated_by_actor_id TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX initiative_evaluations_initiative_idx ON initiative_evaluations (organization_id, initiative_id, evaluated_at DESC);

CREATE TABLE initiative_decisions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  evaluation_id UUID NOT NULL REFERENCES initiative_evaluations(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected', 'returned', 'cancelled')),
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL,
  standard_id UUID NOT NULL REFERENCES evaluation_standards(id),
  standard_version INTEGER NOT NULL,
  coverage JSONB NOT NULL,
  decided_by_actor_id TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX initiative_decisions_initiative_idx ON initiative_decisions (organization_id, initiative_id, decided_at DESC);
