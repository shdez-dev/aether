import type {
  ProductMetricsSnapshot,
  ProductMetricsStore,
} from "@aether/application";

/** Deterministic product-metrics port that exposes the requested tenant scope. */
export class InMemoryProductMetricsStore implements ProductMetricsStore {
  readonly calls: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
    calculatedAt: Date;
  }[] = [];
  private readonly snapshots = new Map<string, ProductMetricsSnapshot>();

  setSnapshot(organizationId: string, snapshot: ProductMetricsSnapshot): void {
    this.snapshots.set(organizationId, snapshot);
  }
  async snapshot(input: {
    organizationId: string;
    startsAt: Date;
    endsAt: Date;
    calculatedAt: Date;
  }): Promise<ProductMetricsSnapshot> {
    this.calls.push(input);
    const snapshot = this.snapshots.get(input.organizationId);
    if (!snapshot) throw new Error("Product metrics fixture is missing");
    return snapshot;
  }
}
