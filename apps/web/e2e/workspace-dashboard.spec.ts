import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const organizationId = "00000000-0000-4000-8000-000000000011";
const workspaceId = "00000000-0000-4000-8000-000000000012";
const initiative = {
  id: "00000000-0000-4000-8000-000000000013",
  organizationId,
  workspaceId,
  title: "Mejorar la atención",
  problemStatement: "El equipo necesita reducir tiempos de espera.",
  expectedOutcome: "Atención más oportuna",
  classification: "internal",
  requestedPriority: "medium",
  status: "draft",
  version: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  allowedActions: ["present"],
};

async function mockWorkspace(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { actorId: "actor-123", expiresAt: "2026-12-31T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/aether/organizations", (route) =>
    route.fulfill({
      json: [
        {
          id: organizationId,
          name: "Equipo Aurora",
          timezone: "America/Santiago",
          locale: "es-CL",
          version: 0,
        },
      ],
    }),
  );
  await page.route(
    `**/api/aether/organizations/${organizationId}/workspaces`,
    (route) =>
      route.fulfill({
        json: [
          {
            id: workspaceId,
            organizationId,
            name: "Operaciones",
            mode: "team",
            version: 0,
          },
        ],
      }),
  );
  await page.route(
    `**/api/aether/organizations/${organizationId}/capabilities?*`,
    (route) =>
      route.fulfill({
        json: {
          accessLevels: ["READ", "CONTRIBUTE", "MANAGE"],
          canReadOrganization: true,
          canManageOrganization: true,
          canCreateWorkspace: true,
          canReadWorkspace: true,
          canManageWorkspace: true,
          canInviteMembers: true,
        },
      }),
  );
  await page.route("**/api/aether/initiatives?*", (route) =>
    route.fulfill({ json: [initiative] }),
  );
  await page.route("**/api/aether/projects?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/aether/evaluation-standards?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    `**/api/aether/organizations/${organizationId}/my-work`,
    (route) => route.fulfill({ json: [] }),
  );
  await page.route("**/api/aether/initiatives/*/audit-events?*", (route) =>
    route.fulfill({ json: [] }),
  );
}

test("el inicio de sesión muestra un centro de trabajo real y navegación funcional", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/workspace");

  await expect(
    page.getByRole("heading", { name: "Lo importante, en movimiento." }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Resumen del espacio activo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Flujo de AETHER" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Estado del ciclo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Iniciativa: 1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Mejorar la atención" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Mi trabajo" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Iniciativas" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Iniciativas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Mejorar la atención/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Proyectos" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Proyectos" }),
  ).toBeVisible();
  await expect(
    page.getByText("No existen proyectos en este workspace."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Mi día", exact: true }).click();
  await page.getByRole("button", { name: /Nueva iniciativa/ }).click();
  await expect(
    page.getByRole("heading", { name: "Nueva iniciativa" }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("el centro de trabajo se adapta a una pantalla móvil", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "Lo importante, en movimiento." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Organización" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Organización" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
