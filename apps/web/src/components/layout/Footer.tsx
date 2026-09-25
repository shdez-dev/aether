import { ArrowUpRight } from "lucide-react";
import { Brand } from "./Brand";
import { BackToTop } from "./BackToTop";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="home-container">
        <div className="footer-top">
          <Brand inverse />
          <p>
            El contexto permanece.
            <br />
            El trabajo avanza.
          </p>
          <nav aria-label="Navegación de pie de página">
            <a href="/#phases">Cómo funciona</a>
            <a href="/seguridad">Seguridad y confianza</a>
            <a href="/#contacto">
              Conocer AETHER
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>AETHER · Ideas, decisiones y proyectos conectados</span>
        </div>
      </div>
      <BackToTop />
    </footer>
  );
}
