"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { ActionButton } from "@aether/ui/action-button";
import { trackEvent } from "../../lib/utils/tracking";

const DemoDialog = dynamic(
  () => import("./DemoDialog.js").then((module) => module.DemoDialog),
  {
    ssr: false,
    loading: () => (
      <p className="dialog-loading" role="status">
        Preparando formulario…
      </p>
    ),
  },
);

export function CTASection({ demoEmail }: { demoEmail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="cta-section" id="contacto" aria-labelledby="cta-title">
      <div className="home-container cta-inner">
        <p className="eyebrow">El próximo paso es tuyo</p>
        <h2 id="cta-title">
          Tu próxima gran iniciativa
          <br />
          empieza con claridad.
        </h2>
        <p>
          Conversemos sobre cómo trabaja tu organización y cómo AETHER puede
          conectar sus ideas, decisiones y proyectos.
        </p>
        <div className="cta-actions">
          <ActionButton
            id="request-demo"
            variant="light"
            onClick={() => {
              setOpen(true);
              trackEvent("cta_click", "solicitar-demo");
            }}
          >
            Solicitar demo
            <ArrowUpRight aria-hidden="true" />
          </ActionButton>
          <ActionButton asChild variant="outline" className="cta-secondary">
            <a
              href="#workflow"
              onClick={() => trackEvent("cta_click", "ver-ejemplo")}
            >
              Ver un ejemplo
              <ArrowRight aria-hidden="true" />
            </a>
          </ActionButton>
        </div>
        <span className="cta-note">
          Una conversación sobre tu equipo, tus retos y tu siguiente paso.
        </span>
      </div>
      {open && (
        <DemoDialog
          recipient={demoEmail}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() =>
              document.getElementById("request-demo")?.focus(),
            );
          }}
        />
      )}
    </section>
  );
}
