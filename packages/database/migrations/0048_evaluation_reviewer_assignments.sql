CREATE TABLE initiative_evaluation_reviewer_assignments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  assigned_actor_id TEXT NOT NULL,
  assigned_by_actor_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('assigned', 'abstained', 'reassigned', 'escalated', 'completed')),
  status_changed_at TIMESTAMPTZ NOT NULL,
  status_changed_by_actor_id TEXT NOT NULL,
  reason TEXT NULL,
  CHECK (
    (status = 'assigned' AND reason IS NULL)
    OR (status <> 'assigned' AND char_length(trim(reason)) BETWEEN 1 AND 2000)
    OR status = 'completed'
  )
);

CREATE UNIQUE INDEX initiative_evaluation_reviewer_assignments_one_active_idx
  ON initiative_evaluation_reviewer_assignments (initiative_id)
  WHERE status = 'assigned';

CREATE INDEX initiative_evaluation_reviewer_assignments_assignee_idx
  ON initiative_evaluation_reviewer_assignments (organization_id, assigned_actor_id, status, assigned_at DESC);

CREATE FUNCTION assert_evaluation_reviewer_assignment_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM initiatives
     WHERE id = NEW.initiative_id
       AND organization_id = NEW.organization_id
       AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'evaluation reviewer assignment must preserve initiative scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_evaluation_reviewer_assignments_scope_immutable
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, initiative_id
ON initiative_evaluation_reviewer_assignments
FOR EACH ROW EXECUTE FUNCTION assert_evaluation_reviewer_assignment_scope();
