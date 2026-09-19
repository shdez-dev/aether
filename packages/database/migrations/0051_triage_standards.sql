CREATE TABLE triage_standards (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  criteria JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL,
  published_by_actor_id TEXT NOT NULL,
  UNIQUE (organization_id, name, version)
);
CREATE UNIQUE INDEX triage_standards_one_active_per_organization_idx
  ON triage_standards (organization_id) WHERE is_active;

CREATE TABLE triage_standard_adoptions (
  id UUID PRIMARY KEY,
  standard_id UUID NOT NULL REFERENCES triage_standards(id),
  adopted_by_actor_id TEXT NOT NULL,
  adopted_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE initiative_triages (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL REFERENCES initiatives(id),
  initiative_version INTEGER NOT NULL CHECK (initiative_version >= 0),
  standard_id UUID NOT NULL REFERENCES triage_standards(id),
  standard_version INTEGER NOT NULL CHECK (standard_version >= 1),
  criteria JSONB NOT NULL,
  assessed_by_actor_id TEXT NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (initiative_id, initiative_version, standard_id, standard_version)
);
CREATE INDEX initiative_triages_initiative_idx
  ON initiative_triages (organization_id, initiative_id, assessed_at DESC);

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
  ) THEN
    RAISE EXCEPTION 'triage scope does not match initiative and standard'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_triages_scope_check
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, initiative_id,
  initiative_version, standard_id, standard_version
ON initiative_triages
FOR EACH ROW EXECUTE FUNCTION validate_triage_scope();

CREATE OR REPLACE FUNCTION prevent_applied_triage_standard_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM initiative_triages WHERE standard_id = OLD.id
  ) AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.criteria IS DISTINCT FROM OLD.criteria
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by_actor_id IS DISTINCT FROM OLD.published_by_actor_id
  ) THEN
    RAISE EXCEPTION 'a triage standard cannot change after it is applied'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER triage_standards_preserve_applied_versions
BEFORE UPDATE OF organization_id, name, version, criteria, published_at,
  published_by_actor_id
ON triage_standards
FOR EACH ROW EXECUTE FUNCTION prevent_applied_triage_standard_mutation();
