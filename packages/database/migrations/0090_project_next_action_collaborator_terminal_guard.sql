CREATE FUNCTION prevent_terminal_project_collaborator_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE project_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT project.status INTO project_status
      FROM project_next_actions action
      JOIN projects project ON project.id = action.project_id
     WHERE action.id = OLD.action_id
     FOR UPDATE OF project;
    IF project_status IN ('completed', 'cancelled', 'archived') THEN
      RAISE EXCEPTION 'terminal project tasks are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT project.status INTO project_status
      FROM project_next_actions action
      JOIN projects project ON project.id = action.project_id
     WHERE action.id = NEW.action_id
     FOR UPDATE OF project;
    IF project_status IN ('completed', 'cancelled', 'archived') THEN
      RAISE EXCEPTION 'terminal project tasks are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_action_collaborators_terminal_guard
BEFORE INSERT OR UPDATE OR DELETE ON project_next_action_collaborators
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_project_collaborator_mutation();
