import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { actors } from "../../lib/constants/actors";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

export function ActorsGrid() {
  return (
    <section
      className="section section-tint"
      id="actors"
      aria-labelledby="actors-title"
    >
      <div className="home-container">
        <SectionHeading
          id="actors-title"
          index="03"
          eyebrow="Hecho para trabajar juntos"
          title="Distintas perspectivas. Una misma dirección."
          description="AETHER conecta a las personas detrás de cada iniciativa. Cada una aporta desde su responsabilidad, con una historia compartida como punto de encuentro."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {actors.map((actor, index) => (
            <Reveal key={actor.id} delay={index * 0.08}>
              <article
                className="actor-card"
                style={{ "--actor-color": actor.color } as CSSProperties}
              >
                <actor.icon size={24} aria-hidden="true" />
                <h3>{actor.name}</h3>
                <p>{actor.purpose}</p>
                <ul>
                  {actor.capabilities.map((capability) => (
                    <li key={capability}>
                      <Check size={14} aria-hidden="true" />
                      {capability}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
