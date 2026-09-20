CREATE OR REPLACE FUNCTION validate_project_next_action_dependency_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM project_next_actions action
      JOIN project_next_actions prerequisite ON prerequisite.id = NEW.depends_on_action_id
     WHERE action.id = NEW.action_id
       AND action.project_id = prerequisite.project_id
  ) THEN
    RAISE EXCEPTION 'next action dependencies must stay within one project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_action_dependencies_scope_check
BEFORE INSERT OR UPDATE OF action_id, depends_on_action_id
ON project_next_action_dependencies
FOR EACH ROW EXECUTE FUNCTION validate_project_next_action_dependency_scope();

CREATE OR REPLACE FUNCTION prevent_project_next_action_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_action_id UUID;
  previous_depends_on_action_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_action_id := OLD.action_id;
    previous_depends_on_action_id := OLD.depends_on_action_id;
  END IF;

  IF EXISTS (
    WITH RECURSIVE prerequisite_actions(id) AS (
      SELECT dependency.depends_on_action_id
        FROM project_next_action_dependencies dependency
       WHERE dependency.action_id = NEW.depends_on_action_id
         AND (
           previous_action_id IS NULL
           OR dependency.action_id <> previous_action_id
           OR dependency.depends_on_action_id <> previous_depends_on_action_id
         )
      UNION
      SELECT dependency.depends_on_action_id
        FROM project_next_action_dependencies dependency
        JOIN prerequisite_actions prerequisite
          ON prerequisite.id = dependency.action_id
       WHERE previous_action_id IS NULL
          OR dependency.action_id <> previous_action_id
          OR dependency.depends_on_action_id <> previous_depends_on_action_id
    )
    SELECT 1
      FROM prerequisite_actions
     WHERE id = NEW.action_id
  ) THEN
    RAISE EXCEPTION 'next action dependencies cannot form a cycle'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_action_dependencies_cycle_check
BEFORE INSERT OR UPDATE OF action_id, depends_on_action_id
ON project_next_action_dependencies
FOR EACH ROW EXECUTE FUNCTION prevent_project_next_action_dependency_cycle();
