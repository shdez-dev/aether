import { AccessDeniedError, type TenantStore } from "./tenancy.js";
import type { DocumentProjectAccess } from "./documents.js";

export type Notification = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  recipientActorId: string;
  eventKey: string;
  resourceType: "initiative" | "evaluation" | "decision" | "project";
  resourceId: string;
  title: string;
  createdAt: Date;
  readAt: Date | null;
}>;
export type NotificationPreference = Readonly<{
  actorId: string;
  organizationId: string;
  emailEnabled: boolean;
  updatedAt: Date;
}>;
export interface NotificationStore {
  create(notification: Notification): Promise<Notification>;
  find(input: { id: string; actorId: string }): Promise<Notification | null>;
  list(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Notification[]>;
  markRead(input: {
    id: string;
    actorId: string;
    readAt: Date;
  }): Promise<Notification | null>;
  setPreference(preference: NotificationPreference): Promise<void>;
  getPreference(input: {
    actorId: string;
    organizationId: string;
  }): Promise<NotificationPreference | null>;
}
export class NotificationService {
  constructor(
    private readonly dependencies: {
      store: NotificationStore;
      tenancy: TenantStore;
      projects?: DocumentProjectAccess;
      ids: { next(): string };
      clock: { now(): Date };
    },
  ) {}
  async notify(
    input: Omit<Notification, "id" | "createdAt" | "readAt">,
  ): Promise<Notification> {
    if (
      !(await this.dependencies.tenancy.findOrganizationRole({
        actorId: input.recipientActorId,
        organizationId: input.organizationId,
      }))
    )
      throw new AccessDeniedError("organization:read");
    return this.dependencies.store.create({
      ...input,
      id: this.dependencies.ids.next(),
      createdAt: this.dependencies.clock.now(),
      readAt: null,
    });
  }
  async inbox(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Notification[]> {
    if (!(await this.dependencies.tenancy.findOrganizationRole(input)))
      throw new AccessDeniedError("organization:read");
    const items = await this.dependencies.store.list(input);
    return (
      await Promise.all(
        items.map(async (item) => ({
          item,
          allowed: await this.canOpen(input.actorId, item),
        })),
      )
    ).flatMap(({ item, allowed }) => (allowed ? [item] : []));
  }
  async read(input: {
    actorId: string;
    notificationId: string;
  }): Promise<Notification> {
    const existing = await this.dependencies.store.find({
      id: input.notificationId,
      actorId: input.actorId,
    });
    if (!existing || !(await this.canOpen(input.actorId, existing)))
      throw new AccessDeniedError("organization:read");
    const notification = await this.dependencies.store.markRead({
      id: input.notificationId,
      actorId: input.actorId,
      readAt: this.dependencies.clock.now(),
    });
    if (!notification) throw new AccessDeniedError("organization:read");
    return notification;
  }
  async setEmailPreference(input: {
    actorId: string;
    organizationId: string;
    emailEnabled: boolean;
  }): Promise<void> {
    if (!(await this.dependencies.tenancy.findOrganizationRole(input)))
      throw new AccessDeniedError("organization:read");
    await this.dependencies.store.setPreference({
      ...input,
      updatedAt: this.dependencies.clock.now(),
    });
  }
  private async canOpen(
    actorId: string,
    notification: Notification,
  ): Promise<boolean> {
    const role = await this.dependencies.tenancy.findOrganizationRole({
      actorId,
      organizationId: notification.organizationId,
    });
    if (role === "owner" || role === "admin") return true;
    if (
      !(await this.dependencies.tenancy.findWorkspaceRole({
        actorId,
        workspaceId: notification.workspaceId,
      }))
    )
      return false;
    return notification.resourceType !== "project"
      ? true
      : Boolean(
          await this.dependencies.projects?.isParticipant({
            actorId,
            projectId: notification.resourceId,
          }),
        );
  }
}
