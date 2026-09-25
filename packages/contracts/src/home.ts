import { z } from "zod";

/** Public contact intent. The website opens a draft; it does not store leads. */
export const demoRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Escribe tu nombre (al menos 2 caracteres).")
    .max(100, "Usa hasta 100 caracteres."),
  email: z.email("Escribe un correo electrónico válido.").max(254),
  organization: z
    .string()
    .trim()
    .min(2, "Escribe el nombre de tu organización.")
    .max(160, "Usa hasta 160 caracteres."),
  message: z.string().trim().max(1000, "Usa hasta 1.000 caracteres."),
});

export type DemoRequest = z.infer<typeof demoRequestSchema>;

export const publicSiteSchema = z.object({
  appUrl: z
    .url()
    .refine(
      (value) => ["http:", "https:"].includes(new URL(value).protocol),
      "Usa una URL HTTP o HTTPS.",
    ),
  demoEmail: z.email(),
});
