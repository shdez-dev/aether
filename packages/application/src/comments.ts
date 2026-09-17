import type { DocumentResourceType } from "@aether/domain";
import { type DocumentProjectAccess, type DocumentStore } from "./documents.js";
import { type NotificationService } from "./notifications.js";
import {
  AccessDeniedError,
  assertWorkspaceWritable,
  type TenantStore,
} from "./tenancy.js";

export type Comment = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  resourceType: DocumentResourceType;
  resourceId: string;
  body: string;
  mentionedActorIds: readonly string[];
  authorActorId: string;
  createdAt: Date;
  editedAt: Date | null;
  resolvedAt: Date | null;
  resolvedByActorId: string | null;
  deletedAt: Date | null;
}>;
export type CommentAuditEvent = Readonly<{
  id: string;
  commentId: string;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  eventType:
    | "comment.created.v1"
    | "comment.edited.v1"
    | "comment.resolved.v1"
    | "comment.reopened.v1"
    | "comment.deleted.v1";
  correlationId: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
}>;
export interface CommentStore {
  create(input: { comment: Comment; audit: CommentAuditEvent }): Promise<void>;
  list(input: {
    organizationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<readonly Comment[]>;
  update(input: {
    comment: Comment;
    audit: CommentAuditEvent;
  }): Promise<boolean>;
  find(id: string): Promise<Comment | null>;
}
export class CommentService {
  constructor(
    private readonly d: {
      store: CommentStore;
      resources: DocumentStore;
      tenancy: TenantStore;
      projects?: DocumentProjectAccess;
      notifications?: NotificationService;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}
  async create(input: {
    actorId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
    body: string;
    mentionedActorIds: readonly string[];
    correlationId: string;
  }): Promise<Comment> {
    const resource = await this.requireAccess(
      input.actorId,
      input.resourceType,
      input.resourceId,
    );
    await assertWorkspaceWritable(this.d.tenancy, resource.workspaceId);
    for (const actorId of new Set(input.mentionedActorIds))
      await this.requireAccess(actorId, input.resourceType, input.resourceId);
    const now = this.d.clock.now();
    const comment: Comment = {
      id: this.d.ids.next(),
      ...resource,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      body: input.body,
      mentionedActorIds: [...new Set(input.mentionedActorIds)],
      authorActorId: input.actorId,
      createdAt: now,
      editedAt: null,
      resolvedAt: null,
      resolvedByActorId: null,
      deletedAt: null,
    };
    await this.d.store.create({
      comment,
      audit: this.auditFor(
        comment,
        input.actorId,
        input.correlationId,
        "comment.created.v1",
      ),
    });
    for (const actorId of comment.mentionedActorIds.filter(
      (id) => id !== input.actorId,
    ))
      await this.d.notifications?.notify({
        organizationId: comment.organizationId,
        workspaceId: comment.workspaceId,
        recipientActorId: actorId,
        eventKey: `comment.mentioned.v1:${comment.id}:${actorId}`,
        resourceType: comment.resourceType,
        resourceId: comment.resourceId,
        title: "Te mencionaron en una conversación",
      });
    return comment;
  }
  async list(input: {
    actorId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }) {
    await this.requireAccess(
      input.actorId,
      input.resourceType,
      input.resourceId,
    );
    const resource = await this.d.resources.resolveResource(input);
    return this.d.store.list({
      organizationId: resource!.organizationId,
      ...input,
    });
  }
  async resolve(input: {
    actorId: string;
    commentId: string;
    reopen?: boolean;
    correlationId: string;
  }): Promise<Comment> {
    const comment = await this.d.store.find(input.commentId);
    if (!comment) throw new Error("COMMENT_NOT_FOUND");
    await this.requireAccess(
      input.actorId,
      comment.resourceType,
      comment.resourceId,
    );
    await assertWorkspaceWritable(this.d.tenancy, comment.workspaceId);
    const updated = {
      ...comment,
      resolvedAt: input.reopen ? null : this.d.clock.now(),
      resolvedByActorId: input.reopen ? null : input.actorId,
    };
    if (
      !(await this.d.store.update({
        comment: updated,
        audit: this.auditFor(
          updated,
          input.actorId,
          input.correlationId,
          input.reopen ? "comment.reopened.v1" : "comment.resolved.v1",
        ),
      }))
    )
      throw new Error("COMMENT_CONFLICT");
    return updated;
  }
  async edit(input: {
    actorId: string;
    commentId: string;
    body: string;
    correlationId: string;
  }): Promise<Comment> {
    const comment = await this.d.store.find(input.commentId);
    if (!comment) throw new Error("COMMENT_NOT_FOUND");
    await this.requireAccess(
      input.actorId,
      comment.resourceType,
      comment.resourceId,
    );
    if (comment.authorActorId !== input.actorId)
      throw new AccessDeniedError("workspace:read");
    await assertWorkspaceWritable(this.d.tenancy, comment.workspaceId);
    const updated = {
      ...comment,
      body: input.body,
      editedAt: this.d.clock.now(),
    };
    if (
      !(await this.d.store.update({
        comment: updated,
        audit: this.auditFor(
          updated,
          input.actorId,
          input.correlationId,
          "comment.edited.v1",
        ),
      }))
    )
      throw new Error("COMMENT_CONFLICT");
    return updated;
  }
  async delete(input: {
    actorId: string;
    commentId: string;
    correlationId: string;
  }): Promise<void> {
    const comment = await this.d.store.find(input.commentId);
    if (!comment) throw new Error("COMMENT_NOT_FOUND");
    await this.requireAccess(
      input.actorId,
      comment.resourceType,
      comment.resourceId,
    );
    const role = await this.d.tenancy.findOrganizationRole({
      actorId: input.actorId,
      organizationId: comment.organizationId,
    });
    if (
      comment.authorActorId !== input.actorId &&
      role !== "owner" &&
      role !== "admin"
    )
      throw new AccessDeniedError("workspace:read");
    await assertWorkspaceWritable(this.d.tenancy, comment.workspaceId);
    const updated = { ...comment, deletedAt: this.d.clock.now() };
    if (
      !(await this.d.store.update({
        comment: updated,
        audit: this.auditFor(
          updated,
          input.actorId,
          input.correlationId,
          "comment.deleted.v1",
        ),
      }))
    )
      throw new Error("COMMENT_CONFLICT");
  }
  private auditFor(
    comment: Comment,
    actorId: string,
    correlationId: string,
    eventType: CommentAuditEvent["eventType"],
  ): CommentAuditEvent {
    return {
      id: this.d.ids.next(),
      commentId: comment.id,
      organizationId: comment.organizationId,
      workspaceId: comment.workspaceId,
      actorId,
      eventType,
      correlationId,
      occurredAt: this.d.clock.now(),
      payload: {},
    };
  }
  private async requireAccess(
    actorId: string,
    resourceType: DocumentResourceType,
    resourceId: string,
  ) {
    const resource = await this.d.resources.resolveResource({
      resourceType,
      resourceId,
    });
    if (!resource) throw new Error("COMMENT_RESOURCE_NOT_FOUND");
    const role = await this.d.tenancy.findOrganizationRole({
      actorId,
      organizationId: resource.organizationId,
    });
    const manager = role === "owner" || role === "admin";
    if (
      !role ||
      (!manager &&
        !(await this.d.tenancy.findWorkspaceRole({
          actorId,
          workspaceId: resource.workspaceId,
        })))
    )
      throw new AccessDeniedError("workspace:read");
    if (
      !manager &&
      resourceType === "project" &&
      !(await this.d.projects?.isParticipant({
        actorId,
        projectId: resourceId,
      }))
    )
      throw new AccessDeniedError("workspace:read");
    return resource;
  }
}
