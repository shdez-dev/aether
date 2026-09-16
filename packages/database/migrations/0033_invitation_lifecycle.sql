ALTER TABLE invitations
  ADD COLUMN rejected_at TIMESTAMPTZ NULL,
  ADD COLUMN rejected_by_actor_id TEXT NULL,
  ADD COLUMN revoked_at TIMESTAMPTZ NULL,
  ADD COLUMN revoked_by_actor_id TEXT NULL,
  ADD COLUMN expired_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT invitations_terminal_state_check CHECK (
    num_nonnulls(accepted_at, rejected_at, revoked_at, expired_at) <= 1
  ),
  ADD CONSTRAINT invitations_rejection_actor_check CHECK (
    (rejected_at IS NULL) = (rejected_by_actor_id IS NULL)
  ),
  ADD CONSTRAINT invitations_revocation_actor_check CHECK (
    (revoked_at IS NULL) = (revoked_by_actor_id IS NULL)
  );

ALTER TABLE organization_membership_audit_events
  DROP CONSTRAINT organization_membership_audit_events_event_type_check;

ALTER TABLE organization_membership_audit_events
  ADD CONSTRAINT organization_membership_audit_events_event_type_check CHECK (
    event_type IN (
      'organization.created.v1',
      'organization.invitation_issued.v1',
      'organization.invitation_rejected.v1',
      'organization.invitation_revoked.v1',
      'organization.invitation_expired.v1',
      'organization.ownership_transferred.v1',
      'organization.membership_activated.v1',
      'organization.member_responsibilities_reassigned.v1',
      'organization.membership_suspended.v1',
      'organization.membership_revoked.v1'
    )
  );

CREATE INDEX invitations_pending_organization_idx
  ON invitations (organization_id, expires_at)
  WHERE accepted_at IS NULL
    AND rejected_at IS NULL
    AND revoked_at IS NULL
    AND expired_at IS NULL;
