import type { AuthSession, AuthStore, LoginTransaction } from "@aether/auth";
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
  OutboxMessage,
  DurableDomainEvent,
  Invitation,
  Organization,
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
} from "@aether/domain";
import type { Pool, PoolClient } from "pg";

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
        standard.criteria,
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
        evaluation.criteria,
        evaluation.coverage,
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
        decision.evidence,
        decision.standardId,
        decision.standardVersion,
        decision.coverage,
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
        project.participants,
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

export class PostgresOutboxStore implements OutboxStore {
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
          `INSERT INTO outbox_dead_letters (event_id, event_type, organization_id, attempts, failed_at, last_error, payload) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING`,
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
      project.participants,
      project.status,
      project.version,
      project.createdAt,
      project.updatedAt,
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
