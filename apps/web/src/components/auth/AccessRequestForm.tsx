"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Mail } from "lucide-react";
import { demoRequestSchema, type DemoRequest } from "@aether/contracts";

type FieldName = keyof DemoRequest;

export function AccessRequestForm({ recipient }: { recipient: string }) {
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [draftUrl, setDraftUrl] = useState("");

  function prepareRequest(event: FormEvent<HTMLFormElement>) {
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
        const field = issue.path[0] as FieldName;
        next[field] ??= issue.message;
      }
      setErrors(next);
      setDraftUrl("");
      requestAnimationFrame(() =>
        document.getElementById(`access-${Object.keys(next)[0]}`)?.focus(),
      );
      return;
    }

    setErrors({});
    const { name, email, organization, message } = result.data;
    const body = [
      "Hola, me gustaría solicitar acceso a AETHER para mi organización.",
      "",
      `Nombre: ${name}`,
      `Correo: ${email}`,
      `Organización: ${organization}`,
      ...(message ? ["", `Contexto: ${message}`] : []),
      "",
      "Quedo atento/a a los siguientes pasos.",
    ].join("\n");
    setDraftUrl(
      `mailto:${recipient}?subject=${encodeURIComponent("Solicitud de acceso a AETHER")}&body=${encodeURIComponent(body)}`,
    );
  }

  return (
    <form
      className="auth-request-form"
      noValidate
      onSubmit={prepareRequest}
      onChange={() => setDraftUrl("")}
    >
      <div className="auth-form-row">
        <div className="auth-field">
          <label htmlFor="access-name">Tu nombre</label>
          <input
            id="access-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Nombre y apellido"
            maxLength={100}
            required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "access-name-error" : undefined}
          />
          {errors.name && (
            <span id="access-name-error" className="auth-field-error">
              {errors.name}
            </span>
          )}
        </div>
        <div className="auth-field">
          <label htmlFor="access-email">Correo de trabajo</label>
          <input
            id="access-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="tu@organizacion.com"
            maxLength={254}
            required
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "access-email-error" : undefined}
          />
          {errors.email && (
            <span id="access-email-error" className="auth-field-error">
              {errors.email}
            </span>
          )}
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="access-organization">Organización</label>
        <input
          id="access-organization"
          name="organization"
          type="text"
          autoComplete="organization"
          placeholder="Nombre de tu organización"
          maxLength={160}
          required
          aria-invalid={Boolean(errors.organization)}
          aria-describedby={
            errors.organization ? "access-organization-error" : undefined
          }
        />
        {errors.organization && (
          <span id="access-organization-error" className="auth-field-error">
            {errors.organization}
          </span>
        )}
      </div>
      <div className="auth-field">
        <label htmlFor="access-message">
          ¿Qué quieren impulsar? <span>Opcional</span>
        </label>
        <textarea
          id="access-message"
          name="message"
          rows={3}
          maxLength={1000}
          placeholder="Cuéntanos brevemente sobre tu equipo o proyecto"
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "access-message-error" : undefined}
        />
        {errors.message && (
          <span id="access-message-error" className="auth-field-error">
            {errors.message}
          </span>
        )}
      </div>
      {Object.keys(errors).length > 0 && (
        <p className="auth-form-error" role="alert">
          Revisa los campos indicados para continuar.
        </p>
      )}
      <p className="auth-form-note">
        Estos datos sólo preparan un correo en tu dispositivo. Nada se envía ni
        almacena desde esta página.
      </p>
      {draftUrl ? (
        <div className="auth-form-ready">
          <p role="status">
            <Check size={16} aria-hidden="true" /> Borrador listo; todavía no se
            ha enviado.
          </p>
          <a className="auth-primary" href={draftUrl}>
            Abrir correo para enviar
            <Mail size={18} strokeWidth={1.8} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <button className="auth-primary" type="submit">
          Preparar solicitud de acceso
          <ArrowRight size={19} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
