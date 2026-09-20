CREATE TABLE project_change_requests (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  impact TEXT NOT NULL CHECK (btrim(impact) <> ''),
  requested_by_actor_id TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected'))
);
