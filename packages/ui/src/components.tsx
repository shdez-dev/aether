import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "primary" | "quiet" | "danger";
  },
) {
  const { tone = "primary", className = "", ...rest } = props;
  return (
    <button className={`ui-button ui-button--${tone} ${className}`} {...rest} />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = props.id ?? props.name;
  return (
    <label className="ui-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Card({
  children,
  title,
}: {
  children?: ReactNode;
  title?: string;
}) {
  return (
    <section className="ui-card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <span className={`ui-status ui-status--${tone}`}>{children}</span>;
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "error";
}) {
  return (
    <p
      className={`ui-notice ui-notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
