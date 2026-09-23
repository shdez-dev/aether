CREATE FUNCTION prevent_initiative_decision_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'initiative decisions are immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER initiative_decisions_immutable
BEFORE UPDATE OR DELETE ON initiative_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_initiative_decision_mutation();
