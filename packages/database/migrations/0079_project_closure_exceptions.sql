ALTER TABLE project_closures
  ADD COLUMN closure_exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT project_closures_exceptions_are_an_array CHECK (
    jsonb_typeof(closure_exceptions) = 'array'
    AND jsonb_array_length(closure_exceptions) <= 100
  );

CREATE OR REPLACE FUNCTION validate_project_closure_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  closure_exception JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'project closures are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships closer
        ON closer.organization_id = project.organization_id
     WHERE project.id = NEW.project_id
       AND project.status = 'completed'
       AND closer.actor_id = NEW.closed_by_actor_id
       AND closer.status = 'active'
       AND (
         NEW.closed_by_actor_id = project.lead_actor_id
         OR closer.role IN ('owner', 'admin')
       )
  ) THEN
    RAISE EXCEPTION 'project closure requires completed project execution authority'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.pending_items <> COALESCE(
    (
      SELECT jsonb_agg(value ->> 'description')
      FROM jsonb_array_elements(NEW.closure_exceptions)
    ),
    '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'project closure pending items must match closure exceptions'
      USING ERRCODE = '23514';
  END IF;
  FOR closure_exception IN SELECT value FROM jsonb_array_elements(NEW.closure_exceptions)
  LOOP
    IF jsonb_typeof(closure_exception) <> 'object'
      OR NOT (
        closure_exception ? 'id'
        AND closure_exception ? 'description'
        AND closure_exception ? 'disposition'
        AND closure_exception ? 'responsibleActorId'
        AND closure_exception ? 'rationale'
      )
      OR jsonb_typeof(closure_exception -> 'id') <> 'string'
      OR jsonb_typeof(closure_exception -> 'description') <> 'string'
      OR jsonb_typeof(closure_exception -> 'disposition') <> 'string'
      OR jsonb_typeof(closure_exception -> 'responsibleActorId') <> 'string'
      OR jsonb_typeof(closure_exception -> 'rationale') <> 'string'
      OR btrim(closure_exception ->> 'id') = ''
      OR btrim(closure_exception ->> 'description') = ''
      OR btrim(closure_exception ->> 'responsibleActorId') = ''
      OR btrim(closure_exception ->> 'rationale') = ''
      OR closure_exception ->> 'disposition' NOT IN ('resolved', 'transferred', 'accepted')
    THEN
      RAISE EXCEPTION 'project closure exception is invalid' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM projects project
        JOIN organization_memberships member
          ON member.organization_id = project.organization_id
        JOIN workspace_memberships workspace_member
          ON workspace_member.workspace_id = project.workspace_id
       WHERE project.id = NEW.project_id
         AND member.actor_id = closure_exception ->> 'responsibleActorId'
         AND member.status = 'active'
         AND workspace_member.actor_id = closure_exception ->> 'responsibleActorId'
    ) THEN
      RAISE EXCEPTION 'project closure exception requires an active scoped responsible actor'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_closures_scope_check
BEFORE INSERT OR UPDATE ON project_closures
FOR EACH ROW EXECUTE FUNCTION validate_project_closure_scope();
