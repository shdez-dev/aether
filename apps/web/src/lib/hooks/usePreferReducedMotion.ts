"use client";
import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const snapshot = () => window.matchMedia(query).matches;
// The first client render must match SSR, including labels and disabled controls.
const serverSnapshot = () => true;

export function usePreferReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
