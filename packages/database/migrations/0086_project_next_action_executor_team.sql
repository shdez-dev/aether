ALTER TABLE project_next_actions
  ADD COLUMN executor_team_id UUID NULL REFERENCES teams(id);

CREATE OR REPLACE FUNCTION enforce_project_next_action_executor_team_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.executor_team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM projects
      JOIN teams ON teams.id = NEW.executor_team_id
     WHERE projects.id = NEW.project_id
       AND teams.organization_id = projects.organization_id
       AND teams.workspace_id = projects.workspace_id
  ) THEN
    RAISE EXCEPTION 'next action executor team must belong to its project workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_actions_executor_team_scope
BEFORE INSERT OR UPDATE OF project_id, executor_team_id ON project_next_actions
FOR EACH ROW EXECUTE FUNCTION enforce_project_next_action_executor_team_scope();
