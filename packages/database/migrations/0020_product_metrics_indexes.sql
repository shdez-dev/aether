CREATE INDEX initiative_decisions_metrics_idx
  ON initiative_decisions (organization_id, decided_at)
  INCLUDE (id, outcome, initiative_id);

CREATE INDEX projects_metrics_idx
  ON projects (organization_id, status, updated_at)
  INCLUDE (id, source_decision_id, lead_actor_id);

CREATE INDEX project_closures_metrics_idx
  ON project_closures (organization_id, closed_at)
  INCLUDE (project_id, lessons_learned);
