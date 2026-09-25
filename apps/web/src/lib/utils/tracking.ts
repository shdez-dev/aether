export type HomeEvent =
  | "cta_click"
  | "phase_select"
  | "workflow_select"
  | "scroll_depth"
  | "demo_invalid"
  | "demo_draft";

/** Local integration point. No cookies, personal fields or network requests. */
export function trackEvent(name: HomeEvent, target: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("aether:analytics", { detail: { name, target } }),
  );
}
