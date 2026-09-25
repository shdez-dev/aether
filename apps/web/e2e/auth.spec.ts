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
  expect(redirect.headers().location).toMatch(/\/auth\/login$/);
  await expect(
    page.getByRole("link", { name: "Crear cuenta" }),
  ).toHaveAttribute("href", "/auth/registro");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
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
  expect(redirect.headers().location).toMatch(/\/auth\/register$/);

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
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { actorId: "new-actor", expiresAt: "2026-12-31T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/aether/organizations", (route) =>
    route.fulfill({ json: [] }),
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

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
