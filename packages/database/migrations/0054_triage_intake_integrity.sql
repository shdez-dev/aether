CREATE OR REPLACE FUNCTION prevent_published_triage_standard_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.criteria IS DISTINCT FROM OLD.criteria
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by_actor_id IS DISTINCT FROM OLD.published_by_actor_id
  THEN
    RAISE EXCEPTION 'published triage standards are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS triage_standards_preserve_applied_versions
  ON triage_standards;
CREATE TRIGGER triage_standards_published_immutable
BEFORE UPDATE OR DELETE ON triage_standards
FOR EACH ROW EXECUTE FUNCTION prevent_published_triage_standard_mutation();

CREATE OR REPLACE FUNCTION validate_triage_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM initiatives i
      JOIN triage_standards s ON s.id = NEW.standard_id
     WHERE i.id = NEW.initiative_id
       AND i.organization_id = NEW.organization_id
       AND i.workspace_id = NEW.workspace_id
       AND i.version = NEW.initiative_version
       AND s.organization_id = NEW.organization_id
       AND s.version = NEW.standard_version
       AND s.is_active
  ) THEN
    RAISE EXCEPTION 'triage requires an active standard with matching scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_initiative_triage_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'initiative triages are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER initiative_triages_append_only
BEFORE UPDATE OR DELETE ON initiative_triages
FOR EACH ROW EXECUTE FUNCTION prevent_initiative_triage_mutation();

CREATE OR REPLACE FUNCTION require_adoption_for_active_triage_standard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active
     AND NOT EXISTS (
       SELECT 1 FROM triage_standard_adoptions
        WHERE standard_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'an active triage standard requires an adoption'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER triage_standards_active_requires_adoption
AFTER INSERT OR UPDATE OF is_active ON triage_standards
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_adoption_for_active_triage_standard();

CREATE OR REPLACE FUNCTION preserve_active_triage_standard_adoption()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM triage_standards
     WHERE id = OLD.standard_id AND is_active
  ) THEN
    RAISE EXCEPTION 'an active triage standard requires an adoption'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER triage_standard_adoptions_preserve_active_standard
BEFORE DELETE ON triage_standard_adoptions
FOR EACH ROW EXECUTE FUNCTION preserve_active_triage_standard_adoption();

CREATE OR REPLACE FUNCTION prevent_intake_assignment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'initiative intake assignments are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER initiative_intake_assignments_append_only
BEFORE UPDATE OR DELETE ON initiative_intake_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_intake_assignment_mutation();

CREATE OR REPLACE FUNCTION prevent_intake_responsibility_revocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    TG_OP = 'DELETE'
    OR (OLD.status = 'active' AND NEW.status <> 'active')
  ) AND EXISTS (
    SELECT 1 FROM initiative_intake_assignments
     WHERE organization_id = OLD.organization_id
       AND responsible_actor_id = OLD.actor_id
  ) THEN
    RAISE EXCEPTION 'reassign or close intake responsibilities before revoking membership'
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER organization_memberships_preserve_intake_responsibility
BEFORE UPDATE OF status OR DELETE ON organization_memberships
FOR EACH ROW EXECUTE FUNCTION prevent_intake_responsibility_revocation();
