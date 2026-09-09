import type {
  ProjectAuditEvent,
  ProjectAuditStore,
  ProjectExecutionStore,
  ProjectStore,
} from "@aether/application";
import type {
  Project,
  ProjectMilestone,
  ProjectNextAction,
} from "@aether/domain";

export class InMemoryProjectStore implements ProjectStore {
  readonly projects = new Map<string, Project>();
  async create(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
  async findById(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) ?? null;
  }
  async findByInitiative(initiativeId: string): Promise<Project | null> {
    return (
      [...this.projects.values()].find(
        (project) => project.sourceInitiativeId === initiativeId,
      ) ?? null
    );
  }
  async save(input: {
    project: Project;
    expectedVersion: number;
  }): Promise<boolean> {
    const current = this.projects.get(input.project.id);
    if (!current || current.version !== input.expectedVersion) return false;
    this.projects.set(input.project.id, input.project);
    return true;
  }
}
export class InMemoryProjectExecutionStore implements ProjectExecutionStore {
  readonly milestones: ProjectMilestone[] = [];
  readonly actions: ProjectNextAction[] = [];
  async addMilestone(milestone: ProjectMilestone): Promise<void> {
    this.milestones.push(milestone);
  }
  async addNextAction(action: ProjectNextAction): Promise<void> {
    this.actions.push(action);
  }
}
export class InMemoryProjectAuditStore implements ProjectAuditStore {
  readonly events: ProjectAuditEvent[] = [];
  async record(event: ProjectAuditEvent): Promise<void> {
    this.events.push(event);
  }
  async list(input: {
    organizationId: string;
    projectId: string;
  }): Promise<readonly ProjectAuditEvent[]> {
    return this.events.filter(
      (event) =>
        event.organizationId === input.organizationId &&
        event.projectId === input.projectId,
    );
  }
}
