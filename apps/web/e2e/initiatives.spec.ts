import { expect, test } from "@playwright/test";

const initiative = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  title: "Reducir espera",
  problemStatement: "Tiempos elevados",
  expectedOutcome: "Atención oportuna",
  classification: "internal",
  requestedPriority: "medium",
  status: "draft",
  version: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  allowedActions: ["present"],
};

test("carga una iniciativa y la presenta", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        actorId: "actor-123",
        expiresAt: "2026-09-12T00:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/aether/organizations", (route) =>
    route.fulfill({
      json: [
        {
          id: initiative.organizationId,
          name: "Aether",
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
    route.fulfill({ json: [initiative] }),
  );
  await page.route("**/api/aether/projects?*", (route) =>
    route.fulfill({ json: [] }),
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
        allowedActions: [],
      },
    }),
  );
  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "Lo importante, en movimiento." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Iniciativas" }).click();
  await expect(
    page.getByRole("button", { name: "Reducir espera" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Presentar iniciativa" }).click();
  await expect(
    page.getByText("Iniciativa presentada para revisión."),
  ).toBeVisible();
});
