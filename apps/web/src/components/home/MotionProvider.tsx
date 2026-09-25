"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { trackEvent } from "../../lib/utils/tracking";

const loadFeatures = () =>
  import("./motion-features.js").then((module) => module.domAnimation);

export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const milestones = new Set<number>();
    let queued = false;
    const measure = () => {
      queued = false;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const depth = total > 0 ? (window.scrollY / total) * 100 : 100;
      for (const value of [25, 50, 75, 100])
        if (depth >= value - 1 && !milestones.has(value)) {
          milestones.add(value);
          trackEvent("scroll_depth", String(value));
        }
    };
    const onScroll = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(measure);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
