import type { Clock } from "@aether/application";

export class FixedClock implements Clock {
  public constructor(
    private current: Date = new Date("2026-01-01T00:00:00.000Z"),
  ) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
