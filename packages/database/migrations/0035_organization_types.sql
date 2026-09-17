ALTER TABLE organizations
  ADD COLUMN organization_type TEXT NULL
    CHECK (organization_type IS NULL OR organization_type IN ('personal', 'business', 'institutional'));

CREATE INDEX organizations_type_idx
  ON organizations (organization_type)
  WHERE organization_type IS NOT NULL;
