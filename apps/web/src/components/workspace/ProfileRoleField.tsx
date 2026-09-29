"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

const suggestedRoles = [
  "Desarrollador frontend",
  "Desarrollador backend",
  "Desarrollador full stack",
  "Diseñador de producto",
  "Product manager",
  "Analista de datos",
  "Líder de proyecto",
];

export function ProfileRoleField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (role: string) => void;
  disabled: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const query = value.trim().toLocaleLowerCase("es");
  const options =
    showAll || !query
      ? suggestedRoles
      : suggestedRoles.filter((role) =>
          role.toLocaleLowerCase("es").includes(query),
        );

  function choose(role: string) {
    onChange(role);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setShowAll(true);
      setOpen(true);
      window.setTimeout(() => optionRefs.current[0]?.focus(), 0);
    }
  }

  function onOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      inputRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
        options.length;
      optionRefs.current[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      optionRefs.current[
        event.key === "Home" ? 0 : options.length - 1
      ]?.focus();
    }
  }

  return (
    <div
      className="user-profile__field user-profile__role-field"
      onBlur={onBlur}
    >
      <label htmlFor={inputId}>Rol o especialidad</label>
      <div className="user-profile__role-control">
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setShowAll(false);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
          maxLength={120}
          placeholder="Ej. Desarrollador frontend"
          autoComplete="off"
          aria-describedby={helpId}
          disabled={disabled}
        />
        <button
          type="button"
          className="user-profile__role-toggle"
          aria-label={
            open && showAll
              ? "Ocultar roles sugeridos"
              : "Mostrar roles sugeridos"
          }
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            if (open && showAll) setOpen(false);
            else {
              setShowAll(true);
              setOpen(true);
            }
          }}
          disabled={disabled}
        >
          <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <small id={helpId}>Elige una sugerencia o escribe tu propio rol.</small>
      {open && !disabled ? (
        <div className="user-profile__role-menu" id={listId}>
          <p>ROLES SUGERIDOS</p>
          {options.length ? (
            <ul>
              {options.map((role, index) => (
                <li key={role}>
                  <button
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    className={value === role ? "is-selected" : undefined}
                    aria-label={value === role ? `${role}, seleccionado` : role}
                    onClick={() => choose(role)}
                    onKeyDown={(event) => onOptionKeyDown(event, index)}
                  >
                    <span>{role}</span>
                    {value === role ? (
                      <Check size={16} aria-hidden="true" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="user-profile__role-empty">
              No hay sugerencias. Puedes guardar el rol que escribiste.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
