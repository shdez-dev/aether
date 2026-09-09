import type { AuthSession, AuthStore, LoginTransaction } from "@aether/auth";
import type {
  InitiativeAuditEvent,
  InitiativeAuditStore,
  InitiativeStore,
  Invitation,
  Organization,
  TenantStore,
  Workspace,
} from "@aether/application";
import type {
  Initiative,
  InitiativeClassification,
  InitiativeStatus,
  OrganizationRole,
  WorkspaceRole,
} from "@aether/domain";
import type { Pool } from "pg";

/** Adaptador PostgreSQL para transacciones OIDC y sesiones opacas. */
export class PostgresAuthStore implements AuthStore {
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

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.pool.query(
      "UPDATE auth_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [sessionId, now],
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
      "SELECT id, organization_id, name, mode, version FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return result.rows[0] ? toWorkspace(result.rows[0]) : null;
  }

  async findOrganizationRole(input: {
    actorId: string;
    organizationId: string;
  }): Promise<OrganizationRole | null> {
    const result = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM organization_memberships WHERE actor_id = $1 AND organization_id = $2",
      [input.actorId, input.organizationId],
    );
    return result.rows[0]?.role ?? null;
  }

  async findWorkspaceRole(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<WorkspaceRole | null> {
    const result = await this.pool.query<{ role: WorkspaceRole }>(
      "SELECT role FROM workspace_memberships WHERE actor_id = $1 AND workspace_id = $2",
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
         ON CONFLICT (organization_id, actor_id) DO UPDATE SET role = EXCLUDED.role, actor_email = EXCLUDED.actor_email`,
        [
          invitation.organizationId,
          input.actorId,
          input.actorEmail.toLowerCase(),
          invitation.organizationRole,
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
}

type WorkspaceRow = {
  id: string;
  organization_id: string;
  name: string;
  mode: Workspace["mode"];
  version: number;
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
