import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("la comprobación de sesión muestra el hexágono animado y respeta movimiento reducido", async ({
  page,
}) => {
  let releaseSession!: () => void;
  const sessionPending = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });

  await page.route("**/api/auth/session", async (route) => {
    await sessionPending;
    await route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });

  await page.goto("/workspace");
  const loading = page.locator(".workspace-session-loading");
  const segments = loading.locator(".workspace-session-loading__segments");

  await expect(
    loading.getByRole("heading", { name: "Preparando tu espacio" }),
  ).toBeVisible();
  await expect(loading.getByRole("status")).toContainText(
    "Verificando tu sesión",
  );
  await expect(segments).toHaveCSS(
    "animation-name",
    "workspace-session-hexagon",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(segments).toHaveCSS("animation-name", "none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  releaseSession();
  await expect(
    page.getByRole("link", { name: "Iniciar sesión" }),
  ).toBeVisible();
});
