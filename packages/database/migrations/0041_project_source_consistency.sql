CREATE OR REPLACE FUNCTION assert_project_source_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  initiative_scope RECORD;
  decision_scope RECORD;
BEGIN
  SELECT organization_id, workspace_id
    INTO initiative_scope
    FROM initiatives
   WHERE id = NEW.source_initiative_id;
  SELECT organization_id, workspace_id, initiative_id
    INTO decision_scope
    FROM initiative_decisions
   WHERE id = NEW.source_decision_id;

  IF initiative_scope IS NULL OR decision_scope IS NULL
    OR decision_scope.initiative_id <> NEW.source_initiative_id
    OR initiative_scope.organization_id <> NEW.organization_id
    OR decision_scope.organization_id <> NEW.organization_id
    OR initiative_scope.workspace_id <> NEW.workspace_id
    OR decision_scope.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'project source initiative and decision must share organization and workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_require_consistent_sources
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, source_initiative_id, source_decision_id
ON projects
FOR EACH ROW EXECUTE FUNCTION assert_project_source_consistency();
