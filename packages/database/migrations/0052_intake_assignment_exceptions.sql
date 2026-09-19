CREATE TABLE initiative_intake_assignments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  responsible_actor_id TEXT NOT NULL,
  assigned_by_actor_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  next_review_on DATE NOT NULL,
  UNIQUE (initiative_id)
);

CREATE INDEX initiative_intake_assignments_responsible_idx
  ON initiative_intake_assignments
  (organization_id, responsible_actor_id, next_review_on);

CREATE OR REPLACE FUNCTION validate_intake_assignment_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM initiatives i
      JOIN organization_memberships responsible_membership
        ON responsible_membership.organization_id = i.organization_id
       AND responsible_membership.actor_id = NEW.responsible_actor_id
       AND responsible_membership.status = 'active'
     WHERE i.id = NEW.initiative_id
       AND i.organization_id = NEW.organization_id
       AND i.workspace_id = NEW.workspace_id
       AND i.status = 'presented'
       AND (
         responsible_membership.role IN ('owner', 'admin')
         OR EXISTS (
           SELECT 1
             FROM workspace_memberships wm
            WHERE wm.workspace_id = i.workspace_id
              AND wm.actor_id = NEW.responsible_actor_id
         )
       )
  ) THEN
    RAISE EXCEPTION 'intake assignment must preserve presented initiative scope and active responsibility'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_intake_assignments_scope_check
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, initiative_id,
  responsible_actor_id
ON initiative_intake_assignments
FOR EACH ROW EXECUTE FUNCTION validate_intake_assignment_scope();
