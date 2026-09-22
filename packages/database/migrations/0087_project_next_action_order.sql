ALTER TABLE project_next_actions ADD COLUMN position INTEGER;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY project_id, workflow_status ORDER BY due_on NULLS LAST, created_at, id
  ) AS position FROM project_next_actions
)
UPDATE project_next_actions actions SET position = ranked.position
FROM ranked WHERE ranked.id = actions.id;

ALTER TABLE project_next_actions
  ALTER COLUMN position SET NOT NULL,
  ADD CONSTRAINT project_next_actions_position_positive CHECK (position > 0),
  ADD CONSTRAINT project_next_actions_column_position_unique
    UNIQUE (project_id, workflow_status, position) DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION enforce_project_next_action_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE project_status TEXT;
BEGIN
  SELECT status INTO project_status FROM projects WHERE id = NEW.project_id FOR UPDATE;
  IF project_status IN ('completed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'terminal project tasks are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.project_id <> OLD.project_id THEN
      RAISE EXCEPTION 'tasks cannot move between projects' USING ERRCODE = '23514';
    END IF;
    IF (NEW.position IS DISTINCT FROM OLD.position OR NEW.workflow_status <> OLD.workflow_status)
       AND NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'task order changes require the next version' USING ERRCODE = '23514';
    END IF;
    IF NEW.workflow_status <> OLD.workflow_status THEN
      SET CONSTRAINTS project_next_actions_column_position_unique DEFERRED;
      UPDATE project_next_actions
         SET position = position - 1,
             version = version + 1
       WHERE project_id = OLD.project_id
         AND workflow_status = OLD.workflow_status
         AND position > OLD.position;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.workflow_status <> OLD.workflow_status THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO NEW.position
      FROM project_next_actions WHERE project_id = NEW.project_id
        AND workflow_status = NEW.workflow_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_actions_shared_order
BEFORE INSERT OR UPDATE ON project_next_actions
FOR EACH ROW EXECUTE FUNCTION enforce_project_next_action_order();
