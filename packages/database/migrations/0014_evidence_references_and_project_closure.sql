CREATE TABLE project_closures (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  outcomes TEXT NOT NULL CHECK (char_length(outcomes) BETWEEN 1 AND 10000),
  lessons_learned TEXT NOT NULL CHECK (char_length(lessons_learned) BETWEEN 1 AND 10000),
  pending_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_by_actor_id TEXT NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE project_deliverable_acceptances (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  document_id UUID NOT NULL REFERENCES documents(id),
  document_version_id UUID NOT NULL REFERENCES document_versions(id),
  accepted_by_actor_id TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  UNIQUE (project_id, document_version_id)
);
CREATE INDEX project_deliverable_acceptances_project_idx
  ON project_deliverable_acceptances (organization_id, project_id, accepted_at ASC);

CREATE TABLE evidence_references (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('evaluation', 'decision', 'project_closure')),
  subject_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id),
  document_version_id UUID NOT NULL REFERENCES document_versions(id),
  linked_by_actor_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL,
  UNIQUE (subject_type, subject_id, document_version_id)
);
CREATE INDEX evidence_references_subject_idx
  ON evidence_references (organization_id, subject_type, subject_id, linked_at ASC);
