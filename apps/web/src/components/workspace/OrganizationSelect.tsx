"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type OrganizationSelectOption = Readonly<{
  value: string;
  label: string;
  description?: string;
}>;

export function OrganizationSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  placeholder = "Selecciona una opción",
  helperText,
}: {
  label: string;
  value: string;
  options: readonly OrganizationSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const typeaheadRef = useRef({ value: "", timeout: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : 0,
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const activeOption = options[activeIndex] ?? null;
  const isDisabled = disabled || options.length === 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open)
      optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => () => window.clearTimeout(typeaheadRef.current.timeout), []);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (isDisabled) return;
    const lastIndex = options.length - 1;

    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      } else {
        setActiveIndex(
          (current) => (current + direction + options.length) % options.length,
        );
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : lastIndex);
      setOpen(true);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      }
      return;
    }

    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const search =
        `${typeaheadRef.current.value}${event.key}`.toLocaleLowerCase("es");
      typeaheadRef.current.value = search;
      window.clearTimeout(typeaheadRef.current.timeout);
      typeaheadRef.current.timeout = window.setTimeout(() => {
        typeaheadRef.current.value = "";
      }, 700);
      const start = open ? (activeIndex + 1) % options.length : 0;
      const match = [
        ...options.slice(start),
        ...options.slice(0, start),
      ].findIndex((option) =>
        option.label.toLocaleLowerCase("es").startsWith(search),
      );
      if (match >= 0) {
        event.preventDefault();
        const index = (start + match) % options.length;
        setActiveIndex(index);
        setOpen(true);
      }
    }
  }

  return (
    <div className="organization-page__field organization-select-field">
      <label htmlFor={`${id}-trigger`} id={`${id}-label`}>
        {label}
      </label>
      <div className="organization-select" ref={rootRef}>
        <button
          type="button"
          id={`${id}-trigger`}
          className="organization-select__trigger"
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            open && activeOption ? `${id}-option-${activeIndex}` : undefined
          }
          aria-describedby={helperText ? `${id}-help` : undefined}
          aria-required={required || undefined}
          disabled={isDisabled}
          onClick={() => {
            if (open) setOpen(false);
            else {
              setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
              setOpen(true);
            }
          }}
          onKeyDown={onTriggerKeyDown}
        >
          <span
            className={
              selectedOption
                ? "organization-select__value"
                : "organization-select__value is-placeholder"
            }
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <span className="organization-select__indicator" aria-hidden="true">
            <ChevronDown size={16} strokeWidth={2} />
          </span>
        </button>
        {open && !isDisabled ? (
          <div
            className="organization-select__menu"
            id={`${id}-listbox`}
            role="listbox"
            aria-labelledby={`${id}-label`}
          >
            <p className="organization-select__menu-label">Elige una opción</p>
            <div className="organization-select__options">
              {options.map((option, index) => (
                <div
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  className={[
                    "organization-select__option",
                    index === activeIndex ? "is-active" : "",
                    option.value === value ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  id={`${id}-option-${index}`}
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                >
                  <span className="organization-select__option-copy">
                    <span>{option.label}</span>
                    {option.description ? (
                      <small>{option.description}</small>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Check size={16} aria-hidden="true" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {helperText ? <small id={`${id}-help`}>{helperText}</small> : null}
    </div>
  );
}
