import type {
  AuthSession,
  AuthSessionAuditEvent,
  AuthSessionAuditStore,
  AuthStore,
  LoginTransaction,
} from "@aether/auth";
import { ProjectAlreadyExistsError } from "@aether/application";
import type {
  InitiativeAuditEvent,
  InitiativeAuditStore,
  InitiativeStore,
  EvaluationStandardStore,
  EvaluationStore,
  ProjectAuditEvent,
  ProjectAuditStore,
  ProjectExecutionStore,
  ProjectStore,
  OutboxStore,
  OutboxQueueStore,
  OutboxQueueStats,
  OutboxAdministrationStore,
  OutboxDeadLetter,
  OutboxMessage,
  DurableDomainEvent,
  IdempotencyReservation,
  IdempotencyResponse,
  IdempotencyStore,
  AuditEvent,
  AuditHistoryStore,
  SecurityAuditStore,
  ProductMetricsStore,
  ProductMetricsSnapshot,
  DocumentAuditEvent,
  DocumentAuditStore,
  DocumentStore,
  DocumentVersionAccess,
  DocumentResource,
  DocumentProjectAccess,
  NotificationStore,
  Notification,
  NotificationPreference,
  CommentStore,
  Comment,
  EvidenceReferenceStore,
  EvidenceSubjectLookup,
  ProjectClosureStore,
  Invitation,
  Organization,
  Team,
  TenantStore,
  Workspace,
} from "@aether/application";
import type {
  Initiative,
  InitiativeClassification,
  InitiativeStatus,
  EvaluationStandard,
  InitiativeEvaluation,
  InitiativeDecision,
  Project,
  ProjectMilestone,
  ProjectNextAction,
  OrganizationRole,
  WorkspaceRole,
  DocumentVersion,
  InstitutionalDocument,
  DocumentResourceType,
  EvidenceReference,
  EvidenceReferenceSubjectType,
  ProjectClosure,
  ProjectDeliverableAcceptance,
} from "@aether/domain";
import type { Pool, PoolClient } from "pg";

export { migratePool } from "./migrations.js";

/** Adaptador PostgreSQL para transacciones OIDC y sesiones opacas. */
export class PostgresAuthStore implements AuthStore, AuthSessionAuditStore {
  constructor(private readonly pool: Pool) {}

  async createSession(session: AuthSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (id, token_hash, actor_id, actor_email, issuer, created_at, last_seen_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session.id,
        session.tokenHash,
        session.actorId,
        session.actorEmail,
        session.issuer,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
        session.revokedAt,
      ],
    );
  }

  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, token_hash, actor_id, actor_email, issuer, created_at, last_seen_at, expires_at, revoked_at
       FROM auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async renewSession(
    sessionId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<AuthSession | null> {
    const result = await this.pool.query<SessionRow>(
      `UPDATE auth_sessions SET expires_at = $2, last_seen_at = $3 WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, token_hash, actor_id, actor_email, issuer, created_at, last_seen_at, expires_at, revoked_at`,
      [sessionId, expiresAt, now],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async listActiveSessions(input: {
    actorId: string;
    now: Date;
  }): Promise<readonly AuthSession[]> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, token_hash, actor_id, actor_email, issuer, created_at, last_seen_at, expires_at, revoked_at
       FROM auth_sessions
       WHERE actor_id = $1 AND revoked_at IS NULL AND expires_at > $2
       ORDER BY last_seen_at DESC, created_at DESC`,
      [input.actorId, input.now],
    );
    return result.rows.map(toSession);
  }

  async revokeOwnedSession(input: {
    actorId: string;
    sessionId: string;
    now: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = $3
       WHERE id = $1 AND actor_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [input.sessionId, input.actorId, input.now],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async revokeOtherSessions(input: {
    actorId: string;
    exceptSessionId: string;
    now: Date;
  }): Promise<number> {
    const result = await this.pool.query(
      `UPDATE auth_sessions SET revoked_at = $3
       WHERE actor_id = $1 AND id <> $2 AND revoked_at IS NULL AND expires_at > $3`,
      [input.actorId, input.exceptSessionId, input.now],
    );
    return result.rowCount ?? 0;
  }

  async rotateSession(input: {
    actorId: string;
    sessionId: string;
    replacement: AuthSession;
    now: Date;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const revoked = await client.query(
        `UPDATE auth_sessions SET revoked_at = $3
         WHERE id = $1 AND actor_id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [input.sessionId, input.actorId, input.now],
      );
      if ((revoked.rowCount ?? 0) !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO auth_sessions (id, token_hash, actor_id, actor_email, issuer, created_at, last_seen_at, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.replacement.id,
          input.replacement.tokenHash,
          input.replacement.actorId,
          input.replacement.actorEmail,
          input.replacement.issuer,
          input.replacement.createdAt,
          input.replacement.lastSeenAt,
          input.replacement.expiresAt,
          input.replacement.revokedAt,
        ],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSessionAudit(event: AuthSessionAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_session_audit_events
       (id, action, actor_id, target_session_id, correlation_id, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.id,
        event.action,
        event.actorId,
        event.targetSessionId,
        event.correlationId,
        event.occurredAt,
        asJson(event.payload),
      ],
    );
  }

  async createLoginTransaction(transaction: LoginTransaction): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_login_transactions (id, handle_hash, state_hash, code_verifier_ciphertext, nonce_ciphertext, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        transaction.id,
        transaction.handleHash,
        transaction.stateHash,
        transaction.codeVerifierCiphertext,
        transaction.nonceCiphertext,
        transaction.expiresAt,
      ],
    );
  }

  async consumeLoginTransaction(input: {
    handleHash: string;
    stateHash: string;
    now: Date;
  }): Promise<LoginTransaction | null> {
    const result = await this.pool.query<LoginTransactionRow>(
      `DELETE FROM auth_login_transactions WHERE handle_hash = $1 AND state_hash = $2 AND expires_at > $3
       RETURNING id, handle_hash, state_hash, code_verifier_ciphertext, nonce_ciphertext, expires_at`,
      [input.handleHash, input.stateHash, input.now],
    );
    return result.rows[0] ? toLoginTransaction(result.rows[0]) : null;
  }
}

/** Persistencia de resultados de mutaciones HTTP idempotentes. */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async reserve(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<IdempotencyReservation> {
    await this.pool.query(
      "DELETE FROM api_idempotency_keys WHERE expires_at <= NOW()",
    );
    const inserted = await this.pool.query(
      `INSERT INTO api_idempotency_keys (actor_id, operation, idempotency_key, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT DO NOTHING
       RETURNING actor_id`,
      [
        input.actorId,
        input.operation,
        input.key,
        input.requestHash,
        input.expiresAt,
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return { kind: "claimed" };

    const existing = await this.pool.query<IdempotencyKeyRow>(
      `SELECT request_hash, status, response_status, response_body
       FROM api_idempotency_keys
       WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3`,
      [input.actorId, input.operation, input.key],
    );
    const record = existing.rows[0];
    if (!record || record.request_hash !== input.requestHash)
      return { kind: "key_reused" };
    if (record.status === "pending") return { kind: "in_progress" };
    if (record.response_status === null || record.response_body === null)
      throw new Error("Completed idempotency record is invalid");
    return {
      kind: "completed",
      response: {
        statusCode: record.response_status,
        body: record.response_body,
      },
    };
  }

  async complete(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
    response: IdempotencyResponse;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE api_idempotency_keys
       SET status = 'completed', response_status = $5, response_body = $6
       WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3
         AND request_hash = $4 AND status = 'pending'`,
      [
        input.actorId,
        input.operation,
        input.key,
        input.requestHash,
        input.response.statusCode,
        asJson(input.response.body),
      ],
    );
    if ((result.rowCount ?? 0) !== 1)
      throw new Error("Idempotency record cannot be completed");
  }

  async abandon(input: {
    actorId: string;
    operation: string;
    key: string;
    requestHash: string;
  }): Promise<void> {
    await this.pool.query(
      `DELETE FROM api_idempotency_keys
       WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3
         AND request_hash = $4 AND status = 'pending'`,
      [input.actorId, input.operation, input.key, input.requestHash],
    );
  }
}

type SessionRow = {
  id: string;
  token_hash: string;
  actor_id: string;
  actor_email: string | null;
  issuer: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};
type IdempotencyKeyRow = {
  request_hash: string;
  status: "pending" | "completed";
  response_status: number | null;
  response_body: unknown | null;
};
type LoginTransactionRow = {
  id: string;
  handle_hash: string;
  state_hash: string;
  code_verifier_ciphertext: string;
  nonce_ciphertext: string;
  expires_at: Date;
};
function toSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    issuer: row.issuer,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
function toLoginTransaction(row: LoginTransactionRow): LoginTransaction {
  return {
    id: row.id,
    handleHash: row.handle_hash,
    stateHash: row.state_hash,
    codeVerifierCiphertext: row.code_verifier_ciphertext,
    nonceCiphertext: row.nonce_ciphertext,
    expiresAt: row.expires_at,
  };
}

/** Adaptador transaccional de organizaciones, workspaces, membresías e invitaciones. */
export class PostgresTenantStore implements TenantStore {
  constructor(private readonly pool: Pool) {}

  async bootstrapOrganization(input: {
    organization: Organization;
    ownerActorId: string;
    ownerEmail: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO organizations (id, name, timezone, locale, version) VALUES ($1, $2, $3, $4, $5)",
        [
          input.organization.id,
          input.organization.name,
          input.organization.timezone,
          input.organization.locale,
          input.organization.version,
        ],
      );
      await client.query(
        "INSERT INTO organization_memberships (organization_id, actor_id, actor_email, role) VALUES ($1, $2, $3, 'owner')",
        [
          input.organization.id,
          input.ownerActorId,
          input.ownerEmail.toLowerCase(),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createWorkspace(workspace: Workspace): Promise<void> {
    await this.pool.query(
      "INSERT INTO workspaces (id, organization_id, name, mode, version) VALUES ($1, $2, $3, $4, $5)",
      [
        workspace.id,
        workspace.organizationId,
        workspace.name,
        workspace.mode,
        workspace.version,
      ],
    );
  }

  async findWorkspace(workspaceId: string): Promise<Workspace | null> {
    const result = await this.pool.query<WorkspaceRow>(
      "SELECT id, organization_id, name, mode, version, status, archived_at, archived_by_actor_id FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return result.rows[0] ? toWorkspace(result.rows[0]) : null;
  }
  async listOrganizations(actorId: string): Promise<readonly Organization[]> {
    const result = await this.pool.query<Organization>(
      `SELECT organizations.id, organizations.name, organizations.timezone, organizations.locale, organizations.version FROM organizations JOIN organization_memberships ON organization_memberships.organization_id = organizations.id WHERE organization_memberships.actor_id = $1 AND organization_memberships.status = 'active' ORDER BY organizations.name`,
      [actorId],
    );
    return result.rows;
  }
  async listWorkspaces(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Workspace[]> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT workspaces.id, workspaces.organization_id, workspaces.name, workspaces.mode, workspaces.version, workspaces.status, workspaces.archived_at, workspaces.archived_by_actor_id FROM workspaces LEFT JOIN workspace_memberships ON workspace_memberships.workspace_id = workspaces.id WHERE workspaces.organization_id = $1 AND EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND actor_id = $2 AND status = 'active') AND (EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND actor_id = $2 AND status = 'active' AND role IN ('owner','admin')) OR workspace_memberships.actor_id = $2) ORDER BY workspaces.name`,
      [input.organizationId, input.actorId],
    );
    return result.rows.map(toWorkspace);
  }

  async findOrganizationRole(input: {
    actorId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    const result = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM organization_memberships WHERE actor_id = $1 AND organization_id = $2 AND status = 'active'",
      [input.actorId, input.organizationId],
    );
    return result.rows[0]?.role ?? null;
  }

  async findWorkspaceRole(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<WorkspaceRole | null> {
    const result = await this.pool.query<{ role: WorkspaceRole }>(
      `SELECT workspace_memberships.role FROM workspace_memberships
       JOIN workspaces ON workspaces.id = workspace_memberships.workspace_id
       JOIN organization_memberships ON organization_memberships.organization_id = workspaces.organization_id AND organization_memberships.actor_id = workspace_memberships.actor_id
       WHERE workspace_memberships.actor_id = $1 AND workspace_memberships.workspace_id = $2 AND organization_memberships.status = 'active'`,
      [input.actorId, input.workspaceId],
    );
    return result.rows[0]?.role ?? null;
  }

  async createInvitation(
    input: Invitation & { tokenHash: string },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO invitations (id, organization_id, email, organization_role, workspace_ids, workspace_role, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.id,
        input.organizationId,
        input.email,
        input.organizationRole,
        input.workspaceIds,
        input.workspaceRole,
        input.tokenHash,
        input.expiresAt,
      ],
    );
  }

  async acceptInvitation(input: {
    tokenHash: string;
    actorId: string;
    actorEmail: string;
    now: Date;
    auditEventId: string;
    correlationId: string;
  }): Promise<Invitation | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<InvitationRow>(
        `SELECT id, organization_id, email, organization_role, workspace_ids, workspace_role, expires_at
         FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > $2 AND LOWER(email) = LOWER($3) FOR UPDATE`,
        [input.tokenHash, input.now, input.actorEmail],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const invitation = toInvitation(row);
      await client.query(
        `INSERT INTO organization_memberships (organization_id, actor_id, actor_email, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, actor_id) DO UPDATE SET role = EXCLUDED.role, actor_email = EXCLUDED.actor_email, status = 'active', status_changed_at = $5`,
        [
          invitation.organizationId,
          input.actorId,
          input.actorEmail.toLowerCase(),
          invitation.organizationRole,
          input.now,
        ],
      );
      await client.query(
        `INSERT INTO organization_membership_audit_events
         (id, organization_id, actor_id, target_actor_id, event_type, correlation_id, occurred_at, payload)
         VALUES ($1, $2, $3, $3, 'organization.membership_activated.v1', $4, $5, $6)`,
        [
          input.auditEventId,
          invitation.organizationId,
          input.actorId,
          input.correlationId,
          input.now,
          { invitationId: invitation.id },
        ],
      );
      for (const workspaceId of invitation.workspaceIds) {
        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, actor_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, actor_id) DO UPDATE SET role = EXCLUDED.role`,
          [workspaceId, input.actorId, invitation.workspaceRole],
        );
      }
      await client.query(
        "UPDATE invitations SET accepted_at = $2, accepted_by_actor_id = $3 WHERE id = $1",
        [invitation.id, input.now, input.actorId],
      );
      await client.query("COMMIT");
      return invitation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transferOwnership(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"transferred" | "actor_not_owner" | "target_not_member"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const memberships = await client.query<{
        actor_id: string;
        role: OrganizationRole;
        status: "active" | "suspended" | "revoked";
      }>(
        `SELECT actor_id, role, status FROM organization_memberships
         WHERE organization_id = $1 AND actor_id = ANY($2::text[])
         ORDER BY actor_id FOR UPDATE`,
        [input.organizationId, [input.actorId, input.targetActorId]],
      );
      const actor = memberships.rows.find(
        (row) => row.actor_id === input.actorId,
      );
      const target = memberships.rows.find(
        (row) => row.actor_id === input.targetActorId,
      );
      if (actor?.role !== "owner") {
        await client.query("ROLLBACK");
        return "actor_not_owner";
      }
      if (!target || target.status !== "active") {
        await client.query("ROLLBACK");
        return "target_not_member";
      }
      await client.query(
        "UPDATE organization_memberships SET role = 'owner' WHERE organization_id = $1 AND actor_id = $2",
        [input.organizationId, input.targetActorId],
      );
      await client.query(
        "UPDATE organization_memberships SET role = 'admin' WHERE organization_id = $1 AND actor_id = $2",
        [input.organizationId, input.actorId],
      );
      await client.query(
        `INSERT INTO organization_membership_audit_events
         (id, organization_id, actor_id, target_actor_id, event_type, correlation_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, 'organization.ownership_transferred.v1', $5, $6, $7)`,
        [
          input.auditEventId,
          input.organizationId,
          input.actorId,
          input.targetActorId,
          input.correlationId,
          input.occurredAt,
          { formerRole: "owner", newRole: "owner" },
        ],
      );
      await client.query("COMMIT");
      return "transferred";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async changeMembershipStatus(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    status: "suspended" | "revoked";
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<
    | "changed"
    | "actor_not_manager"
    | "target_not_member"
    | "target_is_owner"
    | "target_has_open_responsibilities"
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const memberships = await client.query<{
        actor_id: string;
        role: OrganizationRole;
        status: "active" | "suspended" | "revoked";
      }>(
        `SELECT actor_id, role, status FROM organization_memberships
         WHERE organization_id = $1 AND actor_id = ANY($2::text[])
         ORDER BY actor_id FOR UPDATE`,
        [input.organizationId, [input.actorId, input.targetActorId]],
      );
      const actor = memberships.rows.find(
        (row) => row.actor_id === input.actorId,
      );
      const target = memberships.rows.find(
        (row) => row.actor_id === input.targetActorId,
      );
      if (
        !actor ||
        actor.status !== "active" ||
        (actor.role !== "owner" && actor.role !== "admin")
      ) {
        await client.query("ROLLBACK");
        return "actor_not_manager";
      }
      if (!target) {
        await client.query("ROLLBACK");
        return "target_not_member";
      }
      if (target.role === "owner") {
        await client.query("ROLLBACK");
        return "target_is_owner";
      }
      const responsibilities = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM projects WHERE organization_id = $1 AND status IN ('planned', 'active', 'blocked') AND (lead_actor_id = $2 OR sponsor_actor_id = $2)
          UNION ALL
          SELECT 1 FROM project_next_actions JOIN projects ON projects.id = project_next_actions.project_id WHERE projects.organization_id = $1 AND projects.status IN ('planned', 'active', 'blocked') AND project_next_actions.owner_actor_id = $2 AND project_next_actions.completed_at IS NULL
        ) AS exists`,
        [input.organizationId, input.targetActorId],
      );
      if (responsibilities.rows[0]?.exists) {
        await client.query("ROLLBACK");
        return "target_has_open_responsibilities";
      }
      await client.query(
        "UPDATE organization_memberships SET status = $3, status_changed_at = $4 WHERE organization_id = $1 AND actor_id = $2",
        [
          input.organizationId,
          input.targetActorId,
          input.status,
          input.occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO organization_membership_audit_events
         (id, organization_id, actor_id, target_actor_id, event_type, correlation_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.auditEventId,
          input.organizationId,
          input.actorId,
          input.targetActorId,
          `organization.membership_${input.status}.v1`,
          input.correlationId,
          input.occurredAt,
          { status: input.status },
        ],
      );
      await client.query("COMMIT");
      return "changed";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reassignMemberResponsibilities(input: {
    organizationId: string;
    actorId: string;
    targetActorId: string;
    replacementActorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<
    | "reassigned"
    | "actor_not_manager"
    | "target_not_member"
    | "replacement_not_active"
    | "replacement_conflicts_with_project_role"
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const members = await client.query<{
        actor_id: string;
        role: OrganizationRole;
        status: string;
      }>(
        `SELECT actor_id, role, status FROM organization_memberships WHERE organization_id = $1 AND actor_id = ANY($2::text[]) ORDER BY actor_id FOR UPDATE`,
        [
          input.organizationId,
          [input.actorId, input.targetActorId, input.replacementActorId],
        ],
      );
      const actor = members.rows.find((row) => row.actor_id === input.actorId);
      const target = members.rows.find(
        (row) => row.actor_id === input.targetActorId,
      );
      const replacement = members.rows.find(
        (row) => row.actor_id === input.replacementActorId,
      );
      if (
        !actor ||
        actor.status !== "active" ||
        (actor.role !== "owner" && actor.role !== "admin")
      ) {
        await client.query("ROLLBACK");
        return "actor_not_manager";
      }
      if (!target) {
        await client.query("ROLLBACK");
        return "target_not_member";
      }
      if (!replacement || replacement.status !== "active") {
        await client.query("ROLLBACK");
        return "replacement_not_active";
      }
      const conflict = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM projects WHERE organization_id = $1 AND status IN ('planned','active','blocked') AND ((lead_actor_id = $2 AND sponsor_actor_id = $3) OR (sponsor_actor_id = $2 AND lead_actor_id = $3) OR (participants @> jsonb_build_array(jsonb_build_object('actorId',$2)) AND participants @> jsonb_build_array(jsonb_build_object('actorId',$3))))) AS exists`,
        [input.organizationId, input.targetActorId, input.replacementActorId],
      );
      if (conflict.rows[0]?.exists) {
        await client.query("ROLLBACK");
        return "replacement_conflicts_with_project_role";
      }
      await client.query(
        `UPDATE projects SET sponsor_actor_id = CASE WHEN sponsor_actor_id = $2 THEN $3 ELSE sponsor_actor_id END, lead_actor_id = CASE WHEN lead_actor_id = $2 THEN $3 ELSE lead_actor_id END, participants = (SELECT jsonb_agg(CASE WHEN item->>'actorId' = $2 THEN jsonb_set(item, '{actorId}', to_jsonb($3::text)) ELSE item END) FROM jsonb_array_elements(participants) AS item), version = version + 1, updated_at = $4 WHERE organization_id = $1 AND status IN ('planned','active','blocked') AND (sponsor_actor_id = $2 OR lead_actor_id = $2 OR participants @> jsonb_build_array(jsonb_build_object('actorId',$2)))`,
        [
          input.organizationId,
          input.targetActorId,
          input.replacementActorId,
          input.occurredAt,
        ],
      );
      await client.query(
        `UPDATE project_next_actions SET owner_actor_id = $3 FROM projects WHERE projects.id = project_next_actions.project_id AND projects.organization_id = $1 AND projects.status IN ('planned','active','blocked') AND project_next_actions.owner_actor_id = $2 AND project_next_actions.completed_at IS NULL`,
        [input.organizationId, input.targetActorId, input.replacementActorId],
      );
      await client.query(
        `INSERT INTO organization_membership_audit_events (id, organization_id, actor_id, target_actor_id, event_type, correlation_id, occurred_at, payload) VALUES ($1,$2,$3,$4,'organization.member_responsibilities_reassigned.v1',$5,$6,$7)`,
        [
          input.auditEventId,
          input.organizationId,
          input.actorId,
          input.targetActorId,
          input.correlationId,
          input.occurredAt,
          { replacementActorId: input.replacementActorId },
        ],
      );
      await client.query("COMMIT");
      return "reassigned";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    auditEventId: string;
    correlationId: string;
    occurredAt: Date;
  }): Promise<"archived" | "not_found" | "already_archived"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ status: "active" | "archived" }>(
        `SELECT status FROM workspaces WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [input.workspaceId, input.organizationId],
      );
      const workspace = result.rows[0];
      if (!workspace) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (workspace.status === "archived") {
        await client.query("ROLLBACK");
        return "already_archived";
      }
      await client.query(
        `UPDATE workspaces
         SET status = 'archived', archived_at = $3, archived_by_actor_id = $4, version = version + 1
         WHERE id = $1 AND organization_id = $2`,
        [
          input.workspaceId,
          input.organizationId,
          input.occurredAt,
          input.actorId,
        ],
      );
      await client.query(
        `INSERT INTO workspace_audit_events
         (id, workspace_id, organization_id, actor_id, event_type, correlation_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, 'workspace.archived.v1', $5, $6, $7)`,
        [
          input.auditEventId,
          input.workspaceId,
          input.organizationId,
          input.actorId,
          input.correlationId,
          input.occurredAt,
          {},
        ],
      );
      await client.query("COMMIT");
      return "archived";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createTeam(
    input: Team & {
      actorId: string;
      correlationId: string;
      occurredAt: Date;
    },
  ): Promise<"created" | "workspace_not_found" | "member_not_active"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const workspace = await client.query(
        `SELECT id FROM workspaces
         WHERE id = $1 AND organization_id = $2 AND status = 'active' FOR UPDATE`,
        [input.workspaceId, input.organizationId],
      );
      if ((workspace.rowCount ?? 0) !== 1) {
        await client.query("ROLLBACK");
        return "workspace_not_found";
      }
      if (input.memberActorIds.length > 0) {
        const members = await client.query<{ actor_id: string }>(
          `SELECT actor_id FROM organization_memberships
           WHERE organization_id = $1 AND actor_id = ANY($2::text[]) AND status = 'active'`,
          [input.organizationId, input.memberActorIds],
        );
        if (members.rows.length !== input.memberActorIds.length) {
          await client.query("ROLLBACK");
          return "member_not_active";
        }
      }
      await client.query(
        `INSERT INTO teams (id, organization_id, workspace_id, name, version)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.id,
          input.organizationId,
          input.workspaceId,
          input.name,
          input.version,
        ],
      );
      for (const actorId of input.memberActorIds)
        await client.query(
          "INSERT INTO team_memberships (team_id, actor_id) VALUES ($1, $2)",
          [input.id, actorId],
        );
      await client.query(
        `INSERT INTO team_audit_events
         (id, organization_id, workspace_id, team_id, actor_id, event_type, correlation_id, occurred_at, payload)
         VALUES ($1,$2,$3,$4,$5,'team.created.v1',$6,$7,$8)`,
        [
          crypto.randomUUID(),
          input.organizationId,
          input.workspaceId,
          input.id,
          input.actorId,
          input.correlationId,
          input.occurredAt,
          asJson({ memberActorIds: input.memberActorIds }),
        ],
      );
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTeams(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Team[]> {
    const result = await this.pool.query<TeamRow>(
      `SELECT teams.id, teams.organization_id, teams.workspace_id, teams.name,
              teams.version, COALESCE(array_agg(team_memberships.actor_id ORDER BY team_memberships.actor_id)
                FILTER (WHERE team_memberships.actor_id IS NOT NULL), '{}') AS member_actor_ids
       FROM teams LEFT JOIN team_memberships ON team_memberships.team_id = teams.id
       WHERE teams.organization_id = $1 AND teams.workspace_id = $2
       GROUP BY teams.id ORDER BY teams.name`,
      [input.organizationId, input.workspaceId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      name: row.name,
      version: row.version,
      memberActorIds: row.member_actor_ids,
    }));
  }
}

type TeamRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  name: string;
  version: number;
  member_actor_ids: string[];
};

type WorkspaceRow = {
  id: string;
  organization_id: string;
  name: string;
  mode: Workspace["mode"];
  version: number;
  status: Workspace["status"];
  archived_at: Date | null;
  archived_by_actor_id: string | null;
};
type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  organization_role: OrganizationRole;
  workspace_ids: string[];
  workspace_role: WorkspaceRole;
  expires_at: Date;
};
function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    mode: row.mode,
    version: row.version,
    status: row.status,
    archivedAt: row.archived_at,
    archivedByActorId: row.archived_by_actor_id,
  };
}
function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    organizationRole: row.organization_role,
    workspaceIds: row.workspace_ids,
    workspaceRole: row.workspace_role,
    expiresAt: row.expires_at,
  };
}

/** Persistencia PostgreSQL del agregado Initiative con control optimista de versión. */
export class PostgresInitiativeStore implements InitiativeStore {
  constructor(private readonly pool: Pool) {}

  async create(initiative: Initiative): Promise<void> {
    await this.pool.query(
      `INSERT INTO initiatives (id, organization_id, workspace_id, created_by_actor_id, title, problem_statement, expected_outcome, classification, status, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        initiative.id,
        initiative.organizationId,
        initiative.workspaceId,
        initiative.createdByActorId,
        initiative.title,
        initiative.problemStatement,
        initiative.expectedOutcome,
        initiative.classification,
        initiative.status,
        initiative.version,
        initiative.createdAt,
        initiative.updatedAt,
      ],
    );
  }
  async findById(initiativeId: string): Promise<Initiative | null> {
    const result = await this.pool.query<InitiativeRow>(
      `SELECT id, organization_id, workspace_id, created_by_actor_id, title, problem_statement, expected_outcome, classification, status, version, created_at, updated_at
       FROM initiatives WHERE id = $1`,
      [initiativeId],
    );
    return result.rows[0] ? toInitiative(result.rows[0]) : null;
  }
  async list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Initiative[]> {
    const result = await this.pool.query<InitiativeRow>(
      `SELECT id, organization_id, workspace_id, created_by_actor_id, title, problem_statement, expected_outcome, classification, status, version, created_at, updated_at
       FROM initiatives WHERE organization_id = $1 AND workspace_id = $2 ORDER BY updated_at DESC`,
      [input.organizationId, input.workspaceId],
    );
    return result.rows.map(toInitiative);
  }
  async save(input: {
    initiative: Initiative;
    expectedVersion: number;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE initiatives SET title = $2, problem_statement = $3, expected_outcome = $4, classification = $5, status = $6, version = $7, updated_at = $8
       WHERE id = $1 AND version = $9`,
      [
        input.initiative.id,
        input.initiative.title,
        input.initiative.problemStatement,
        input.initiative.expectedOutcome,
        input.initiative.classification,
        input.initiative.status,
        input.initiative.version,
        input.initiative.updatedAt,
        input.expectedVersion,
      ],
    );
    return result.rowCount === 1;
  }
}

export class PostgresInitiativeAuditStore implements InitiativeAuditStore {
  constructor(private readonly pool: Pool) {}
  async record(event: InitiativeAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO initiative_audit_events (id, event_type, organization_id, workspace_id, initiative_id, actor_id, correlation_id, occurred_at, from_status, to_status, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.id,
        event.eventType,
        event.organizationId,
        event.workspaceId,
        event.initiativeId,
        event.actorId,
        event.correlationId,
        event.occurredAt,
        event.fromStatus,
        event.toStatus,
        event.payload,
      ],
    );
  }
  async list(input: {
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeAuditEvent[]> {
    const result = await this.pool.query<InitiativeAuditRow>(
      `SELECT id, event_type, organization_id, workspace_id, initiative_id, actor_id, correlation_id, occurred_at, from_status, to_status, payload
       FROM initiative_audit_events WHERE organization_id = $1 AND initiative_id = $2 ORDER BY occurred_at ASC`,
      [input.organizationId, input.initiativeId],
    );
    return result.rows.map(toInitiativeAuditEvent);
  }
}

export class PostgresEvaluationStandardStore implements EvaluationStandardStore {
  constructor(private readonly pool: Pool) {}
  async create(standard: EvaluationStandard): Promise<void> {
    await this.pool.query(
      `INSERT INTO evaluation_standards (id, organization_id, name, version, criteria, is_active, published_at, published_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        standard.id,
        standard.organizationId,
        standard.name,
        standard.version,
        asJson(standard.criteria),
        standard.isActive,
        standard.publishedAt,
        standard.publishedByActorId,
      ],
    );
  }
  async findById(standardId: string): Promise<EvaluationStandard | null> {
    const result = await this.pool.query<EvaluationStandardRow>(
      `SELECT id, organization_id, name, version, criteria, is_active, published_at, published_by_actor_id
       FROM evaluation_standards WHERE id = $1`,
      [standardId],
    );
    return result.rows[0] ? toEvaluationStandard(result.rows[0]) : null;
  }
  async list(input: {
    organizationId: string;
  }): Promise<readonly EvaluationStandard[]> {
    const result = await this.pool.query<EvaluationStandardRow>(
      `SELECT id, organization_id, name, version, criteria, is_active, published_at, published_by_actor_id FROM evaluation_standards WHERE organization_id = $1 ORDER BY is_active DESC, name, version DESC`,
      [input.organizationId],
    );
    return result.rows.map(toEvaluationStandard);
  }
  async activate(input: {
    organizationId: string;
    standardId: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE evaluation_standards SET is_active = FALSE WHERE organization_id = $1 AND is_active",
        [input.organizationId],
      );
      const updated = await client.query(
        "UPDATE evaluation_standards SET is_active = TRUE WHERE id = $1 AND organization_id = $2",
        [input.standardId, input.organizationId],
      );
      if (updated.rowCount !== 1)
        throw new Error("Evaluation standard not found");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresEvaluationStore implements EvaluationStore {
  constructor(private readonly pool: Pool) {}
  async createEvaluation(evaluation: InitiativeEvaluation): Promise<void> {
    await this.pool.query(
      `INSERT INTO initiative_evaluations (id, organization_id, workspace_id, initiative_id, initiative_version, standard_id, standard_version, criteria, coverage, evaluated_by_actor_id, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        evaluation.id,
        evaluation.organizationId,
        evaluation.workspaceId,
        evaluation.initiativeId,
        evaluation.initiativeVersion,
        evaluation.standardId,
        evaluation.standardVersion,
        asJson(evaluation.criteria),
        asJson(evaluation.coverage),
        evaluation.evaluatedByActorId,
        evaluation.evaluatedAt,
      ],
    );
  }
  async findEvaluation(
    evaluationId: string,
  ): Promise<InitiativeEvaluation | null> {
    const result = await this.pool.query<InitiativeEvaluationRow>(
      `SELECT id, organization_id, workspace_id, initiative_id, initiative_version, standard_id, standard_version, criteria, coverage, evaluated_by_actor_id, evaluated_at FROM initiative_evaluations WHERE id = $1`,
      [evaluationId],
    );
    return result.rows[0] ? toInitiativeEvaluation(result.rows[0]) : null;
  }
  async createDecision(decision: InitiativeDecision): Promise<void> {
    await this.pool.query(
      `INSERT INTO initiative_decisions (id, organization_id, workspace_id, initiative_id, evaluation_id, outcome, rationale, evidence, standard_id, standard_version, coverage, decided_by_actor_id, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        decision.id,
        decision.organizationId,
        decision.workspaceId,
        decision.initiativeId,
        decision.evaluationId,
        decision.outcome,
        decision.rationale,
        asJson(decision.evidence),
        decision.standardId,
        decision.standardVersion,
        asJson(decision.coverage),
        decision.decidedByActorId,
        decision.decidedAt,
      ],
    );
  }
  async findDecision(decisionId: string): Promise<InitiativeDecision | null> {
    const result = await this.pool.query<InitiativeDecisionRow>(
      `SELECT id, organization_id, workspace_id, initiative_id, evaluation_id, outcome, rationale, evidence, standard_id, standard_version, coverage, decided_by_actor_id, decided_at
       FROM initiative_decisions WHERE id = $1`,
      [decisionId],
    );
    return result.rows[0] ? toInitiativeDecision(result.rows[0]) : null;
  }
}

export class PostgresProjectStore implements ProjectStore {
  constructor(private readonly pool: Pool) {}
  async create(project: Project): Promise<void> {
    await this.pool.query(
      `INSERT INTO projects (id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        project.id,
        project.organizationId,
        project.workspaceId,
        project.sourceInitiativeId,
        project.sourceDecisionId,
        project.name,
        project.sponsorActorId,
        project.leadActorId,
        asJson(project.participants),
        project.status,
        project.version,
        project.createdAt,
        project.updatedAt,
      ],
    );
  }
  async createWithEvent(input: {
    project: Project;
    event: DurableDomainEvent;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertProject(client, input.project);
      await insertOutboxEvent(client, input.event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (isProjectConversionConflict(error))
        throw new ProjectAlreadyExistsError();
      throw error;
    } finally {
      client.release();
    }
  }
  async findById(projectId: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, version, created_at, updated_at FROM projects WHERE id = $1`,
      [projectId],
    );
    return result.rows[0] ? toProject(result.rows[0]) : null;
  }
  async findByInitiative(initiativeId: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, version, created_at, updated_at FROM projects WHERE source_initiative_id = $1`,
      [initiativeId],
    );
    return result.rows[0] ? toProject(result.rows[0]) : null;
  }
  async list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Project[]> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, version, created_at, updated_at FROM projects WHERE organization_id = $1 AND workspace_id = $2 ORDER BY updated_at DESC`,
      [input.organizationId, input.workspaceId],
    );
    return result.rows.map(toProject);
  }
  async save(input: {
    project: Project;
    expectedVersion: number;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE projects SET status = $2, version = $3, updated_at = $4 WHERE id = $1 AND version = $5`,
      [
        input.project.id,
        input.project.status,
        input.project.version,
        input.project.updatedAt,
        input.expectedVersion,
      ],
    );
    return result.rowCount === 1;
  }
  async saveWithEvent(input: {
    project: Project;
    expectedVersion: number;
    event: DurableDomainEvent;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE projects SET status = $2, version = $3, updated_at = $4 WHERE id = $1 AND version = $5`,
        [
          input.project.id,
          input.project.status,
          input.project.version,
          input.project.updatedAt,
          input.expectedVersion,
        ],
      );
      if ((result.rowCount ?? 0) === 1)
        await insertOutboxEvent(client, input.event);
      await client.query("COMMIT");
      return (result.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
export class PostgresProjectExecutionStore implements ProjectExecutionStore {
  constructor(private readonly pool: Pool) {}
  async addMilestone(milestone: ProjectMilestone): Promise<void> {
    await this.pool.query(
      `INSERT INTO project_milestones (id, project_id, title, due_on, completed_at, created_by_actor_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        milestone.id,
        milestone.projectId,
        milestone.title,
        milestone.dueOn,
        milestone.completedAt,
        milestone.createdByActorId,
        milestone.createdAt,
      ],
    );
  }
  async addNextAction(action: ProjectNextAction): Promise<void> {
    await this.pool.query(
      `INSERT INTO project_next_actions (id, project_id, description, owner_actor_id, due_on, completed_at, created_by_actor_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        action.id,
        action.projectId,
        action.description,
        action.ownerActorId,
        action.dueOn,
        action.completedAt,
        action.createdByActorId,
        action.createdAt,
      ],
    );
  }
}
export class PostgresProjectClosureStore implements ProjectClosureStore {
  constructor(private readonly pool: Pool) {}
  async createClosure(closure: ProjectClosure): Promise<void> {
    await this.pool.query(
      `INSERT INTO project_closures (id, project_id, organization_id, workspace_id, outcomes, lessons_learned, pending_items, closed_by_actor_id, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        closure.id,
        closure.projectId,
        closure.organizationId,
        closure.workspaceId,
        closure.outcomes,
        closure.lessonsLearned,
        asJson(closure.pendingItems),
        closure.closedByActorId,
        closure.closedAt,
      ],
    );
  }
  async findClosure(projectId: string): Promise<ProjectClosure | null> {
    const result = await this.pool.query<ProjectClosureRow>(
      `SELECT id, project_id, organization_id, workspace_id, outcomes, lessons_learned, pending_items, closed_by_actor_id, closed_at
       FROM project_closures WHERE project_id = $1`,
      [projectId],
    );
    return result.rows[0] ? toProjectClosure(result.rows[0]) : null;
  }
  async acceptDeliverable(
    acceptance: ProjectDeliverableAcceptance,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO project_deliverable_acceptances (id, project_id, organization_id, workspace_id, name, document_id, document_version_id, accepted_by_actor_id, accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        acceptance.id,
        acceptance.projectId,
        acceptance.organizationId,
        acceptance.workspaceId,
        acceptance.name,
        acceptance.documentId,
        acceptance.documentVersionId,
        acceptance.acceptedByActorId,
        acceptance.acceptedAt,
      ],
    );
  }
}

export class PostgresEvidenceStore
  implements EvidenceReferenceStore, EvidenceSubjectLookup
{
  constructor(private readonly pool: Pool) {}
  async create(reference: EvidenceReference): Promise<void> {
    await this.pool.query(
      `INSERT INTO evidence_references (id, organization_id, workspace_id, subject_type, subject_id, document_id, document_version_id, linked_by_actor_id, linked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        reference.id,
        reference.organizationId,
        reference.workspaceId,
        reference.subjectType,
        reference.subjectId,
        reference.documentId,
        reference.documentVersionId,
        reference.linkedByActorId,
        reference.linkedAt,
      ],
    );
  }
  async list(input: {
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<readonly EvidenceReference[]> {
    const result = await this.pool.query<EvidenceReferenceRow>(
      `SELECT id, organization_id, workspace_id, subject_type, subject_id, document_id, document_version_id, linked_by_actor_id, linked_at
       FROM evidence_references WHERE subject_type = $1 AND subject_id = $2 ORDER BY linked_at ASC, id ASC`,
      [input.subjectType, input.subjectId],
    );
    return result.rows.map(toEvidenceReference);
  }
  async resolve(input: {
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<{ organizationId: string; workspaceId: string } | null> {
    const source = {
      evaluation: "initiative_evaluations",
      decision: "initiative_decisions",
      project_closure: "project_closures",
    }[input.subjectType];
    const result = await this.pool.query<DocumentResourceRow>(
      `SELECT organization_id, workspace_id FROM ${source} WHERE id = $1`,
      [input.subjectId],
    );
    return result.rows[0] ? toDocumentResource(result.rows[0]) : null;
  }
}
export class PostgresProjectAuditStore implements ProjectAuditStore {
  constructor(private readonly pool: Pool) {}
  async record(event: ProjectAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO project_audit_events (id, event_type, organization_id, workspace_id, project_id, actor_id, correlation_id, occurred_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        event.id,
        event.eventType,
        event.organizationId,
        event.workspaceId,
        event.projectId,
        event.actorId,
        event.correlationId,
        event.occurredAt,
        event.payload,
      ],
    );
  }
  async list(input: {
    organizationId: string;
    projectId: string;
  }): Promise<readonly ProjectAuditEvent[]> {
    const result = await this.pool.query<ProjectAuditRow>(
      `SELECT id, event_type, organization_id, workspace_id, project_id, actor_id, correlation_id, occurred_at, payload FROM project_audit_events WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at ASC`,
      [input.organizationId, input.projectId],
    );
    return result.rows.map(toProjectAuditEvent);
  }
}

export class PostgresAuditHistoryStore implements AuditHistoryStore {
  constructor(private readonly pool: Pool) {}
  async list(input: {
    organizationId: string;
    resourceType: import("@aether/application").AuditResourceType;
    resourceId: string;
  }): Promise<readonly AuditEvent[]> {
    const result = await this.pool.query<AuditRow>(
      `SELECT id, action, resource_type, resource_id, actor_id, organization_id, workspace_id, occurred_at, result, correlation_id, causation_id, async_event_id, payload
       FROM audit_events
       WHERE organization_id = $1 AND resource_type = $2 AND resource_id = $3
       ORDER BY occurred_at ASC, id ASC`,
      [input.organizationId, input.resourceType, input.resourceId],
    );
    return result.rows.map(toAuditEvent);
  }
}
export class PostgresSecurityAuditStore implements SecurityAuditStore {
  constructor(private readonly pool: Pool) {}
  async record(i: Parameters<SecurityAuditStore["record"]>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO security_audit_events (id,actor_id,action,method,path,status_code,correlation_id,occurred_at,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        i.id,
        i.actorId,
        i.action,
        i.method,
        i.path,
        i.statusCode,
        i.correlationId,
        i.occurredAt,
        i.metadata,
      ],
    );
  }
}
/** Read-only, organization-scoped aggregates for the institutional dashboard. */
export class PostgresProductMetricsStore implements ProductMetricsStore {
  constructor(private readonly pool: Pool) {}
  async snapshot(input: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
    calculatedAt: Date;
  }): Promise<ProductMetricsSnapshot> {
    const result = await this.pool.query<ProductMetricsRow>(
      `WITH decisions AS (
         SELECT decisions.id, decisions.outcome,
           EXTRACT(EPOCH FROM (decisions.decided_at - initiatives.created_at)) / 3600 AS lead_hours
         FROM initiative_decisions AS decisions
         JOIN initiatives ON initiatives.id = decisions.initiative_id
         WHERE decisions.organization_id = $1
           AND decisions.decided_at >= $2 AND decisions.decided_at < $3
       ), decision_summary AS (
         SELECT COUNT(*)::int AS decided_count,
           AVG(lead_hours)::float8 AS average_hours,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_hours)::float8 AS median_hours,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM evidence_references AS evidence_links
             JOIN document_versions AS versions ON versions.id = evidence_links.document_version_id
             WHERE evidence_links.organization_id = $1
               AND evidence_links.subject_type = 'decision'
               AND evidence_links.subject_id = decisions.id
               AND versions.status = 'published'
               AND versions.evidence_status = 'valid'
           ))::int AS decisions_with_verified_evidence,
           COUNT(*) FILTER (WHERE outcome = 'approved')::int AS approved_decisions,
           COUNT(*) FILTER (WHERE outcome = 'approved' AND EXISTS (
             SELECT 1 FROM projects
             WHERE projects.organization_id = $1
               AND projects.source_decision_id = decisions.id
           ))::int AS converted_decisions
         FROM decisions
       ), active_project_summary AS (
         SELECT COUNT(*)::int AS active_or_blocked_count,
           COUNT(*) FILTER (WHERE NULLIF(BTRIM(lead_actor_id), '') IS NOT NULL)::int AS with_assigned_lead_count,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM project_milestones AS milestones
             WHERE milestones.project_id = projects.id
               AND milestones.completed_at IS NULL
               AND (milestones.due_on IS NULL OR milestones.due_on >= $3::date)
           ))::int AS with_upcoming_milestone_count,
           COUNT(*) FILTER (WHERE updated_at < ($3 - INTERVAL '30 days'))::int AS stale_for_thirty_days_count
         FROM projects
         WHERE organization_id = $1 AND status IN ('active', 'blocked')
       ), closure_summary AS (
         SELECT COUNT(*)::int AS closed_count,
           COUNT(*) FILTER (WHERE NULLIF(BTRIM(lessons_learned), '') IS NOT NULL)::int AS with_lessons_learned_count
         FROM project_closures
         WHERE organization_id = $1 AND closed_at >= $2 AND closed_at < $3
       )
       SELECT decision_summary.*, active_project_summary.*, closure_summary.*
       FROM decision_summary CROSS JOIN active_project_summary CROSS JOIN closure_summary`,
      [input.organizationId, input.startsAt, input.endsAt],
    );
    const row = result.rows[0]!;
    const decidedCount = numberValue(row.decided_count);
    const approvedDecisions = numberValue(row.approved_decisions);
    const closedCount = numberValue(row.closed_count);
    return {
      calculationVersion: "2026-09-v1",
      timezone: "UTC",
      calculatedAt: input.calculatedAt,
      period: { startsAt: input.startsAt, endsAt: input.endsAt },
      initiativeDecision: {
        decidedCount,
        averageHours: nullableNumber(row.average_hours),
        medianHours: nullableNumber(row.median_hours),
      },
      decisionEvidence: {
        decidedCount,
        decisionsWithVerifiedEvidence: numberValue(
          row.decisions_with_verified_evidence,
        ),
        coveragePercent: percent(
          numberValue(row.decisions_with_verified_evidence),
          decidedCount,
        ),
      },
      conversion: {
        approvedDecisions,
        projectsCreatedFromApprovedDecisions: numberValue(
          row.converted_decisions,
        ),
        conversionPercent: percent(
          numberValue(row.converted_decisions),
          approvedDecisions,
        ),
      },
      activeProjects: {
        activeOrBlockedCount: numberValue(row.active_or_blocked_count),
        withAssignedLeadCount: numberValue(row.with_assigned_lead_count),
        withUpcomingMilestoneCount: numberValue(
          row.with_upcoming_milestone_count,
        ),
        staleForThirtyDaysCount: numberValue(row.stale_for_thirty_days_count),
      },
      closures: {
        closedCount,
        withLessonsLearnedCount: numberValue(row.with_lessons_learned_count),
        lessonsCoveragePercent: percent(
          numberValue(row.with_lessons_learned_count),
          closedCount,
        ),
      },
    };
  }
}
export class PostgresNotificationStore implements NotificationStore {
  constructor(private readonly pool: Pool) {}
  async create(notification: Notification): Promise<Notification> {
    const result = await this.pool.query<NotificationRow>(
      `INSERT INTO notifications (id, organization_id, workspace_id, recipient_actor_id, event_key, resource_type, resource_id, title, created_at, read_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (recipient_actor_id, event_key) DO UPDATE SET event_key = EXCLUDED.event_key
       RETURNING id, organization_id, workspace_id, recipient_actor_id, event_key, resource_type, resource_id, title, created_at, read_at`,
      [
        notification.id,
        notification.organizationId,
        notification.workspaceId,
        notification.recipientActorId,
        notification.eventKey,
        notification.resourceType,
        notification.resourceId,
        notification.title,
        notification.createdAt,
        notification.readAt,
      ],
    );
    return toNotification(result.rows[0]!);
  }
  async list(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Notification[]> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT id, organization_id, workspace_id, recipient_actor_id, event_key, resource_type, resource_id, title, created_at, read_at
       FROM notifications WHERE recipient_actor_id = $1 AND organization_id = $2 ORDER BY created_at DESC, id DESC`,
      [input.actorId, input.organizationId],
    );
    return result.rows.map(toNotification);
  }
  async find(input: {
    id: string;
    actorId: string;
  }): Promise<Notification | null> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT id, organization_id, workspace_id, recipient_actor_id, event_key, resource_type, resource_id, title, created_at, read_at
       FROM notifications WHERE id = $1 AND recipient_actor_id = $2`,
      [input.id, input.actorId],
    );
    return result.rows[0] ? toNotification(result.rows[0]) : null;
  }
  async markRead(input: {
    id: string;
    actorId: string;
    readAt: Date;
  }): Promise<Notification | null> {
    const result = await this.pool.query<NotificationRow>(
      `UPDATE notifications SET read_at = COALESCE(read_at, $3) WHERE id = $1 AND recipient_actor_id = $2
       RETURNING id, organization_id, workspace_id, recipient_actor_id, event_key, resource_type, resource_id, title, created_at, read_at`,
      [input.id, input.actorId, input.readAt],
    );
    return result.rows[0] ? toNotification(result.rows[0]) : null;
  }
  async setPreference(preference: NotificationPreference): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_preferences (actor_id, organization_id, email_enabled, updated_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (actor_id, organization_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = EXCLUDED.updated_at`,
      [
        preference.actorId,
        preference.organizationId,
        preference.emailEnabled,
        preference.updatedAt,
      ],
    );
  }
  async getPreference(input: {
    actorId: string;
    organizationId: string;
  }): Promise<NotificationPreference | null> {
    const result = await this.pool.query<NotificationPreferenceRow>(
      `SELECT actor_id, organization_id, email_enabled, updated_at FROM notification_preferences WHERE actor_id = $1 AND organization_id = $2`,
      [input.actorId, input.organizationId],
    );
    return result.rows[0]
      ? {
          actorId: result.rows[0].actor_id,
          organizationId: result.rows[0].organization_id,
          emailEnabled: result.rows[0].email_enabled,
          updatedAt: result.rows[0].updated_at,
        }
      : null;
  }
}
export class PostgresCommentStore implements CommentStore {
  constructor(private readonly pool: Pool) {}
  async create(c: Comment): Promise<void> {
    await this.pool.query(
      `INSERT INTO comments (id,organization_id,workspace_id,resource_type,resource_id,body,mentioned_actor_ids,author_actor_id,created_at,edited_at,resolved_at,resolved_by_actor_id,deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        c.id,
        c.organizationId,
        c.workspaceId,
        c.resourceType,
        c.resourceId,
        c.body,
        asJson(c.mentionedActorIds),
        c.authorActorId,
        c.createdAt,
        c.editedAt,
        c.resolvedAt,
        c.resolvedByActorId,
        c.deletedAt,
      ],
    );
  }
  async list(i: {
    organizationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<readonly Comment[]> {
    const r = await this.pool.query<CommentRow>(
      `SELECT * FROM comments WHERE organization_id=$1 AND resource_type=$2 AND resource_id=$3 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [i.organizationId, i.resourceType, i.resourceId],
    );
    return r.rows.map(toComment);
  }
  async find(id: string): Promise<Comment | null> {
    const r = await this.pool.query<CommentRow>(
      `SELECT * FROM comments WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ? toComment(r.rows[0]) : null;
  }
  async update(c: Comment): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE comments SET resolved_at=$2,resolved_by_actor_id=$3 WHERE id=$1 AND deleted_at IS NULL`,
      [c.id, c.resolvedAt, c.resolvedByActorId],
    );
    return r.rowCount === 1;
  }
}

/** Metadatos de documentos y bitácora insertados atómicamente en PostgreSQL. */
export class PostgresDocumentStore
  implements DocumentStore, DocumentAuditStore
{
  constructor(private readonly pool: Pool) {}

  async resolveResource(input: {
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<DocumentResource | null> {
    const query = resourceLookupQuery(input.resourceType);
    const result = await this.pool.query<DocumentResourceRow>(query, [
      input.resourceId,
    ]);
    return result.rows[0] ? toDocumentResource(result.rows[0]) : null;
  }
  async createQuarantined(input: {
    document: InstitutionalDocument;
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertDocument(client, input.document);
      await insertDocumentVersion(client, input.version);
      await insertDocumentAudit(client, input.audit);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async findVersion(input: {
    documentId: string;
    versionId: string;
  }): Promise<DocumentVersionAccess | null> {
    const result = await this.pool.query<DocumentVersionRow>(
      `${documentVersionSelect} WHERE documents.id = $1 AND document_versions.id = $2`,
      [input.documentId, input.versionId],
    );
    return result.rows[0] ? toDocumentVersionAccess(result.rows[0]) : null;
  }
  async findLatestVersion(
    documentId: string,
  ): Promise<DocumentVersionAccess | null> {
    const result = await this.pool.query<DocumentVersionRow>(
      `${documentVersionSelect} WHERE documents.id = $1 ORDER BY document_versions.version_number DESC LIMIT 1`,
      [documentId],
    );
    return result.rows[0] ? toDocumentVersionAccess(result.rows[0]) : null;
  }
  async listByResource(input: {
    organizationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<readonly DocumentVersionAccess[]> {
    const result = await this.pool.query<DocumentVersionRow>(
      `${documentVersionSelect} WHERE documents.organization_id = $1 AND documents.resource_type = $2 AND documents.resource_id = $3 ORDER BY documents.created_at ASC, document_versions.version_number DESC`,
      [input.organizationId, input.resourceType, input.resourceId],
    );
    return result.rows.map(toDocumentVersionAccess);
  }
  async publish(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE document_versions SET detected_content_type = $2, status = 'published', evidence_status = 'valid', published_at = $3, retention_until = $4 WHERE id = $1 AND status = 'pending_scan'`,
        [
          input.version.id,
          input.version.detectedContentType,
          input.version.publishedAt,
          input.version.retentionUntil,
        ],
      );
      if ((updated.rowCount ?? 0) === 1) {
        await client.query(
          "UPDATE document_binaries SET object_key = $2 WHERE version_id = $1",
          [input.version.id, input.version.objectKey],
        );
        if (input.version.supersedesVersionId)
          await client.query(
            `UPDATE document_versions SET status = 'superseded', evidence_status = 'replaced', replaced_by_version_id = $2 WHERE id = $1 AND status IN ('published', 'withdrawn')`,
            [input.version.supersedesVersionId, input.version.id],
          );
        await insertDocumentAudit(client, input.audit);
      }
      await client.query("COMMIT");
      return (updated.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async reject(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE document_versions SET status = 'rejected', evidence_status = 'withdrawn', rejected_at = $2 WHERE id = $1 AND status IN ('quarantined', 'pending_scan')`,
        [input.version.id, input.version.rejectedAt],
      );
      if ((updated.rowCount ?? 0) === 1)
        await insertDocumentAudit(client, input.audit);
      await client.query("COMMIT");
      return (updated.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async queueForScan(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
    event: DurableDomainEvent;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE document_versions SET detected_content_type = $2, status = 'pending_scan' WHERE id = $1 AND status = 'quarantined'`,
        [input.version.id, input.version.detectedContentType],
      );
      if ((updated.rowCount ?? 0) === 1) {
        await insertDocumentAudit(client, input.audit);
        await insertOutboxEvent(client, input.event);
      }
      await client.query("COMMIT");
      return (updated.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async createReplacement(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertDocumentVersion(client, input.version);
      await insertDocumentAudit(client, input.audit);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async restore(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
    event: DurableDomainEvent;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertDocumentVersion(client, input.version);
      await insertDocumentAudit(client, input.audit);
      await insertOutboxEvent(client, input.event);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async withdraw(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE document_versions SET status = 'withdrawn', evidence_status = 'withdrawn', withdrawn_at = $2 WHERE id = $1 AND status = 'published'`,
        [input.version.id, input.version.withdrawnAt],
      );
      if ((updated.rowCount ?? 0) === 1)
        await insertDocumentAudit(client, input.audit);
      await client.query("COMMIT");
      return (updated.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async listExpired(now: Date): Promise<readonly DocumentVersionAccess[]> {
    const result = await this.pool.query<DocumentVersionRow>(
      `${documentVersionSelect} WHERE document_versions.retention_until <= $1 AND document_versions.status IN ('published', 'withdrawn', 'superseded')`,
      [now],
    );
    return result.rows.map(toDocumentVersionAccess);
  }
  async purge(input: {
    version: DocumentVersion;
    audit: DocumentAuditEvent;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE document_versions SET status = 'purged', evidence_status = 'withdrawn' WHERE id = $1 AND status IN ('published', 'withdrawn', 'superseded')`,
        [input.version.id],
      );
      if ((updated.rowCount ?? 0) === 1) {
        await client.query(
          "UPDATE document_binaries SET object_key = NULL WHERE version_id = $1",
          [input.version.id],
        );
        await insertDocumentAudit(client, input.audit);
      }
      await client.query("COMMIT");
      return (updated.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async record(event: DocumentAuditEvent): Promise<void> {
    await insertDocumentAudit(this.pool, event);
  }
}

/** Consulta mínima para autorizar un documento cuyo padre es un proyecto. */
export class PostgresDocumentProjectAccess implements DocumentProjectAccess {
  constructor(private readonly pool: Pool) {}
  async isParticipant(input: {
    actorId: string;
    projectId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM projects
       WHERE id = $1
         AND (lead_actor_id = $2 OR participants @> jsonb_build_array(jsonb_build_object('actorId', $2)))`,
      [input.projectId, input.actorId],
    );
    return result.rowCount === 1;
  }
}

export class PostgresOutboxStore implements OutboxStore, OutboxQueueStore {
  constructor(private readonly pool: Pool) {}
  async claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    lockExpiredBefore: Date;
  }): Promise<readonly OutboxMessage[]> {
    const result = await this.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT event_id FROM outbox_events
         WHERE (status = 'pending' AND available_at <= $1)
            OR (status = 'processing' AND locked_at < $2)
         ORDER BY occurred_at ASC LIMIT $3 FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events AS events SET status = 'processing', attempts = attempts + 1, locked_at = $1, locked_by = $4
       FROM candidates WHERE events.event_id = candidates.event_id
       RETURNING events.*`,
      [input.now, input.lockExpiredBefore, input.limit, input.workerId],
    );
    return result.rows.map(toOutboxMessage);
  }
  async markProcessed(input: {
    eventId: string;
    workerId: string;
    processedAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events SET status = 'processed', processed_at = $3, locked_at = NULL, locked_by = NULL WHERE event_id = $1 AND locked_by = $2`,
      [input.eventId, input.workerId, input.processedAt],
    );
  }
  async scheduleRetry(input: {
    eventId: string;
    workerId: string;
    availableAt: Date;
    error: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events SET status = 'pending', available_at = $3, last_error = $4, locked_at = NULL, locked_by = NULL WHERE event_id = $1 AND locked_by = $2`,
      [input.eventId, input.workerId, input.availableAt, input.error],
    );
  }
  async deadLetter(input: {
    eventId: string;
    workerId: string;
    failedAt: Date;
    error: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `UPDATE outbox_events SET status = 'dead_letter', last_error = $3, locked_at = NULL, locked_by = NULL WHERE event_id = $1 AND locked_by = $2 RETURNING *`,
        [input.eventId, input.workerId, input.error],
      );
      const event = result.rows[0];
      if (event)
        await client.query(
          `INSERT INTO outbox_dead_letters (event_id, event_type, organization_id, attempts, failed_at, last_error, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (event_id) DO UPDATE SET
             event_type = EXCLUDED.event_type,
             organization_id = EXCLUDED.organization_id,
             attempts = EXCLUDED.attempts,
             failed_at = EXCLUDED.failed_at,
             last_error = EXCLUDED.last_error,
             payload = EXCLUDED.payload`,
          [
            event.event_id,
            event.event_type,
            event.organization_id,
            event.attempts,
            input.failedAt,
            input.error,
            event.payload,
          ],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async hasConsumption(input: {
    consumer: string;
    eventId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM outbox_consumptions WHERE consumer = $1 AND event_id = $2`,
      [input.consumer, input.eventId],
    );
    return (result.rowCount ?? 0) > 0;
  }
  async recordConsumption(input: {
    consumer: string;
    eventId: string;
    processedAt: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO outbox_consumptions (consumer, event_id, processed_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [input.consumer, input.eventId, input.processedAt],
    );
    return (result.rowCount ?? 0) === 1;
  }
  async queueStats(now: Date): Promise<OutboxQueueStats> {
    const result = await this.pool.query<OutboxQueueStatsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
         COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_lettered,
         EXTRACT(EPOCH FROM ($1 - MIN(occurred_at) FILTER (WHERE status = 'pending')))::float8 AS oldest_pending_age_seconds
       FROM outbox_events`,
      [now],
    );
    const row = result.rows[0]!;
    return {
      pending: Number(row.pending),
      processing: Number(row.processing),
      deadLettered: Number(row.dead_lettered),
      oldestPendingAgeSeconds:
        row.oldest_pending_age_seconds === null
          ? null
          : Number(row.oldest_pending_age_seconds),
    };
  }
}

/** PostgreSQL recovery adapter; replay keeps an immutable record of who retried it. */
export class PostgresOutboxAdministrationStore implements OutboxAdministrationStore {
  constructor(private readonly pool: Pool) {}
  async listDeadLetters(input: {
    organizationId: string;
    limit: number;
  }): Promise<readonly OutboxDeadLetter[]> {
    const result = await this.pool.query<OutboxDeadLetterRow>(
      `SELECT events.event_id, events.event_type, events.organization_id,
              events.aggregate_id, events.aggregate_type, events.aggregate_version,
              events.correlation_id, events.attempts, letters.failed_at, letters.last_error
       FROM outbox_dead_letters AS letters
       JOIN outbox_events AS events ON events.event_id = letters.event_id
       WHERE letters.organization_id = $1
         AND events.status = 'dead_letter'
       ORDER BY letters.failed_at DESC, letters.event_id ASC
       LIMIT $2`,
      [input.organizationId, input.limit],
    );
    return result.rows.map(toOutboxDeadLetter);
  }
  async replayDeadLetter(input: {
    replayId: string;
    eventId: string;
    organizationId: string;
    replayedByActorId: string;
    correlationId: string;
    reason: string;
    replayedAt: Date;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const replayed = await client.query(
        `UPDATE outbox_events
         SET status = 'pending', attempts = 0, available_at = $3,
             locked_at = NULL, locked_by = NULL, last_error = NULL, processed_at = NULL
         WHERE event_id = $1 AND organization_id = $2 AND status = 'dead_letter'
         RETURNING event_id`,
        [input.eventId, input.organizationId, input.replayedAt],
      );
      if ((replayed.rowCount ?? 0) === 1)
        await client.query(
          `INSERT INTO outbox_replays (id, event_id, organization_id, replayed_by_actor_id, correlation_id, reason, replayed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.replayId,
            input.eventId,
            input.organizationId,
            input.replayedByActorId,
            input.correlationId,
            input.reason,
            input.replayedAt,
          ],
        );
      await client.query("COMMIT");
      return (replayed.rowCount ?? 0) === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

type InitiativeRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  created_by_actor_id: string;
  title: string;
  problem_statement: string;
  expected_outcome: string;
  classification: InitiativeClassification;
  status: InitiativeStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
};
type InitiativeAuditRow = {
  id: string;
  event_type: string;
  organization_id: string;
  workspace_id: string;
  initiative_id: string;
  actor_id: string;
  correlation_id: string;
  occurred_at: Date;
  from_status: InitiativeStatus | null;
  to_status: InitiativeStatus | null;
  payload: Record<string, unknown>;
};
function toInitiative(row: InitiativeRow): Initiative {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    createdByActorId: row.created_by_actor_id,
    title: row.title,
    problemStatement: row.problem_statement,
    expectedOutcome: row.expected_outcome,
    classification: row.classification,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function toInitiativeAuditEvent(row: InitiativeAuditRow): InitiativeAuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    initiativeId: row.initiative_id,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    payload: row.payload,
  };
}

type EvaluationStandardRow = {
  id: string;
  organization_id: string;
  name: string;
  version: number;
  criteria: EvaluationStandard["criteria"];
  is_active: boolean;
  published_at: Date;
  published_by_actor_id: string;
};
type InitiativeEvaluationRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  initiative_id: string;
  initiative_version: number;
  standard_id: string;
  standard_version: number;
  criteria: InitiativeEvaluation["criteria"];
  coverage: InitiativeEvaluation["coverage"];
  evaluated_by_actor_id: string;
  evaluated_at: Date;
};
type InitiativeDecisionRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  initiative_id: string;
  evaluation_id: string;
  outcome: InitiativeDecision["outcome"];
  rationale: string;
  evidence: string[];
  standard_id: string;
  standard_version: number;
  coverage: InitiativeDecision["coverage"];
  decided_by_actor_id: string;
  decided_at: Date;
};
type ProjectRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  source_initiative_id: string;
  source_decision_id: string;
  name: string;
  sponsor_actor_id: string;
  lead_actor_id: string;
  participants: Project["participants"];
  status: Project["status"];
  version: number;
  created_at: Date;
  updated_at: Date;
};
type ProjectAuditRow = {
  id: string;
  event_type: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  correlation_id: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
};
type NotificationRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  recipient_actor_id: string;
  event_key: string;
  resource_type: Notification["resourceType"];
  resource_id: string;
  title: string;
  created_at: Date;
  read_at: Date | null;
};
type NotificationPreferenceRow = {
  actor_id: string;
  organization_id: string;
  email_enabled: boolean;
  updated_at: Date;
};
type CommentRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  resource_type: DocumentResourceType;
  resource_id: string;
  body: string;
  mentioned_actor_ids: string[];
  author_actor_id: string;
  created_at: Date;
  edited_at: Date | null;
  resolved_at: Date | null;
  resolved_by_actor_id: string | null;
  deleted_at: Date | null;
};
type ProjectClosureRow = {
  id: string;
  project_id: string;
  organization_id: string;
  workspace_id: string;
  outcomes: string;
  lessons_learned: string;
  pending_items: string[];
  closed_by_actor_id: string;
  closed_at: Date;
};
type EvidenceReferenceRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  subject_type: EvidenceReferenceSubjectType;
  subject_id: string;
  document_id: string;
  document_version_id: string;
  linked_by_actor_id: string;
  linked_at: Date;
};
type AuditRow = {
  id: string;
  action: string;
  resource_type: import("@aether/application").AuditResourceType;
  resource_id: string;
  actor_id: string;
  organization_id: string;
  workspace_id: string;
  occurred_at: Date;
  result: AuditEvent["result"];
  correlation_id: string;
  causation_id: string | null;
  async_event_id: string | null;
  payload: Record<string, unknown>;
};
type ProductMetricsRow = {
  decided_count: number | string;
  average_hours: number | string | null;
  median_hours: number | string | null;
  decisions_with_verified_evidence: number | string;
  approved_decisions: number | string;
  converted_decisions: number | string;
  active_or_blocked_count: number | string;
  with_assigned_lead_count: number | string;
  with_upcoming_milestone_count: number | string;
  stale_for_thirty_days_count: number | string;
  closed_count: number | string;
  with_lessons_learned_count: number | string;
};
type DocumentResourceRow = { organization_id: string; workspace_id: string };
type DocumentVersionRow = {
  document_id: string;
  organization_id: string;
  workspace_id: string;
  resource_type: DocumentResourceType;
  resource_id: string;
  classification: InstitutionalDocument["classification"];
  created_by_actor_id: string;
  document_created_at: Date;
  version_id: string;
  version_number: number;
  original_name: string;
  declared_content_type: string;
  detected_content_type: string | null;
  byte_length: string | number;
  sha256: string;
  status: DocumentVersion["status"];
  quarantine_key: string;
  object_key: string | null;
  version_created_at: Date;
  published_at: Date | null;
  rejected_at: Date | null;
  withdrawn_at: Date | null;
  retention_until: Date | null;
  evidence_status: DocumentVersion["evidenceStatus"];
  supersedes_version_id: string | null;
  replaced_by_version_id: string | null;
};
type OutboxRow = {
  event_id: string;
  event_type: string;
  occurred_at: Date;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: number;
  organization_id: string;
  correlation_id: string;
  causation_id: string | null;
  schema_version: number;
  payload: Record<string, unknown>;
  status: OutboxMessage["status"];
  attempts: number;
  available_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
};
type OutboxDeadLetterRow = {
  event_id: string;
  event_type: string;
  organization_id: string;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: number;
  correlation_id: string;
  attempts: number;
  failed_at: Date;
  last_error: string;
};
type OutboxQueueStatsRow = {
  pending: number | string;
  processing: number | string;
  dead_lettered: number | string;
  oldest_pending_age_seconds: number | string | null;
};
function toEvaluationStandard(row: EvaluationStandardRow): EvaluationStandard {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    version: row.version,
    criteria: row.criteria,
    isActive: row.is_active,
    publishedAt: row.published_at,
    publishedByActorId: row.published_by_actor_id,
  };
}
function toInitiativeEvaluation(
  row: InitiativeEvaluationRow,
): InitiativeEvaluation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    initiativeId: row.initiative_id,
    initiativeVersion: row.initiative_version,
    standardId: row.standard_id,
    standardVersion: row.standard_version,
    criteria: row.criteria,
    coverage: row.coverage,
    evaluatedByActorId: row.evaluated_by_actor_id,
    evaluatedAt: row.evaluated_at,
  };
}
function toInitiativeDecision(row: InitiativeDecisionRow): InitiativeDecision {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    initiativeId: row.initiative_id,
    evaluationId: row.evaluation_id,
    outcome: row.outcome,
    rationale: row.rationale,
    evidence: row.evidence,
    standardId: row.standard_id,
    standardVersion: row.standard_version,
    coverage: row.coverage,
    decidedByActorId: row.decided_by_actor_id,
    decidedAt: row.decided_at,
  };
}
function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    sourceInitiativeId: row.source_initiative_id,
    sourceDecisionId: row.source_decision_id,
    name: row.name,
    sponsorActorId: row.sponsor_actor_id,
    leadActorId: row.lead_actor_id,
    participants: row.participants,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function toProjectAuditEvent(row: ProjectAuditRow): ProjectAuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
    payload: row.payload,
  };
}
function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    recipientActorId: row.recipient_actor_id,
    eventKey: row.event_key,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    title: row.title,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}
function toComment(r: CommentRow): Comment {
  return {
    id: r.id,
    organizationId: r.organization_id,
    workspaceId: r.workspace_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    body: r.body,
    mentionedActorIds: r.mentioned_actor_ids,
    authorActorId: r.author_actor_id,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    resolvedAt: r.resolved_at,
    resolvedByActorId: r.resolved_by_actor_id,
    deletedAt: r.deleted_at,
  };
}
function toProjectClosure(row: ProjectClosureRow): ProjectClosure {
  return {
    id: row.id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    outcomes: row.outcomes,
    lessonsLearned: row.lessons_learned,
    pendingItems: row.pending_items,
    closedByActorId: row.closed_by_actor_id,
    closedAt: row.closed_at,
  };
}
function toEvidenceReference(row: EvidenceReferenceRow): EvidenceReference {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    linkedByActorId: row.linked_by_actor_id,
    linkedAt: row.linked_at,
  };
}
function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    actorId: row.actor_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    occurredAt: row.occurred_at,
    result: row.result,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    asyncEventId: row.async_event_id,
    payload: row.payload,
  };
}
function toDocumentResource(row: DocumentResourceRow): DocumentResource {
  return { organizationId: row.organization_id, workspaceId: row.workspace_id };
}
function toDocumentVersionAccess(
  row: DocumentVersionRow,
): DocumentVersionAccess {
  return {
    document: {
      id: row.document_id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      classification: row.classification,
      createdByActorId: row.created_by_actor_id,
      createdAt: row.document_created_at,
    },
    version: {
      id: row.version_id,
      documentId: row.document_id,
      versionNumber: row.version_number,
      originalName: row.original_name,
      declaredContentType: row.declared_content_type,
      detectedContentType: row.detected_content_type,
      byteLength: Number(row.byte_length),
      sha256: row.sha256,
      status: row.status,
      quarantineKey: row.quarantine_key,
      objectKey: row.object_key,
      createdAt: row.version_created_at,
      publishedAt: row.published_at,
      rejectedAt: row.rejected_at,
      withdrawnAt: row.withdrawn_at,
      retentionUntil: row.retention_until,
      evidenceStatus: row.evidence_status,
      supersedesVersionId: row.supersedes_version_id,
      replacedByVersionId: row.replaced_by_version_id,
    },
  };
}
function toOutboxMessage(row: OutboxRow): OutboxMessage {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    aggregateVersion: row.aggregate_version,
    organizationId: row.organization_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    schemaVersion: row.schema_version,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
  };
}
function toOutboxDeadLetter(row: OutboxDeadLetterRow): OutboxDeadLetter {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    organizationId: row.organization_id,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    aggregateVersion: row.aggregate_version,
    correlationId: row.correlation_id,
    attempts: row.attempts,
    failedAt: row.failed_at,
    lastError: row.last_error,
  };
}
async function insertProject(
  client: PoolClient,
  project: Project,
): Promise<void> {
  await client.query(
    `INSERT INTO projects (id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      project.id,
      project.organizationId,
      project.workspaceId,
      project.sourceInitiativeId,
      project.sourceDecisionId,
      project.name,
      project.sponsorActorId,
      project.leadActorId,
      asJson(project.participants),
      project.status,
      project.version,
      project.createdAt,
      project.updatedAt,
    ],
  );
}
const documentVersionSelect = `SELECT documents.id AS document_id, documents.organization_id, documents.workspace_id, documents.resource_type, documents.resource_id, documents.classification, documents.created_by_actor_id, documents.created_at AS document_created_at, document_versions.id AS version_id, document_versions.version_number, document_versions.original_name, document_versions.declared_content_type, document_versions.detected_content_type, document_versions.byte_length, document_versions.sha256, document_versions.status, document_binaries.quarantine_key, document_binaries.object_key, document_versions.created_at AS version_created_at, document_versions.published_at, document_versions.rejected_at, document_versions.withdrawn_at, document_versions.retention_until, document_versions.evidence_status, document_versions.supersedes_version_id, document_versions.replaced_by_version_id FROM documents JOIN document_versions ON document_versions.document_id = documents.id JOIN document_binaries ON document_binaries.version_id = document_versions.id`;
function resourceLookupQuery(resourceType: DocumentResourceType): string {
  switch (resourceType) {
    case "initiative":
      return "SELECT organization_id, workspace_id FROM initiatives WHERE id = $1";
    case "evaluation":
      return "SELECT organization_id, workspace_id FROM initiative_evaluations WHERE id = $1";
    case "decision":
      return "SELECT organization_id, workspace_id FROM initiative_decisions WHERE id = $1";
    case "project":
      return "SELECT organization_id, workspace_id FROM projects WHERE id = $1";
  }
}
async function insertDocument(
  client: Pool | PoolClient,
  document: InstitutionalDocument,
): Promise<void> {
  await client.query(
    `INSERT INTO documents (id, organization_id, workspace_id, resource_type, resource_id, classification, created_by_actor_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      document.id,
      document.organizationId,
      document.workspaceId,
      document.resourceType,
      document.resourceId,
      document.classification,
      document.createdByActorId,
      document.createdAt,
    ],
  );
}
async function insertDocumentVersion(
  client: Pool | PoolClient,
  version: DocumentVersion,
): Promise<void> {
  await client.query(
    `INSERT INTO document_versions (id, document_id, version_number, original_name, declared_content_type, detected_content_type, byte_length, sha256, status, created_at, published_at, rejected_at, withdrawn_at, retention_until, evidence_status, supersedes_version_id, replaced_by_version_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      version.id,
      version.documentId,
      version.versionNumber,
      version.originalName,
      version.declaredContentType,
      version.detectedContentType,
      version.byteLength,
      version.sha256,
      version.status,
      version.createdAt,
      version.publishedAt,
      version.rejectedAt,
      version.withdrawnAt,
      version.retentionUntil,
      version.evidenceStatus,
      version.supersedesVersionId,
      version.replacedByVersionId,
    ],
  );
  await client.query(
    `INSERT INTO document_binaries (version_id, quarantine_key, object_key) VALUES ($1,$2,$3)`,
    [version.id, version.quarantineKey, version.objectKey],
  );
}
async function insertDocumentAudit(
  client: Pool | PoolClient,
  event: DocumentAuditEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO document_audit_events (id, event_type, document_id, version_id, organization_id, workspace_id, actor_id, correlation_id, occurred_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      event.id,
      event.eventType,
      event.documentId,
      event.versionId,
      event.organizationId,
      event.workspaceId,
      event.actorId,
      event.correlationId,
      event.occurredAt,
      asJson(event.payload),
    ],
  );
}
async function insertOutboxEvent(
  client: PoolClient,
  event: DurableDomainEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (event_id, event_type, occurred_at, aggregate_id, aggregate_type, aggregate_version, organization_id, correlation_id, causation_id, schema_version, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      event.eventId,
      event.eventType,
      event.occurredAt,
      event.aggregateId,
      event.aggregateType,
      event.aggregateVersion,
      event.organizationId,
      event.correlationId,
      event.causationId,
      event.schemaVersion,
      event.payload,
    ],
  );
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}
function numberValue(value: number | string): number {
  return Number(value);
}
function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}
function percent(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10_000) / 100;
}

function isProjectConversionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return (
    databaseError.code === "23505" &&
    (databaseError.constraint === "projects_source_initiative_id_key" ||
      databaseError.constraint === "projects_source_decision_id_key")
  );
}
