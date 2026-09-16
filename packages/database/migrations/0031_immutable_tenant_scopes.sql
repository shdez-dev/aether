CREATE FUNCTION prevent_organization_scope_transfer() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Organization scope is immutable; use approved export and import for inter-organization moves'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION enforce_immutable_workspace_scope() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  ) THEN
    RAISE EXCEPTION 'Tenant scope is immutable; use an explicit approved migration command'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspaces
    WHERE id = NEW.workspace_id
      AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'Workspace must belong to the record organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  inconsistent_table TEXT;
BEGIN
  SELECT table_name INTO inconsistent_table
  FROM (
    SELECT 'teams'::TEXT AS table_name
    FROM teams item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'initiatives'
    FROM initiatives item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'initiative_evaluations'
    FROM initiative_evaluations item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'initiative_decisions'
    FROM initiative_decisions item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'projects'
    FROM projects item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'documents'
    FROM documents item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'project_closures'
    FROM project_closures item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'project_deliverable_acceptances'
    FROM project_deliverable_acceptances item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'evidence_references'
    FROM evidence_references item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'notifications'
    FROM notifications item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'comments'
    FROM comments item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'workspace_policy_overrides'
    FROM workspace_policy_overrides item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
    UNION ALL
    SELECT 'temporary_access_grants'
    FROM temporary_access_grants item JOIN workspaces workspace ON workspace.id = item.workspace_id
    WHERE item.organization_id <> workspace.organization_id
  ) inconsistent
  LIMIT 1;

  IF inconsistent_table IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce immutable tenant scope: inconsistent data in %', inconsistent_table
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- A workspace never changes organization in the MVP.
CREATE TRIGGER workspaces_organization_scope_immutable
  BEFORE UPDATE OF organization_id ON workspaces
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_scope_transfer();

-- Organization-scoped records without a workspace cannot be reassigned.
CREATE TRIGGER evaluation_standards_organization_scope_immutable
  BEFORE UPDATE OF organization_id ON evaluation_standards
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_scope_transfer();
CREATE TRIGGER organization_policies_organization_scope_immutable
  BEFORE UPDATE OF organization_id ON organization_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_scope_transfer();
CREATE TRIGGER support_access_grants_organization_scope_immutable
  BEFORE UPDATE OF organization_id ON support_access_grants
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_scope_transfer();

-- Institutional records with both identifiers must match a real workspace and
-- cannot be reassigned by a generic UPDATE. A future explicit relocation
-- command must be introduced with its own reviewed migration and audit trail.
CREATE TRIGGER teams_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON teams
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER initiatives_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON initiatives
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER initiative_evaluations_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON initiative_evaluations
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER initiative_decisions_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON initiative_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER projects_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON projects
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER documents_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON documents
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER project_closures_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON project_closures
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER project_deliverable_acceptances_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON project_deliverable_acceptances
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER evidence_references_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON evidence_references
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER notifications_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON notifications
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER comments_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON comments
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER workspace_policy_overrides_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON workspace_policy_overrides
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
CREATE TRIGGER temporary_access_grants_tenant_scope_immutable
  BEFORE INSERT OR UPDATE OF organization_id, workspace_id ON temporary_access_grants
  FOR EACH ROW EXECUTE FUNCTION enforce_immutable_workspace_scope();
