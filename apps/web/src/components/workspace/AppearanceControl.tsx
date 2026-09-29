import { Monitor, Moon, Sun } from "lucide-react";

import type { DayThemePreference } from "./use-day-theme";

const themeOptions = [
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Oscuro", icon: Moon },
  { id: "system", label: "Sistema", icon: Monitor },
] as const;

export function AppearanceControl({
  preference,
  onChange,
  label = "Apariencia de la interfaz",
  showCaption = true,
}: {
  preference: DayThemePreference;
  onChange: (theme: DayThemePreference) => void;
  label?: string;
  showCaption?: boolean;
}) {
  return (
    <div className="day-appearance">
      {showCaption ? (
        <span className="day-appearance__label">APARIENCIA</span>
      ) : null}
      <div className="day-appearance__options" role="group" aria-label={label}>
        {themeOptions.map(({ id, label: optionLabel, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={preference === id}
            onClick={() => onChange(id)}
          >
            <Icon size={15} aria-hidden="true" /> {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
