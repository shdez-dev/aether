CREATE OR REPLACE FUNCTION validate_project_external_dependency_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships owner_member
        ON owner_member.organization_id = project.organization_id
      JOIN organization_memberships creator_member
        ON creator_member.organization_id = project.organization_id
      JOIN workspace_memberships owner_workspace_member
        ON owner_workspace_member.workspace_id = project.workspace_id
     WHERE project.id = NEW.project_id
       AND owner_member.actor_id = NEW.owner_actor_id
       AND owner_member.status = 'active'
       AND creator_member.actor_id = NEW.created_by_actor_id
       AND creator_member.status = 'active'
       AND owner_workspace_member.actor_id = NEW.owner_actor_id
       AND (
         NEW.created_by_actor_id = project.lead_actor_id
         OR creator_member.role IN ('owner', 'admin')
       )
  ) THEN
    RAISE EXCEPTION 'external dependency requires scoped execution authority'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_external_dependencies_scope_check
BEFORE INSERT OR UPDATE ON project_external_dependencies
FOR EACH ROW EXECUTE FUNCTION validate_project_external_dependency_scope();
