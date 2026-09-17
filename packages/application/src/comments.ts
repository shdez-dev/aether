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
export interface CommentStore {
  create(comment: Comment): Promise<void>;
  list(input: {
    organizationId: string;
    resourceType: DocumentResourceType;
    resourceId: string;
  }): Promise<readonly Comment[]>;
  update(comment: Comment): Promise<boolean>;
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
      await this.requireAccess(
        actorId,
        input.resourceType,
        input.resourceId,
      );
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
    await this.d.store.create(comment);
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
    if (!(await this.d.store.update(updated)))
      throw new Error("COMMENT_CONFLICT");
    return updated;
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
