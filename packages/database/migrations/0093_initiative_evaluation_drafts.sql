CREATE TABLE initiative_evaluation_drafts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  initiative_version INTEGER NOT NULL CHECK (initiative_version >= 0),
  standard_id UUID NOT NULL REFERENCES evaluation_standards(id),
  standard_version INTEGER NOT NULL CHECK (standard_version >= 1),
  results JSONB NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  version INTEGER NOT NULL CHECK (version >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  updated_by_actor_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  published_evaluation_id UUID NULL REFERENCES initiative_evaluations(id),
  CHECK ((status = 'draft' AND published_evaluation_id IS NULL)
      OR (status = 'published' AND published_evaluation_id IS NOT NULL))
);

CREATE UNIQUE INDEX initiative_evaluation_drafts_one_active_idx
  ON initiative_evaluation_drafts (initiative_id) WHERE status = 'draft';
CREATE UNIQUE INDEX initiative_evaluation_drafts_published_evaluation_idx
  ON initiative_evaluation_drafts (published_evaluation_id)
  WHERE published_evaluation_id IS NOT NULL;

CREATE FUNCTION enforce_initiative_evaluation_draft_scope()
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
         OR NEW.results <> OLD.results)) THEN
      RAISE EXCEPTION 'evaluation draft transition is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_evaluation_drafts_scope
BEFORE INSERT OR UPDATE ON initiative_evaluation_drafts
FOR EACH ROW EXECUTE FUNCTION enforce_initiative_evaluation_draft_scope();
