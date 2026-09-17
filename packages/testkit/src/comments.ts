import type {
  Comment,
  CommentAuditEvent,
  CommentStore,
} from "@aether/application";

export class InMemoryCommentStore implements CommentStore {
  readonly comments = new Map<string, Comment>();
  readonly audits: CommentAuditEvent[] = [];

  async create(input: {
    comment: Comment;
    audit: CommentAuditEvent;
  }): Promise<void> {
    this.comments.set(input.comment.id, input.comment);
    this.audits.push(input.audit);
  }

  async list(input: {
    organizationId: string;
    resourceType: Comment["resourceType"];
    resourceId: string;
  }): Promise<readonly Comment[]> {
    return [...this.comments.values()]
      .filter(
        (comment) =>
          comment.organizationId === input.organizationId &&
          comment.resourceType === input.resourceType &&
          comment.resourceId === input.resourceId &&
          comment.deletedAt === null,
      )
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
  }

  async update(input: {
    comment: Comment;
    audit: CommentAuditEvent;
  }): Promise<boolean> {
    if (!this.comments.has(input.comment.id)) return false;
    this.comments.set(input.comment.id, input.comment);
    this.audits.push(input.audit);
    return true;
  }

  async find(id: string): Promise<Comment | null> {
    const comment = this.comments.get(id);
    return comment?.deletedAt === null ? comment : null;
  }
}
