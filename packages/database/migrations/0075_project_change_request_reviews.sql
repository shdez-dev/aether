ALTER TABLE project_change_requests
  ADD COLUMN reviewed_by_actor_id TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_note TEXT,
  ADD CONSTRAINT project_change_requests_review_consistency CHECK (
    (status = 'pending' AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL AND review_note IS NULL)
    OR
    (status IN ('approved', 'rejected') AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND btrim(review_note) <> '')
  );

CREATE TABLE project_baselines (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  change_request_id UUID NOT NULL UNIQUE REFERENCES project_change_requests(id),
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot JSONB NOT NULL,
  approved_by_actor_id TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (project_id, version)
);

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
  IF NEW.status <> 'pending' AND NOT EXISTS (
    SELECT 1
      FROM projects project
      JOIN organization_memberships reviewer
        ON reviewer.organization_id = project.organization_id
     WHERE project.id = NEW.project_id
       AND reviewer.actor_id = NEW.reviewed_by_actor_id
       AND reviewer.status = 'active'
       AND reviewer.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'change request review requires organization management authority'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
