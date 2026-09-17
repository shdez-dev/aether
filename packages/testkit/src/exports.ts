import type { ExportJob, ExportJobStore } from "@aether/application";
export class InMemoryExportJobStore implements ExportJobStore {
  readonly jobs: ExportJob[] = [];
  async create(job: ExportJob): Promise<void> {
    this.jobs.push(job);
  }
  async list(input: {
    organizationId: string;
    requestedByActorId: string;
  }): Promise<readonly ExportJob[]> {
    return this.jobs.filter(
      (job) =>
        job.organizationId === input.organizationId &&
        job.requestedByActorId === input.requestedByActorId,
    );
  }
}
