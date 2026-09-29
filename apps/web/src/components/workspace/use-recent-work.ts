"use client";

import { useCallback, useEffect, useState } from "react";

export type RecentWorkEntry = {
  kind: "initiative" | "project";
  id: string;
  organizationId: string;
  workspaceId: string;
};

const limit = 8;

function storageKey(actorId: string) {
  return `aether:recent-work:${actorId}`;
}

function readRecent(actorId: string): RecentWorkEntry[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem(storageKey(actorId)) ?? "[]",
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (entry): entry is RecentWorkEntry =>
          entry &&
          typeof entry === "object" &&
          (entry.kind === "initiative" || entry.kind === "project") &&
          typeof entry.id === "string" &&
          typeof entry.organizationId === "string" &&
          typeof entry.workspaceId === "string",
      )
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function useRecentWork(actorId: string | undefined) {
  const [entries, setEntries] = useState<RecentWorkEntry[]>([]);

  useEffect(() => {
    setEntries(actorId ? readRecent(actorId) : []);
  }, [actorId]);

  const remember = useCallback(
    (entry: RecentWorkEntry) => {
      if (!actorId) return;
      setEntries((current) => {
        const next = [
          entry,
          ...current.filter(
            (item) => item.kind !== entry.kind || item.id !== entry.id,
          ),
        ].slice(0, limit);
        try {
          localStorage.setItem(storageKey(actorId), JSON.stringify(next));
        } catch {
          // Recent shortcuts still work for this session when storage is unavailable.
        }
        return next;
      });
    },
    [actorId],
  );

  return { entries, remember };
}
