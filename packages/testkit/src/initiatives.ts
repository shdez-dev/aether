import type {
  EvaluationStandardStore,
  EvaluationStore,
  InitiativeAuditEvent,
  InitiativeAuditStore,
  InitiativeStore,
} from "@aether/application";
import type {
  EvaluationStandard,
  Initiative,
  InitiativeDecision,
  InitiativeEvaluation,
} from "@aether/domain";

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

export class InMemoryEvaluationStandardStore implements EvaluationStandardStore {
  readonly standards = new Map<string, EvaluationStandard>();
  async create(standard: EvaluationStandard): Promise<void> {
    this.standards.set(standard.id, standard);
  }
  async findById(standardId: string): Promise<EvaluationStandard | null> {
    return this.standards.get(standardId) ?? null;
  }
  async activate(input: {
    organizationId: string;
    standardId: string;
  }): Promise<void> {
    for (const [id, standard] of this.standards) {
      if (standard.organizationId === input.organizationId)
        this.standards.set(id, {
          ...standard,
          isActive: id === input.standardId,
        });
    }
  }
}

export class InMemoryEvaluationStore implements EvaluationStore {
  readonly evaluations = new Map<string, InitiativeEvaluation>();
  readonly decisions = new Map<string, InitiativeDecision>();
  async createEvaluation(evaluation: InitiativeEvaluation): Promise<void> {
    this.evaluations.set(evaluation.id, evaluation);
  }
  async findEvaluation(
    evaluationId: string,
  ): Promise<InitiativeEvaluation | null> {
    return this.evaluations.get(evaluationId) ?? null;
  }
  async createDecision(decision: InitiativeDecision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }
  async findDecision(decisionId: string): Promise<InitiativeDecision | null> {
    return this.decisions.get(decisionId) ?? null;
  }
}
