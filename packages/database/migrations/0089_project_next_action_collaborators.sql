CREATE TABLE project_next_action_collaborators (
  action_id UUID NOT NULL REFERENCES project_next_actions(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  added_by_actor_id TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (action_id, actor_id)
);

CREATE OR REPLACE FUNCTION enforce_project_next_action_collaborator_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM project_next_actions action
    JOIN projects project ON project.id = action.project_id
    JOIN organization_memberships organization_member
      ON organization_member.organization_id = project.organization_id
     AND organization_member.actor_id = NEW.actor_id
     AND organization_member.status = 'active'
    JOIN workspace_memberships workspace_member
      ON workspace_member.workspace_id = project.workspace_id
     AND workspace_member.actor_id = NEW.actor_id
    WHERE action.id = NEW.action_id
  ) THEN
    RAISE EXCEPTION 'next action collaborator must be active in its project workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_next_action_collaborators_scope
BEFORE INSERT OR UPDATE OF action_id, actor_id ON project_next_action_collaborators
FOR EACH ROW EXECUTE FUNCTION enforce_project_next_action_collaborator_scope();
