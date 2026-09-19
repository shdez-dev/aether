ALTER TABLE initiative_evaluations
  ADD COLUMN annulled_by_actor_id TEXT NULL,
  ADD COLUMN annulled_at TIMESTAMPTZ NULL,
  ADD COLUMN annulment_reason TEXT NULL,
  ADD CONSTRAINT initiative_evaluations_annulment_state_check CHECK (
    (annulled_at IS NULL AND annulled_by_actor_id IS NULL AND annulment_reason IS NULL)
    OR (annulled_at IS NOT NULL AND annulled_by_actor_id IS NOT NULL AND annulment_reason IS NOT NULL)
  );
