CREATE TABLE initiative_relationships (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_initiative_id UUID NOT NULL REFERENCES initiatives(id),
  target_initiative_id UUID NOT NULL REFERENCES initiatives(id),
  kind TEXT NOT NULL CHECK (kind IN ('related', 'continues')),
  declared_by_actor_id TEXT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL,
  CHECK (source_initiative_id <> target_initiative_id),
  UNIQUE (source_initiative_id, target_initiative_id)
);
CREATE INDEX initiative_relationships_target_idx
  ON initiative_relationships (organization_id, target_initiative_id, declared_at DESC);
CREATE INDEX initiative_relationships_source_idx
  ON initiative_relationships (organization_id, source_initiative_id, declared_at DESC);

CREATE OR REPLACE FUNCTION validate_initiative_relationship_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM initiatives source
      JOIN initiatives target ON target.id = NEW.target_initiative_id
     WHERE source.id = NEW.source_initiative_id
       AND source.organization_id = NEW.organization_id
       AND source.workspace_id = NEW.workspace_id
       AND target.organization_id = NEW.organization_id
       AND target.workspace_id = NEW.workspace_id
       AND source.status IN ('draft', 'returned')
       AND source.created_by_actor_id = NEW.declared_by_actor_id
  ) THEN
    RAISE EXCEPTION 'initiative relationship must preserve organization and workspace scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initiative_relationships_scope_check
BEFORE INSERT
ON initiative_relationships
FOR EACH ROW EXECUTE FUNCTION validate_initiative_relationship_scope();

CREATE OR REPLACE FUNCTION prevent_initiative_relationship_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'initiative relationships are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER initiative_relationships_append_only
BEFORE UPDATE OR DELETE ON initiative_relationships
FOR EACH ROW EXECUTE FUNCTION prevent_initiative_relationship_mutation();
