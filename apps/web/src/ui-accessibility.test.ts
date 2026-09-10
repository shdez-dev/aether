import { createElement } from "react";

import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expect, it } from "vitest";

import { Button, Card, Field, Notice, Status } from "@aether/ui";

it("expone componentes reutilizables sin violaciones de accesibilidad", async () => {
  const { container } = render(
    createElement(
      Card,
      { title: "Contexto" },
      createElement(Field, {
        label: "Organización",
        name: "organization",
        required: true,
      }),
      createElement(Status, null, "Activo"),
      createElement(Notice, null, "Estado listo"),
      createElement(Button, null, "Continuar"),
    ),
  );
  expect((await axe(container)).violations).toEqual([]);
});
