export type BusinessHoursMode = "disabled" | "audit" | "enforce";

export type BusinessHoursWindow = Readonly<{
  /** ISO weekday: Monday is 1 and Sunday is 7. */
  dayOfWeek: number;
  /** Minutes since midnight in the policy timezone. */
  startMinute: number;
  /** Minutes since midnight in the policy timezone. */
  endMinute: number;
}>;

export type BusinessHoursPolicy = Readonly<{
  mode: BusinessHoursMode;
  timezone: string;
  windows: readonly BusinessHoursWindow[];
}>;

const weekdayByShortName: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Evaluates a weekly schedule at an instant without depending on server timezone. */
export function isWithinBusinessHours(
  policy: BusinessHoursPolicy,
  instant: Date,
): boolean {
  if (policy.mode === "disabled") return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const dayOfWeek = weekdayByShortName[values.weekday ?? ""];
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (!dayOfWeek || !Number.isInteger(hour) || !Number.isInteger(minute))
    return false;
  const minuteOfDay = hour * 60 + minute;
  return policy.windows.some(
    (window) =>
      window.dayOfWeek === dayOfWeek &&
      window.startMinute <= minuteOfDay &&
      minuteOfDay < window.endMinute,
  );
}
