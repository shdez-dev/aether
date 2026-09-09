import type {
  InitiativeAuditEvent,
  InitiativeAuditStore,
  InitiativeStore,
} from "@aether/application";
import type { Initiative } from "@aether/domain";

export class InMemoryInitiativeStore implements InitiativeStore {
  readonly initiatives = new Map<string, Initiative>();
  async create(initiative: Initiative): Promise<void> {
    this.initiatives.set(initiative.id, initiative);
  }
  async findById(initiativeId: string): Promise<Initiative | null> {
    return this.initiatives.get(initiativeId) ?? null;
  }
  async list(input: {
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly Initiative[]> {
    return [...this.initiatives.values()].filter(
      (initiative) =>
        initiative.organizationId === input.organizationId &&
        initiative.workspaceId === input.workspaceId,
    );
  }
  async save(input: {
    initiative: Initiative;
    expectedVersion: number;
  }): Promise<boolean> {
    const current = this.initiatives.get(input.initiative.id);
    if (!current || current.version !== input.expectedVersion) return false;
    this.initiatives.set(input.initiative.id, input.initiative);
    return true;
  }
}

export class InMemoryInitiativeAuditStore implements InitiativeAuditStore {
  readonly events: InitiativeAuditEvent[] = [];
  async record(event: InitiativeAuditEvent): Promise<void> {
    this.events.push(event);
  }
  async list(input: {
    organizationId: string;
    initiativeId: string;
  }): Promise<readonly InitiativeAuditEvent[]> {
    return this.events.filter(
      (event) =>
        event.organizationId === input.organizationId &&
        event.initiativeId === input.initiativeId,
    );
  }
}
