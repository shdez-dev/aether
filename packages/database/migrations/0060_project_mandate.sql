ALTER TABLE projects
  ADD COLUMN objective TEXT,
  ADD COLUMN boundaries TEXT,
  ADD COLUMN success_criteria TEXT,
  ADD COLUMN next_milestone TEXT,
  ADD CONSTRAINT projects_objective_nonempty CHECK (objective IS NULL OR length(trim(objective)) > 0),
  ADD CONSTRAINT projects_boundaries_nonempty CHECK (boundaries IS NULL OR length(trim(boundaries)) > 0),
  ADD CONSTRAINT projects_success_criteria_nonempty CHECK (success_criteria IS NULL OR length(trim(success_criteria)) > 0),
  ADD CONSTRAINT projects_next_milestone_nonempty CHECK (next_milestone IS NULL OR length(trim(next_milestone)) > 0);
