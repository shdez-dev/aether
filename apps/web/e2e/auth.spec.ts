import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("acceso OIDC desde la nueva pantalla de inicio", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Qué bueno tenerte de vuelta.",
  );
  await expect(page.locator(".auth-orbit__hex")).toHaveCSS(
    "stroke-dasharray",
    "none",
  );
  const markAlignment = await page.evaluate(() => {
    const bars = document
      .querySelector<SVGGraphicsElement>(".auth-orbit__mark path")
      ?.getBBox();
    const center = document
      .querySelector<SVGGraphicsElement>(".auth-orbit__core")
      ?.getBBox();
    if (!bars || !center) throw new Error("Falta el símbolo de AETHER");
    return {
      horizontal: bars.x + bars.width / 2 - (center.x + center.width / 2),
      vertical: bars.y + bars.height / 2 - (center.y + center.height / 2),
    };
  });
  expect(Math.abs(markAlignment.horizontal)).toBeLessThanOrEqual(1);
  expect(Math.abs(markAlignment.vertical)).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("link", { name: "Iniciar sesión", exact: true }),
  ).toHaveAttribute("href", "/auth/continuar");
  const redirect = await request.get("/auth/continuar", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  const loginUrl = new URL(redirect.headers().location ?? "/", page.url());
  expect(loginUrl.pathname).toBe("/auth/login");
  const normalizeLoopbackOrigin = (value: string) => {
    const url = new URL(value);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      url.hostname = "loopback";
    return url.origin;
  };
  expect([
    new URL(process.env.AETHER_API_URL ?? "http://127.0.0.1:4000").origin,
    normalizeLoopbackOrigin(page.url()),
  ]).toContain(normalizeLoopbackOrigin(loginUrl.href));
  await expect(
    page.getByRole("link", { name: "Crear cuenta" }),
  ).toHaveAttribute("href", "/auth/registro");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("un intento de acceso vencido ofrece un nuevo inicio sin mostrar JSON", async ({
  page,
}) => {
  await page.goto("/auth/login?reason=session-expired");
  await expect(page.locator(".auth-expired-notice")).toContainText(
    "Este intento de acceso ya no está disponible",
  );
  await expect(
    page.getByRole("link", { name: "Iniciar sesión", exact: true }),
  ).toHaveAttribute("href", "/auth/continuar");
});

test("registro personal conduce al proveedor de identidad", async ({
  page,
  request,
}) => {
  await page.goto("/auth/registro");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Tu lugar en AETHER empieza aquí.",
  );
  await expect(
    page.getByRole("link", { name: "Crear mi cuenta" }),
  ).toHaveAttribute("href", "/auth/crear-cuenta");
  const redirect = await request.get("/auth/crear-cuenta", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  const registrationUrl = new URL(
    redirect.headers().location ?? "/",
    page.url(),
  );
  expect(registrationUrl.pathname).toBe("/auth/register");
  expect([
    new URL(process.env.AETHER_API_URL ?? "http://127.0.0.1:4000").origin,
    new URL(page.url()).origin,
  ]).toContain(registrationUrl.origin);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("las dos páginas de acceso se adaptan a móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/auth/login", "/auth/registro"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  }
});

test("acceso y registro caben en pantallas de escritorio sin scroll", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1919, height: 950 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ["/auth/login", "/auth/registro"]) {
      await page.goto(path);
      const metrics = await page.evaluate(() => ({
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        storyBottom: document
          .querySelector(".auth-story")
          ?.getBoundingClientRect().bottom,
        surfaceBottom: document
          .querySelector(".auth-surface")
          ?.getBoundingClientRect().bottom,
      }));
      expect(
        metrics.pageHeight,
        `${path} @ ${viewport.width}×${viewport.height}`,
      ).toBeLessThanOrEqual(metrics.viewportHeight + 1);
      expect(metrics.storyBottom).toBeLessThanOrEqual(
        metrics.viewportHeight + 1,
      );
      expect(metrics.surfaceBottom).toBeLessThanOrEqual(
        metrics.viewportHeight + 1,
      );
    }
  }
});

test("una cuenta sin organización ve el primer acceso y sus dos caminos", async ({
  page,
}) => {
  let loggedOut = false;
  let identityLogoutVisited = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(
      loggedOut
        ? { status: 401, body: "{}" }
        : {
            json: {
              actorId: "new-actor",
              expiresAt: "2026-12-31T00:00:00.000Z",
            },
          },
    ),
  );
  await page.route("**/api/aether/organizations", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/auth/logout", (route) => {
    loggedOut = true;
    return route.fulfill({
      json: {
        logoutUrl:
          "https://identity.example/realms/aether-local/protocol/openid-connect/logout?client_id=aether-local&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A3100%2Fworkspace%3Flogged_out%3D1",
      },
    });
  });
  await page.route(
    "https://identity.example/realms/aether-local/protocol/openid-connect/logout**",
    (route) => {
      identityLogoutVisited = true;
      return route.fulfill({
        status: 302,
        headers: {
          location: "http://127.0.0.1:3100/workspace?logged_out=1",
        },
      });
    },
  );
  await page.goto("/workspace");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Empecemos por lo que te une.",
  );
  await expect(
    page.getByRole("button", { name: /^Crear organización/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Unirme con invitación/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Unirme con invitación/ }).click();
  await expect(page.getByLabel("Código de invitación")).toBeVisible();
  await page.getByRole("button", { name: /Volver a las opciones/ }).click();
  await page.getByRole("button", { name: /^Crear organización/ }).click();
  const organizationType = page.getByRole("combobox", {
    name: "Tipo de organización",
  });
  const organizationForm = page.locator(".first-steps__form");
  await page.waitForTimeout(350);
  const formBeforeOpen = await organizationForm.boundingBox();
  await organizationType.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.waitForTimeout(250);
  const formAfterOpen = await organizationForm.boundingBox();
  expect(formBeforeOpen).not.toBeNull();
  const menuPosition = await page
    .getByRole("listbox")
    .evaluate((menu) => getComputedStyle(menu).position);
  expect(menuPosition).toBe("absolute");
  expect(
    Math.abs((formAfterOpen?.height ?? 0) - (formBeforeOpen?.height ?? 0)),
  ).toBeLessThan(3);
  await page.getByRole("option", { name: /Uso personal/ }).click();
  await expect(organizationType).toContainText("Uso personal");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: /Cerrar sesión/ }).click();
  const logoutDialog = page.getByRole("dialog", { name: "¿Cerrar sesión?" });
  await expect(logoutDialog).toBeVisible();
  await expect(
    logoutDialog.getByText(/Tu trabajo y tus proyectos/),
  ).toBeVisible();
  expect(identityLogoutVisited).toBe(false);
  await logoutDialog.getByRole("button", { name: "Seguir en AETHER" }).click();
  await expect(logoutDialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Crea el espacio de tu equipo.",
  );
  await page.getByRole("button", { name: /Cerrar sesión/ }).click();
  await logoutDialog.getByRole("button", { name: "Sí, cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/workspace\?logged_out=1$/);
  expect(identityLogoutVisited).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Hasta pronto.",
  );
  await expect(
    page.getByText(/Tu sesión terminó, pero tus iniciativas y proyectos/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iniciar sesión" }),
  ).toHaveAttribute("href", "/auth/login");
  await expect(
    page.getByRole("link", { name: /Aparece otra cuenta/ }),
  ).toHaveAttribute("href", "/auth/identity-logout");
});

test("el workspace termina la carga y pide iniciar sesión si no hay sesión", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 401, body: "{}" }),
  );
  await page.goto("/workspace");

  await expect(
    page.getByText(
      "Inicia sesión para volver a tus iniciativas, decisiones y proyectos.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iniciar sesión" }),
  ).toHaveAttribute("href", "/auth/login");
});
