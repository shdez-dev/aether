import { describe, expect, it } from "vitest";
import { demoRequestSchema, publicSiteSchema } from "@aether/contracts";

describe("contrato público de contacto", () => {
  it("rechaza correo inválido y campos vacíos, sin aceptar esquemas de URL ejecutables", () => {
    expect(
      demoRequestSchema.safeParse({
        name: " ",
        email: "not-an-email",
        organization: " ",
        message: "",
      }).success,
    ).toBe(false);
    expect(
      publicSiteSchema.safeParse({
        appUrl: "javascript:alert(1)",
        demoEmail: "demo@example.org",
      }).success,
    ).toBe(false);
  });
  it("normaliza el texto y limita el contenido que llega al borrador", () => {
    const data = {
      name: "  Persona de prueba  ",
      email: "prueba@example.org",
      organization: "Organización",
      message: "",
    };
    expect(demoRequestSchema.parse(data).name).toBe("Persona de prueba");
    expect(
      demoRequestSchema.safeParse({ ...data, message: "x".repeat(1001) })
        .success,
    ).toBe(false);
  });
});
