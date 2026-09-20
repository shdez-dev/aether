CREATE TABLE project_next_action_dependencies (
  action_id UUID NOT NULL REFERENCES project_next_actions(id) ON DELETE CASCADE,
  depends_on_action_id UUID NOT NULL REFERENCES project_next_actions(id) ON DELETE CASCADE,
  PRIMARY KEY (action_id, depends_on_action_id),
  CHECK (action_id <> depends_on_action_id)
);
