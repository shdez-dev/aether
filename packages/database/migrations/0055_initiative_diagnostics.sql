CREATE TABLE initiative_diagnostics (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiative_id UUID NOT NULL UNIQUE REFERENCES initiatives(id),
  version INTEGER NOT NULL CHECK (version >= 0),
  beneficiaries JSONB NOT NULL,
  causes JSONB NOT NULL,
  constraints JSONB NOT NULL,
  previous_attempts JSONB NOT NULL,
  hypotheses JSONB NOT NULL,
  saved_by_actor_id TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL
);
CREATE OR REPLACE FUNCTION validate_initiative_diagnostic_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM initiatives WHERE id = NEW.initiative_id AND organization_id = NEW.organization_id AND workspace_id = NEW.workspace_id AND status IN ('draft', 'returned')) THEN
    RAISE EXCEPTION 'diagnostic must preserve editable initiative scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER initiative_diagnostics_scope_check BEFORE INSERT OR UPDATE ON initiative_diagnostics FOR EACH ROW EXECUTE FUNCTION validate_initiative_diagnostic_scope();
