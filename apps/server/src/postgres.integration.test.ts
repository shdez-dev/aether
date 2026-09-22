import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  AccessDeniedError,
  EvaluationService,
  DiagnosticService,
  IntakeService,
  TriageService,
  InitiativeVersionConflictError,
  InitiativeRelationshipService,
  InitiativeService,
  NotificationService,
  OutboxWorker,
  ProjectAlreadyExistsError,
  ProjectService,
  TemporaryAccessGrantService,
  SupportAccessService,
  TenantService,
} from "@aether/application";
import {
  AuthService,
  createAesGcmCipher,
  type OidcProvider,
} from "@aether/auth";
import {
  PostgresAuthStore,
  PostgresEvaluationStandardStore,
  PostgresEvaluationStore,
  PostgresTriageStandardStore,
  PostgresTriageStore,
  PostgresInitiativeAuditStore,
  PostgresInitiativeRelationshipStore,
  PostgresDiagnosticStore,
  PostgresInitiativeStore,
  PostgresIntakeAssignmentStore,
  PostgresIdempotencyStore,
  PostgresNotificationStore,
  PostgresOutboxStore,
  PostgresOutboxAdministrationStore,
  PostgresCapacityStore,
  PostgresProjectAuditStore,
  PostgresProjectExecutionStore,
  PostgresProjectClosureStore,
  PostgresProjectStore,
  PostgresDocumentStore,
  PostgresProductMetricsStore,
  PostgresTemporaryAccessGrantStore,
  PostgresSupportAccessGrantStore,
  PostgresTenantStore,
  migratePool,
} from "@aether/database";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let pool: Pool;
const testSessionEncryptionKey = Buffer.alloc(32).toString("base64");
const containerRuntimeAvailable =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const requireContainerRuntime = process.env.REQUIRE_CONTAINER_RUNTIME === "1";
const runPostgresIntegration =
  containerRuntimeAvailable || requireContainerRuntime ? it : it.skip;

if (containerRuntimeAvailable || requireContainerRuntime) {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("aether")
      .withUsername("aether")
      .withPassword("aether")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await migratePool(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });
}

describe.sequential("PostgreSQL integration", () => {
  runPostgresIntegration(
    "applies every migration to a clean database and reapplying is idempotent",
    async () => {
      const migrationDirectory = fileURLToPath(
        new URL("../../../packages/database/migrations/", import.meta.url),
      );
      const expected = (await readdir(migrationDirectory))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const applied = await pool.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      expect(applied.rows.map((row) => row.name)).toEqual(expected);
      await expect(migratePool(pool)).resolves.toBeUndefined();
      const reapplied = await pool.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      expect(reapplied.rows.map((row) => row.name)).toEqual(expected);
    },
    120_000,
  );

  runPostgresIntegration(
    "audits the tenancy lifecycle atomically without invitation secrets",
    async () => {
      const tenants = new TenantService({
        store: new PostgresTenantStore(pool),
        ids: { next: randomUUID },
        tokens: {
          generate: () => "lifecycle-token",
          hash: (value) => `lifecycle:${value}`,
        },
        clock: { now: () => new Date("2026-09-16T02:00:00.000Z") },
      });
      const organization = await tenants.createOrganization({
        actorId: "lifecycle-owner",
        actorEmail: "lifecycle-owner@example.test",
        name: "Lifecycle audit",
        timezone: "UTC",
        locale: "es-CL",
        correlationId: randomUUID(),
      });
      const workspace = await tenants.createWorkspace({
        actorId: "lifecycle-owner",
        organizationId: organization.id,
        name: "Lifecycle workspace",
        mode: "institutional",
        correlationId: randomUUID(),
      });
      const invitation = await tenants.invite({
        actorId: "lifecycle-owner",
        organizationId: organization.id,
        email: "lifecycle-member@example.test",
        organizationRole: "member",
        workspaceIds: [workspace.id],
        workspaceRole: "viewer",
        expiresInDays: 7,
        correlationId: randomUUID(),
      });
      await tenants.acceptInvitation({
        token: invitation.deliveryToken,
        actorId: "lifecycle-member",
        actorEmail: "lifecycle-member@example.test",
        correlationId: randomUUID(),
      });

      const organizationAudit = await pool.query<{
        event_type: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT event_type, payload
         FROM organization_membership_audit_events
         WHERE organization_id = $1
           AND event_type IN (
             'organization.created.v1',
             'organization.invitation_issued.v1',
             'organization.membership_activated.v1'
           )
         ORDER BY event_type`,
        [organization.id],
      );
      expect(organizationAudit.rows.map((row) => row.event_type)).toEqual([
        "organization.created.v1",
        "organization.invitation_issued.v1",
        "organization.membership_activated.v1",
      ]);
      const issued = organizationAudit.rows.find(
        (row) => row.event_type === "organization.invitation_issued.v1",
      );
      expect(issued?.payload).toEqual({
        invitationId: invitation.invitation.id,
        organizationRole: "member",
        workspaceCount: 1,
      });
      expect(JSON.stringify(organizationAudit.rows)).not.toContain(
        "lifecycle-member@example.test",
      );
      expect(JSON.stringify(organizationAudit.rows)).not.toContain(
        invitation.deliveryToken,
      );
      const workspaceAudit = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM workspace_audit_events
         WHERE workspace_id = $1`,
        [workspace.id],
      );
      expect(workspaceAudit.rows).toEqual([
        { event_type: "workspace.created.v1" },
      ]);
      await expect(
        pool.query(
          "DELETE FROM workspace_audit_events WHERE workspace_id = $1",
          [workspace.id],
        ),
      ).rejects.toThrow("Audit events are append-only");
    },
    120_000,
  );

  runPostgresIntegration(
    "binds each OIDC issuer and subject to one stable internal actor",
    async () => {
      const store = new PostgresAuthStore(pool);
      const authenticatedAt = new Date("2026-09-17T13:00:00.000Z");
      const first = await store.resolveIdentity({
        id: randomUUID(),
        issuer: "https://identity.example/realms/aether",
        subject: "provider-subject",
        email: "first@example.test",
        authenticatedAt,
      });
      const repeated = await store.resolveIdentity({
        id: randomUUID(),
        issuer: "https://identity.example/realms/aether",
        subject: "provider-subject",
        email: "updated@example.test",
        authenticatedAt: new Date(authenticatedAt.getTime() + 1_000),
      });
      const differentIssuer = await store.resolveIdentity({
        id: randomUUID(),
        issuer: "https://other-identity.example/realms/aether",
        subject: "provider-subject",
        email: "other@example.test",
        authenticatedAt,
      });
      expect(repeated.actorId).toBe(first.actorId);
      expect(differentIssuer.actorId).not.toBe(first.actorId);
      await expect(
        pool.query<{ email: string; last_authenticated_at: Date }>(
          "SELECT email, last_authenticated_at FROM actor_identities WHERE id = $1",
          [first.actorId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            email: "updated@example.test",
            last_authenticated_at: new Date(authenticatedAt.getTime() + 1_000),
          },
        ],
      });
    },
    120_000,
  );

  runPostgresIntegration(
    "persists rejected, revoked, and expired invitations without granting membership",
    async () => {
      let now = new Date("2026-09-16T03:00:00.000Z");
      let tokenSequence = 0;
      const tenants = new TenantService({
        store: new PostgresTenantStore(pool),
        ids: { next: randomUUID },
        tokens: {
          generate: () => `invitation-${++tokenSequence}`.padEnd(32, "x"),
          hash: (value) => `invitation-lifecycle:${value}`,
        },
        clock: { now: () => now },
      });
      const organization = await tenants.createOrganization({
        actorId: "invitation-owner",
        actorEmail: "invitation-owner@example.test",
        name: "Invitation lifecycle",
        timezone: "UTC",
        locale: "es-CL",
      });
      const accepted = await tenants.invite({
        actorId: "invitation-owner",
        organizationId: organization.id,
        email: "accepted-lifecycle@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      });
      await tenants.acceptInvitation({
        token: accepted.deliveryToken,
        actorId: "accepted-lifecycle",
        actorEmail: "accepted-lifecycle@example.test",
      });
      await expect(
        tenants.acceptInvitation({
          token: accepted.deliveryToken,
          actorId: "accepted-lifecycle",
          actorEmail: "accepted-lifecycle@example.test",
        }),
      ).resolves.toMatchObject({ id: accepted.invitation.id });

      const rejected = await tenants.invite({
        actorId: "invitation-owner",
        organizationId: organization.id,
        email: "rejected-lifecycle@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      });
      await tenants.rejectInvitation({
        token: rejected.deliveryToken,
        actorId: "rejected-lifecycle",
        actorEmail: "rejected-lifecycle@example.test",
      });

      const revoked = await tenants.invite({
        actorId: "invitation-owner",
        organizationId: organization.id,
        email: "revoked-lifecycle@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 7,
      });
      await tenants.revokeInvitation({
        actorId: "invitation-owner",
        organizationId: organization.id,
        invitationId: revoked.invitation.id,
        correlationId: randomUUID(),
      });

      const expired = await tenants.invite({
        actorId: "invitation-owner",
        organizationId: organization.id,
        email: "expired-lifecycle@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 1,
      });
      now = new Date("2026-09-18T03:00:00.000Z");
      await expect(
        tenants.acceptInvitation({
          token: expired.deliveryToken,
          actorId: "expired-lifecycle",
          actorEmail: "expired-lifecycle@example.test",
        }),
      ).rejects.toMatchObject({ code: "INVITATION_INVALID_OR_EXPIRED" });

      const states = await pool.query<{
        id: string;
        accepted_at: Date | null;
        rejected_at: Date | null;
        revoked_at: Date | null;
        expired_at: Date | null;
      }>(
        `SELECT id, accepted_at, rejected_at, revoked_at, expired_at
         FROM invitations WHERE organization_id = $1`,
        [organization.id],
      );
      const byId = new Map(states.rows.map((row) => [row.id, row]));
      expect(byId.get(accepted.invitation.id)?.accepted_at).not.toBeNull();
      expect(byId.get(rejected.invitation.id)?.rejected_at).not.toBeNull();
      expect(byId.get(revoked.invitation.id)?.revoked_at).not.toBeNull();
      expect(byId.get(expired.invitation.id)?.expired_at).not.toBeNull();
      await expect(
        new PostgresTenantStore(pool).findOrganizationRole({
          actorId: "rejected-lifecycle",
          organizationId: organization.id,
        }),
      ).resolves.toBeNull();
      const audit = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM organization_membership_audit_events
         WHERE organization_id = $1 AND event_type LIKE 'organization.invitation_%'
         ORDER BY event_type`,
        [organization.id],
      );
      expect(audit.rows.map((row) => row.event_type)).toEqual([
        "organization.invitation_expired.v1",
        "organization.invitation_issued.v1",
        "organization.invitation_issued.v1",
        "organization.invitation_issued.v1",
        "organization.invitation_issued.v1",
        "organization.invitation_rejected.v1",
        "organization.invitation_revoked.v1",
      ]);
    },
    120_000,
  );

  runPostgresIntegration(
    "makes organization and workspace scope immutable in PostgreSQL",
    async () => {
      const ids = { next: randomUUID };
      const tenants = new TenantService({
        store: new PostgresTenantStore(pool),
        ids,
        tokens: {
          generate: () => "scope-token",
          hash: (value) => `scope:${value}`,
        },
        clock: { now: () => new Date("2026-09-16T01:00:00.000Z") },
      });
      const organization = await tenants.createOrganization({
        actorId: "scope-owner",
        actorEmail: "scope-owner@example.test",
        name: "Immutable scope",
        timezone: "UTC",
        locale: "es-CL",
      });
      const otherOrganization = await tenants.createOrganization({
        actorId: "other-scope-owner",
        actorEmail: "other-scope-owner@example.test",
        name: "Other immutable scope",
        timezone: "UTC",
        locale: "es-CL",
      });
      const workspace = await tenants.createWorkspace({
        actorId: "scope-owner",
        organizationId: organization.id,
        name: "Source workspace",
        mode: "team",
      });
      const otherWorkspace = await tenants.createWorkspace({
        actorId: "other-scope-owner",
        organizationId: otherOrganization.id,
        name: "Target workspace",
        mode: "team",
      });
      const team = await tenants.createTeam({
        actorId: "scope-owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
        name: "Source team",
        memberActorIds: ["scope-owner"],
        correlationId: randomUUID(),
      });
      await tenants.setWorkspacePolicyOverride({
        actorId: "scope-owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
        dataResidencyRegion: "cl",
        retentionDays: 365,
        correlationId: randomUUID(),
      });

      await expect(
        pool.query("UPDATE workspaces SET organization_id = $1 WHERE id = $2", [
          otherOrganization.id,
          workspace.id,
        ]),
      ).rejects.toThrow("Organization scope is immutable");
      await expect(
        pool.query("UPDATE teams SET workspace_id = $1 WHERE id = $2", [
          otherWorkspace.id,
          team.id,
        ]),
      ).rejects.toThrow("Tenant scope is immutable");
      await expect(
        pool.query(
          "UPDATE workspace_policy_overrides SET organization_id = $1 WHERE workspace_id = $2",
          [otherOrganization.id, workspace.id],
        ),
      ).rejects.toThrow("Tenant scope is immutable");
      await expect(
        pool.query(
          `INSERT INTO documents
           (id, organization_id, workspace_id, resource_type, resource_id,
            classification, created_by_actor_id, created_at)
           VALUES ($1, $2, $3, 'initiative', $4, 'internal', 'scope-owner', NOW())`,
          [randomUUID(), otherOrganization.id, workspace.id, randomUUID()],
        ),
      ).rejects.toThrow("Workspace must belong to the record organization");

      await expect(
        pool.query<{ organization_id: string }>(
          "SELECT organization_id FROM workspaces WHERE id = $1",
          [workspace.id],
        ),
      ).resolves.toMatchObject({
        rows: [{ organization_id: organization.id }],
      });
      await expect(
        pool.query<{ workspace_id: string }>(
          "SELECT workspace_id FROM teams WHERE id = $1",
          [team.id],
        ),
      ).resolves.toMatchObject({ rows: [{ workspace_id: workspace.id }] });
    },
    120_000,
  );

  runPostgresIntegration(
    "persists the complete temporary access lifecycle and its append-only audit",
    async () => {
      let now = new Date("2026-09-15T15:00:00.000Z");
      const ids = { next: randomUUID };
      const clock = { now: () => now };
      const tenantStore = new PostgresTenantStore(pool);
      const grantStore = new PostgresTemporaryAccessGrantStore(pool);
      const tenants = new TenantService({
        store: tenantStore,
        ids,
        tokens: {
          generate: () => randomUUID().replaceAll("-", "").padEnd(43, "x"),
          hash: (value) => `temporary-access:${value}`,
        },
        clock,
      });
      const accessGrants = new TemporaryAccessGrantService({
        store: grantStore,
        resources: grantStore,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const organization = await tenants.createOrganization({
        actorId: "temporary-owner",
        actorEmail: "temporary-owner@example.test",
        name: "Temporary access persistence",
        timezone: "UTC",
        locale: "es-CL",
      });
      const workspace = await tenants.createWorkspace({
        actorId: "temporary-owner",
        organizationId: organization.id,
        name: "External review",
        mode: "institutional",
      });
      const invitation = await tenants.invite({
        actorId: "temporary-owner",
        organizationId: organization.id,
        email: "temporary-requester@example.test",
        organizationRole: "member",
        workspaceIds: [workspace.id],
        workspaceRole: "viewer",
        expiresInDays: 1,
      });
      await tenants.acceptInvitation({
        token: invitation.deliveryToken,
        actorId: "temporary-requester",
        actorEmail: "temporary-requester@example.test",
      });

      const requested = await accessGrants.request({
        actorId: "temporary-requester",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "workspace",
        resourceId: workspace.id,
        action: "read",
        granteeActorId: "temporary-reviewer",
        reason: "Independent review",
        expiresInMinutes: 60,
        correlationId: randomUUID(),
      });
      await accessGrants.approve({
        actorId: "temporary-owner",
        organizationId: organization.id,
        grantId: requested.id,
        correlationId: randomUUID(),
      });
      await expect(
        accessGrants.authorize({
          actorId: "temporary-reviewer",
          organizationId: organization.id,
          workspaceId: workspace.id,
          resourceType: "workspace",
          resourceId: workspace.id,
          action: "read",
          correlationId: randomUUID(),
        }),
      ).resolves.toBe(true);
      await accessGrants.revoke({
        actorId: "temporary-reviewer",
        organizationId: organization.id,
        grantId: requested.id,
        reason: "Review completed",
        correlationId: randomUUID(),
      });
      await expect(
        accessGrants.authorize({
          actorId: "temporary-reviewer",
          organizationId: organization.id,
          workspaceId: workspace.id,
          resourceType: "workspace",
          resourceId: workspace.id,
          action: "read",
          correlationId: randomUUID(),
        }),
      ).resolves.toBe(false);

      const expiring = await accessGrants.request({
        actorId: "temporary-requester",
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "workspace",
        resourceId: workspace.id,
        action: "read",
        granteeActorId: "temporary-reviewer",
        reason: "Short review",
        expiresInMinutes: 1,
        correlationId: randomUUID(),
      });
      await accessGrants.approve({
        actorId: "temporary-owner",
        organizationId: organization.id,
        grantId: expiring.id,
        correlationId: randomUUID(),
      });
      now = new Date("2026-09-15T15:02:00.000Z");
      await expect(
        accessGrants.authorize({
          actorId: "temporary-reviewer",
          organizationId: organization.id,
          workspaceId: workspace.id,
          resourceType: "workspace",
          resourceId: workspace.id,
          action: "read",
          correlationId: randomUUID(),
        }),
      ).resolves.toBe(false);
      const events = await pool.query<{ event_type: string }>(
        `SELECT event_type
         FROM temporary_access_grant_audit_events
         WHERE organization_id = $1
         ORDER BY occurred_at, id`,
        [organization.id],
      );
      expect(events.rows.map((event) => event.event_type)).toEqual(
        expect.arrayContaining([
          "temporary_access_grant.requested.v1",
          "temporary_access_grant.approved.v1",
          "temporary_access_grant.used.v1",
          "temporary_access_grant.revoked.v1",
          "temporary_access_grant.expired.v1",
        ]),
      );
      await expect(
        pool.query(
          `DELETE FROM temporary_access_grant_audit_events WHERE grant_id = $1`,
          [requested.id],
        ),
      ).rejects.toThrow();
    },
    120_000,
  );

  runPostgresIntegration(
    "relocates an unreferenced document atomically and blocks evidence-linked documents",
    async () => {
      const ids = { next: randomUUID };
      const now = new Date("2026-09-17T12:00:00.000Z");
      const tenants = new TenantService({
        store: new PostgresTenantStore(pool),
        ids,
        tokens: {
          generate: () => "document-relocation-token",
          hash: (value) => `document-relocation:${value}`,
        },
        clock: { now: () => now },
      });
      const organization = await tenants.createOrganization({
        actorId: "document-relocation-owner",
        actorEmail: "document-relocation-owner@example.test",
        name: "Document relocation",
        timezone: "UTC",
        locale: "es-CL",
      });
      const workspace = await tenants.createWorkspace({
        actorId: "document-relocation-owner",
        organizationId: organization.id,
        name: "Document relocation workspace",
        mode: "team",
      });
      const documents = new PostgresDocumentStore(pool);
      const document = {
        id: randomUUID(),
        organizationId: organization.id,
        workspaceId: workspace.id,
        resourceType: "initiative" as const,
        resourceId: randomUUID(),
        classification: "internal" as const,
        createdByActorId: "document-relocation-owner",
        createdAt: now,
      };
      const version = {
        id: randomUUID(),
        documentId: document.id,
        versionNumber: 1,
        originalName: "acta.pdf",
        declaredContentType: "application/pdf",
        detectedContentType: null,
        byteLength: 10,
        sha256: "a".repeat(64),
        status: "quarantined" as const,
        quarantineKey: `quarantine/${randomUUID()}`,
        objectKey: null,
        createdAt: now,
        publishedAt: null,
        rejectedAt: null,
        withdrawnAt: null,
        retentionUntil: null,
        evidenceStatus: "pending" as const,
        supersedesVersionId: null,
        replacedByVersionId: null,
      };
      const audit = (
        eventType: "document.upload_started.v1" | "document.relocated.v1",
      ) => ({
        id: randomUUID(),
        eventType,
        documentId: document.id,
        versionId: version.id,
        organizationId: organization.id,
        workspaceId: workspace.id,
        actorId: "document-relocation-owner",
        correlationId: randomUUID(),
        occurredAt: now,
        payload: {},
      });
      await documents.createQuarantined({
        document,
        version,
        audit: audit("document.upload_started.v1"),
      });
      const targetResourceId = randomUUID();
      await expect(
        documents.relocate({
          document: {
            ...document,
            resourceType: "project",
            resourceId: targetResourceId,
          },
          audit: {
            ...audit("document.relocated.v1"),
            payload: {
              fromResourceType: document.resourceType,
              fromResourceId: document.resourceId,
            },
          },
        }),
      ).resolves.toBe(true);
      await expect(
        pool.query<{ resource_type: string; resource_id: string }>(
          "SELECT resource_type, resource_id FROM documents WHERE id = $1",
          [document.id],
        ),
      ).resolves.toMatchObject({
        rows: [{ resource_type: "project", resource_id: targetResourceId }],
      });
      await pool.query(
        `INSERT INTO evidence_references
         (id, organization_id, workspace_id, subject_type, subject_id, document_id, document_version_id, linked_by_actor_id, linked_at)
         VALUES ($1,$2,$3,'evaluation',$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          organization.id,
          workspace.id,
          randomUUID(),
          document.id,
          version.id,
          "document-relocation-owner",
          now,
        ],
      );
      await expect(
        documents.relocate({
          document: {
            ...document,
            resourceType: "initiative",
            resourceId: randomUUID(),
          },
          audit: audit("document.relocated.v1"),
        }),
      ).resolves.toBe(false);
    },
    120_000,
  );

  runPostgresIntegration(
    "limits support JIT to audited aggregate diagnostics and one hour",
    async () => {
      let now = new Date("2026-09-15T16:00:00.000Z");
      const ids = { next: randomUUID };
      const clock = { now: () => now };
      const tenantStore = new PostgresTenantStore(pool);
      const supportStore = new PostgresSupportAccessGrantStore(pool);
      const tenants = new TenantService({
        store: tenantStore,
        ids,
        tokens: {
          generate: () => randomUUID().replaceAll("-", "").padEnd(43, "x"),
          hash: (value) => `support-access:${value}`,
        },
        clock,
      });
      const supportAccess = new SupportAccessService({
        store: supportStore,
        operators: {
          isEligible: async (actorId) => actorId === "postgres-support",
        },
        tenancy: tenantStore,
        ids,
        clock,
      });
      const organization = await tenants.createOrganization({
        actorId: "postgres-support-owner",
        actorEmail: "postgres-support-owner@example.test",
        name: "Support JIT persistence",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "cl", retentionDays: 365 },
        correlationId: randomUUID(),
      });
      await tenants.createWorkspace({
        actorId: "postgres-support-owner",
        organizationId: organization.id,
        name: "Operational workspace",
        mode: "institutional",
      });
      const requested = await supportAccess.request({
        actorId: "postgres-support",
        organizationId: organization.id,
        reason: "Investigate delivery backlog",
        expiresInMinutes: 30,
        correlationId: randomUUID(),
      });
      await supportAccess.approve({
        actorId: "postgres-support-owner",
        organizationId: organization.id,
        grantId: requested.id,
        correlationId: randomUUID(),
      });
      await expect(
        supportAccess.diagnose({
          actorId: "postgres-support",
          organizationId: organization.id,
          correlationId: randomUUID(),
        }),
      ).resolves.toEqual({
        organizationId: organization.id,
        generatedAt: now,
        workspaces: { active: 1, archived: 0 },
        memberships: { active: 1, suspended: 0, revoked: 0 },
        delivery: { pendingOutboxEvents: 0, deadLetters: 0 },
        policyConfigured: true,
      });
      await supportAccess.revoke({
        actorId: "postgres-support-owner",
        organizationId: organization.id,
        grantId: requested.id,
        reason: "Diagnostic complete",
        correlationId: randomUUID(),
      });
      await expect(
        supportAccess.diagnose({
          actorId: "postgres-support",
          organizationId: organization.id,
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "SUPPORT_ACCESS_DENIED" });

      const expiring = await supportAccess.request({
        actorId: "postgres-support",
        organizationId: organization.id,
        reason: "Short diagnostic",
        expiresInMinutes: 1,
        correlationId: randomUUID(),
      });
      await supportAccess.approve({
        actorId: "postgres-support-owner",
        organizationId: organization.id,
        grantId: expiring.id,
        correlationId: randomUUID(),
      });
      now = new Date("2026-09-15T16:02:00.000Z");
      await expect(
        supportAccess.diagnose({
          actorId: "postgres-support",
          organizationId: organization.id,
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "SUPPORT_ACCESS_DENIED" });
      const events = await pool.query<{ event_type: string }>(
        `SELECT event_type
         FROM support_access_grant_audit_events
         WHERE organization_id = $1
         ORDER BY occurred_at, id`,
        [organization.id],
      );
      expect(events.rows.map((event) => event.event_type)).toEqual(
        expect.arrayContaining([
          "support_access_grant.requested.v1",
          "support_access_grant.approved.v1",
          "support_access_grant.used.v1",
          "support_access_grant.revoked.v1",
          "support_access_grant.expired.v1",
        ]),
      );
      await expect(
        pool.query(
          "DELETE FROM support_access_grant_audit_events WHERE grant_id = $1",
          [requested.id],
        ),
      ).rejects.toThrow();
    },
    120_000,
  );

  runPostgresIntegration(
    "transfers ownership atomically, audits it, and rejects removal of the final owner",
    async () => {
      const ids = { next: randomUUID };
      const clock = { now: () => new Date("2026-09-14T13:30:00.000Z") };
      const tenants = new TenantService({
        store: new PostgresTenantStore(pool),
        ids,
        tokens: {
          generate: () => "token",
          hash: (value) => `ownership-transfer:${value}`,
        },
        clock,
      });
      const organization = await tenants.createOrganization({
        actorId: "initial-owner",
        actorEmail: "initial-owner@example.test",
        name: "Ownership",
        timezone: "UTC",
        locale: "es-CL",
      });
      const invitation = await tenants.invite({
        actorId: "initial-owner",
        organizationId: organization.id,
        email: "next-owner@example.test",
        organizationRole: "member",
        workspaceIds: [],
        workspaceRole: "member",
        expiresInDays: 7,
      });
      await tenants.acceptInvitation({
        token: invitation.deliveryToken,
        actorId: "next-owner",
        actorEmail: "next-owner@example.test",
      });

      await tenants.transferOwnership({
        actorId: "initial-owner",
        organizationId: organization.id,
        targetActorId: "next-owner",
        correlationId: randomUUID(),
      });

      await expect(
        new PostgresTenantStore(pool).findOrganizationRole({
          actorId: "next-owner",
          organizationId: organization.id,
        }),
      ).resolves.toBe("owner");
      await expect(
        new PostgresTenantStore(pool).findOrganizationRole({
          actorId: "initial-owner",
          organizationId: organization.id,
        }),
      ).resolves.toBe("admin");
      const audit = await pool.query(
        `SELECT actor_id, target_actor_id, event_type
         FROM organization_membership_audit_events
         WHERE organization_id = $1 AND event_type = 'organization.ownership_transferred.v1'`,
        [organization.id],
      );
      expect(audit.rows).toEqual([
        {
          actor_id: "initial-owner",
          target_actor_id: "next-owner",
          event_type: "organization.ownership_transferred.v1",
        },
      ]);
      await expect(
        pool.query(
          "DELETE FROM organization_memberships WHERE organization_id = $1 AND actor_id = 'next-owner'",
          [organization.id],
        ),
      ).rejects.toThrow("An organization must retain at least one owner");
    },
    120_000,
  );

  runPostgresIntegration(
    "persists tenancy policies, resolves inheritance, and isolates overrides",
    async () => {
      const ids = { next: randomUUID };
      const clock = { now: () => new Date("2026-09-14T14:00:00.000Z") };
      const tenantStore = new PostgresTenantStore(pool);
      const tenants = new TenantService({
        store: tenantStore,
        ids,
        tokens: { generate: () => "token", hash: (value) => `policy:${value}` },
        clock,
      });
      const organization = await tenants.createOrganization({
        actorId: "policy-owner",
        actorEmail: "policy-owner@example.test",
        name: "Policy organization",
        organizationType: "business",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "cl", retentionDays: 365 },
        correlationId: randomUUID(),
      });
      const otherOrganization = await tenants.createOrganization({
        actorId: "other-owner",
        actorEmail: "other-owner@example.test",
        name: "Other policy organization",
        timezone: "UTC",
        locale: "es-CL",
        policy: { dataResidencyRegion: "us", retentionDays: 90 },
        correlationId: randomUUID(),
      });
      const workspace = await tenants.createWorkspace({
        actorId: "policy-owner",
        organizationId: organization.id,
        name: "Regional workspace",
        mode: "institutional",
      });
      await expect(
        pool.query<{ organization_type: string | null }>(
          "SELECT organization_type FROM organizations WHERE id = $1",
          [organization.id],
        ),
      ).resolves.toMatchObject({ rows: [{ organization_type: "business" }] });

      await expect(
        tenants.getEffectivePolicy({
          actorId: "policy-owner",
          organizationId: organization.id,
          workspaceId: workspace.id,
        }),
      ).resolves.toMatchObject({
        dataResidencyRegion: { value: "cl", origin: "organization" },
        retentionDays: { value: 365, origin: "organization" },
      });
      await tenants.setWorkspacePolicyOverride({
        actorId: "policy-owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
        dataResidencyRegion: "eu",
        retentionDays: null,
        correlationId: randomUUID(),
      });
      await tenants.updateOrganizationPolicy({
        actorId: "policy-owner",
        organizationId: organization.id,
        dataResidencyRegion: "cl-south",
        retentionDays: 180,
        businessHours: {
          mode: "audit",
          timezone: "UTC",
          windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
        },
        correlationId: randomUUID(),
      });
      await expect(
        tenants.getEffectivePolicy({
          actorId: "policy-owner",
          organizationId: organization.id,
          workspaceId: workspace.id,
        }),
      ).resolves.toMatchObject({
        dataResidencyRegion: { value: "eu", origin: "workspace" },
        retentionDays: { value: 180, origin: "organization" },
        businessHours: {
          value: {
            mode: "audit",
            timezone: "UTC",
            windows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
          },
          origin: "organization",
        },
        organizationPolicy: { version: 1, dataResidencyRegion: "cl-south" },
      });
      await expect(
        tenantStore.findEffectivePolicy({
          organizationId: otherOrganization.id,
          workspaceId: workspace.id,
        }),
      ).resolves.toBeNull();
      await tenants.clearWorkspacePolicyOverride({
        actorId: "policy-owner",
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: randomUUID(),
      });
      await expect(
        tenants.getEffectivePolicy({
          actorId: "policy-owner",
          organizationId: organization.id,
          workspaceId: workspace.id,
        }),
      ).resolves.toMatchObject({
        dataResidencyRegion: { value: "cl-south", origin: "organization" },
        retentionDays: { value: 180, origin: "organization" },
        workspaceOverride: null,
      });
      const audit = await pool.query(
        `SELECT event_type, correlation_id
         FROM tenancy_policy_audit_events
         WHERE organization_id = $1
         ORDER BY occurred_at ASC, id ASC`,
        [organization.id],
      );
      expect(audit.rows).toHaveLength(4);
      expect(audit.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining([
          "organization.policy_configured.v1",
          "workspace.policy_override_set.v1",
          "organization.policy_updated.v1",
          "workspace.policy_override_cleared.v1",
        ]),
      );
      await expect(
        pool.query(
          "DELETE FROM tenancy_policy_audit_events WHERE organization_id = $1",
          [organization.id],
        ),
      ).rejects.toThrow("append-only");
    },
    120_000,
  );

  runPostgresIntegration(
    "lists and replays only an organization's dead letters with a recovery audit",
    async () => {
      const organizationId = randomUUID();
      const otherOrganizationId = randomUUID();
      const eventId = randomUUID();
      const replayId = randomUUID();
      const replayedAt = new Date("2026-09-13T12:00:00.000Z");
      await pool.query(
        `INSERT INTO organizations (id, name, timezone, locale) VALUES
         ($1, 'Recovery', 'UTC', 'es-CL'), ($2, 'Other recovery', 'UTC', 'es-CL')`,
        [organizationId, otherOrganizationId],
      );
      await pool.query(
        `INSERT INTO outbox_events (event_id, event_type, occurred_at, aggregate_id, aggregate_type, aggregate_version, organization_id, correlation_id, causation_id, schema_version, payload, status, attempts, last_error)
         VALUES ($1, 'project.created.v1', $2, $3, 'project', 1, $4, $5, NULL, 1, '{}', 'dead_letter', 5, 'Dependency unavailable')`,
        [eventId, replayedAt, randomUUID(), organizationId, randomUUID()],
      );
      await pool.query(
        `INSERT INTO outbox_dead_letters (event_id, event_type, organization_id, attempts, failed_at, last_error, payload)
         VALUES ($1, 'project.created.v1', $2, 5, $3, 'Dependency unavailable', '{}')`,
        [eventId, organizationId, replayedAt],
      );
      await expect(
        pool.query(
          `INSERT INTO outbox_events (event_id, event_type, occurred_at, aggregate_id, aggregate_type, aggregate_version, organization_id, correlation_id, causation_id, schema_version, payload)
           VALUES ($1, 'unknown.event.v1', $2, $3, 'project', 1, $4, $5, NULL, 1, '{}')`,
          [
            randomUUID(),
            replayedAt,
            randomUUID(),
            organizationId,
            randomUUID(),
          ],
        ),
      ).rejects.toThrow("outbox_events_known_event_type_check");
      const store = new PostgresOutboxAdministrationStore(pool);
      await expect(
        store.listDeadLetters({ organizationId, limit: 25 }),
      ).resolves.toEqual([
        expect.objectContaining({
          eventId,
          organizationId,
          attempts: 5,
          lastError: "Dependency unavailable",
        }),
      ]);
      await expect(
        store.listDeadLetters({
          organizationId: otherOrganizationId,
          limit: 25,
        }),
      ).resolves.toEqual([]);
      await expect(
        store.replayDeadLetter({
          replayId,
          eventId,
          organizationId,
          replayedByActorId: "owner",
          correlationId: randomUUID(),
          reason: "La dependencia volvió a estar disponible.",
          replayedAt,
        }),
      ).resolves.toBe(true);
      const replayed = await pool.query<{
        status: string;
        attempts: number;
        last_error: string | null;
      }>(
        "SELECT status, attempts, last_error FROM outbox_events WHERE event_id = $1",
        [eventId],
      );
      expect(replayed.rows).toEqual([
        { status: "pending", attempts: 0, last_error: null },
      ]);
      const audit = await pool.query<{
        id: string;
        replayed_by_actor_id: string;
        reason: string;
      }>(
        "SELECT id, replayed_by_actor_id, reason FROM outbox_replays WHERE event_id = $1",
        [eventId],
      );
      expect(audit.rows).toEqual([
        {
          id: replayId,
          replayed_by_actor_id: "owner",
          reason: "La dependencia volvió a estar disponible.",
        },
      ]);
      await expect(
        pool.query("DELETE FROM outbox_replays WHERE id = $1", [replayId]),
      ).rejects.toThrow("append-only");
      await expect(
        store.listDeadLetters({ organizationId, limit: 25 }),
      ).resolves.toEqual([]);
      await expect(
        store.replayDeadLetter({
          replayId: randomUUID(),
          eventId,
          organizationId: otherOrganizationId,
          replayedByActorId: "other-owner",
          correlationId: randomUUID(),
          reason: "No debe cruzar la organización.",
          replayedAt,
        }),
      ).resolves.toBe(false);
      // Esta fixture comparte base efímera con los demás casos: no debe dejar
      // trabajo pendiente que otro worker pueda reclamar.
      await pool.query(
        "UPDATE outbox_events SET status = 'processed' WHERE event_id = $1",
        [eventId],
      );
    },
    120_000,
  );

  runPostgresIntegration(
    "calculates exact product metrics without crossing organization boundaries",
    async () => {
      const organizationId = randomUUID();
      const otherOrganizationId = randomUUID();
      const workspaceId = randomUUID();
      const otherWorkspaceId = randomUUID();
      const initiativeOne = randomUUID();
      const initiativeTwo = randomUUID();
      const initiativePrevious = randomUUID();
      const otherInitiative = randomUUID();
      const standardId = randomUUID();
      const otherStandardId = randomUUID();
      const evaluationOne = randomUUID();
      const evaluationTwo = randomUUID();
      const evaluationPrevious = randomUUID();
      const otherEvaluation = randomUUID();
      const decisionOne = randomUUID();
      const decisionTwo = randomUUID();
      const decisionPrevious = randomUUID();
      const otherDecision = randomUUID();
      const activeProjectId = randomUUID();
      const closedProjectId = randomUUID();
      const documentId = randomUUID();
      const documentVersionId = randomUUID();
      const startsAt = new Date("2026-01-01T00:00:00.000Z");
      const endsAt = new Date("2026-02-01T00:00:00.000Z");

      await pool.query(
        `INSERT INTO organizations (id, name, timezone, locale) VALUES
         ($1, 'Metrics', 'UTC', 'es-CL'), ($2, 'Other metrics', 'UTC', 'es-CL')`,
        [organizationId, otherOrganizationId],
      );
      await pool.query(
        `INSERT INTO workspaces (id, organization_id, name, mode) VALUES
         ($1, $2, 'Metrics workspace', 'institutional'),
         ($3, $4, 'Other workspace', 'institutional')`,
        [workspaceId, organizationId, otherWorkspaceId, otherOrganizationId],
      );
      await pool.query(
        `INSERT INTO organization_memberships (organization_id, actor_id, actor_email, role, status)
         VALUES ($1,'owner','owner@example.test','owner','active'),
                ($1,'lead','lead@example.test','member','active')`,
        [organizationId],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, actor_id, role)
         VALUES ($1,'lead','member')`,
        [workspaceId],
      );
      await pool.query(
        `INSERT INTO initiatives (id, organization_id, workspace_id, created_by_actor_id, title, problem_statement, expected_outcome, classification, status, created_at, updated_at) VALUES
         ($1,$2,$3,'owner','One','Problem','Outcome','internal','approved','2026-01-01T00:00:00Z','2026-01-03T00:00:00Z'),
         ($4,$2,$3,'owner','Two','Problem','Outcome','internal','rejected','2026-01-02T00:00:00Z','2026-01-04T00:00:00Z'),
         ($5,$2,$3,'owner','Previous','Problem','Outcome','internal','approved','2025-12-01T00:00:00Z','2025-12-03T00:00:00Z'),
         ($6,$7,$8,'other','Other','Problem','Outcome','internal','approved','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')`,
        [
          initiativeOne,
          organizationId,
          workspaceId,
          initiativeTwo,
          initiativePrevious,
          otherInitiative,
          otherOrganizationId,
          otherWorkspaceId,
        ],
      );
      await pool.query(
        `INSERT INTO evaluation_standards (id, organization_id, name, version, criteria, is_active, published_at, published_by_actor_id) VALUES
         ($1,$2,'Standard',1,'[]',false,'2025-12-01T00:00:00Z','owner'),
         ($3,$4,'Other standard',1,'[]',false,'2025-12-01T00:00:00Z','other')`,
        [standardId, organizationId, otherStandardId, otherOrganizationId],
      );
      await pool.query(
        `INSERT INTO initiative_evaluations (id, organization_id, workspace_id, initiative_id, initiative_version, standard_id, standard_version, criteria, coverage, evaluated_by_actor_id, evaluated_at) VALUES
         ($1,$2,$3,$4,0,$5,1,'[]','{}','owner','2026-01-03T00:00:00Z'),
         ($6,$2,$3,$7,0,$5,1,'[]','{}','owner','2026-01-04T00:00:00Z'),
         ($8,$2,$3,$9,0,$5,1,'[]','{}','owner','2025-12-03T00:00:00Z'),
         ($10,$11,$12,$13,0,$14,1,'[]','{}','other','2026-01-02T00:00:00Z')`,
        [
          evaluationOne,
          organizationId,
          workspaceId,
          initiativeOne,
          standardId,
          evaluationTwo,
          initiativeTwo,
          evaluationPrevious,
          initiativePrevious,
          otherEvaluation,
          otherOrganizationId,
          otherWorkspaceId,
          otherInitiative,
          otherStandardId,
        ],
      );
      await pool.query(
        `INSERT INTO initiative_decisions (id, organization_id, workspace_id, initiative_id, evaluation_id, outcome, rationale, evidence, standard_id, standard_version, coverage, decided_by_actor_id, decided_at) VALUES
         ($1,$2,$3,$4,$5,'approved','Rationale','[]',$6,1,'{}','owner','2026-01-03T00:00:00Z'),
         ($7,$2,$3,$8,$9,'rejected','Rationale','[]',$6,1,'{}','owner','2026-01-04T00:00:00Z'),
         ($10,$2,$3,$11,$12,'approved','Rationale','[]',$6,1,'{}','owner','2025-12-03T00:00:00Z'),
         ($13,$14,$15,$16,$17,'approved','Rationale','[]',$18,1,'{}','other','2026-01-02T00:00:00Z')`,
        [
          decisionOne,
          organizationId,
          workspaceId,
          initiativeOne,
          evaluationOne,
          standardId,
          decisionTwo,
          initiativeTwo,
          evaluationTwo,
          decisionPrevious,
          initiativePrevious,
          evaluationPrevious,
          otherDecision,
          otherOrganizationId,
          otherWorkspaceId,
          otherInitiative,
          otherEvaluation,
          otherStandardId,
        ],
      );
      await pool.query(
        `INSERT INTO projects (id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, created_at, updated_at) VALUES
         ($1,$2,$3,$4,$5,'Active','sponsor','lead','[{"actorId":"lead","role":"lead"}]','active','2026-01-03T00:00:00Z','2025-12-20T00:00:00Z'),
         ($6,$2,$3,$7,$8,'Closed','sponsor','lead','[]','completed','2025-12-03T00:00:00Z','2026-01-15T00:00:00Z')`,
        [
          activeProjectId,
          organizationId,
          workspaceId,
          initiativeOne,
          decisionOne,
          closedProjectId,
          initiativePrevious,
          decisionPrevious,
        ],
      );
      await pool.query(
        `INSERT INTO project_milestones (id, project_id, title, due_on, completed_at, created_by_actor_id, created_at)
         VALUES ($1,$2,'Upcoming','2026-02-15',NULL,'owner','2026-01-03T00:00:00Z')`,
        [randomUUID(), activeProjectId],
      );
      await pool.query(
        `INSERT INTO project_closures (id, project_id, organization_id, workspace_id, outcomes, lessons_learned, objective_assessment, assessment_rationale, pending_items, closed_by_actor_id, closed_at)
         VALUES ($1,$2,$3,$4,'Delivered','Reusable lesson','achieved','Metric target met','[]','owner','2026-01-20T00:00:00Z')`,
        [randomUUID(), closedProjectId, organizationId, workspaceId],
      );
      const capacityStore = new PostgresCapacityStore(pool);
      const capacityPeriod = {
        startsOn: "2026-02-01",
        endsOn: "2026-02-07",
      };
      const availability = {
        id: randomUUID(),
        organizationId,
        actorId: "lead",
        unit: "hours" as const,
        period: capacityPeriod,
        availableEffort: 20,
        declaredByActorId: "owner",
        declaredAt: new Date("2026-01-03T00:00:00.000Z"),
      };
      const allocation = {
        id: randomUUID(),
        organizationId,
        workspaceId,
        projectId: activeProjectId,
        actorId: "lead",
        unit: "hours" as const,
        period: capacityPeriod,
        allocatedEffort: 12.5,
        declaredByActorId: "owner",
        declaredAt: availability.declaredAt,
      };
      await capacityStore.saveAvailability(availability);
      await capacityStore.saveAllocation(allocation);
      await expect(
        capacityStore.findAvailability({
          organizationId,
          actorId: "lead",
          unit: "hours",
          period: capacityPeriod,
        }),
      ).resolves.toEqual(availability);
      await expect(
        capacityStore.listAllocations({
          organizationId,
          actorId: "lead",
          unit: "hours",
          period: capacityPeriod,
        }),
      ).resolves.toEqual([allocation]);
      await expect(
        capacityStore.saveAllocation({
          ...allocation,
          id: randomUUID(),
          workspaceId: otherWorkspaceId,
        }),
      ).rejects.toThrow(
        "capacity allocation must preserve project and membership scope",
      );
      await expect(
        pool.query(
          `INSERT INTO project_external_dependencies (id, project_id, description, external_party, owner_actor_id, due_on, status, created_by_actor_id, created_at)
           VALUES ($1,$2,'Await external approval','Outside party','owner',NULL,'open','owner','2026-01-03T00:00:00Z')`,
          [randomUUID(), activeProjectId],
        ),
      ).rejects.toThrow(
        "external dependency requires scoped execution authority",
      );
      await expect(
        pool.query(
          `INSERT INTO project_change_requests (id, project_id, title, reason, impact, requested_by_actor_id, requested_at, status)
           VALUES ($1,$2,'Unscoped change','Attempted bypass','Would alter scope','outsider','2026-01-03T00:00:00Z','pending')`,
          [randomUUID(), activeProjectId],
        ),
      ).rejects.toThrow("change request requires project execution authority");
      const activeActionId = randomUUID();
      const otherActiveActionId = randomUUID();
      const closedActionId = randomUUID();
      await pool.query(
        `INSERT INTO project_next_actions (id, project_id, description, owner_actor_id, due_on, completed_at, created_by_actor_id, created_at)
         VALUES
           ($1,$2,'Active action','owner',NULL,NULL,'owner','2026-01-03T00:00:00Z'),
           ($3,$2,'Other active action','owner',NULL,NULL,'owner','2026-01-03T00:00:00Z'),
           ($4,$5,'Closed action','owner',NULL,NULL,'owner','2026-01-03T00:00:00Z')`,
        [
          activeActionId,
          activeProjectId,
          otherActiveActionId,
          closedActionId,
          closedProjectId,
        ],
      );
      await expect(
        pool.query(
          `INSERT INTO project_next_action_dependencies (action_id, depends_on_action_id)
           VALUES ($1,$2)`,
          [activeActionId, closedActionId],
        ),
      ).rejects.toThrow(
        "next action dependencies must stay within one project",
      );
      await pool.query(
        `INSERT INTO project_next_action_dependencies (action_id, depends_on_action_id)
         VALUES ($1,$2)`,
        [activeActionId, otherActiveActionId],
      );
      await expect(
        pool.query(
          `INSERT INTO project_next_action_dependencies (action_id, depends_on_action_id)
           VALUES ($1,$2)`,
          [otherActiveActionId, activeActionId],
        ),
      ).rejects.toThrow("next action dependencies cannot form a cycle");
      const concurrentActionId = randomUUID();
      const concurrentDependencyId = randomUUID();
      await pool.query(
        `INSERT INTO project_next_actions (id, project_id, description, owner_actor_id, due_on, completed_at, created_by_actor_id, created_at)
         VALUES
           ($1,$2,'Concurrent action','owner',NULL,NULL,'owner','2026-01-03T00:00:00Z'),
           ($3,$2,'Concurrent dependency','owner',NULL,NULL,'owner','2026-01-03T00:00:00Z')`,
        [concurrentActionId, activeProjectId, concurrentDependencyId],
      );
      const transaction = await pool.connect();
      let committed = false;
      try {
        await transaction.query("BEGIN");
        await transaction.query(
          `INSERT INTO project_next_action_dependencies (action_id, depends_on_action_id)
           VALUES ($1,$2)`,
          [concurrentActionId, concurrentDependencyId],
        );
        const inverseDependency = pool.query(
          `INSERT INTO project_next_action_dependencies (action_id, depends_on_action_id)
           VALUES ($1,$2)`,
          [concurrentDependencyId, concurrentActionId],
        );
        let inverseSettled = false;
        void inverseDependency.then(
          () => {
            inverseSettled = true;
          },
          () => {
            inverseSettled = true;
          },
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        expect(inverseSettled).toBe(false);
        await transaction.query("COMMIT");
        committed = true;
        await expect(inverseDependency).rejects.toThrow(
          "next action dependencies cannot form a cycle",
        );
      } finally {
        if (!committed) await transaction.query("ROLLBACK");
        transaction.release();
      }
      const plannedAction = {
        id: randomUUID(),
        projectId: activeProjectId,
        description: "Round-trip planning fields",
        ownerActorId: "owner",
        dueOn: "2026-01-12",
        priority: "high" as const,
        estimatedEffort: 12.5,
        effortUnit: "hours" as const,
        periodStartOn: "2026-01-05",
        periodEndOn: "2026-01-12",
        completedAt: null,
        createdByActorId: "owner",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      };
      const executionStore = new PostgresProjectExecutionStore(pool);
      await executionStore.addNextAction(plannedAction);
      await expect(
        executionStore.findNextAction(plannedAction.id),
      ).resolves.toEqual(plannedAction);
      await expect(
        pool.query(
          `INSERT INTO project_next_actions (id, project_id, description, owner_actor_id, priority, estimated_effort, effort_unit, period_start_on, period_end_on, created_by_actor_id, created_at)
           VALUES ($1,$2,'Incomplete estimate','owner','medium',8,NULL,'2026-01-03','2026-01-04','owner','2026-01-03T00:00:00Z')`,
          [randomUUID(), activeProjectId],
        ),
      ).rejects.toThrow(/project_next_actions_estimation_complete/);
      await expect(
        pool.query(
          `INSERT INTO project_next_actions (id, project_id, description, owner_actor_id, priority, estimated_effort, effort_unit, period_start_on, period_end_on, created_by_actor_id, created_at)
           VALUES ($1,$2,'Invalid period','owner','medium',8,'hours','2026-01-04','2026-01-03','owner','2026-01-03T00:00:00Z')`,
          [randomUUID(), activeProjectId],
        ),
      ).rejects.toThrow(/project_next_actions_period_complete/);
      await pool.query(
        `INSERT INTO documents (id, organization_id, workspace_id, resource_type, resource_id, classification, created_by_actor_id, created_at)
         VALUES ($1,$2,$3,'decision',$4,'internal','owner','2026-01-03T00:00:00Z')`,
        [documentId, organizationId, workspaceId, decisionOne],
      );
      await pool.query(
        `INSERT INTO document_versions (id, document_id, version_number, original_name, declared_content_type, detected_content_type, byte_length, sha256, status, created_at, published_at, evidence_status)
         VALUES ($1,$2,1,'evidence.pdf','application/pdf','application/pdf',1,$3,'published','2026-01-03T00:00:00Z','2026-01-03T00:00:00Z','valid')`,
        [documentVersionId, documentId, "a".repeat(64)],
      );
      await pool.query(
        `INSERT INTO document_binaries (version_id, quarantine_key, object_key) VALUES ($1,$2,$3)`,
        [
          documentVersionId,
          `quarantine/${documentVersionId}`,
          `objects/${documentVersionId}`,
        ],
      );
      await pool.query(
        `INSERT INTO evidence_references (id, organization_id, workspace_id, subject_type, subject_id, document_id, document_version_id, linked_by_actor_id, linked_at)
         VALUES ($1,$2,$3,'decision',$4,$5,$6,'owner','2026-01-03T00:00:00Z')`,
        [
          randomUUID(),
          organizationId,
          workspaceId,
          decisionOne,
          documentId,
          documentVersionId,
        ],
      );

      const snapshot = await new PostgresProductMetricsStore(pool).snapshot({
        organizationId,
        startsAt,
        endsAt,
        calculatedAt: endsAt,
      });
      expect(snapshot.initiativeDecision).toEqual({
        decidedCount: 2,
        averageHours: 48,
        medianHours: 48,
      });
      expect(snapshot.decisionEvidence).toEqual({
        decidedCount: 2,
        decisionsWithVerifiedEvidence: 1,
        coveragePercent: 50,
      });
      expect(snapshot.conversion).toEqual({
        approvedDecisions: 1,
        projectsCreatedFromApprovedDecisions: 1,
        conversionPercent: 100,
      });
      expect(snapshot.activeProjects).toEqual({
        activeOrBlockedCount: 1,
        withAssignedLeadCount: 1,
        withUpcomingMilestoneCount: 1,
        staleForThirtyDaysCount: 1,
      });
      expect(snapshot.closures).toEqual({
        closedCount: 1,
        withLessonsLearnedCount: 1,
        lessonsCoveragePercent: 100,
      });
    },
    120_000,
  );

  runPostgresIntegration(
    "renews, expires and revokes opaque sessions with append-only audit",
    async () => {
      let now = new Date("2026-09-09T12:00:00.000Z");
      const subject = `session-${randomUUID()}@example.test`;
      const oidc: OidcProvider = {
        async buildAuthorizationUrl({ state }) {
          return `https://identity.example/authorize?state=${state}`;
        },
        async exchangeAuthorizationCode() {
          return { subject, email: subject };
        },
      };
      const store = new PostgresAuthStore(pool);
      const auth = new AuthService({
        store,
        audit: store,
        cipher: createAesGcmCipher(testSessionEncryptionKey),
        oidc,
        issuer: "https://identity.example",
        sessionTtlSeconds: 3600,
        sessionRenewalWindowSeconds: 600,
        now: () => now,
      });
      const login = async () => {
        const started = await auth.beginLogin();
        const state = new URL(started.authorizationUrl).searchParams.get(
          "state",
        );
        if (!state) throw new Error("OIDC state was not generated");
        return auth.completeLogin({
          transactionHandle: started.transactionHandle,
          state,
          callbackUrl: `https://app.example/auth/callback?code=test&state=${state}`,
        });
      };

      const first = await login();
      const actorId = first.session.actorId;
      now = new Date("2026-09-09T12:55:00.000Z");
      expect(
        (await auth.authenticate(first.sessionToken))?.expiresAt.toISOString(),
      ).toBe("2026-09-09T13:55:00.000Z");
      const firstSession = await auth.authenticate(first.sessionToken);
      if (!firstSession) throw new Error("First session should be active");
      const rotated = await auth.rotateSession({
        currentSession: firstSession,
        correlationId: randomUUID(),
      });
      await expect(auth.authenticate(first.sessionToken)).resolves.toBeNull();
      await expect(
        auth.authenticate(rotated.sessionToken),
      ).resolves.toMatchObject({ createdAt: first.session.createdAt });
      const second = await login();
      const listed = await auth.listSessions(actorId, second.session.id);
      expect(listed).toHaveLength(2);
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: second.session.id, isCurrent: true }),
        ]),
      );
      expect(
        await auth.revokeSession({
          actorId,
          sessionId: rotated.session.id,
          correlationId: randomUUID(),
        }),
      ).toBe(true);
      await expect(auth.authenticate(rotated.sessionToken)).resolves.toBeNull();
      const third = await login();
      expect(
        await auth.revokeOtherSessions({
          actorId,
          currentSessionId: second.session.id,
          correlationId: randomUUID(),
        }),
      ).toBe(1);
      await expect(auth.authenticate(third.sessionToken)).resolves.toBeNull();
      now = new Date("2026-09-09T13:56:00.000Z");
      await expect(auth.authenticate(second.sessionToken)).resolves.toBeNull();
      const events = await pool.query<{ action: string }>(
        "SELECT action FROM auth_session_audit_events WHERE actor_id = $1 ORDER BY occurred_at",
        [actorId],
      );
      expect(events.rows).toEqual([
        { action: "auth.session_rotated.v1" },
        { action: "auth.session_revoked.v1" },
        { action: "auth.sessions_revoked_others.v1" },
      ]);
      await expect(
        pool.query(
          "DELETE FROM auth_session_audit_events WHERE actor_id = $1",
          [actorId],
        ),
      ).rejects.toThrow("append-only");
    },
    120_000,
  );

  runPostgresIntegration(
    "persists and replays idempotent mutation responses",
    async () => {
      const store = new PostgresIdempotencyStore(pool);
      const input = {
        actorId: "idempotency@example.test",
        operation: "initiative.create",
        key: randomUUID(),
        requestHash: "request-hash",
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      expect(await store.reserve(input)).toEqual({ kind: "claimed" });
      await store.complete({
        ...input,
        response: { statusCode: 201, body: { id: randomUUID() } },
      });
      await expect(store.reserve(input)).resolves.toMatchObject({
        kind: "completed",
        response: { statusCode: 201 },
      });
      await expect(
        store.reserve({ ...input, requestHash: "different-request" }),
      ).resolves.toEqual({ kind: "key_reused" });
      const pending = { ...input, key: randomUUID(), requestHash: "pending" };
      const concurrentReservations = await Promise.all([
        store.reserve(pending),
        store.reserve(pending),
      ]);
      expect(concurrentReservations).toEqual(
        expect.arrayContaining([{ kind: "claimed" }, { kind: "in_progress" }]),
      );
      await store.abandon(pending);
      await expect(store.reserve(pending)).resolves.toEqual({
        kind: "claimed",
      });
    },
  );

  runPostgresIntegration(
    "deduplicates notifications by recipient and event key",
    async () => {
      const tenants = new TenantService({
        store: new PostgresTenantStore(pool),
        ids: { next: randomUUID },
        tokens: {
          generate: () => "notification-token",
          hash: (value) => value,
        },
        clock: { now: () => new Date("2026-09-17T12:00:00.000Z") },
      });
      const owner = "notifications-owner@example.test";
      const organization = await tenants.createOrganization({
        actorId: owner,
        actorEmail: owner,
        name: "Notification integration",
        timezone: "UTC",
        locale: "es-CL",
      });
      const workspace = await tenants.createWorkspace({
        actorId: owner,
        organizationId: organization.id,
        name: "Notifications",
        mode: "institutional",
      });
      const notifications = new NotificationService({
        store: new PostgresNotificationStore(pool),
        tenancy: new PostgresTenantStore(pool),
        ids: { next: randomUUID },
        clock: { now: () => new Date("2026-09-17T12:00:00.000Z") },
      });
      const input = {
        organizationId: organization.id,
        workspaceId: workspace.id,
        recipientActorId: owner,
        eventKey: `notification.integration.v1:${randomUUID()}`,
        resourceType: "project" as const,
        resourceId: randomUUID(),
        title: "Actualización disponible",
      };

      const first = await notifications.notify(input);
      const duplicate = await notifications.notify(input);

      expect(duplicate).toEqual(first);
      await expect(
        notifications.inbox({
          actorId: owner,
          organizationId: organization.id,
        }),
      ).resolves.toEqual([first]);
    },
  );

  runPostgresIntegration(
    "isolates tenants and persists project plus outbox event atomically",
    async () => {
      const ids = { next: randomUUID };
      const clock = { now: () => new Date() };
      const tenantStore = new PostgresTenantStore(pool);
      const initiativesStore = new PostgresInitiativeStore(pool);
      const initiativeAudit = new PostgresInitiativeAuditStore(pool);
      const evaluationsStore = new PostgresEvaluationStore(pool);
      const projectStore = new PostgresProjectStore(pool);
      const tenantService = new TenantService({
        store: tenantStore,
        ids,
        tokens: { generate: randomUUID, hash: (value) => `hash:${value}` },
        clock,
      });
      const initiativeService = new InitiativeService({
        store: initiativesStore,
        audit: initiativeAudit,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const evaluationService = new EvaluationService({
        standards: new PostgresEvaluationStandardStore(pool),
        evaluations: evaluationsStore,
        initiatives: initiativesStore,
        audit: initiativeAudit,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const projectService = new ProjectService({
        projects: projectStore,
        execution: new PostgresProjectExecutionStore(pool),
        closures: new PostgresProjectClosureStore(pool),
        documents: new PostgresDocumentStore(pool),
        audit: new PostgresProjectAuditStore(pool),
        decisions: evaluationsStore,
        initiatives: initiativesStore,
        tenancy: tenantStore,
        ids,
        clock,
      });

      const owner = "owner@example.test";
      const organization = await tenantService.createOrganization({
        actorId: owner,
        actorEmail: owner,
        name: "Aether integration",
        timezone: "UTC",
        locale: "es-CL",
      });
      const workspace = await tenantService.createWorkspace({
        actorId: owner,
        organizationId: organization.id,
        name: "Estrategia",
        mode: "institutional",
      });
      const otherWorkspace = await tenantService.createWorkspace({
        actorId: owner,
        organizationId: organization.id,
        name: "Otro contexto",
        mode: "institutional",
      });
      const invited = await tenantService.invite({
        actorId: owner,
        organizationId: organization.id,
        email: "lead@example.test",
        organizationRole: "member",
        workspaceIds: [workspace.id],
        workspaceRole: "member",
        expiresInDays: 1,
      });
      await tenantService.acceptInvitation({
        actorId: "lead@example.test",
        actorEmail: "lead@example.test",
        token: invited.deliveryToken,
      });
      const reviewerInvitation = await tenantService.invite({
        actorId: owner,
        organizationId: organization.id,
        email: "reviewer@example.test",
        organizationRole: "admin",
        workspaceIds: [],
        workspaceRole: "viewer",
        expiresInDays: 1,
      });
      await tenantService.acceptInvitation({
        actorId: "reviewer@example.test",
        actorEmail: "reviewer@example.test",
        token: reviewerInvitation.deliveryToken,
      });

      const draft = await initiativeService.create({
        actorId: owner,
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: randomUUID(),
        title: "Reducir tiempos de espera",
        problemStatement: "La atención tarda demasiado.",
        expectedOutcome: "Reducir la mediana de espera.",
        classification: "internal",
        requestedPriority: "medium",
      });
      const diagnostics = new DiagnosticService({
        store: new PostgresDiagnosticStore(pool),
        initiatives: initiativesStore,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const diagnostic = await diagnostics.save({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        expectedVersion: null,
        correlationId: randomUUID(),
        beneficiaries: ["Personas que esperan atención"],
        causes: [
          {
            kind: "evidence",
            text: "La mediana supera treinta días",
            source: "Registro de atención",
          },
        ],
        constraints: [],
        previousAttempts: [],
        hypotheses: [],
        scope: "Solicitudes internas del área de atención",
        risks: [],
        resources: ["Equipo de atención"],
        nextExperiment: "Probar clasificación inicial durante una semana",
      });
      await expect(
        diagnostics.get({
          actorId: owner,
          organizationId: organization.id,
          initiativeId: draft.id,
        }),
      ).resolves.toMatchObject({
        id: diagnostic.id,
        scope: "Solicitudes internas del área de atención",
      });
      await expect(
        pool.query(
          "UPDATE initiative_diagnostics SET causes = $1 WHERE initiative_id = $2",
          [
            JSON.stringify([
              { kind: "evidence", text: "Sin fuente", source: null },
            ]),
            draft.id,
          ],
        ),
      ).rejects.toThrow("invalid diagnostic entry");
      const relatedInitiative = await initiativeService.create({
        actorId: owner,
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: randomUUID(),
        title: "Iniciativa relacionada",
        problemStatement: "Otra necesidad del mismo contexto.",
        expectedOutcome: "Conservar la trazabilidad.",
        classification: "internal",
        requestedPriority: "low",
      });
      const relationships = new InitiativeRelationshipService({
        relationships: new PostgresInitiativeRelationshipStore(pool),
        initiatives: initiativesStore,
        audit: initiativeAudit,
        tenancy: tenantStore,
        ids,
        clock,
      });
      await relationships.declare({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        expectedVersion: draft.version,
        targetInitiativeId: relatedInitiative.id,
        kind: "related",
        correlationId: randomUUID(),
      });
      await expect(
        relationships.declare({
          actorId: owner,
          organizationId: organization.id,
          initiativeId: draft.id,
          expectedVersion: draft.version + 1,
          targetInitiativeId: relatedInitiative.id,
          kind: "related",
          correlationId: randomUUID(),
        }),
      ).rejects.toThrow();
      const afterRelationship = await initiativesStore.findById(draft.id);
      expect(afterRelationship).toMatchObject({
        requestedPriority: "medium",
        operationalPriority: null,
        version: draft.version + 1,
      });
      await expect(
        pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM initiative_audit_events
           WHERE initiative_id = $1 AND event_type = 'initiative.relationship_declared.v1'`,
          [draft.id],
        ),
      ).resolves.toMatchObject({ rows: [{ count: "1" }] });
      const reprioritized = await initiativeService.setOperationalPriority({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        correlationId: randomUUID(),
        expectedVersion: afterRelationship!.version,
        operationalPriority: "high",
      });
      expect(await initiativesStore.findById(draft.id)).toMatchObject({
        requestedPriority: "medium",
        operationalPriority: "high",
        version: reprioritized.version,
      });
      await expect(
        initiativeService.list({
          actorId: "outsider@example.test",
          organizationId: organization.id,
          workspaceId: workspace.id,
        }),
      ).rejects.toBeInstanceOf(AccessDeniedError);

      const presented = await initiativeService.present({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        correlationId: randomUUID(),
        expectedVersion: reprioritized.version,
      });
      const intakeAssignments = new PostgresIntakeAssignmentStore(pool);
      const intakeService = new IntakeService({
        assignments: intakeAssignments,
        initiatives: initiativesStore,
        tenancy: tenantStore,
        ids,
        clock,
      });
      expect(
        await intakeService.listUnassigned({
          actorId: owner,
          organizationId: organization.id,
        }),
      ).toEqual([expect.objectContaining({ initiativeId: draft.id })]);
      const intakeAssignment = await intakeService.assign({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        expectedVersion: presented.version,
        responsibleActorId: "lead@example.test",
        nextReviewOn: "2026-09-24",
        correlationId: randomUUID(),
      });
      expect(
        await intakeAssignments.findActiveByInitiative(draft.id),
      ).toMatchObject({ id: intakeAssignment.id, nextReviewOn: "2026-09-24" });
      await expect(
        pool.query(
          "UPDATE initiative_intake_assignments SET next_review_on = '2026-09-25' WHERE id = $1",
          [intakeAssignment.id],
        ),
      ).rejects.toThrow("initiative intake assignments are append-only");
      await expect(
        pool.query("DELETE FROM initiative_intake_assignments WHERE id = $1", [
          intakeAssignment.id,
        ]),
      ).rejects.toThrow("initiative intake assignments are append-only");
      await expect(
        pool.query(
          "UPDATE organization_memberships SET status = 'suspended' WHERE organization_id = $1 AND actor_id = $2",
          [organization.id, "lead@example.test"],
        ),
      ).rejects.toThrow(
        "reassign or close intake responsibilities before revoking membership",
      );
      await expect(
        pool.query(
          `INSERT INTO initiative_intake_assignments
           (id, organization_id, workspace_id, initiative_id,
            responsible_actor_id, assigned_by_actor_id, assigned_at, next_review_on)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),'2026-09-24')`,
          [
            randomUUID(),
            organization.id,
            otherWorkspace.id,
            draft.id,
            owner,
            owner,
          ],
        ),
      ).rejects.toThrow(
        "intake assignment must preserve presented initiative scope and active responsibility",
      );
      await expect(
        intakeService.listUnassigned({
          actorId: owner,
          organizationId: organization.id,
        }),
      ).resolves.toEqual([]);
      const triageStore = new PostgresTriageStore(pool);
      const triageStandardStore = new PostgresTriageStandardStore(pool);
      const triageService = new TriageService({
        standards: triageStandardStore,
        triages: triageStore,
        initiatives: initiativesStore,
        tenancy: tenantStore,
        ids,
        clock,
      });
      const triageCriterionId = randomUUID();
      const triageStandard = await triageService.publishStandard({
        actorId: owner,
        organizationId: organization.id,
        name: "Triage inicial",
        version: 1,
        criteria: [
          {
            id: triageCriterionId,
            code: "SCOPE",
            name: "Alcance",
            description: "Alcance institucional verificable.",
            required: true,
          },
        ],
      });
      await expect(
        pool.query(
          `UPDATE triage_standards SET criteria = $1::jsonb WHERE id = $2`,
          [JSON.stringify([]), triageStandard.id],
        ),
      ).rejects.toThrow("published triage standards are immutable");
      await expect(
        pool.query("DELETE FROM triage_standards WHERE id = $1", [
          triageStandard.id,
        ]),
      ).rejects.toThrow("published triage standards are immutable");
      await expect(
        pool.query(
          `INSERT INTO initiative_triages
           (id, organization_id, workspace_id, initiative_id, initiative_version,
            standard_id, standard_version, criteria, assessed_by_actor_id, assessed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,NOW())`,
          [
            randomUUID(),
            organization.id,
            workspace.id,
            draft.id,
            presented.version,
            triageStandard.id,
            triageStandard.version,
            JSON.stringify([]),
            owner,
          ],
        ),
      ).rejects.toThrow(
        "triage requires an active standard with matching scope",
      );
      await triageService.activateStandard({
        actorId: owner,
        organizationId: organization.id,
        standardId: triageStandard.id,
      });
      const triage = await triageService.triage({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        expectedVersion: presented.version,
        standardId: triageStandard.id,
        results: [
          {
            criterionId: triageCriterionId,
            assessment: "pass",
            justification: ["El alcance está delimitado."],
          },
        ],
        correlationId: randomUUID(),
      });
      expect(await triageStore.findById(triage.id)).toMatchObject({
        initiativeVersion: presented.version,
        standardId: triageStandard.id,
        standardVersion: 1,
      });
      const atomicDraft = await initiativeService.create({
        actorId: owner,
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: randomUUID(),
        title: "Verificar rollback de evidencia",
        problemStatement: "La evidencia debe ser atómica.",
        expectedOutcome: "No quedan registros sin auditoría.",
        classification: "internal",
        requestedPriority: "low",
      });
      const atomicPresented = await initiativeService.present({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: atomicDraft.id,
        correlationId: randomUUID(),
        expectedVersion: atomicDraft.version,
      });
      const duplicateAuditEvent = {
        id: randomUUID(),
        eventType: "initiative.atomicity_probe.v1",
        organizationId: organization.id,
        workspaceId: workspace.id,
        initiativeId: atomicDraft.id,
        actorId: owner,
        correlationId: randomUUID(),
        occurredAt: new Date(),
        fromStatus: "presented" as const,
        toStatus: "presented" as const,
        payload: {},
      };
      await initiativeAudit.record(duplicateAuditEvent);
      const orphanedAssignmentId = randomUUID();
      await expect(
        intakeAssignments.createWithAudit({
          assignment: {
            id: orphanedAssignmentId,
            organizationId: organization.id,
            workspaceId: workspace.id,
            initiativeId: atomicDraft.id,
            responsibleActorId: "lead@example.test",
            assignedByActorId: owner,
            assignedAt: new Date(),
            nextReviewOn: "2026-09-25",
          },
          auditEvent: duplicateAuditEvent,
        }),
      ).rejects.toBeDefined();
      await expect(
        intakeAssignments.findActiveByInitiative(atomicDraft.id),
      ).resolves.toBeNull();
      const orphanedTriageId = randomUUID();
      await expect(
        triageStore.createWithAudit({
          triage: {
            id: orphanedTriageId,
            organizationId: organization.id,
            workspaceId: workspace.id,
            initiativeId: atomicDraft.id,
            initiativeVersion: atomicPresented.version,
            standardId: triageStandard.id,
            standardVersion: triageStandard.version,
            criteria: [],
            assessedByActorId: owner,
            assessedAt: new Date(),
          },
          auditEvent: duplicateAuditEvent,
        }),
      ).rejects.toBeDefined();
      await expect(triageStore.findById(orphanedTriageId)).resolves.toBeNull();
      await expect(
        pool.query(
          "UPDATE initiative_triages SET criteria = '[]'::jsonb WHERE id = $1",
          [triage.id],
        ),
      ).rejects.toThrow("initiative triages are append-only");
      await expect(
        pool.query("DELETE FROM initiative_triages WHERE id = $1", [triage.id]),
      ).rejects.toThrow("initiative triages are append-only");
      await expect(
        pool.query(
          `UPDATE triage_standards SET criteria = $1::jsonb WHERE id = $2`,
          [
            JSON.stringify([
              {
                id: randomUUID(),
                code: "ALTERED",
                name: "Criterio alterado",
                description: "No debe reescribir el triage existente.",
                required: true,
              },
            ]),
            triageStandard.id,
          ],
        ),
      ).rejects.toThrow("published triage standards are immutable");
      const unadoptedOrganization = await tenantService.createOrganization({
        actorId: owner,
        actorEmail: owner,
        name: "Organización sin adopción",
        timezone: "UTC",
        locale: "es-CL",
      });
      const unadoptedStandardId = randomUUID();
      await pool.query(
        `INSERT INTO triage_standards
         (id, organization_id, name, version, criteria, is_active, published_at, published_by_actor_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,FALSE,NOW(),$6)`,
        [
          unadoptedStandardId,
          unadoptedOrganization.id,
          "Estándar sin adopción",
          1,
          JSON.stringify([]),
          owner,
        ],
      );
      const activationClient = await pool.connect();
      try {
        await activationClient.query("BEGIN");
        await activationClient.query(
          "UPDATE triage_standards SET is_active = TRUE WHERE id = $1",
          [unadoptedStandardId],
        );
        await expect(activationClient.query("COMMIT")).rejects.toThrow(
          "an active triage standard requires an adoption",
        );
      } finally {
        await activationClient.query("ROLLBACK");
        activationClient.release();
      }
      await expect(
        pool.query(
          `INSERT INTO initiative_triages
           (id, organization_id, workspace_id, initiative_id, initiative_version,
            standard_id, standard_version, criteria, assessed_by_actor_id, assessed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,NOW())`,
          [
            randomUUID(),
            organization.id,
            otherWorkspace.id,
            draft.id,
            presented.version,
            triageStandard.id,
            triageStandard.version,
            JSON.stringify([]),
            owner,
          ],
        ),
      ).rejects.toThrow(
        "triage requires an active standard with matching scope",
      );
      const standard = await evaluationService.publishStandard({
        actorId: owner,
        organizationId: organization.id,
        name: "Estándar inicial",
        version: 1,
        criteria: [
          {
            id: randomUUID(),
            code: "IMPACT",
            name: "Impacto",
            description: "Impacto institucional verificable.",
            weight: 1,
          },
        ],
      });
      await evaluationService.activateStandard({
        actorId: owner,
        organizationId: organization.id,
        standardId: standard.id,
      });
      const initialAdoptions = await pool.query<{
        standard_id: string;
        adopted_by_actor_id: string;
      }>(
        `SELECT standard_id, adopted_by_actor_id
           FROM evaluation_standard_adoptions
          WHERE standard_id = $1`,
        [standard.id],
      );
      expect(initialAdoptions.rows).toEqual([
        { standard_id: standard.id, adopted_by_actor_id: owner },
      ]);
      const concurrentPublications = await Promise.allSettled(
        [0, 1].map(() =>
          evaluationService.publishStandard({
            actorId: owner,
            organizationId: organization.id,
            name: "Estándar publicado en paralelo",
            version: 1,
            criteria: [
              {
                id: randomUUID(),
                code: "PARALLEL",
                name: "Publicación concurrente",
                description: "Sólo una versión puede persistir.",
                weight: 1,
              },
            ],
          }),
        ),
      );
      expect(
        concurrentPublications.filter(
          (result) => result.status === "fulfilled",
        ),
      ).toHaveLength(1);
      expect(
        concurrentPublications.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      await evaluationService.assignReviewer({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        reviewerActorId: "reviewer@example.test",
        correlationId: randomUUID(),
      });
      await expect(
        pool.query(
          `INSERT INTO initiative_evaluation_reviewer_assignments (id, organization_id, workspace_id, initiative_id, assigned_actor_id, assigned_by_actor_id, assigned_at, status, status_changed_at, status_changed_by_actor_id, reason)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),'assigned',NOW(),$6,NULL)`,
          [
            randomUUID(),
            organization.id,
            otherWorkspace.id,
            draft.id,
            "reviewer@example.test",
            owner,
          ],
        ),
      ).rejects.toThrow(
        "evaluation reviewer assignment must preserve initiative scope",
      );
      const evaluation = await evaluationService.review({
        actorId: "reviewer@example.test",
        organizationId: organization.id,
        initiativeId: draft.id,
        standardId: standard.id,
        expectedVersion: presented.version,
        correlationId: randomUUID(),
        results: [
          {
            criterionId: standard.criteria[0]!.id,
            assessment: "met",
            evidence: ["Indicador confirmado."],
          },
        ],
      });
      const replacementStandard = await evaluationService.publishStandard({
        actorId: owner,
        organizationId: organization.id,
        name: standard.name,
        version: 2,
        criteria: [
          {
            id: randomUUID(),
            code: "IMPACT_V2",
            name: "Impacto revisado",
            description: "Una nueva versión no altera la evaluación previa.",
            weight: 2,
          },
        ],
      });
      await evaluationService.activateStandard({
        actorId: owner,
        organizationId: organization.id,
        standardId: replacementStandard.id,
      });
      const replacementAdoptions = await pool.query<{
        standard_id: string;
        adopted_by_actor_id: string;
      }>(
        `SELECT standard_id, adopted_by_actor_id
           FROM evaluation_standard_adoptions
          WHERE standard_id = $1`,
        [replacementStandard.id],
      );
      expect(replacementAdoptions.rows).toEqual([
        { standard_id: replacementStandard.id, adopted_by_actor_id: owner },
      ]);
      const persistedEvaluation = await evaluationsStore.findEvaluation(
        evaluation.id,
      );
      expect(persistedEvaluation).toMatchObject({
        standardId: standard.id,
        standardVersion: 1,
        criteria: [
          expect.objectContaining({ criterion: standard.criteria[0] }),
        ],
      });
      const annulmentDraft = await initiativeService.create({
        actorId: owner,
        organizationId: organization.id,
        workspaceId: workspace.id,
        correlationId: randomUUID(),
        title: "Evaluación que requiere nueva evidencia",
        problemStatement: "La evidencia de evaluación debe revisarse.",
        expectedOutcome: "Reabrir la revisión antes de decidir.",
        classification: "internal",
        requestedPriority: "medium",
      });
      const annulmentPresented = await initiativeService.present({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: annulmentDraft.id,
        correlationId: randomUUID(),
        expectedVersion: annulmentDraft.version,
      });
      await evaluationService.assignReviewer({
        actorId: owner,
        organizationId: organization.id,
        initiativeId: annulmentDraft.id,
        reviewerActorId: "reviewer@example.test",
        correlationId: randomUUID(),
      });
      const annulmentEvaluation = await evaluationService.review({
        actorId: "reviewer@example.test",
        organizationId: organization.id,
        initiativeId: annulmentDraft.id,
        standardId: replacementStandard.id,
        expectedVersion: annulmentPresented.version,
        correlationId: randomUUID(),
        results: [
          {
            criterionId: replacementStandard.criteria[0]!.id,
            assessment: "met",
            evidence: ["Evidencia que requiere contraste."],
          },
        ],
      });
      const annulledEvaluation = await evaluationService.annulEvaluation({
        actorId: owner,
        organizationId: organization.id,
        evaluationId: annulmentEvaluation.id,
        reason: "La evidencia debe completarse antes de la decisión.",
        correlationId: randomUUID(),
      });
      expect(
        await evaluationsStore.findEvaluation(annulledEvaluation.id),
      ).toMatchObject({
        annulledByActorId: owner,
        annulledAt: annulledEvaluation.annulledAt,
        annulmentReason: "La evidencia debe completarse antes de la decisión.",
      });
      await expect(
        evaluationService.decide({
          actorId: owner,
          organizationId: organization.id,
          initiativeId: annulmentDraft.id,
          evaluationId: annulledEvaluation.id,
          expectedVersion: annulmentPresented.version + 1,
          outcome: "approved",
          rationale: "No debe decidirse una evaluación anulada.",
          evidence: ["Acta."],
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "EVALUATION_ANNULLED" });
      await expect(
        pool.query(
          `INSERT INTO initiative_decisions (id, organization_id, workspace_id, initiative_id, evaluation_id, outcome, rationale, evidence, standard_id, standard_version, coverage, decided_by_actor_id, decided_at)
           VALUES ($1,$2,$3,$4,$5,'approved','Evaluación anulada','[]',$6,$7,$8::jsonb,$9,NOW())`,
          [
            randomUUID(),
            organization.id,
            workspace.id,
            annulmentDraft.id,
            annulledEvaluation.id,
            replacementStandard.id,
            replacementStandard.version,
            JSON.stringify(annulledEvaluation.coverage),
            owner,
          ],
        ),
      ).rejects.toThrow("decision cannot reference an annulled evaluation");
      const reviewing = await initiativesStore.findById(draft.id);
      await expect(
        pool.query(
          "UPDATE evaluation_standards SET criteria = $1::jsonb WHERE id = $2",
          [
            JSON.stringify([
              {
                id: randomUUID(),
                code: "ALTERED",
                name: "Criterio alterado",
                description: "No debe reescribir la evaluación existente.",
                weight: 1,
              },
            ]),
            standard.id,
          ],
        ),
      ).rejects.toThrow(
        "an evaluation standard cannot change after it is applied",
      );
      const decisionInput = {
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        evaluationId: evaluation.id,
        expectedVersion: reviewing!.version,
        outcome: "approved" as const,
        rationale: "Evidencia suficiente.",
        evidence: ["Acta."],
        conditions: [
          {
            description: "Validar el resultado del piloto.",
            responsibleActorId: "lead@example.test",
            dueOn: "2026-10-01",
          },
          {
            description: "Formalizar el alcance inicial.",
            responsibleActorId: "lead@example.test",
            dueOn: "2026-10-02",
          },
        ],
      };
      const decisionAttempts = await Promise.allSettled([
        evaluationService.decide({
          ...decisionInput,
          correlationId: randomUUID(),
        }),
        evaluationService.decide({
          ...decisionInput,
          correlationId: randomUUID(),
        }),
      ]);
      expect(
        decisionAttempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        decisionAttempts.find((result) => result.status === "rejected")?.reason,
      ).toBeInstanceOf(InitiativeVersionConflictError);
      const successfulDecision = decisionAttempts.find(
        (result) => result.status === "fulfilled",
      );
      if (!successfulDecision || successfulDecision.status !== "fulfilled")
        throw new Error("An approved decision was expected");
      const decision = successfulDecision.value;
      await expect(
        pool.query(
          `UPDATE initiative_evaluations
              SET annulled_by_actor_id = $1,
                  annulled_at = NOW(),
                  annulment_reason = 'No debe permitirse por SQL directo.'
            WHERE id = $2`,
          [owner, evaluation.id],
        ),
      ).rejects.toThrow("an evaluation with a decision cannot be annulled");
      const persistedQuality = await pool.query<{
        evaluation_quality: typeof evaluation.quality;
        decision_quality: typeof decision.quality;
      }>(
        `SELECT evaluation.quality AS evaluation_quality,
                decision.quality AS decision_quality
           FROM initiative_evaluations evaluation
           JOIN initiative_decisions decision ON decision.evaluation_id = evaluation.id
          WHERE decision.id = $1`,
        [decision.id],
      );
      expect(persistedQuality.rows[0]).toEqual({
        evaluation_quality: evaluation.quality,
        decision_quality: decision.quality,
      });
      await expect(
        pool.query(
          `INSERT INTO initiative_decisions (id, organization_id, workspace_id, initiative_id, evaluation_id, outcome, rationale, evidence, standard_id, standard_version, coverage, decided_by_actor_id, decided_at)
           VALUES ($1,$2,$3,$4,$5,'approved','Versión alterada','[]',$6,2,'{}',$7,NOW())`,
          [
            randomUUID(),
            organization.id,
            workspace.id,
            draft.id,
            evaluation.id,
            standard.id,
            owner,
          ],
        ),
      ).rejects.toThrow(
        "decision must preserve the evaluated initiative and standard version",
      );
      await expect(
        pool.query(
          `INSERT INTO projects (id, organization_id, workspace_id, source_initiative_id, source_decision_id, name, sponsor_actor_id, lead_actor_id, participants, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'Proyecto inconsistente',$6,$7,'[]','planned',NOW(),NOW())`,
          [
            randomUUID(),
            organization.id,
            otherWorkspace.id,
            draft.id,
            decision.id,
            owner,
            "lead@example.test",
          ],
        ),
      ).rejects.toThrow(
        "project source initiative and decision must share organization and workspace",
      );
      const persistedDecision = await evaluationsStore.findDecision(
        decision.id,
      );
      expect(persistedDecision?.conditions).toMatchObject([
        {
          description: "Validar el resultado del piloto.",
          responsibleActorId: "lead@example.test",
          status: "pending",
        },
        {
          description: "Formalizar el alcance inicial.",
          responsibleActorId: "lead@example.test",
          status: "pending",
        },
      ]);
      const projectInput = {
        actorId: owner,
        organizationId: organization.id,
        initiativeId: draft.id,
        decisionId: decision.id,
        name: "Proyecto de espera",
        objective: "Reducir la espera de atención.",
        boundaries: "Solicitudes internas priorizadas.",
        successCriteria: "Reducir la mediana de espera.",
        nextMilestone: "Validar el piloto.",
        sponsorActorId: owner,
        leadActorId: "lead@example.test",
        participants: [
          { actorId: owner, role: "sponsor" },
          { actorId: "lead@example.test", role: "lead" },
        ] as const,
      };
      await expect(
        projectService.createFromInitiative({
          ...projectInput,
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "DECISION_CONDITIONS_PENDING" });
      await evaluationService.fulfillCondition({
        actorId: "lead@example.test",
        organizationId: organization.id,
        decisionId: decision.id,
        conditionId: persistedDecision!.conditions![0]!.id,
        note: "El resultado del piloto fue validado.",
        correlationId: randomUUID(),
      });
      await evaluationService.exemptCondition({
        actorId: owner,
        organizationId: organization.id,
        decisionId: decision.id,
        conditionId: persistedDecision!.conditions![1]!.id,
        reason: "La validación se incorporó al alcance inicial.",
        correlationId: randomUUID(),
      });
      expect(
        (await evaluationsStore.findDecision(decision.id))?.conditions,
      ).toMatchObject([
        {
          status: "fulfilled",
          resolvedByActorId: "lead@example.test",
          resolutionNote: "El resultado del piloto fue validado.",
        },
        {
          status: "exempted",
          resolvedByActorId: owner,
          resolutionNote: "La validación se incorporó al alcance inicial.",
        },
      ]);
      const duplicateEventId = randomUUID();
      await pool.query(
        `INSERT INTO outbox_events (event_id, event_type, occurred_at, aggregate_id, aggregate_type, aggregate_version, organization_id, correlation_id, causation_id, schema_version, payload)
         VALUES ($1, 'project.created.v1', NOW(), $2, 'project', 1, $3, $4, NULL, 1, '{}')`,
        [duplicateEventId, randomUUID(), organization.id, randomUUID()],
      );
      const failedConversionProject = {
        id: randomUUID(),
        organizationId: organization.id,
        workspaceId: workspace.id,
        sourceInitiativeId: draft.id,
        sourceDecisionId: decision.id,
        name: "Proyecto que debe revertirse",
        objective: null,
        boundaries: null,
        successCriteria: null,
        nextMilestone: null,
        sponsorActorId: owner,
        leadActorId: "lead@example.test",
        participants: [
          { actorId: owner, role: "sponsor" },
          { actorId: "lead@example.test", role: "lead" },
        ] as const,
        status: "planned" as const,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await expect(
        projectStore.createWithEventAndAudit!({
          project: failedConversionProject,
          event: {
            eventId: duplicateEventId,
            eventType: "project.created.v1",
            occurredAt: new Date(),
            aggregateId: failedConversionProject.id,
            aggregateType: "project",
            aggregateVersion: 0,
            organizationId: organization.id,
            correlationId: randomUUID(),
            causationId: null,
            schemaVersion: 1,
            payload: {},
          },
          auditEvent: {
            id: randomUUID(),
            eventType: "project.created_from_initiative.v1",
            organizationId: organization.id,
            workspaceId: workspace.id,
            projectId: failedConversionProject.id,
            actorId: owner,
            correlationId: randomUUID(),
            occurredAt: new Date(),
            payload: {},
          },
        }),
      ).rejects.toBeDefined();
      await expect(projectStore.findByInitiative(draft.id)).resolves.toBeNull();
      await pool.query("DELETE FROM outbox_events WHERE event_id = $1", [
        duplicateEventId,
      ]);
      const projectAttempts = await Promise.allSettled([
        projectService.createFromInitiative({
          ...projectInput,
          correlationId: randomUUID(),
        }),
        projectService.createFromInitiative({
          ...projectInput,
          correlationId: randomUUID(),
        }),
      ]);
      expect(
        projectAttempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(2);
      const successfulProjects = projectAttempts.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      expect(
        new Set(successfulProjects.map((project) => project.id)).size,
      ).toBe(1);
      const project = successfulProjects[0];
      if (!project) throw new Error("A project was expected");
      await expect(
        projectService.createFromInitiative({
          ...projectInput,
          name: "Conversión no canónica",
          correlationId: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(ProjectAlreadyExistsError);

      const events = await pool.query<{ event_type: string; status: string }>(
        "SELECT event_type, status FROM outbox_events WHERE aggregate_id = $1",
        [project.id],
      );
      expect(events.rows).toEqual([
        { event_type: "project.created.v1", status: "pending" },
      ]);
      const audit = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM project_audit_events WHERE project_id = $1",
        [project.id],
      );
      expect(audit.rows).toEqual([
        { event_type: "project.created_from_initiative.v1" },
      ]);

      const handled: string[] = [];
      const worker = new OutboxWorker({
        store: new PostgresOutboxStore(pool),
        handler: { handle: async (event) => void handled.push(event.eventId) },
        clock,
        workerId: "integration-worker",
        consumer: "integration-test.v1",
        maxAttempts: 3,
        lockTimeoutSeconds: 60,
      });
      await worker.processOnce();
      expect(handled).toHaveLength(1);
      const processed = await pool.query<{ status: string }>(
        "SELECT status FROM outbox_events WHERE aggregate_id = $1",
        [project.id],
      );
      expect(processed.rows).toEqual([{ status: "processed" }]);
      const consumptions = await pool.query(
        "SELECT 1 FROM outbox_consumptions WHERE consumer = 'integration-test.v1'",
      );
      expect(consumptions.rowCount).toBe(1);

      const change = await projectService.requestChange({
        actorId: "lead@example.test",
        organizationId: organization.id,
        projectId: project.id,
        title: "Ampliar la cobertura",
        reason: "La evidencia exige incluir un canal adicional.",
        impact: "Cambiará el próximo hito y la carga estimada.",
        correlationId: randomUUID(),
      });
      await expect(
        pool.query("SELECT 1 FROM project_baselines WHERE project_id = $1", [
          project.id,
        ]),
      ).resolves.toMatchObject({ rowCount: 0 });
      const reviews = await Promise.allSettled([
        projectService.reviewChangeRequest({
          actorId: owner,
          organizationId: organization.id,
          projectId: project.id,
          changeRequestId: change.id,
          outcome: "approved",
          reviewNote: "La ampliación tiene respaldo suficiente.",
          correlationId: randomUUID(),
        }),
        projectService.reviewChangeRequest({
          actorId: "reviewer@example.test",
          organizationId: organization.id,
          projectId: project.id,
          changeRequestId: change.id,
          outcome: "rejected",
          reviewNote: "No debe resolverse dos veces la misma solicitud.",
          correlationId: randomUUID(),
        }),
      ]);
      expect(
        reviews.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        reviews.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const reviewedChange = await pool.query<{
        status: "approved" | "rejected";
        reviewed_by_actor_id: string;
      }>(
        `SELECT status, reviewed_by_actor_id FROM project_change_requests WHERE id = $1`,
        [change.id],
      );
      expect(reviewedChange.rows).toHaveLength(1);
      expect(reviewedChange.rows[0]?.status).toBe("approved");
      const baseline = await pool.query<{
        version: number;
        approved_by_actor_id: string;
      }>(
        `SELECT version, approved_by_actor_id FROM project_baselines WHERE change_request_id = $1`,
        [change.id],
      );
      expect(baseline.rows).toEqual([
        { version: 1, approved_by_actor_id: owner },
      ]);
      await expect(
        projectService.baselineDifference({
          actorId: "lead@example.test",
          organizationId: organization.id,
          projectId: project.id,
          correlationId: randomUUID(),
        }),
      ).resolves.toMatchObject({
        baseline: { version: 1, snapshot: { id: project.id } },
        differences: [],
      });
    },
    120_000,
  );
});
