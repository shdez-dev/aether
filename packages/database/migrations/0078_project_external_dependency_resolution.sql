ALTER TABLE project_external_dependencies
  ADD COLUMN resolution_note TEXT,
  ADD COLUMN resolved_by_actor_id TEXT,
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD CONSTRAINT project_external_dependencies_resolution_consistency CHECK (
    (status = 'open' AND resolution_note IS NULL AND resolved_by_actor_id IS NULL AND resolved_at IS NULL)
    OR
    (status IN ('resolved', 'accepted') AND resolution_note IS NOT NULL AND btrim(resolution_note) <> '' AND resolved_by_actor_id IS NOT NULL AND resolved_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION validate_project_external_dependency_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'external dependency resolution is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM projects project
    JOIN organization_memberships owner_member ON owner_member.organization_id = project.organization_id
    JOIN organization_memberships creator_member ON creator_member.organization_id = project.organization_id
    JOIN workspace_memberships owner_workspace_member ON owner_workspace_member.workspace_id = project.workspace_id
    WHERE project.id = NEW.project_id AND owner_member.actor_id = NEW.owner_actor_id
      AND owner_member.status = 'active' AND creator_member.actor_id = NEW.created_by_actor_id
      AND creator_member.status = 'active' AND owner_workspace_member.actor_id = NEW.owner_actor_id
      AND (NEW.created_by_actor_id = project.lead_actor_id OR creator_member.role IN ('owner', 'admin'))
  ) THEN RAISE EXCEPTION 'external dependency requires scoped execution authority' USING ERRCODE = '23514'; END IF;
  IF NEW.status <> 'open' AND NOT EXISTS (
    SELECT 1 FROM projects project JOIN organization_memberships resolver ON resolver.organization_id = project.organization_id
    WHERE project.id = NEW.project_id AND resolver.actor_id = NEW.resolved_by_actor_id AND resolver.status = 'active'
      AND (NEW.resolved_by_actor_id = NEW.owner_actor_id OR NEW.resolved_by_actor_id = project.lead_actor_id OR resolver.role IN ('owner', 'admin'))
  ) THEN RAISE EXCEPTION 'external dependency resolution requires scoped authority' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
