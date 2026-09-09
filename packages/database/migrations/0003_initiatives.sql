CREATE TABLE initiatives (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_by_actor_id TEXT NOT NULL,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('internal', 'confidential')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'presented', 'under_review', 'approved', 'rejected', 'withdrawn')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (char_length(title) BETWEEN 1 AND 255),
  CHECK (char_length(problem_statement) BETWEEN 1 AND 10000),
  CHECK (char_length(expected_outcome) BETWEEN 1 AND 10000)
);

CREATE INDEX initiatives_workspace_idx ON initiatives (organization_id, workspace_id, updated_at DESC);

CREATE TABLE initiative_audit_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  actor_id TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  from_status TEXT NULL,
  to_status TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX initiative_audit_events_timeline_idx ON initiative_audit_events (organization_id, initiative_id, occurred_at ASC);
