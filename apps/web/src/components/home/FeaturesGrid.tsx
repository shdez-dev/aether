import { Check, Minus } from "lucide-react";
import { features, comparisons } from "../../lib/constants/features";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

export function FeaturesGrid() {
  return (
    <section
      className="section home-container"
      id="features"
      aria-labelledby="features-title"
    >
      <SectionHeading
        id="features-title"
        index="02"
        eyebrow="La plataforma"
        title="Menos piezas sueltas. Más trabajo con sentido."
        description="Cuando las ideas, los acuerdos y las tareas viven separados, avanzar cuesta. AETHER los reúne alrededor de lo que tu organización quiere lograr."
      />
      <div className="grid gap-6 md:grid-cols-2">
        {features.map((feature, index) => (
          <Reveal key={feature.label} delay={index * 0.08}>
            <article className="feature-card">
              <feature.icon size={28} aria-hidden="true" />
              <p className="card-kicker">{feature.label}</p>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <div className="feature-detail">{feature.detail}</div>
            </article>
          </Reveal>
        ))}
      </div>
      <div className="comparison">
        <div>
          <p className="eyebrow">Un cambio de enfoque</p>
          <h3>
            Del seguimiento manual
            <br />
            al contexto conectado.
          </h3>
          <p>Un lugar para entender qué se está haciendo y por qué importa.</p>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Comparación de métodos de trabajo"
        >
          <table>
            <caption className="sr-only">
              Seguimiento manual y enfoque de Aether
            </caption>
            <thead>
              <tr>
                <th scope="col">Dimensión</th>
                <th scope="col">Seguimiento manual</th>
                <th scope="col">Con Aether</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map(([name, manual, aether]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>
                    <Minus size={14} aria-hidden="true" />
                    {manual}
                  </td>
                  <td>
                    <Check size={14} aria-hidden="true" />
                    {aether}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
