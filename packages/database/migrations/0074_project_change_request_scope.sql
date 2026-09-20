CREATE OR REPLACE FUNCTION validate_project_change_request_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships requester
        ON requester.organization_id = project.organization_id
     WHERE project.id = NEW.project_id
       AND requester.actor_id = NEW.requested_by_actor_id
       AND requester.status = 'active'
       AND (
         NEW.requested_by_actor_id = project.lead_actor_id
         OR requester.role IN ('owner', 'admin')
       )
  ) THEN
    RAISE EXCEPTION 'change request requires project execution authority'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_change_requests_scope_check
BEFORE INSERT OR UPDATE ON project_change_requests
FOR EACH ROW EXECUTE FUNCTION validate_project_change_request_scope();
