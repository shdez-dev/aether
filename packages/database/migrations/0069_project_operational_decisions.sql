CREATE TABLE project_operational_decisions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  subject TEXT NOT NULL CHECK (btrim(subject) <> ''),
  decision TEXT NOT NULL CHECK (btrim(decision) <> ''),
  rationale TEXT NOT NULL CHECK (btrim(rationale) <> ''),
  decided_by_actor_id TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION validate_project_operational_decision_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships member
        ON member.organization_id = project.organization_id
     WHERE project.id = NEW.project_id
       AND member.actor_id = NEW.decided_by_actor_id
       AND member.status = 'active'
       AND (
         NEW.decided_by_actor_id = project.lead_actor_id
         OR member.role IN ('owner', 'admin')
       )
  ) THEN
    RAISE EXCEPTION 'operational decision requires project execution authority'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_operational_decisions_scope_check
BEFORE INSERT OR UPDATE ON project_operational_decisions
FOR EACH ROW EXECUTE FUNCTION validate_project_operational_decision_scope();
