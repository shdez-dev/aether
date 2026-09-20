CREATE INDEX project_external_dependencies_open_due_idx
  ON project_external_dependencies (project_id, due_on)
  WHERE status = 'open';
