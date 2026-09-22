ALTER TABLE project_next_actions
  ADD COLUMN reviewer_actor_id TEXT NULL,
  ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'to_do'
    CHECK (workflow_status IN ('to_do', 'in_progress', 'in_review', 'done', 'cancelled')),
  ADD COLUMN blocked_reason TEXT NULL
    CHECK (blocked_reason IS NULL OR char_length(blocked_reason) BETWEEN 1 AND 2000),
  ADD COLUMN unblock_responsible_actor_id TEXT NULL,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  ADD CONSTRAINT project_next_actions_block_context
    CHECK (
      (blocked_reason IS NULL AND unblock_responsible_actor_id IS NULL)
      OR (
        blocked_reason IS NOT NULL
        AND unblock_responsible_actor_id IS NOT NULL
        AND workflow_status IN ('in_progress', 'in_review')
      )
    );

UPDATE project_next_actions
   SET workflow_status = 'done'
 WHERE completed_at IS NOT NULL;

COMMENT ON COLUMN project_next_actions.workflow_status IS
  'Flujo operativo compartido. El bloqueo se representa por separado para conservar el estado de trabajo.';
