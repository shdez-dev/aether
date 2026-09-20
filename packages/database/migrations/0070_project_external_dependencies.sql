CREATE TABLE project_external_dependencies (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  external_party TEXT NOT NULL CHECK (btrim(external_party) <> ''),
  owner_actor_id TEXT NOT NULL,
  due_on DATE NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'accepted')),
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
