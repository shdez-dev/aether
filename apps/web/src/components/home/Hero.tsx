"use client";
import { ArrowRight, ArrowDown, ShieldCheck } from "lucide-react";
import { ActionButton } from "@aether/ui/action-button";
import { HexagonFlow } from "./HexagonFlow";
import { trackEvent } from "../../lib/utils/tracking";

export function Hero() {
  return (
    <section
      className="hero-section home-container"
      id="hero"
      aria-labelledby="hero-title"
    >
      <div className="hero-copy">
        <p className="eyebrow">
          <span className="status-dot" />
          De las buenas ideas al trabajo que importa
        </p>
        <h1 id="hero-title">
          Tus iniciativas.
          <br />
          Tu equipo.
          <br />
          <span>Una misma dirección.</span>
        </h1>
        <p className="hero-description">
          AETHER conecta las ideas de tu organización con las decisiones y los
          proyectos que las hacen avanzar. Todo el recorrido, en un mismo lugar.
        </p>
        <div className="hero-actions">
          <ActionButton asChild>
            <a
              href="#contacto"
              onClick={() => trackEvent("cta_click", "conocer-demo")}
            >
              Descubrir AETHER
              <ArrowRight aria-hidden="true" />
            </a>
          </ActionButton>
          <ActionButton asChild variant="outline">
            <a
              href="#phases"
              onClick={() => trackEvent("cta_click", "explorar-ciclo")}
            >
              Cómo funciona
            </a>
          </ActionButton>
        </div>
        <div className="hero-proof">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Menos contexto perdido. Más claridad para avanzar.</span>
        </div>
      </div>
      <HexagonFlow />
      <div className="hero-baseline">
        <a href="#phases">
          <ArrowDown size={15} aria-hidden="true" />
          Descubre cómo se conecta todo
        </a>
        <span>Diseñado para organizaciones que necesitan claridad.</span>
      </div>
    </section>
  );
}
