import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { OrganizationSelect } from "./OrganizationSelect";

it("presenta un menú propio y permite elegir con el teclado", () => {
  const onChange = vi.fn();
  render(
    <OrganizationSelect
      label="Espacio de trabajo"
      value="team"
      onChange={onChange}
      options={[
        { value: "team", label: "Equipo", description: "Trabajo compartido." },
        {
          value: "institutional",
          label: "Institución",
          description: "Colaboración institucional.",
        },
      ]}
    />,
  );

  const trigger = screen.getByRole("combobox", {
    name: "Espacio de trabajo",
  });
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox")).toBeTruthy();

  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const activeOptionId = trigger.getAttribute("aria-activedescendant");
  expect(document.getElementById(activeOptionId ?? "")?.textContent).toContain(
    "Institución",
  );

  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("institutional");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("cierra el menú cuando se hace clic fuera del control", () => {
  render(
    <OrganizationSelect
      label="Responsabilidad"
      value="evaluator"
      onChange={vi.fn()}
      options={[
        { value: "evaluator", label: "Evaluación" },
        { value: "coordinator", label: "Coordinación" },
      ]}
    />,
  );

  fireEvent.click(screen.getByRole("combobox", { name: "Responsabilidad" }));
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});
