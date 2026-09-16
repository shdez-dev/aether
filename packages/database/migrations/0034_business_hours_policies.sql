ALTER TABLE organization_policies
  ADD COLUMN business_hours JSONB NULL,
  ADD CONSTRAINT organization_policies_business_hours_object
    CHECK (business_hours IS NULL OR jsonb_typeof(business_hours) = 'object');

ALTER TABLE workspace_policy_overrides
  ADD COLUMN business_hours JSONB NULL,
  ADD CONSTRAINT workspace_policy_overrides_business_hours_object
    CHECK (business_hours IS NULL OR jsonb_typeof(business_hours) = 'object');

ALTER TABLE tenancy_policy_audit_events
  DROP CONSTRAINT tenancy_policy_audit_events_event_type_check;

ALTER TABLE tenancy_policy_audit_events
  ADD CONSTRAINT tenancy_policy_audit_events_event_type_check CHECK (event_type IN (
    'organization.policy_configured.v1',
    'organization.policy_updated.v1',
    'workspace.policy_override_set.v1',
    'workspace.policy_override_cleared.v1',
    'organization.business_hours_outside_window.v1'
  ));
