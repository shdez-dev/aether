import type {
  EvidenceReferenceStore,
  EvidenceSubject,
  EvidenceSubjectLookup,
} from "@aether/application";
import type {
  EvidenceReference,
  EvidenceReferenceSubjectType,
} from "@aether/domain";

export class InMemoryEvidenceStore
  implements EvidenceReferenceStore, EvidenceSubjectLookup
{
  readonly references: EvidenceReference[] = [];
  readonly subjects = new Map<string, EvidenceSubject>();
  setSubject(
    subjectType: EvidenceReferenceSubjectType,
    subjectId: string,
    subject: EvidenceSubject,
  ) {
    this.subjects.set(`${subjectType}:${subjectId}`, subject);
  }
  async create(reference: EvidenceReference): Promise<void> {
    this.references.push(reference);
  }
  async list(input: {
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<readonly EvidenceReference[]> {
    return this.references.filter(
      (reference) =>
        reference.subjectType === input.subjectType &&
        reference.subjectId === input.subjectId,
    );
  }
  async resolve(input: {
    subjectType: EvidenceReferenceSubjectType;
    subjectId: string;
  }): Promise<EvidenceSubject | null> {
    return this.subjects.get(`${input.subjectType}:${input.subjectId}`) ?? null;
  }
}
