import type { Comment, CommentStore } from "@aether/application";

export class InMemoryCommentStore implements CommentStore {
  readonly comments = new Map<string, Comment>();

  async create(comment: Comment): Promise<void> {
    this.comments.set(comment.id, comment);
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

  async update(comment: Comment): Promise<boolean> {
    if (!this.comments.has(comment.id)) return false;
    this.comments.set(comment.id, comment);
    return true;
  }

  async find(id: string): Promise<Comment | null> {
    const comment = this.comments.get(id);
    return comment?.deletedAt === null ? comment : null;
  }
}
