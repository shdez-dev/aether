import {
  ArrowRight,
  ArrowDown,
  Check,
  Users,
  Hexagon,
  ClipboardCheck,
  ShieldCheck,
} from "lucide-react";
import { ActionButton } from "@aether/ui/action-button";

const controls = [
  "Acceso según la responsabilidad de cada persona",
  "Espacios de trabajo con límites claros",
  "Historial de cambios y decisiones",
  "Soporte con acceso temporal y controlado",
];

export function SecuritySection() {
  return (
    <section
      className="section home-container security-section"
      id="security"
      aria-labelledby="security-title"
    >
      <div>
        <p className="eyebrow">
          <span>06</span>Confianza para colaborar
        </p>
        <h2 id="security-title">
          Comparte el trabajo.
          <br />
          Conserva el control.
        </h2>
        <p className="security-intro">
          Trabajar juntos no significa que todo esté abierto para todos. AETHER
          combina colaboración, responsabilidades y trazabilidad para cuidar el
          contexto de tu organización.
        </p>
        <ul>
          {controls.map((control) => (
            <li key={control}>
              <Check size={17} aria-hidden="true" />
              {control}
            </li>
          ))}
        </ul>
        <ActionButton asChild variant="outline">
          <a href="/seguridad">
            Conocer la seguridad de AETHER
            <ArrowRight aria-hidden="true" />
          </a>
        </ActionButton>
      </div>
      <div
        className="security-diagram"
        role="img"
        aria-label="Tu equipo colabora en AETHER con accesos definidos. Las decisiones y su historial permanecen conectados."
      >
        <div className="diagram-label">COLABORACIÓN CON CONFIANZA</div>
        <div className="diagram-main">
          <div className="diagram-node">
            <Users aria-hidden="true" />
            <span>Tu equipo</span>
          </div>
          <div className="diagram-connector">
            <span>Accesos claros</span>
            <ArrowRight aria-hidden="true" />
          </div>
          <div className="diagram-node diagram-api">
            <Hexagon aria-hidden="true" />
            <span>AETHER</span>
          </div>
          <div className="diagram-connector">
            <span>Contexto</span>
            <ArrowRight aria-hidden="true" />
          </div>
          <div className="diagram-node">
            <ClipboardCheck aria-hidden="true" />
            <span>Decisiones</span>
          </div>
        </div>
        <div className="diagram-audit">
          <ArrowDown className="diagram-down" aria-hidden="true" />
          <div className="diagram-node">
            <ShieldCheck aria-hidden="true" />
            <span>Historial</span>
            <small>Quién, cuándo y por qué</small>
          </div>
        </div>
        <p>La información acompaña al equipo. Las responsabilidades también.</p>
      </div>
    </section>
  );
}
