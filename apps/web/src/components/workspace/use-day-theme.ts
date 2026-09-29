"use client";

import { useEffect, useState } from "react";

export type DayThemePreference = "light" | "dark" | "system";

const storageKey = "aether:day-theme";

function isThemePreference(value: string | null): value is DayThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function useDayTheme() {
  const [preference, setPreference] = useState<DayThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemDark(media.matches);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === storageKey)
        setPreference(
          isThemePreference(event.newValue) ? event.newValue : "system",
        );
    };

    try {
      const saved = window.localStorage.getItem(storageKey);
      if (isThemePreference(saved)) setPreference(saved);
    } catch {
      // Browser storage may be unavailable; the system setting still works.
    }

    syncSystem();
    media.addEventListener("change", syncSystem);
    window.addEventListener("storage", syncStorage);
    return () => {
      media.removeEventListener("change", syncSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const selectTheme = (next: DayThemePreference) => {
    setPreference(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Keep the current visit usable when storage is unavailable.
    }
  };

  return {
    preference,
    resolved:
      preference === "system" ? (systemDark ? "dark" : "light") : preference,
    selectTheme,
  };
}
