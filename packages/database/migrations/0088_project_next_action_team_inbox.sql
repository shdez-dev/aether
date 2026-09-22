ALTER TABLE project_next_actions ALTER COLUMN owner_actor_id DROP NOT NULL;

CREATE FUNCTION enforce_project_next_action_assignee()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_actor_id IS NULL
     AND (NEW.workflow_status <> 'to_do' OR NEW.executor_team_id IS NULL) THEN
    RAISE EXCEPTION 'unassigned tasks require an executor team and to_do status'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_actions_assignee_integrity
BEFORE INSERT OR UPDATE OF owner_actor_id, executor_team_id, workflow_status
ON project_next_actions
FOR EACH ROW EXECUTE FUNCTION enforce_project_next_action_assignee();
