import { expect, test } from "@playwright/test";

const initiative = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  createdByActorId: "actor-123",
  createdByDisplayName: "Persona de prueba",
  title: "Reducir espera",
  problemStatement: "Tiempos elevados",
  expectedOutcome: "Atención oportuna",
  proposalDetails: {
    summary: "Mejorar el flujo de atención",
    impactedPeople: "Personas que solicitan atención",
    impactedCount: 60,
    problemImpact: "Retrasos recurrentes",
    solution: "Propuesta de mejora",
    differentiation: "Atención basada en prioridades",
    projectStage: "idea",
    stageRationale: "La idea aún está en validación con usuarios.",
    pilotPlan: "Piloto en una sede durante cuatro semanas",
    pilotResources: "Equipo de atención y tiempo de coordinación",
  },
  classification: "internal",
  requestedPriority: "medium",
  operationalPriority: null,
  intakeAssignment: null,
  status: "draft",
  version: 0,
  duplicateWarnings: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  allowedActions: ["present"],
};
const teamInitiative = {
  ...initiative,
  id: "00000000-0000-4000-8000-000000000004",
  createdByActorId: "actor-456",
  createdByDisplayName: "Otra persona",
  title: "Mejorar la coordinación",
  status: "presented",
  allowedActions: [],
};
const initiatives = [
  initiative,
  teamInitiative,
  ...Array.from({ length: 4 }, (_, index) => ({
    ...teamInitiative,
    id: `00000000-0000-4000-8000-${String(index + 5).padStart(12, "0")}`,
    title: `Idea del equipo ${index + 2}`,
  })),
];

test("carga una iniciativa y la presenta", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        actorId: "actor-123",
        expiresAt: "2027-09-12T00:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/aether/organizations", (route) =>
    route.fulfill({
      json: [
        {
          id: initiative.organizationId,
          name: "Aether",
          organizationType: "institutional",
          timezone: "America/Santiago",
          locale: "es-CL",
          version: 0,
        },
      ],
    }),
  );
  await page.route(
    `**/api/aether/organizations/${initiative.organizationId}/workspaces`,
    (route) =>
      route.fulfill({
        json: [
          {
            id: initiative.workspaceId,
            organizationId: initiative.organizationId,
            name: "Estrategia",
            mode: "institutional",
            version: 0,
            status: "active",
            archivedAt: null,
            archivedByActorId: null,
          },
        ],
      }),
  );
  await page.route(
    `**/api/aether/organizations/${initiative.organizationId}/capabilities?*`,
    (route) =>
      route.fulfill({
        json: {
          accessLevels: ["READ", "CONTRIBUTE", "MANAGE", "ADMIN"],
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
    route.fulfill({ json: initiatives }),
  );
  await page.route("**/api/aether/projects?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/aether/evaluation-standards?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    `**/api/aether/organizations/${initiative.organizationId}/policy`,
    (route) =>
      route.fulfill({
        json: {
          organizationPolicy: {
            dataResidencyRegion: "local",
            retentionDays: 365,
          },
        },
      }),
  );
  await page.route("**/api/aether/initiatives/*/audit-events?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/aether/initiatives/*/submit?*", (route) =>
    route.fulfill({
      json: {
        ...initiative,
        status: "presented",
        version: 1,
        allowedActions: ["review"],
      },
    }),
  );
  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { level: 1, name: "Mi día" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Iniciativas" }).click();
  await expect(page.getByText("ESTADO DEL ESPACIO")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Iniciativas del espacio" }),
  ).toBeVisible();
  const list = page.getByRole("region", {
    name: "Lista de iniciativas, desplazable",
  });
  await expect(list).toBeVisible();
  expect(
    await list.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  expect(
    await list
      .locator(".initiative-row")
      .first()
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThan(120);
  await list.focus();
  await list.press("End");
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Presentadas" }).click();
  await expect(page.locator(".initiative-list .initiative-row")).toHaveCount(5);
  await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: "Todas", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Mejorar la coordinación/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "De mi autoría" }).click();
  await expect(list).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Mejorar la coordinación/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Reducir espera/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Del espacio" }).click();
  const search = page.getByLabel("Buscar iniciativas");
  await search.fill("sin coincidencias");
  await expect(
    page.getByText(
      "No hay iniciativas que coincidan con este alcance y filtros. Prueba otra búsqueda o selección.",
    ),
  ).toBeVisible();
  await search.clear();
  await expect(
    page.getByRole("button", { name: "Reducir espera" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Presentar iniciativa" }).click();
  await expect(
    page.getByText("Iniciativa presentada para revisión."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Abrir configuración institucional" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Estándar de evaluación" }),
  ).toBeVisible();
});
