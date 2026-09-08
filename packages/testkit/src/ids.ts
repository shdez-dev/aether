let sequence = 0;

/** Generates deterministic UUID-shaped values for tests. */
export function nextTestId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

export function resetTestIds(): void {
  sequence = 0;
}
