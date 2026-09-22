CREATE OR REPLACE FUNCTION enforce_project_archival_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'archived' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'archived projects are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'archived' AND OLD.status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'projects may only be archived from completed or cancelled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_archival_integrity
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION enforce_project_archival_integrity();
