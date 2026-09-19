ALTER TABLE initiative_decisions
  ADD COLUMN next_review_on DATE NULL,
  ADD CONSTRAINT initiative_decisions_next_review_on_check CHECK (
    (outcome = 'returned' AND next_review_on IS NOT NULL)
    OR (outcome <> 'returned' AND next_review_on IS NULL)
  );
