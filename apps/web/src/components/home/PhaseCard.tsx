import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Phase } from "../../lib/constants/phases";

export function PhaseCard({ phase }: { phase: Phase }) {
  const Icon = phase.icon;
  return (
    <article
      className="phase-card"
      id={`phase-${phase.id}`}
      style={{ "--phase-color": phase.color } as CSSProperties}
    >
      <div className="card-topline">
        <Icon size={26} aria-hidden="true" />
        <span>{phase.number}</span>
      </div>
      <p className="card-kicker">FASE {phase.number}</p>
      <h3>{phase.name}</h3>
      <p className="card-description">{phase.description}</p>
      <div className="phase-output">
        <span>Lo que te llevas</span>
        <p>{phase.output}</p>
      </div>
      <details className="case-details">
        <summary>
          Ver caso de uso
          <ArrowUpRight size={16} aria-hidden="true" />
        </summary>
        <p>{phase.example}</p>
      </details>
    </article>
  );
}
