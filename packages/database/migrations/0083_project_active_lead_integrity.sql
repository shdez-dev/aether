CREATE OR REPLACE FUNCTION enforce_project_active_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pending_lead' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM organization_memberships organization_member
      JOIN workspace_memberships workspace_member
        ON workspace_member.workspace_id = NEW.workspace_id
     WHERE organization_member.organization_id = NEW.organization_id
       AND organization_member.actor_id = NEW.lead_actor_id
       AND organization_member.status = 'active'
       AND workspace_member.actor_id = NEW.lead_actor_id
  ) THEN
    RAISE EXCEPTION 'project requires an active scoped lead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_active_lead_integrity
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, lead_actor_id, status ON projects
FOR EACH ROW EXECUTE FUNCTION enforce_project_active_lead();
