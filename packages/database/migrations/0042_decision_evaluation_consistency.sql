CREATE OR REPLACE FUNCTION assert_decision_evaluation_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_scope RECORD;
BEGIN
  SELECT organization_id, workspace_id, initiative_id, standard_id, standard_version
    INTO evaluation_scope
    FROM initiative_evaluations
   WHERE id = NEW.evaluation_id;

  IF evaluation_scope IS NULL
    OR evaluation_scope.organization_id <> NEW.organization_id
    OR evaluation_scope.workspace_id <> NEW.workspace_id
    OR evaluation_scope.initiative_id <> NEW.initiative_id
    OR evaluation_scope.standard_id <> NEW.standard_id
    OR evaluation_scope.standard_version <> NEW.standard_version THEN
    RAISE EXCEPTION 'decision must preserve the evaluated initiative and standard version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_decisions_require_matching_evaluation
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, initiative_id, evaluation_id, standard_id, standard_version
ON initiative_decisions
FOR EACH ROW EXECUTE FUNCTION assert_decision_evaluation_consistency();
