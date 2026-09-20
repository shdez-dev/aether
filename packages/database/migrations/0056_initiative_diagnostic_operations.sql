ALTER TABLE initiative_diagnostics
  ADD COLUMN scope TEXT,
  ADD COLUMN risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN next_experiment TEXT;

ALTER TABLE initiative_diagnostics
  ADD CONSTRAINT initiative_diagnostics_scope_nonempty CHECK (scope IS NULL OR length(trim(scope)) > 0);
