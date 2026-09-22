CREATE FUNCTION enforce_project_next_action_due_date_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_on IS DISTINCT FROM OLD.due_on THEN
    IF OLD.workflow_status IN ('done', 'cancelled')
       OR NEW.workflow_status IN ('done', 'cancelled') THEN
      RAISE EXCEPTION 'terminal task dates are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'task date changes require the next version' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_action_due_date_version
BEFORE UPDATE OF due_on ON project_next_actions
FOR EACH ROW EXECUTE FUNCTION enforce_project_next_action_due_date_version();
