-- These indexes mirror the authorized listing filters and their stable cursors.
CREATE INDEX evaluation_standards_organization_listing_idx
  ON evaluation_standards (organization_id, is_active DESC, name ASC, version DESC, id ASC);

CREATE INDEX triage_standards_organization_listing_idx
  ON triage_standards (organization_id, is_active DESC, name ASC, version DESC, id ASC);

CREATE INDEX initiatives_unassigned_intake_listing_idx
  ON initiatives (organization_id, updated_at ASC, id ASC)
  WHERE status = 'presented';

CREATE INDEX comments_active_resource_listing_idx
  ON comments (organization_id, resource_type, resource_id, created_at ASC, id ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX notifications_inbox_stable_listing_idx
  ON notifications (recipient_actor_id, organization_id, created_at DESC, id DESC);

CREATE INDEX projects_workspace_stable_listing_idx
  ON projects (organization_id, workspace_id, updated_at DESC, id DESC);
