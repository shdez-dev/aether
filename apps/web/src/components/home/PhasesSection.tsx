import { phases } from "../../lib/constants/phases";
import { PhaseCard } from "./PhaseCard";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

export function PhasesSection() {
  return (
    <section
      className="section section-tint"
      id="phases"
      aria-labelledby="phases-title"
    >
      <div className="home-container">
        <SectionHeading
          id="phases-title"
          index="01"
          eyebrow="El ciclo"
          title="Una idea merece más que quedarse en una conversación."
          description="Dale un lugar para crecer. AETHER conecta cada fase, desde la primera propuesta hasta las tareas de tu equipo, sin perder lo que le dio origen."
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {phases.map((phase, index) => (
            <Reveal key={phase.id} delay={(index % 3) * 0.08}>
              <PhaseCard phase={phase} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
