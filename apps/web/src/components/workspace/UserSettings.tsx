import { Monitor, ShieldCheck } from "lucide-react";

import { AppearanceControl } from "./AppearanceControl";
import type { DayThemePreference } from "./use-day-theme";

export function UserSettings({
  themePreference,
  onThemeChange,
  onLogout,
}: {
  themePreference: DayThemePreference;
  onThemeChange: (theme: DayThemePreference) => void;
  onLogout: () => void;
}) {
  return (
    <section
      className="daily-desk account-settings"
      aria-label="Configuración personal"
    >
      <header className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">PREFERENCIAS PERSONALES</p>
          <h1>Configuración</h1>
          <p>Ajusta cómo ves Aether y controla tu sesión.</p>
        </div>
      </header>

      <div className="account-settings__grid">
        <section
          className="day-panel account-settings__card"
          aria-labelledby="appearance-title"
        >
          <span className="account-settings__icon" aria-hidden="true">
            <Monitor size={21} strokeWidth={1.7} />
          </span>
          <h2 id="appearance-title">Apariencia</h2>
          <p>Elige el tema más cómodo para trabajar.</p>
          <AppearanceControl
            preference={themePreference}
            onChange={onThemeChange}
            showCaption={false}
          />
          <p className="account-settings__note">
            Esta preferencia se guarda en este navegador. «Sistema» sigue el
            ajuste de tu dispositivo.
          </p>
        </section>

        <section
          className="day-panel account-settings__card"
          aria-labelledby="session-title"
        >
          <span className="account-settings__icon" aria-hidden="true">
            <ShieldCheck size={21} strokeWidth={1.7} />
          </span>
          <h2 id="session-title">Cuenta y sesión</h2>
          <p>Tu sesión de Aether está activa en este navegador.</p>
          <button
            className="day-button day-button--secondary"
            type="button"
            onClick={onLogout}
          >
            Cerrar sesión
          </button>
        </section>
      </div>
    </section>
  );
}
