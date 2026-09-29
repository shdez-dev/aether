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
  proposalDetails: {
    summary: "Hacer más ágil la atención",
    impactedPeople: "Personas usuarias y personal de atención",
    impactedCount: 80,
    problemImpact: "Demoras en horas de alta demanda",
    solution: "Ajustar el flujo de recepción",
    differentiation: "Priorización con criterios comunes",
    projectStage: "prototype",
    stageRationale: "El flujo ya fue validado con cinco personas usuarias.",
    pilotPlan: "Prueba en una unidad por un mes",
    pilotResources: "Tiempo del equipo y métricas de atención",
  },
  classification: "internal",
  requestedPriority: "medium",
  status: "draft",
  version: 0,
  duplicateWarnings: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  allowedActions: ["present"],
};

async function waitForViewTransition(page: Page) {
  await expect(page.locator(".workspace-main__content")).toHaveAttribute(
    "data-view-transition",
    "settled",
  );
}

async function mockWorkspace(page: Page) {
  let organizationPolicy = {
    organizationId,
    dataResidencyRegion: "local",
    retentionDays: 365,
    businessHours: null,
    version: 0,
    updatedByActorId: "actor-123",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  let profile = {
    displayName: "Camila Registrada",
    role: "",
    bio: "",
    avatarData: null as string | null,
    updatedAt: null as string | null,
  };
  await page.route("**/api/aether/me/profile", async (route) => {
    if (route.request().method() === "PATCH") {
      profile = {
        ...JSON.parse(route.request().postData() ?? "{}"),
        updatedAt: new Date().toISOString(),
      };
    }
    await route.fulfill({ json: profile });
  });
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
          organizationType: "business",
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
            status: "active",
            archivedAt: null,
            archivedByActorId: null,
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
  await page.route(
    `**/api/aether/organizations/${organizationId}/policy`,
    async (route) => {
      if (route.request().method() === "PUT") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        organizationPolicy = {
          ...organizationPolicy,
          dataResidencyRegion: body.dataResidencyRegion,
          retentionDays: body.retentionDays,
          version: organizationPolicy.version + 1,
        };
        await route.fulfill({ json: organizationPolicy });
        return;
      }
      await route.fulfill({
        json: {
          organizationId,
          workspaceId: null,
          dataResidencyRegion: {
            value: organizationPolicy.dataResidencyRegion,
            origin: "organization",
          },
          retentionDays: {
            value: organizationPolicy.retentionDays,
            origin: "organization",
          },
          businessHours: {
            value: { mode: "disabled", timezone: "UTC", windows: [] },
            origin: "default",
          },
          organizationPolicy,
          workspaceOverride: null,
        },
      });
    },
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

  await expect(page.getByRole("heading", { name: "Mi día" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Resumen del espacio activo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Todo al día" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "A mano" })).toBeVisible();
  await expect(page.locator(".workspace-topbar")).toHaveCount(0);
  await expect(
    page
      .getByRole("complementary", { name: "Menú del espacio de trabajo" })
      .getByRole("button", {
        name: /Cambiar organización y espacio de trabajo: Equipo Aurora, Operaciones/,
      }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir iniciativa: Mejorar la atención" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Resumen de mis tareas" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Mi trabajo" })).toHaveCount(0);
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
  await page.getByRole("button", { name: /Abrir iniciativa/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Iniciativas" }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("el centro de trabajo se adapta a una pantalla móvil", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Mi día" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", {
      name: /Cambiar organización y espacio de trabajo: Equipo Aurora, Operaciones/,
    })
    .click();
  await page.getByRole("button", { name: "Configuración del espacio" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Organización y espacios" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  const switcher = page.getByRole("button", {
    name: /Cambiar organización y espacio de trabajo: Equipo Aurora, Operaciones/,
  });
  await switcher.click();
  await expect(
    page.getByRole("heading", { name: "Tu espacio de trabajo" }),
  ).toBeVisible();
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("selector-movil.png"),
    });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(switcher).toBeFocused();
});

test("la navegación conserva el mismo diseño y la configuración personal controla la apariencia", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/workspace");

  const sidebar = page.getByRole("complementary", {
    name: "Menú del espacio de trabajo",
  });
  await expect(
    sidebar.getByRole("link", { name: "Ver sitio público" }),
  ).toHaveCount(0);
  const settingsLink = sidebar.getByRole("link", { name: "Configuración" });
  await expect(settingsLink).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Perfil" })).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeVisible();
  await expect(sidebar.locator(".workspace-sidebar__bottom")).not.toContainText(
    /Perfil|Configuración|Cerrar sesión/,
  );

  const shellMetrics = async () =>
    page.evaluate(() => {
      const sidebar = document.querySelector(".workspace-sidebar");
      const content = document.querySelector(".workspace-main__content");
      if (!sidebar || !content) throw new Error("Falta el layout del espacio");
      return {
        sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
        contentMaxWidth: getComputedStyle(content).maxWidth,
        contentPadding: getComputedStyle(content).paddingLeft,
        sidebarColor: getComputedStyle(sidebar).backgroundColor,
        canvasColor: getComputedStyle(document.querySelector(".workspace-app")!)
          .backgroundColor,
      };
    });
  const initial = await shellMetrics();
  for (const [link, heading] of [
    ["Iniciativas", "Iniciativas"],
    ["Proyectos", "Proyectos"],
    ["Recientes", "Recientes"],
  ] as const) {
    await sidebar.getByRole("link", { name: link }).click();
    await expect(page.locator(".workspace-main__content")).toHaveAttribute(
      "data-view-transition",
      "running",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await waitForViewTransition(page);
    expect(await shellMetrics()).toEqual(initial);
    if (browserName === "chromium" && link === "Iniciativas")
      await page.screenshot({
        path: testInfo.outputPath("iniciativas-claro.png"),
        fullPage: true,
      });
  }

  await settingsLink.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Configuración" }),
  ).toBeVisible();
  await waitForViewTransition(page);
  await expect(settingsLink).toHaveAttribute("aria-current", "page");
  const appearance = page.getByRole("group", {
    name: "Apariencia de la interfaz",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("configuracion-personal.png"),
      fullPage: true,
    });
  await appearance.getByRole("button", { name: "Oscuro" }).click();
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "dark",
  );
  await sidebar.getByRole("link", { name: "Iniciativas" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Iniciativas" }),
  ).toBeVisible();
  await waitForViewTransition(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("iniciativas-oscuro.png"),
      fullPage: true,
    });
  await sidebar.getByRole("link", { name: "Proyectos" }).click();
  await waitForViewTransition(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await sidebar.getByRole("link", { name: "Recientes" }).click();
  await waitForViewTransition(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: /Cambiar organización y espacio de trabajo/ })
    .click();
  await page.getByRole("button", { name: "Configuración del espacio" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Organización y espacios" }),
  ).toBeVisible();
  await waitForViewTransition(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await settingsLink.click();
  await waitForViewTransition(page);
  await appearance.getByRole("button", { name: "Claro" }).click();
  await sidebar.getByRole("link", { name: "Mi día", exact: true }).click();
  await waitForViewTransition(page);
  await expect(
    page.getByRole("group", { name: "Apariencia de la interfaz" }),
  ).toHaveCount(0);
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "light",
  );
  await page.setViewportSize({ width: 800, height: 960 });
  await expect(settingsLink).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await settingsLink.click();
  await waitForViewTransition(page);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("region", { name: "Configuración personal" })
    .getByRole("button", { name: "Cerrar sesión" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "¿Cerrar sesión?" }),
  ).toBeVisible();
});

test("la navegación separa mis tareas del espacio y recuerda elementos abiertos", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/workspace");

  const sidebar = page.getByRole("complementary", {
    name: "Menú del espacio de trabajo",
  });
  await expect(sidebar.getByText("TU TRABAJO")).toBeVisible();
  await expect(sidebar.getByText("ESPACIO", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Organización" })).toHaveCount(
    0,
  );

  await sidebar.getByRole("link", { name: "Mis tareas" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Mis tareas" }),
  ).toBeVisible();
  await waitForViewTransition(page);
  await expect(page.getByRole("region", { name: "Mi trabajo" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await sidebar.getByRole("link", { name: "Recientes" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Aún no has abierto trabajo en este espacio",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ver iniciativas" }).click();
  await page.getByRole("button", { name: /Mejorar la atención/ }).click();
  await sidebar.getByRole("link", { name: "Recientes" }).click();
  await expect(
    page
      .getByRole("region", { name: "Trabajo reciente" })
      .getByRole("button", { name: /Mejorar la atención/ }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Recientes" }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Trabajo reciente" })
    .getByRole("button", { name: /Mejorar la atención/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Iniciativas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Mejorar la atención" }),
  ).toBeVisible();
});

test("el espacio de trabajo pide confirmación antes de cerrar sesión", async ({
  page,
}) => {
  await mockWorkspace(page);
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", (route) => {
    logoutRequests += 1;
    return route.fulfill({ status: 500, body: "{}" });
  });
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cerrar sesión?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(logoutRequests).toBe(0);
  await expect(page.getByRole("heading", { name: "Mi día" })).toBeVisible();
});

test("el selector de contexto cambia de organización y espacio sin datos anteriores", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  const secondOrganizationId = "00000000-0000-4000-8000-000000000021";
  const secondWorkspaceId = "00000000-0000-4000-8000-000000000022";
  await page.route("**/api/aether/organizations", (route) =>
    route.fulfill({
      json: [
        { id: organizationId, name: "Equipo Aurora" },
        { id: secondOrganizationId, name: "Equipo Boreal" },
      ],
    }),
  );
  await page.route(
    `**/api/aether/organizations/${secondOrganizationId}/workspaces`,
    (route) =>
      route.fulfill({
        json: [
          {
            id: secondWorkspaceId,
            organizationId: secondOrganizationId,
            name: "Laboratorio",
            mode: "team",
          },
        ],
      }),
  );
  await page.route("**/api/aether/organizations/*/capabilities?*", (route) =>
    route.fulfill({
      json: {
        accessLevels: ["READ"],
        canReadOrganization: true,
        canManageOrganization: false,
        canCreateWorkspace: false,
        canReadWorkspace: true,
        canManageWorkspace: false,
        canInviteMembers: false,
      },
    }),
  );
  await page.route("**/api/aether/organizations/*/my-work", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/aether/initiatives?*", (route) => {
    const requestUrl = new URL(route.request().url());
    const isSecondWorkspace =
      requestUrl.searchParams.get("organizationId") === secondOrganizationId ||
      requestUrl.searchParams.get("workspaceId") === secondWorkspaceId;
    return route.fulfill({ json: isSecondWorkspace ? [] : [initiative] });
  });
  await page.goto("/workspace");
  const trigger = page.getByRole("button", {
    name: /Equipo Aurora.*Operaciones/,
  });
  await expect(trigger).toBeVisible();
  expect(
    await trigger.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(52);
  await trigger.click();
  await expect(page.getByText("CAMBIAR DE LUGAR")).toBeVisible();
  await expect(page.getByRole("region", { name: "Espacios" })).toBeVisible();
  const panel = page.locator(".workspace-context__panel");
  const panelSize = await panel.boundingBox();
  expect(panelSize?.width).toBeLessThanOrEqual(310);
  expect(panelSize?.height).toBeLessThanOrEqual(300);
  const workspaceOptions = page.locator(".workspace-context__options");
  const currentWorkspace = page
    .getByRole("region", { name: "Espacios" })
    .getByRole("button", { name: /Operaciones/ });
  await currentWorkspace.hover();
  expect(
    await workspaceOptions.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await currentWorkspace.evaluate(
      (element) => getComputedStyle(element).transform,
    ),
  ).toBe("none");
  expect(
    await currentWorkspace.evaluate((element) =>
      parseFloat(getComputedStyle(element).borderTopLeftRadius),
    ),
  ).toBeGreaterThanOrEqual(8);
  await expect(
    page.getByRole("button", { name: "Cerrar selector de espacio" }),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await panel.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("selector-escritorio.png"),
    });
  await page.getByRole("button", { name: "Actualizar espacio" }).click();
  await page
    .getByRole("button", { name: "Cambiar organización", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Organizaciones" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".workspace-context__step")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("workspace-context-step-in");
  expect(
    await page
      .locator(".workspace-context__step")
      .evaluate((element) => getComputedStyle(element).animationDuration),
  ).toBe("0.29s");
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("selector-organizaciones.png"),
    });
  await page
    .getByRole("region", { name: "Organizaciones" })
    .getByRole("button", { name: "Equipo Boreal" })
    .click();
  await page
    .getByRole("region", { name: "Espacios" })
    .getByRole("button", { name: "Laboratorio" })
    .click();
  await expect(
    page.getByRole("button", { name: /Equipo Boreal.*Laboratorio/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir iniciativa: Mejorar la atención" }),
  ).toHaveCount(0);
  await expect(page.getByText("CAMBIAR DE LUGAR")).toHaveCount(0);
});

test("organización existente y creación nueva son flujos distintos y funcionales", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1680, height: 953 });
  const newOrganizationId = "00000000-0000-4000-8000-000000000051";
  const newWorkspaceId = "00000000-0000-4000-8000-000000000052";
  const newOrganization = {
    id: newOrganizationId,
    name: "Equipo Horizonte",
    organizationType: "business",
    timezone: "America/Santiago",
    locale: "es-CL",
    version: 0,
  };
  const newWorkspace = {
    id: newWorkspaceId,
    organizationId: newOrganizationId,
    name: "Producto",
    mode: "team",
    version: 0,
    status: "active",
    archivedAt: null,
    archivedByActorId: null,
  };
  let created = false;
  let workspaceCreated = false;
  await page.route("**/api/aether/organizations", async (route) => {
    if (route.request().method() === "POST") {
      created = true;
      await route.fulfill({ status: 201, json: newOrganization });
      return;
    }
    await route.fulfill({
      json: [
        {
          id: organizationId,
          name: "Equipo Aurora",
          organizationType: "business",
          timezone: "America/Santiago",
          locale: "es-CL",
          version: 0,
        },
        ...(created ? [newOrganization] : []),
      ],
    });
  });
  await page.route("**/api/aether/workspaces", async (route) => {
    workspaceCreated = true;
    expect(JSON.parse(route.request().postData() ?? "{}").organizationId).toBe(
      newOrganizationId,
    );
    await route.fulfill({ status: 201, json: newWorkspace });
  });
  await page.route(
    `**/api/aether/organizations/${newOrganizationId}/workspaces`,
    (route) => route.fulfill({ json: workspaceCreated ? [newWorkspace] : [] }),
  );
  await page.route(
    `**/api/aether/organizations/${newOrganizationId}/capabilities?*`,
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
  await page.route(
    `**/api/aether/organizations/${newOrganizationId}/policy`,
    (route) =>
      route.fulfill({
        json: {
          organizationId: newOrganizationId,
          workspaceId: null,
          dataResidencyRegion: { value: "local", origin: "organization" },
          retentionDays: { value: 365, origin: "organization" },
          businessHours: {
            value: { mode: "disabled", timezone: "UTC", windows: [] },
            origin: "default",
          },
          organizationPolicy: {
            organizationId: newOrganizationId,
            dataResidencyRegion: "local",
            retentionDays: 365,
            businessHours: null,
            version: 0,
            updatedByActorId: "actor-123",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
          workspaceOverride: null,
        },
      }),
  );

  await page.goto("/workspace#organization");
  await expect(
    page.getByRole("heading", { level: 1, name: "Organización y espacios" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Organización actual" }),
  ).toContainText("Equipo Aurora");
  await expect(
    page.getByRole("heading", { name: "Política de datos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Espacios de trabajo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Personas y acceso" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Aceptar invitación" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Nueva organización" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Estándar de evaluación" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Evaluación de iniciativas" }),
  ).toBeVisible();
  await expect(page.getByText("Sin estándar activo")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("estandar-evaluacion.png"),
      fullPage: true,
    });
  await page
    .getByRole("button", { name: "Volver a organización y espacios" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Organización y espacios" }),
  ).toBeVisible();
  const policyCard = page.locator("#organization-policy");
  const workspacesCard = page.locator("#organization-workspaces");
  const peopleCard = page.locator("#organization-people");
  const [policyBounds, workspacesBounds, peopleBounds] = await Promise.all([
    policyCard.boundingBox(),
    workspacesCard.boundingBox(),
    peopleCard.boundingBox(),
  ]);
  expect(policyBounds).not.toBeNull();
  expect(workspacesBounds).not.toBeNull();
  expect(peopleBounds).not.toBeNull();
  expect(Math.abs(policyBounds!.y - workspacesBounds!.y)).toBeLessThan(3);
  expect(Math.abs(policyBounds!.y - peopleBounds!.y)).toBeLessThan(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1,
    ),
  ).toBe(true);
  await page
    .getByRole("spinbutton", { name: /Retención de datos/ })
    .fill("180");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Política de la organización actualizada",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("organizacion-claro.png"),
      fullPage: true,
    });
  await expect(
    page.getByRole("navigation", { name: "Secciones de organización" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /Cambiar organización y espacio de trabajo/ })
    .click();
  await page
    .getByRole("button", { name: "Cambiar organización", exact: true })
    .click();
  await page.getByRole("button", { name: "Nueva organización" }).click();
  await expect(page).toHaveURL(/#organization-new$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Nueva organización" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("nueva-organizacion.png"),
      fullPage: true,
    });
  await page
    .getByRole("textbox", { name: "Nombre de la organización" })
    .fill("Equipo Horizonte");
  await page
    .getByRole("textbox", { name: "Nombre del espacio" })
    .fill("Producto");
  await page
    .getByRole("button", { name: "Crear organización y espacio" })
    .click();
  await expect(
    page.getByRole("region", { name: "Organización actual" }),
  ).toContainText("Equipo Horizonte");
  await expect(
    page.getByRole("region", { name: "Organización actual" }),
  ).toContainText("1");
  await expect(
    page.getByRole("button", { name: /Equipo Horizonte.*Producto/ }),
  ).toBeVisible();
  expect(created && workspaceCreated).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("organizacion-movil.png"),
      fullPage: true,
    });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "dark",
  );
  await expect
    .poll(() =>
      page
        .locator(".organization-page__primary")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgb(170, 195, 255)");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("organizacion-oscuro-movil.png"),
      fullPage: true,
    });
});

test("la gestión de espacios e invitaciones respeta los permisos", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1680, height: 953 });
  const newWorkspaceId = "00000000-0000-4000-8000-000000000061";
  let invitationPayload: Record<string, unknown> | null = null;
  await page.route("**/api/aether/workspaces", async (route) => {
    const payload = JSON.parse(route.request().postData() ?? "{}");
    expect(payload).toMatchObject({
      organizationId,
      name: "Diseño",
      mode: "team",
    });
    await route.fulfill({
      status: 201,
      json: {
        id: newWorkspaceId,
        organizationId,
        name: "Diseño",
        mode: "team",
        version: 0,
        status: "active",
        archivedAt: null,
        archivedByActorId: null,
      },
    });
  });
  await page.route(
    `**/api/aether/organizations/${organizationId}/invitations`,
    async (route) => {
      invitationPayload = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 201, json: { id: "invitation-1" } });
    },
  );

  await page.goto("/workspace#organization");
  await expect(
    page.getByRole("spinbutton", { name: /Retención de datos/ }),
  ).toBeVisible();
  const createWorkspaceButton = page.getByRole("button", {
    name: "Nuevo espacio",
  });
  const initialScrollY = await page.evaluate(() => window.scrollY);
  await createWorkspaceButton.click();
  await expect(createWorkspaceButton).toHaveAttribute("aria-expanded", "true");
  const workspaceNameField = page.getByRole("textbox", {
    name: "Nombre del espacio",
  });
  await expect(workspaceNameField).toBeFocused();
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - initialScrollY),
  ).toBeLessThan(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1,
    ),
  ).toBe(true);
  await workspaceNameField.fill("Diseño");
  await page.getByRole("button", { name: "Crear espacio" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Se creó el espacio" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Equipo Aurora.*Diseño/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Correo electrónico" })
    .fill("persona@equipo.com");
  await page.getByRole("button", { name: "Crear invitación" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Invitación creada" }),
  ).toBeVisible();
  expect(invitationPayload).toMatchObject({
    email: "persona@equipo.com",
    organizationRole: "member",
    workspaceIds: [newWorkspaceId],
    workspaceRole: "member",
  });

  await page.route(
    `**/api/aether/organizations/${organizationId}/capabilities?*`,
    (route) =>
      route.fulfill({
        json: {
          accessLevels: ["READ"],
          canReadOrganization: true,
          canManageOrganization: false,
          canCreateWorkspace: false,
          canReadWorkspace: true,
          canManageWorkspace: false,
          canInviteMembers: false,
        },
      }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Organización y espacios" }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: /Retención de datos/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nuevo espacio" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Crear invitación" }),
  ).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("aceptar invitación vive en el selector y cambia a la organización recibida", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  const joinedOrganizationId = "00000000-0000-4000-8000-000000000071";
  const joinedWorkspaceId = "00000000-0000-4000-8000-000000000072";
  const invitationCode = "invitation-token-12345678901234567890";
  const joinedOrganization = {
    id: joinedOrganizationId,
    name: "Equipo Invitado",
    organizationType: "business",
    timezone: "America/Santiago",
    locale: "es-CL",
    version: 0,
  };
  const joinedWorkspace = {
    id: joinedWorkspaceId,
    organizationId: joinedOrganizationId,
    name: "Comunidad",
    mode: "team",
    version: 0,
    status: "active",
    archivedAt: null,
    archivedByActorId: null,
  };
  let accepted = false;
  let submittedToken = "";
  await page.route("**/api/aether/organizations", async (route) => {
    await route.fulfill({
      json: [
        {
          id: organizationId,
          name: "Equipo Aurora",
          organizationType: "business",
          timezone: "America/Santiago",
          locale: "es-CL",
          version: 0,
        },
        ...(accepted ? [joinedOrganization] : []),
      ],
    });
  });
  await page.route(
    `**/api/aether/organizations/${joinedOrganizationId}/workspaces`,
    (route) => route.fulfill({ json: [joinedWorkspace] }),
  );
  await page.route(
    `**/api/aether/organizations/${joinedOrganizationId}/capabilities?*`,
    (route) =>
      route.fulfill({
        json: {
          accessLevels: ["READ", "CONTRIBUTE"],
          canReadOrganization: true,
          canManageOrganization: false,
          canCreateWorkspace: false,
          canReadWorkspace: true,
          canManageWorkspace: false,
          canInviteMembers: false,
        },
      }),
  );
  await page.route("**/api/aether/invitations/accept", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    submittedToken = body.token;
    if (body.token !== invitationCode) {
      await route.fulfill({
        status: 400,
        json: { detail: "El código de invitación no es válido." },
      });
      return;
    }
    accepted = true;
    await route.fulfill({
      status: 200,
      json: {
        id: "00000000-0000-4000-8000-000000000073",
        organizationId: joinedOrganizationId,
        email: "camila@equipo.com",
        organizationRole: "member",
        workspaceIds: [joinedWorkspaceId],
        workspaceRole: "member",
        expiresAt: "2026-10-05T00:00:00.000Z",
      },
    });
  });

  await page.goto("/workspace");
  await page
    .getByRole("button", { name: /Cambiar organización y espacio de trabajo/ })
    .click();
  await page
    .getByRole("button", { name: "Cambiar organización", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Organizaciones" })
      .getByRole("button", { name: "Equipo Aurora" }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("organizaciones-selector.png"),
      fullPage: false,
    });
  await page.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(
    page.getByRole("region", { name: "Aceptar invitación" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("aceptar-invitacion.png"),
      fullPage: false,
    });
  const tokenField = page.getByRole("textbox", {
    name: "Código de invitación",
  });
  await tokenField.fill("corto");
  await expect(
    page.getByRole("button", { name: "Unirme a la organización" }),
  ).toBeDisabled();
  await tokenField.fill(`${invitationCode.slice(0, -1)}x`);
  await page.getByRole("button", { name: "Unirme a la organización" }).click();
  await expect(
    page.locator(".workspace-context__invitation-error"),
  ).toContainText("El código de invitación no es válido.");
  await tokenField.fill(invitationCode);
  await page.getByRole("button", { name: "Unirme a la organización" }).click();
  await expect(
    page.getByRole("button", {
      name: /Cambiar organización y espacio de trabajo: Equipo Invitado, Comunidad/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Cambiar organización y espacio de trabajo/,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(submittedToken).toBe(invitationCode);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("la apariencia permite elegir claro desde un sistema oscuro y recuerda la elección", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/workspace");

  const app = page.locator(".workspace-app");
  await page.getByRole("link", { name: "Configuración" }).click();
  const appearance = page.getByRole("group", {
    name: "Apariencia de la interfaz",
  });
  await expect(app).toHaveAttribute("data-day-theme", "dark");
  await expect(
    appearance.getByRole("button", { name: "Sistema" }),
  ).toHaveAttribute("aria-pressed", "true");

  await appearance.getByRole("button", { name: "Claro" }).click();
  await expect(app).toHaveAttribute("data-day-theme", "light");
  expect(
    await page.evaluate(() => localStorage.getItem("aether:day-theme")),
  ).toBe("light");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("mi-dia-tema-claro.png"),
      fullPage: true,
    });

  await page.reload();
  await page.getByRole("link", { name: "Configuración" }).click();
  await expect(app).toHaveAttribute("data-day-theme", "light");
  await expect(
    appearance.getByRole("button", { name: "Claro" }),
  ).toHaveAttribute("aria-pressed", "true");

  await appearance.getByRole("button", { name: "Oscuro" }).click();
  await expect(app).toHaveAttribute("data-day-theme", "dark");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await appearance.getByRole("button", { name: "Sistema" }).click();
  await expect(app).toHaveAttribute("data-day-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(app).toHaveAttribute("data-day-theme", "light");
});

test("el perfil guarda nombre, rol libre y biografía y mantiene los iconos accesibles", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/workspace#profile");
  await expect(
    page.getByRole("heading", { level: 1, name: "Perfil" }),
  ).toBeVisible();
  const preview = page.getByRole("complementary", { name: "Vista previa" });
  await expect(page.getByRole("textbox", { name: "Nombre" })).toHaveValue(
    "Camila Registrada",
  );
  await expect(preview).toContainText("Camila Registrada");
  await expect(preview).toContainText("Tu rol o especialidad");
  await expect(preview).toContainText("Tu presentación aparecerá aquí");
  await page.getByRole("textbox", { name: "Nombre" }).fill("Alex Rivera");
  const roleField = page.getByRole("textbox", { name: "Rol o especialidad" });
  await roleField.focus();
  await page.keyboard.press("ArrowDown");
  const frontendRole = page.getByRole("button", {
    name: "Desarrollador frontend",
    exact: true,
  });
  await expect(frontendRole).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("perfil-roles-desplegados.png"),
    });
  await page.keyboard.press("Enter");
  await expect(roleField).toHaveValue("Desarrollador frontend");
  await roleField.fill("Investigadora UX");
  await expect(
    page.getByText("No hay sugerencias. Puedes guardar el rol que escribiste."),
  ).toBeVisible();
  await expect(preview).toContainText("Investigadora UX");
  await page.getByRole("button", { name: "Mostrar roles sugeridos" }).click();
  await frontendRole.click();
  await page
    .getByRole("textbox", { name: /Biografía/ })
    .fill("Diseño y construyo interfaces accesibles.");
  await expect(preview).toContainText("Alex Rivera");
  await expect(preview).toContainText("Desarrollador frontend");
  await expect(preview).toContainText(
    "Diseño y construyo interfaces accesibles.",
  );
  const editorBounds = await page.locator(".user-profile__card").boundingBox();
  const previewBounds = await preview.boundingBox();
  expect(previewBounds!.x).toBeGreaterThan(
    editorBounds!.x + editorBounds!.width,
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "perfil.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".user-profile__avatar img")).toBeVisible();
  await expect(
    preview.locator(".user-profile__preview-avatar img"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Tu perfil se guardó correctamente",
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nombre" })).toHaveValue(
    "Alex Rivera",
  );
  await expect(
    page.getByRole("textbox", { name: "Rol o especialidad" }),
  ).toHaveValue("Desarrollador frontend");
  await expect(page.getByRole("textbox", { name: /Biografía/ })).toHaveValue(
    "Diseño y construyo interfaces accesibles.",
  );
  await expect(preview).toContainText("Alex Rivera");
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("perfil-escritorio.png"),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEditorBounds = await page
    .locator(".user-profile__card")
    .boundingBox();
  const mobilePreviewBounds = await preview.boundingBox();
  expect(mobilePreviewBounds!.y).toBeGreaterThan(
    mobileEditorBounds!.y + mobileEditorBounds!.height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("link", { name: "Perfil" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("perfil-movil.png"),
      fullPage: true,
    });
  await page.evaluate(() => localStorage.setItem("aether:day-theme", "dark"));
  await page.reload();
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "dark",
  );
  await expect(preview).toContainText("Alex Rivera");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".user-profile__card")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("Mi día vacío ofrece un inicio claro, también en oscuro y móvil", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  let submittedDraft: Record<string, unknown> | undefined;
  await page.route("**/api/aether/initiatives", async (route) => {
    submittedDraft = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.fulfill({
      status: 201,
      json: {
        ...initiative,
        ...(submittedDraft as object),
        id: "00000000-0000-4000-8000-000000000099",
        status: "draft",
        version: 0,
        allowedActions: ["edit", "present"],
      },
    });
  });
  await page.route("**/api/aether/initiatives?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "Todo al día" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aquí empieza tu próximo avance" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Las iniciativas de este espacio aparecerán aquí, con las últimas actualizadas primero.",
    ),
  ).toBeVisible();
  expect(
    await page
      .locator(".day-recent")
      .evaluate((panel) => panel.getBoundingClientRect().height),
  ).toBeLessThan(260);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("mi-dia-escritorio.png"),
      fullPage: true,
    });
  await page
    .getByRole("group", { name: "Tipo de trabajo" })
    .getByRole("button", { name: /Proyectos/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tus proyectos tendrán su lugar aquí" }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "dark",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: /Equipo Aurora.*Operaciones/ })
    .click();
  await expect(page.getByText("CAMBIAR DE LUGAR")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("mi-dia-oscuro.png"),
      fullPage: true,
    });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "light",
  );
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("mi-dia-movil.png"),
      fullPage: true,
    });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "Nueva iniciativa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Nueva iniciativa", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Nombre del proyecto").fill("Atención sin esperas");
  await page
    .locator("#initiative-summary")
    .fill("Agilizar el primer contacto.");
  await page
    .locator("#initiative-problem")
    .fill("Las personas esperan demasiado para ser atendidas.");
  const alignedFieldTops = await Promise.all(
    ["#initiative-summary", "#initiative-problem"].map((selector) =>
      page
        .locator(selector)
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    ),
  );
  expect(
    Math.abs(alignedFieldTops[0]! - alignedFieldTops[1]!),
  ).toBeLessThanOrEqual(1);
  const fieldWidths = await Promise.all(
    ["#initiative-project-name", "#initiative-summary"].map((selector) =>
      page
        .locator(selector)
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
    ),
  );
  expect(fieldWidths[0]!).toBeGreaterThan(fieldWidths[1]! * 1.8);
  const actionButtonWidths = await page
    .locator(".initiative-wizard__actions .ui-button")
    .evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
    );
  expect(
    Math.abs(actionButtonWidths[0]! - actionButtonWidths[1]!),
  ).toBeLessThanOrEqual(1);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("nueva-iniciativa-contexto.png"),
      fullPage: true,
    });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page
    .locator("#initiative-impacted-people")
    .fill("Personas usuarias y equipos de atención.");
  await page.locator("#initiative-impacted-count").fill("125");
  await page
    .locator("#initiative-impact")
    .fill("Aumenta los abandonos y la carga del equipo.");
  const impactFieldTops = await Promise.all(
    ["#initiative-impacted-people", "#initiative-impact"].map((selector) =>
      page
        .locator(selector)
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    ),
  );
  expect(
    Math.abs(impactFieldTops[0]! - impactFieldTops[1]!),
  ).toBeLessThanOrEqual(1);
  const countWidth = await page
    .locator("#initiative-impacted-count")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(countWidth).toBeLessThan(280);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("nueva-iniciativa-impacto.png"),
      fullPage: true,
    });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page
    .locator("#initiative-value")
    .fill("Reducir la espera mediana en un 20%.");
  await page
    .locator("#initiative-solution")
    .fill("Un sistema de orientación en el ingreso.");
  await page
    .locator("#initiative-differentiation")
    .fill("Se adapta a la capacidad diaria del equipo.");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page
    .locator("#initiative-stage-rationale")
    .fill("La idea aún está en validación con usuarios.");
  await page
    .locator("#initiative-pilot-plan")
    .fill("Probar durante cuatro semanas en una sede.");
  await page
    .locator("#initiative-pilot-resources")
    .fill("Dos personas, métricas de atención y cuatro semanas.");
  const pilotFieldTops = await Promise.all(
    ["#initiative-pilot-plan", "#initiative-pilot-resources"].map((selector) =>
      page
        .locator(selector)
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    ),
  );
  expect(Math.abs(pilotFieldTops[0]! - pilotFieldTops[1]!)).toBeLessThanOrEqual(
    1,
  );
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("nueva-iniciativa-pilotaje.png"),
      fullPage: true,
    });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Guardar como borrador" }),
  ).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Guardar como borrador" }).click();
  await expect(page.getByText("Borrador creado correctamente.")).toBeVisible();
  await expect(
    page.getByText("Reducir la espera mediana en un 20%.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Un sistema de orientación en el ingreso.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Probar durante cuatro semanas en una sede.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(submittedDraft).toMatchObject({
    title: "Atención sin esperas",
    problemStatement: "Las personas esperan demasiado para ser atendidas.",
    expectedOutcome: "Reducir la espera mediana en un 20%.",
    proposalDetails: {
      summary: "Agilizar el primer contacto.",
      impactedPeople: "Personas usuarias y equipos de atención.",
      impactedCount: 125,
      problemImpact: "Aumenta los abandonos y la carga del equipo.",
      solution: "Un sistema de orientación en el ingreso.",
      differentiation: "Se adapta a la capacidad diaria del equipo.",
      projectStage: "idea",
      stageRationale: "La idea aún está en validación con usuarios.",
      pilotPlan: "Probar durante cuatro semanas en una sede.",
      pilotResources: "Dos personas, métricas de atención y cuatro semanas.",
    },
  });
});

test("la bandeja filtra tareas reales y permite recuperar una combinación vacía", async ({
  page,
  browserName,
}, testInfo) => {
  await mockWorkspace(page);
  const work = [
    {
      action: {
        id: "a",
        projectId: "p",
        description: "Preparar la propuesta de mejora del servicio",
        workflowStatus: "in_progress",
        dueOn: "2026-01-01",
        blockedReason: null,
        position: 1,
      },
      kinds: ["owned"],
    },
    {
      action: {
        id: "b",
        projectId: "p",
        description: "Validar el alcance con el equipo",
        workflowStatus: "to_do",
        dueOn: null,
        blockedReason: "Falta la validación del alcance",
        position: 2,
      },
      kinds: ["unblock"],
    },
    {
      action: {
        id: "c",
        projectId: "p",
        description: "Una tarea terminada",
        workflowStatus: "done",
        dueOn: null,
        blockedReason: null,
        position: 3,
      },
      kinds: ["owned"],
    },
  ];
  await page.route("**/api/aether/organizations/*/my-work", (route) =>
    route.fulfill({ json: work }),
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "2 tareas pendientes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ver mis tareas" }).click();
  const inbox = page.getByRole("region", { name: "Mi trabajo", exact: true });
  await expect(inbox.getByRole("listitem")).toHaveCount(2);
  await expect(inbox.getByText("Una tarea terminada")).toHaveCount(0);
  await expect(inbox.getByText(/Vencida/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (browserName === "chromium")
    await page.screenshot({
      path: testInfo.outputPath("mi-dia-con-trabajo.png"),
      fullPage: true,
    });
  await inbox.getByRole("button", { name: "En curso", exact: true }).click();
  await expect(inbox.getByRole("listitem")).toHaveCount(1);
  await inbox.getByLabel("Relación").selectOption("unblock");
  await expect(
    inbox.getByRole("heading", { name: "Sin tareas con estos filtros" }),
  ).toBeVisible();
  await inbox.getByRole("button", { name: "Mostrar todas las tareas" }).click();
  await expect(inbox.getByRole("listitem")).toHaveCount(2);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace-app")).toHaveAttribute(
    "data-day-theme",
    "dark",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("un fallo de la bandeja se puede reintentar y nunca se presenta como éxito", async ({
  page,
}) => {
  await mockWorkspace(page);
  let fail = true;
  await page.route("**/api/aether/organizations/*/my-work", (route) =>
    fail
      ? route.fulfill({
          status: 500,
          json: { message: "Servicio no disponible" },
        })
      : route.fulfill({ json: [] }),
  );
  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "No pudimos consultar tus tareas" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Todo al día" })).toHaveCount(
    0,
  );
  fail = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo al día" }),
  ).toBeVisible();
});
