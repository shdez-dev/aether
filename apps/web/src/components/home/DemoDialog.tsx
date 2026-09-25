"use client";

import { useState, type FormEvent } from "react";
import { Mail, ArrowUpRight } from "lucide-react";
import { ActionButton } from "@aether/ui/action-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@aether/ui/dialog";
import { demoRequestSchema, type DemoRequest } from "@aether/contracts";
import { trackEvent } from "../../lib/utils/tracking";

type FieldName = keyof DemoRequest;
const fields = [
  {
    name: "name",
    label: "Nombre",
    autoComplete: "name",
    type: "text",
    max: 100,
  },
  {
    name: "email",
    label: "Correo electrónico",
    autoComplete: "email",
    type: "email",
    max: 254,
  },
  {
    name: "organization",
    label: "Organización",
    autoComplete: "organization",
    type: "text",
    max: 160,
  },
] as const;

export function DemoDialog({
  recipient,
  onClose,
}: {
  recipient: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [mailto, setMailto] = useState("");
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const result = demoRequestSchema.safeParse({
      name: values.get("name"),
      email: values.get("email"),
      organization: values.get("organization"),
      message: values.get("message"),
    });
    if (!result.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as FieldName;
        next[key] ??= issue.message;
      }
      setErrors(next);
      setMailto("");
      trackEvent("demo_invalid", "contacto");
      requestAnimationFrame(() =>
        document.getElementById(`demo-${Object.keys(next)[0]}`)?.focus(),
      );
      return;
    }
    setErrors({});
    const { name, email, organization, message } = result.data;
    const body = `Hola, me gustaría conocer Aether.\n\nNombre: ${name}\nCorreo: ${email}\nOrganización: ${organization}\n\n${message}\n`;
    setMailto(
      `mailto:${recipient}?subject=${encodeURIComponent("Solicitud de demo de Aether")}&body=${encodeURIComponent(body)}`,
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="dialog-symbol">
          <Mail aria-hidden="true" />
        </div>
        <DialogTitle className="dialog-title">
          Conversemos sobre tu organización.
        </DialogTitle>
        <DialogDescription className="dialog-description">
          Prepara una solicitud para {recipient}. Se abrirá tu aplicación de
          correo; tú revisas y envías el mensaje.
        </DialogDescription>
        <form
          className="demo-form"
          noValidate
          onSubmit={prepare}
          onChange={() => setMailto("")}
        >
          {fields.map((field) => (
            <div className="demo-field" key={field.name}>
              <label htmlFor={`demo-${field.name}`}>
                {field.label} <span>(obligatorio)</span>
              </label>
              <input
                id={`demo-${field.name}`}
                name={field.name}
                type={field.type}
                autoComplete={field.autoComplete}
                required
                maxLength={field.max}
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={
                  errors[field.name] ? `error-${field.name}` : undefined
                }
              />
              {errors[field.name] && (
                <p className="field-error" id={`error-${field.name}`}>
                  {errors[field.name]}
                </p>
              )}
            </div>
          ))}
          <div className="demo-field">
            <label htmlFor="demo-message">
              ¿Qué te gustaría resolver? <span>(opcional)</span>
            </label>
            <textarea
              id="demo-message"
              name="message"
              maxLength={1000}
              rows={3}
              aria-invalid={Boolean(errors.message)}
              aria-describedby={errors.message ? "error-message" : undefined}
            />
            {errors.message && (
              <p className="field-error" id="error-message">
                {errors.message}
              </p>
            )}
          </div>
          {Object.keys(errors).length > 0 && (
            <p className="field-error" role="alert">
              Revisa los campos indicados para preparar tu solicitud.
            </p>
          )}
          <p className="demo-privacy">
            Los datos se usan sólo para redactar tu correo. Esta página no los
            almacena ni los envía.
          </p>
          {mailto ? (
            <div className="demo-ready">
              <p role="status">
                Tu borrador está preparado. Aún no se ha enviado.
              </p>
              <ActionButton asChild>
                <a
                  href={mailto}
                  onClick={() => trackEvent("demo_draft", "email")}
                >
                  Abrir correo y revisar
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </ActionButton>
            </div>
          ) : (
            <ActionButton type="submit">
              Preparar solicitud
              <ArrowUpRight aria-hidden="true" />
            </ActionButton>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
