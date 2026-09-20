ALTER TABLE projects
  DROP CONSTRAINT projects_status_check,
  ADD CONSTRAINT projects_status_check
    CHECK (status IN ('pending_lead', 'planned', 'active', 'paused', 'blocked', 'completed', 'cancelled'));
