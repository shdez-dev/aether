CREATE OR REPLACE FUNCTION prevent_project_next_action_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  action_project_id UUID;
  previous_action_id UUID;
  previous_depends_on_action_id UUID;
BEGIN
  SELECT project_id
    INTO action_project_id
    FROM project_next_actions
   WHERE id = NEW.action_id;
  IF action_project_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(action_project_id::text, 0));
  END IF;

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
