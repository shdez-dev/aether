CREATE OR REPLACE FUNCTION validate_initiative_diagnostic_entries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entry JSONB;
  section JSONB;
BEGIN
  FOREACH section IN ARRAY ARRAY[
    NEW.causes,
    NEW.constraints,
    NEW.previous_attempts,
    NEW.hypotheses,
    NEW.risks
  ] LOOP
    IF jsonb_typeof(section) <> 'array' THEN
      RAISE EXCEPTION 'diagnostic entries must be arrays' USING ERRCODE = '23514';
    END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(section) LOOP
      IF jsonb_typeof(entry) <> 'object'
        OR NOT (entry ? 'kind' AND entry ? 'text' AND entry ? 'source')
        OR jsonb_typeof(entry->'kind') <> 'string'
        OR jsonb_typeof(entry->'text') <> 'string'
        OR jsonb_typeof(entry->'source') NOT IN ('string', 'null')
        OR entry->>'kind' NOT IN ('evidence', 'opinion', 'uncertainty')
        OR length(trim(COALESCE(entry->>'text', ''))) = 0
        OR (
          entry->>'kind' = 'evidence'
          AND length(trim(COALESCE(entry->>'source', ''))) = 0
        ) THEN
        RAISE EXCEPTION 'invalid diagnostic entry' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_typeof(NEW.beneficiaries) <> 'array'
    OR jsonb_typeof(NEW.resources) <> 'array'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.beneficiaries) AS value
      WHERE jsonb_typeof(value) <> 'string' OR length(trim(value #>> '{}')) = 0
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.resources) AS value
      WHERE jsonb_typeof(value) <> 'string' OR length(trim(value #>> '{}')) = 0
    ) THEN
    RAISE EXCEPTION 'diagnostic beneficiaries and resources must be non-empty strings' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER initiative_diagnostics_content_check
  BEFORE INSERT OR UPDATE ON initiative_diagnostics
  FOR EACH ROW EXECUTE FUNCTION validate_initiative_diagnostic_entries();
