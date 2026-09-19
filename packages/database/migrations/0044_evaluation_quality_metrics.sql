ALTER TABLE initiative_evaluations
  ADD COLUMN quality JSONB;

ALTER TABLE initiative_decisions
  ADD COLUMN quality JSONB;
