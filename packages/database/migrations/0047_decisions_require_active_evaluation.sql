CREATE OR REPLACE FUNCTION assert_decision_evaluation_is_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM initiative_evaluations
     WHERE id = NEW.evaluation_id
       AND annulled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'decision cannot reference an annulled evaluation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_decisions_require_active_evaluation
BEFORE INSERT OR UPDATE OF evaluation_id
ON initiative_decisions
FOR EACH ROW EXECUTE FUNCTION assert_decision_evaluation_is_active();

CREATE OR REPLACE FUNCTION assert_evaluation_annulment_has_no_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.annulled_at IS NOT NULL
    AND OLD.annulled_at IS NULL
    AND EXISTS (
      SELECT 1
        FROM initiative_decisions
       WHERE evaluation_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'an evaluation with a decision cannot be annulled'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_evaluations_cannot_annul_decided_evaluation
BEFORE UPDATE OF annulled_at
ON initiative_evaluations
FOR EACH ROW EXECUTE FUNCTION assert_evaluation_annulment_has_no_decision();
