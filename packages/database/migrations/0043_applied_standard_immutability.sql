CREATE OR REPLACE FUNCTION prevent_applied_standard_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM initiative_evaluations
     WHERE standard_id = OLD.id
  )
  AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.criteria IS DISTINCT FROM OLD.criteria
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by_actor_id IS DISTINCT FROM OLD.published_by_actor_id
  ) THEN
    RAISE EXCEPTION 'an evaluation standard cannot change after it is applied'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evaluation_standards_preserve_applied_versions
BEFORE UPDATE OF organization_id, name, version, criteria, published_at, published_by_actor_id
ON evaluation_standards
FOR EACH ROW EXECUTE FUNCTION prevent_applied_standard_mutation();
