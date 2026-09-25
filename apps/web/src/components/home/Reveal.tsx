"use client";
import { div as MotionDiv } from "framer-motion/m";
import { usePreferReducedMotion } from "../../lib/hooks/usePreferReducedMotion";
import { homeMotion } from "../../lib/constants/motion";
import type { ReactNode } from "react";

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string | undefined;
}) {
  const reduce = usePreferReducedMotion();
  // Visible SSR content remains usable if hydration or animation loading fails.
  return (
    <MotionDiv
      className={className}
      initial={false}
      whileInView={
        reduce
          ? { opacity: 1, y: 0 }
          : { opacity: [0.85, 1], y: [homeMotion.revealDistance, 0] }
      }
      viewport={{ once: true, amount: 0.15 }}
      transition={{
        duration: reduce ? 0 : homeMotion.revealDuration,
        delay: reduce ? 0 : Math.min(delay, homeMotion.maximumStagger),
        ease: homeMotion.ease,
      }}
    >
      {children}
    </MotionDiv>
  );
}
