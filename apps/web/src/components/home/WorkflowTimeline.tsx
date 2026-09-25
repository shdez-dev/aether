"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useInView } from "framer-motion";
import { usePreferReducedMotion } from "../../lib/hooks/usePreferReducedMotion";
import { Pause, Play, RotateCcw, ArrowRight } from "lucide-react";
import { workflow } from "../../lib/constants/workflow";
import { homeMotion } from "../../lib/constants/motion";
import { trackEvent } from "../../lib/utils/tracking";
import { SectionHeading } from "./SectionHeading";

export function WorkflowTimeline() {
  const region = useRef<HTMLDivElement>(null);
  const visible = useInView(region, { amount: 0.25 });
  const reduce = usePreferReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(true);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (!visible || paused || reduce || active === workflow.length - 1) return;
    const timer = window.setTimeout(
      () => setActive((value) => Math.min(value + 1, workflow.length - 1)),
      homeMotion.stepReadingTime,
    );
    return () => window.clearTimeout(timer);
  }, [visible, paused, reduce, active]);
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () =>
      document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);
  useEffect(() => {
    if (reduce) setPaused(true);
  }, [reduce]);
  const current = workflow[active]!;
  return (
    <section
      className="section home-container"
      id="workflow"
      aria-labelledby="workflow-title"
    >
      <SectionHeading
        id="workflow-title"
        index="04"
        eyebrow="Imagina lo que podrías hacer"
        title="De «podríamos mejorar esto» a ponerlo en marcha."
        description="Un ejemplo: tu equipo quiere ordenar las solicitudes internas. Explora cómo esa necesidad puede convertirse en un proyecto, sin perder el hilo entre una etapa y otra."
      />
      <div ref={region} className="workflow-shell">
        <div className="workflow-toolbar">
          <span>EJEMPLO ILUSTRATIVO · UNA MEJORA INTERNA</span>
          <button
            className="text-control"
            onClick={() => {
              if (active === workflow.length - 1) {
                setActive(0);
                setPaused(false);
                setManual(false);
              } else setPaused(!paused);
            }}
            disabled={Boolean(reduce)}
          >
            {active === workflow.length - 1 ? (
              <RotateCcw size={15} aria-hidden="true" />
            ) : paused ? (
              <Play size={15} aria-hidden="true" />
            ) : (
              <Pause size={15} aria-hidden="true" />
            )}
            {reduce
              ? "Recorrido estático"
              : active === workflow.length - 1
                ? "Repetir"
                : paused
                  ? active === 0
                    ? "Reproducir recorrido"
                    : "Continuar"
                  : "Pausar"}
          </button>
        </div>
        <ol className="workflow-steps" aria-label="Pasos del recorrido">
          {workflow.map((step, index) => (
            <li
              key={step.title}
              style={
                {
                  "--step-color": `var(--phase-${step.phase})`,
                } as CSSProperties
              }
              data-active={index <= active}
            >
              <button
                aria-pressed={index === active}
                aria-controls="workflow-detail"
                onClick={() => {
                  setActive(index);
                  setPaused(true);
                  setManual(true);
                  trackEvent("workflow_select", step.title);
                }}
              >
                <span className="step-number">{index + 1}</span>
                <strong>{step.title}</strong>
                <span>{step.actor}</span>
              </button>
            </li>
          ))}
        </ol>
        <div
          className="workflow-detail"
          id="workflow-detail"
          aria-live={manual ? "polite" : "off"}
        >
          <span>{String(active + 1).padStart(2, "0")} / 08</span>
          <p key={active} className="workflow-copy">
            <strong>{current.title}.</strong> {current.detail}
          </p>
          <ArrowRight size={20} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
