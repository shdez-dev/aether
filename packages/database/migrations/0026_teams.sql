CREATE TABLE teams (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX teams_workspace_idx ON teams (organization_id, workspace_id, name);

CREATE TABLE team_memberships (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, actor_id)
);

CREATE TABLE team_audit_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'team.created.v1'),
  correlation_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
