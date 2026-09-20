ALTER TABLE projects
  ALTER COLUMN lead_actor_id DROP NOT NULL;

ALTER TABLE projects
  DROP CONSTRAINT projects_status_check,
  ADD CONSTRAINT projects_status_check
    CHECK (status IN ('pending_lead', 'planned', 'active', 'blocked', 'completed', 'cancelled')),
  ADD CONSTRAINT projects_pending_lead_consistency
    CHECK (
      (status = 'pending_lead' AND lead_actor_id IS NULL)
      OR (status <> 'pending_lead' AND lead_actor_id IS NOT NULL)
    );
