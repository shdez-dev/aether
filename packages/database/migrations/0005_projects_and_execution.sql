CREATE TABLE projects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_initiative_id UUID NOT NULL UNIQUE REFERENCES initiatives(id),
  source_decision_id UUID NOT NULL UNIQUE REFERENCES initiative_decisions(id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  sponsor_actor_id TEXT NOT NULL,
  lead_actor_id TEXT NOT NULL,
  participants JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'blocked', 'completed', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (sponsor_actor_id <> lead_actor_id)
);
CREATE INDEX projects_workspace_idx ON projects (organization_id, workspace_id, updated_at DESC);

CREATE TABLE project_milestones (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  due_on DATE NULL,
  completed_at TIMESTAMPTZ NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE project_next_actions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  owner_actor_id TEXT NOT NULL,
  due_on DATE NULL,
  completed_at TIMESTAMPTZ NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE project_audit_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  actor_id TEXT NOT NULL,
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX project_audit_events_timeline_idx ON project_audit_events (organization_id, project_id, occurred_at ASC);
