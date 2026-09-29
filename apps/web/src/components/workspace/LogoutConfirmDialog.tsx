"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, LogOut, X } from "lucide-react";

type LogoutConfirmDialogProps = {
  open: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LogoutConfirmDialog({
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: LogoutConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="workspace-logout-dialog"
      aria-labelledby="workspace-logout-title"
      aria-describedby="workspace-logout-description"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onCancel();
      }}
    >
      <div className="workspace-logout-dialog__icon" aria-hidden="true">
        <LogOut size={23} strokeWidth={1.8} />
      </div>
      <button
        className="workspace-logout-dialog__close"
        type="button"
        aria-label="Cancelar y cerrar diálogo"
        disabled={busy}
        onClick={onCancel}
      >
        <X size={19} aria-hidden="true" />
      </button>
      <p className="workspace-logout-dialog__eyebrow">TU ESPACIO EN AETHER</p>
      <h2 id="workspace-logout-title">¿Cerrar sesión?</h2>
      <p id="workspace-logout-description">
        Podrás volver cuando quieras. Tu trabajo y tus proyectos permanecerán
        aquí.
      </p>
      {error ? (
        <p className="workspace-logout-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="workspace-logout-dialog__actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Seguir en AETHER
        </button>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? "Cerrando sesión…" : "Sí, cerrar sesión"}
          {!busy ? <ArrowRight size={17} aria-hidden="true" /> : null}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
