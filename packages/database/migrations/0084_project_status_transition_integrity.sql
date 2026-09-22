CREATE OR REPLACE FUNCTION enforce_project_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'pending_lead' AND NEW.status IN ('planned', 'cancelled'))
    OR (OLD.status = 'planned' AND NEW.status IN ('active', 'cancelled'))
    OR (OLD.status = 'active' AND NEW.status IN ('paused', 'blocked', 'completed', 'cancelled'))
    OR (OLD.status = 'paused' AND NEW.status IN ('active', 'cancelled'))
    OR (OLD.status = 'blocked' AND NEW.status IN ('active', 'paused', 'cancelled'))
    OR (OLD.status IN ('completed', 'cancelled') AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'invalid project status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_status_transition_integrity
BEFORE UPDATE OF status ON projects
FOR EACH ROW EXECUTE FUNCTION enforce_project_status_transition();
