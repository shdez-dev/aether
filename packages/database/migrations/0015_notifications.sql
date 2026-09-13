CREATE TABLE notification_preferences (
  actor_id TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_id, organization_id)
);
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  recipient_actor_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('initiative','evaluation','decision','project')),
  resource_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  created_at TIMESTAMPTZ NOT NULL,
  read_at TIMESTAMPTZ NULL,
  UNIQUE (recipient_actor_id, event_key)
);
CREATE INDEX notifications_inbox_idx ON notifications (recipient_actor_id, organization_id, created_at DESC);
