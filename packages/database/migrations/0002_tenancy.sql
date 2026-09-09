ALTER TABLE auth_sessions ADD COLUMN actor_email TEXT NULL;

CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  locale TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, actor_id)
);

CREATE INDEX organization_memberships_actor_idx ON organization_memberships (actor_id, organization_id);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('personal', 'team', 'institutional')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX workspaces_organization_idx ON workspaces (organization_id, id);

CREATE TABLE workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, actor_id)
);

CREATE TABLE invitations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  organization_role TEXT NOT NULL CHECK (organization_role IN ('owner', 'admin', 'member')),
  workspace_ids UUID[] NOT NULL DEFAULT '{}',
  workspace_role TEXT NOT NULL CHECK (workspace_role IN ('admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  accepted_by_actor_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX invitations_active_token_idx ON invitations (token_hash) WHERE accepted_at IS NULL;
