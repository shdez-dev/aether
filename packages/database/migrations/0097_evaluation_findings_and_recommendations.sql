ALTER TABLE initiative_evaluation_drafts
  ADD COLUMN findings JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(findings) = 'array'),
  ADD COLUMN recommendation TEXT;

ALTER TABLE initiative_evaluations
  ADD COLUMN findings JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(findings) = 'array'),
  ADD COLUMN recommendation TEXT;

CREATE OR REPLACE FUNCTION enforce_initiative_evaluation_draft_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM initiatives
    WHERE id = NEW.initiative_id
      AND organization_id = NEW.organization_id
      AND workspace_id = NEW.workspace_id
      AND (NEW.status = 'published'
        OR (status = 'presented' AND version = NEW.initiative_version))
  ) THEN
    RAISE EXCEPTION 'evaluation draft must preserve a presented initiative scope and version'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evaluation_standards
    WHERE id = NEW.standard_id
      AND organization_id = NEW.organization_id
      AND version = NEW.standard_version
  ) THEN
    RAISE EXCEPTION 'evaluation draft must preserve its standard version'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft'
       OR NEW.id <> OLD.id
       OR NEW.organization_id <> OLD.organization_id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.initiative_id <> OLD.initiative_id
       OR NEW.initiative_version <> OLD.initiative_version
       OR (NEW.status = 'draft' AND NEW.version <> OLD.version + 1)
       OR (NEW.status = 'published' AND NEW.version <> OLD.version)
       OR (NEW.status = 'published' AND (
         NEW.standard_id <> OLD.standard_id
         OR NEW.standard_version <> OLD.standard_version
         OR NEW.results <> OLD.results
         OR NEW.findings <> OLD.findings
         OR NEW.recommendation IS DISTINCT FROM OLD.recommendation)) THEN
      RAISE EXCEPTION 'evaluation draft transition is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
