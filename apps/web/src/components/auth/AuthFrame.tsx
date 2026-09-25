import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Brand } from "../layout/Brand";

type AuthFrameProps = {
  mode: "login" | "register";
  children: ReactNode;
};

const content = {
  login: {
    index: "01 / ACCESO",
    title: "La claridad empieza donde tu equipo se encuentra.",
    description:
      "Ideas, decisiones y proyectos. Todo sigue conectado cuando vuelves a AETHER.",
    footnote: "Tu trabajo, en una misma dirección.",
  },
  register: {
    index: "02 / COMENZAR",
    title: "Tu punto de partida para conectar lo que importa.",
    description:
      "Una cuenta propia. Todos tus equipos y proyectos, cuando llegue el momento, en un mismo lugar.",
    footnote: "Una nueva forma de trabajar, juntos.",
  },
};

export function AuthFrame({ mode, children }: AuthFrameProps) {
  const story = content[mode];

  return (
    <div className={`auth-page auth-page--${mode}`}>
      <a className="auth-skip" href="#auth-content">
        Saltar al contenido
      </a>
      <aside className="auth-story" aria-label="Sobre AETHER">
        <div className="auth-story__top">
          <Brand inverse />
          <span className="auth-story__edition">PLATAFORMA / 2026</span>
        </div>
        <div className="auth-story__main">
          <div className="auth-story__line" />
          <p className="auth-story__index">{story.index}</p>
          <h2>{story.title}</h2>
          <p className="auth-story__description">{story.description}</p>
        </div>
        <div className="auth-orbit" aria-hidden="true">
          <svg viewBox="0 0 520 360" role="presentation">
            <circle className="auth-orbit__outer" cx="259" cy="180" r="156" />
            <circle className="auth-orbit__inner" cx="259" cy="180" r="111" />
            <path
              className="auth-orbit__spokes"
              d="M259 24v312M124 102l270 156M124 258l270-156"
            />
            <path
              className="auth-orbit__hex"
              d="M259 24 394 102v156l-135 78-135-78V102z"
            />
            <g className="auth-orbit__nodes">
              <circle cx="259" cy="24" r="5" />
              <circle cx="394" cy="102" r="5" />
              <circle cx="394" cy="258" r="5" />
              <circle cx="259" cy="336" r="5" />
              <circle cx="124" cy="258" r="5" />
              <circle cx="124" cy="102" r="5" />
            </g>
            <g className="auth-orbit__mark">
              <path d="M219 95h80M315 103l40 69M355 189l-40 68M299 265h-80M203 257l-39-68M164 172l39-69" />
            </g>
            <circle className="auth-orbit__core" cx="259" cy="180" r="13" />
          </svg>
          <span className="auth-orbit__label">TODO CONECTADO</span>
        </div>
        <div className="auth-story__bottom">
          <span>{story.footnote}</span>
          <span>AETHER / 06</span>
        </div>
      </aside>
      <div className="auth-surface">
        <header className="auth-surface__header">
          <div className="auth-surface__brand">
            <Brand />
          </div>
          <a href="/" className="auth-back">
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            Volver a AETHER
          </a>
        </header>
        <main className="auth-content" id="auth-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="auth-surface__footer">
          <span>© {new Date().getFullYear()} AETHER</span>
          <a href="/seguridad">Seguridad de AETHER</a>
        </footer>
      </div>
    </div>
  );
}
