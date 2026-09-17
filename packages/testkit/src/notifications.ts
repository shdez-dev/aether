import type {
  Notification,
  NotificationPreference,
  NotificationStore,
} from "@aether/application";

/** Store idempotente que reproduce la unicidad por destinatario y evento. */
export class InMemoryNotificationStore implements NotificationStore {
  readonly notifications = new Map<string, Notification>();
  readonly preferences = new Map<string, NotificationPreference>();
  private readonly notificationIdsByRecipientAndEvent = new Map<
    string,
    Map<string, string>
  >();

  async create(notification: Notification): Promise<Notification> {
    const existingByEvent = this.notificationIdsByRecipientAndEvent.get(
      notification.recipientActorId,
    );
    const existingId = existingByEvent?.get(notification.eventKey);
    if (existingId) return this.notifications.get(existingId)!;
    const byEvent = existingByEvent ?? new Map<string, string>();
    this.notifications.set(notification.id, notification);
    byEvent.set(notification.eventKey, notification.id);
    if (!existingByEvent)
      this.notificationIdsByRecipientAndEvent.set(
        notification.recipientActorId,
        byEvent,
      );
    return notification;
  }

  async find(input: {
    id: string;
    actorId: string;
  }): Promise<Notification | null> {
    const notification = this.notifications.get(input.id);
    return notification?.recipientActorId === input.actorId ? notification : null;
  }

  async list(input: {
    actorId: string;
    organizationId: string;
  }): Promise<readonly Notification[]> {
    return [...this.notifications.values()]
      .filter(
        (notification) =>
          notification.recipientActorId === input.actorId &&
          notification.organizationId === input.organizationId,
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      );
  }

  async markRead(input: {
    id: string;
    actorId: string;
    readAt: Date;
  }): Promise<Notification | null> {
    const notification = await this.find(input);
    if (!notification) return null;
    const updated = {
      ...notification,
      readAt: notification.readAt ?? input.readAt,
    };
    this.notifications.set(updated.id, updated);
    return updated;
  }

  async setPreference(preference: NotificationPreference): Promise<void> {
    this.preferences.set(
      `${preference.actorId}:${preference.organizationId}`,
      preference,
    );
  }

  async getPreference(input: {
    actorId: string;
    organizationId: string;
  }): Promise<NotificationPreference | null> {
    return (
      this.preferences.get(`${input.actorId}:${input.organizationId}`) ?? null
    );
  }
}
