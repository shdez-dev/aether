import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("home de producto, seis fases y SRS no publicado", async ({
  page,
  request,
}) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(page.locator("h1")).toContainText("Tus iniciativas");
  await expect(page.locator(".phase-card")).toHaveCount(6);
  await expect(page.locator("#hexagon")).not.toContainText(
    /CONTEXTO COMPARTIDO|01 — 06/,
  );
  await expect(page.locator(".actor-card")).toHaveCount(3);
  await expect(page.locator(".value-tile")).toHaveCount(3);
  await expect(page.locator("main")).not.toContainText(
    /SRS|SLA|RTO|RPO|append-only|CSRF|OIDC|99\.5/,
  );
  await expect(page.locator("a[download]")).toHaveCount(0);
  const phase = page.getByRole("link", {
    name: "Fase 3: Evaluación",
    exact: true,
  });
  await phase.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const { x, y, width, height } = (await tooltip.boundingBox())!;
  await page.mouse.move(x + width / 2, y + height / 2);
  await expect(tooltip).toBeVisible();
  await phase.focus();
  await phase.press("Escape");
  await expect(page.getByRole("tooltip")).not.toBeVisible();
  await phase.blur();
  await phase.focus();
  await expect(page.getByRole("tooltip")).toContainText("Evaluación");
  await phase.press("Enter");
  await expect(page).toHaveURL(/#phase-evaluacion$/);
  await page.locator("#phase-evaluacion summary").click();
  await expect(page.locator("#phase-evaluacion details")).toHaveAttribute(
    "open",
    "",
  );
  const srs = await request.get("/documents/aether-srs-v1.1.pdf");
  expect(srs.status()).toBe(404);
  await page.goto("/seguridad");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Controles explícitos",
  );
  await page
    .locator(".site-header")
    .getByRole("link", { name: "Aether, inicio" })
    .click();
  await page
    .locator("#hero")
    .getByRole("link", { name: "Cómo funciona" })
    .click();
  await expect(page).toHaveURL(/\/#phases$/);
});

test("teclado, diálogo, validación y borrador sin envío", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Saltar al contenido" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const trigger = page.getByRole("button", {
    name: "Solicitar demo",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("animation-name", "dialog-in");
  await dialog.getByRole("button", { name: "Preparar solicitud" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Revisa");
  await expect(dialog.getByLabel("Nombre (obligatorio)")).toBeFocused();
  await dialog.getByLabel("Nombre (obligatorio)").fill("Persona de prueba");
  await dialog
    .getByLabel("Correo electrónico (obligatorio)")
    .fill("prueba@example.org");
  await dialog
    .getByLabel("Organización (obligatorio)")
    .fill("Organización de prueba");
  await dialog.getByRole("button", { name: "Preparar solicitud" }).click();
  const draft = dialog.getByRole("link", { name: "Abrir correo y revisar" });
  await expect(draft).toHaveAttribute(
    "href",
    /^mailto:juanhernandezr0075@gmail\.com\?/,
  );
  await expect(dialog.getByRole("status")).toContainText(
    "Aún no se ha enviado",
  );
  await expect(dialog.getByLabel("Nombre (obligatorio)")).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    page.getByRole("dialog").getByLabel("Nombre (obligatorio)"),
  ).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("rotor continuo, interacción y cambio de preferencia", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const rotor = page.locator(".hex-rotor-bars").first();
  await expect(rotor).toHaveCSS("animation-name", "hex-breathe-spin");
  await expect(rotor).toHaveCSS("animation-iteration-count", "infinite");
  const poses = await rotor.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error("No se encontró la animación del hexágono");
    animation.pause();
    const sample = (time: number) => {
      animation.currentTime = time;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return {
        scale: Math.hypot(matrix.a, matrix.b),
        rotation: Math.abs(matrix.b),
      };
    };
    const start = sample(0);
    const contracted = sample(1584);
    const turning = sample(3600);
    animation.play();
    return { start, contracted, turning };
  });
  expect(poses.contracted.scale).toBeLessThan(poses.start.scale - 0.05);
  expect(poses.turning.rotation).toBeGreaterThan(0.1);
  const phase = page.getByRole("link", {
    name: "Fase 2: Diagnóstico",
    exact: true,
  });
  await phase.hover();
  const connection = page.locator(".hex-connections path").nth(1);
  await expect(connection).toHaveAttribute("data-active", "true");
  await expect(connection).toHaveCSS("stroke-dashoffset", "0px");
  await page.locator("h1").hover();
  await expect(connection).toHaveCSS("opacity", "0");

  await page.clock.install();
  const start = page.getByRole("button", { name: "Reproducir recorrido" });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeVisible();
  await page.clock.runFor(6000);
  await expect(
    page.getByRole("button", { name: /1 Necesidad/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await start.click();
  await page.clock.runFor(5000);
  await expect(
    page.getByRole("button", { name: /2 Propuesta/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.clock.runFor(6000);
  await expect(
    page.getByRole("button", { name: /2 Propuesta/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(rotor).toHaveCSS("animation-name", "none");
  await expect(
    page.getByRole("button", { name: "Recorrido estático" }),
  ).toBeDisabled();
  await page.clock.runFor(6000);
  await expect(
    page.getByRole("button", { name: /2 Propuesta/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".workflow-copy")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("encabezado compacto sin enlaces de secciones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const header = page.locator(".site-header");
  await expect(
    header.getByRole("link", { name: "Aether, inicio" }),
  ).toBeVisible();
  await expect(header.getByRole("link", { name: "Ingresar" })).toBeVisible();
  await expect(header).not.toContainText(/El ciclo|La plataforma|Seguridad/);
  await expect(header.getByRole("navigation")).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Abrir menú" })).toHaveCount(
    0,
  );
});

test("volver al inicio flota al desplazarse y desaparece arriba", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const backToTop = page.getByRole("button", {
    name: "Volver al inicio",
    includeHidden: true,
  });
  await expect(page.locator(".footer-bottom")).not.toContainText(
    "Volver al inicio",
  );
  await expect(backToTop).toBeHidden();
  await page
    .locator("#value")
    .evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  await expect(backToTop).toBeVisible();
  await expect(backToTop).toHaveCSS("position", "fixed");
  await expect(backToTop).toHaveCSS("width", "48px");
  await expect(backToTop).toHaveText("");
  await expect(backToTop).toHaveCSS("opacity", "1");
  await backToTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(backToTop).toBeHidden();
  await expect(page.locator(".site-header .brand")).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator("#security")
    .evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  await expect(backToTop).toBeVisible();
  await backToTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("hexágono acompaña el scroll y señala la sección actual", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const dock = page.getByRole("navigation", {
    name: "Secciones de la página",
    includeHidden: true,
  });
  const travelingHexagon = page.locator("#hexagon .hex-diagram");
  await expect(dock).toBeHidden();
  const heroRect = await travelingHexagon.evaluate((element) => {
    const { left, width } = element.getBoundingClientRect();
    return { left, width };
  });
  await page.evaluate(() => window.scrollTo({ top: 350, behavior: "instant" }));
  await expect(travelingHexagon).toHaveCSS("position", "fixed");
  await expect(dock).toBeHidden();
  const travelingRect = await travelingHexagon.evaluate((element) => {
    const { left, width } = element.getBoundingClientRect();
    return { left, width };
  });
  expect(travelingRect.width).toBeGreaterThan(160);
  expect(travelingRect.width).toBeLessThan(heroRect.width);
  expect(travelingRect.left).toBeGreaterThan(heroRect.left);
  await page.evaluate(() => window.scrollTo({ top: 550, behavior: "instant" }));
  await expect
    .poll(() =>
      travelingHexagon.evaluate(
        (element) => element.getBoundingClientRect().width,
      ),
    )
    .toBeLessThan(travelingRect.width);
  const laterRect = await travelingHexagon.evaluate((element) => {
    const { left, width } = element.getBoundingClientRect();
    return { left, width };
  });
  expect(laterRect.width).toBeLessThan(travelingRect.width);
  expect(laterRect.left).toBeGreaterThan(travelingRect.left);

  await page
    .locator("#features")
    .evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  await expect(dock).toBeVisible();
  await expect(travelingHexagon).toBeHidden();
  await expect(dock).not.toHaveAttribute("inert", "");
  await expect
    .poll(() =>
      dock
        .locator(".hex-dock-mark")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeCloseTo(160, 0);
  await expect(dock.locator('a[aria-current="location"]')).toHaveAttribute(
    "href",
    "#features",
  );
  await dock.getByRole("link", { name: "Ir a Tu equipo" }).click();
  await expect(page).toHaveURL(/#actors$/);
  await expect(dock.locator('a[aria-current="location"]')).toHaveAttribute(
    "href",
    "#actors",
  );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(travelingHexagon).toHaveCSS("position", "relative");
  await expect(dock).toBeHidden();

  await page
    .locator("#contacto")
    .evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  await expect(dock).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator("#security")
    .evaluate((element) =>
      element.scrollIntoView({ behavior: "instant", block: "start" }),
    );
  await expect(dock).toBeVisible();
  await expect(dock.locator(".hex-dock-rotor")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await expect(travelingHexagon).toHaveCSS("position", "relative");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dock).toBeHidden();
  await expect(travelingHexagon).toHaveCSS("visibility", "visible");
});

for (const width of [390, 768, 1440]) {
  test(`responsive ${width}px, contraste y movimiento reducido`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".hex-rotor-bars").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.locator(".site-header").getByRole("navigation"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /6 Proyecto/ }).click();
    await expect(page.locator("#workflow-detail")).toContainText(
      "objetivo, alcance y responsables",
    );
    await expect(
      page.getByRole("button", { name: "Recorrido estático" }),
    ).toBeDisabled();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `test-results/home-${width}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}

test("contenido útil antes de JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3100/");
  await expect(page.locator("h1")).toContainText("Tus iniciativas");
  await expect(page.locator("#phase-proyecto")).toContainText(
    "Transforma una iniciativa aprobada",
  );
  await expect(page.locator(".value-tile").first()).toContainText("Claridad");
  await context.close();
});
