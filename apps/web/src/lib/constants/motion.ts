/** A small, shared motion vocabulary. Durations are seconds; no spring overshoot. */
export const homeMotion = {
  ease: [0.22, 1, 0.36, 1] as const,
  revealDuration: 0.44,
  revealDistance: 8,
  maximumStagger: 0.16,
  stepReadingTime: 4800,
} as const;
