import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { Brand } from "../layout/Brand";

export function WorkspaceSignedOut({ signedOut }: { signedOut: boolean }) {
  return (
    <main className="workspace-signed-out">
      <section className="workspace-signed-out__story">
        <header className="workspace-signed-out__header">
          <Brand inverse />
          <span>AETHER / ESPACIO PERSONAL</span>
        </header>

        <div className="workspace-signed-out__copy">
          <p className="workspace-signed-out__eyebrow">
            {signedOut ? "SESIÓN CERRADA" : "TU ESPACIO EN AETHER"}
          </p>
          <h1>
            {signedOut ? (
              <>
                Hasta pronto.
                <br />
                Todo queda en su sitio.
              </>
            ) : (
              <>
                Tus ideas,
                <br />
                cuando quieras.
              </>
            )}
          </h1>
          <p className="workspace-signed-out__description">
            {signedOut
              ? "Tu sesión terminó, pero tus iniciativas y proyectos permanecen aquí, listos para cuando vuelvas."
              : "Inicia sesión para volver a tus iniciativas, decisiones y proyectos."}
          </p>
        </div>

        <div className="workspace-signed-out__diagram" aria-hidden="true">
          <svg viewBox="0 0 320 300" fill="none">
            <circle className="signed-out-orbit" cx="160" cy="150" r="124" />
            <path
              className="signed-out-outer-hex"
              d="M160 24 269 87v126l-109 63-109-63V87z"
            />
            <circle
              className="signed-out-inner-orbit"
              cx="160"
              cy="150"
              r="75"
            />
            <path
              className="signed-out-inner-hex"
              d="m160 91 51 30v59l-51 29-51-29v-59z"
            />
            <circle className="signed-out-core" cx="160" cy="150" r="5" />
            <path
              className="signed-out-axis"
              d="M160 29v242M55 90l210 120M265 90 55 210"
            />
          </svg>
          <span>CONTEXTO CONSERVADO</span>
        </div>

        <footer className="workspace-signed-out__footer">
          <span>Un mismo lugar para seguir avanzando.</span>
          <span>01 — AETHER</span>
        </footer>
      </section>

      <section
        className="workspace-signed-out__actions"
        aria-label="Acceso a AETHER"
      >
        <div className="workspace-signed-out__action-content">
          <div className="workspace-signed-out__status" aria-hidden="true">
            {signedOut ? <Check size={18} /> : <ShieldCheck size={18} />}
          </div>
          <p className="workspace-signed-out__action-eyebrow">
            {signedOut ? "CIERRE COMPLETADO" : "ACCESO A TU ESPACIO"}
          </p>
          <h2>{signedOut ? "Tu espacio te espera." : "Continúa en AETHER."}</h2>
          <p className="workspace-signed-out__action-description">
            {signedOut
              ? "Vuelve a entrar cuando estés listo."
              : "Identifícate para consultar el trabajo de tu equipo."}
          </p>

          <a className="workspace-signed-out__login" href="/auth/login">
            <span>Iniciar sesión</span>
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <a className="workspace-signed-out__home" href="/">
            Volver al sitio de AETHER
          </a>
          <a
            className="workspace-signed-out__switch-account"
            href="/auth/identity-logout"
          >
            ¿Aparece otra cuenta? Cierra esa sesión
          </a>
        </div>

        <p className="workspace-signed-out__privacy">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>Tu cuenta y tus datos permanecen protegidos.</span>
        </p>
      </section>
    </main>
  );
}
