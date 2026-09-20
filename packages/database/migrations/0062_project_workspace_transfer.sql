CREATE OR REPLACE FUNCTION enforce_immutable_workspace_scope() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR (
      NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      AND NOT (
        TG_TABLE_NAME = 'projects'
        AND current_setting('aether.project_workspace_transfer', true) = 'true'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Tenant scope is immutable; use an explicit approved migration command'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM workspaces
    WHERE id = NEW.workspace_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'Workspace must belong to the record organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
