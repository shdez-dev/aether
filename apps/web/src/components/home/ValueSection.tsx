import { Compass, Link2, ArrowUpRight } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

const benefits = [
  {
    icon: Compass,
    title: "Claridad",
    description:
      "Entiende qué se quiere resolver, qué se acordó y cuál es el próximo paso.",
  },
  {
    icon: Link2,
    title: "Continuidad",
    description:
      "Retoma el trabajo con su historia, incluso cuando cambian los equipos o las prioridades.",
  },
  {
    icon: ArrowUpRight,
    title: "Dirección",
    description:
      "Conecta las tareas de hoy con el propósito que puso en marcha cada proyecto.",
  },
];

export function ValueSection() {
  return (
    <section
      className="section metrics-section"
      id="value"
      aria-labelledby="value-title"
    >
      <div className="home-container">
        <SectionHeading
          id="value-title"
          index="05"
          eyebrow="Lo que cambia con AETHER"
          title="No sólo organizar trabajo. Darle sentido."
          description="Una plataforma para que el conocimiento no se quede en una reunión, las decisiones no pierdan su fundamento y el trabajo no pierda su propósito."
        />
        <div className="grid gap-px md:grid-cols-3 metric-grid">
          {benefits.map((benefit) => (
            <article className="metric-tile value-tile" key={benefit.title}>
              <benefit.icon size={26} aria-hidden="true" />
              <h3>{benefit.title}</h3>
              <p>{benefit.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
