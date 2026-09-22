ALTER TABLE project_operational_decisions
  ADD COLUMN supersedes_decision_id UUID REFERENCES project_operational_decisions(id);

CREATE UNIQUE INDEX project_operational_decisions_single_successor
  ON project_operational_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_project_operational_decision_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'operational decisions are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships member
        ON member.organization_id = project.organization_id
     WHERE project.id = NEW.project_id
       AND member.actor_id = NEW.decided_by_actor_id
       AND member.status = 'active'
       AND (
         NEW.decided_by_actor_id = project.lead_actor_id
         OR member.role IN ('owner', 'admin')
       )
  ) THEN
    RAISE EXCEPTION 'operational decision requires project execution authority'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM project_operational_decisions previous
     WHERE previous.id = NEW.supersedes_decision_id
       AND previous.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'operational decision must supersede a decision from the same project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
