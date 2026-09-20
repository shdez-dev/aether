CREATE TABLE project_risks (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  probability TEXT NOT NULL CHECK (probability IN ('low', 'medium', 'high')),
  impact TEXT NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
  treatment TEXT NOT NULL CHECK (treatment IN ('avoid', 'mitigate', 'transfer', 'accept')),
  owner_actor_id TEXT NOT NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION validate_project_risk_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships owner_member
        ON owner_member.organization_id = project.organization_id
      JOIN organization_memberships creator_member
        ON creator_member.organization_id = project.organization_id
      JOIN workspace_memberships owner_workspace_member
        ON owner_workspace_member.workspace_id = project.workspace_id
     WHERE project.id = NEW.project_id
       AND owner_member.actor_id = NEW.owner_actor_id
       AND owner_member.status = 'active'
       AND creator_member.actor_id = NEW.created_by_actor_id
       AND creator_member.status = 'active'
       AND (
         NEW.created_by_actor_id = project.lead_actor_id
         OR creator_member.role IN ('owner', 'admin')
       )
       AND owner_workspace_member.actor_id = NEW.owner_actor_id
  ) THEN
    RAISE EXCEPTION 'project risk requires an active scoped owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_risks_scope_check
BEFORE INSERT OR UPDATE ON project_risks
FOR EACH ROW EXECUTE FUNCTION validate_project_risk_scope();
