CREATE TABLE initiative_evaluation_conflicts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  assignment_id UUID NOT NULL REFERENCES initiative_evaluation_reviewer_assignments(id),
  declared_by_actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 1 AND 2000),
  declared_at TIMESTAMPTZ NOT NULL,
  resolved_by_actor_id TEXT NULL,
  resolution TEXT NULL CHECK (resolution IS NULL OR char_length(trim(resolution)) BETWEEN 1 AND 2000),
  resolved_at TIMESTAMPTZ NULL,
  CHECK (
    (resolved_by_actor_id IS NULL AND resolution IS NULL AND resolved_at IS NULL)
    OR (resolved_by_actor_id IS NOT NULL AND resolution IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX initiative_evaluation_conflicts_one_open_per_assignment_idx
  ON initiative_evaluation_conflicts (assignment_id)
  WHERE resolved_at IS NULL;

CREATE FUNCTION enforce_initiative_evaluation_conflict_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM initiative_evaluation_reviewer_assignments
    WHERE id = NEW.assignment_id
      AND organization_id = NEW.organization_id
      AND workspace_id = NEW.workspace_id
      AND initiative_id = NEW.initiative_id
      AND assigned_actor_id = NEW.declared_by_actor_id
  ) THEN
    RAISE EXCEPTION 'evaluation conflict must preserve its reviewer assignment scope'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.initiative_id <> OLD.initiative_id
    OR NEW.assignment_id <> OLD.assignment_id
    OR NEW.declared_by_actor_id <> OLD.declared_by_actor_id
    OR NEW.reason <> OLD.reason
    OR NEW.declared_at <> OLD.declared_at
    OR OLD.resolved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'evaluation conflict declaration is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_evaluation_conflicts_scope
BEFORE INSERT OR UPDATE ON initiative_evaluation_conflicts
FOR EACH ROW EXECUTE FUNCTION enforce_initiative_evaluation_conflict_scope();
