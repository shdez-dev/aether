"use client";

import { Camera, Check, Eye, LoaderCircle, UserRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { UserProfileInput, UserProfileResponse } from "@aether/contracts";
import { ProfileRoleField } from "./ProfileRoleField";

const emptyProfile: UserProfileInput = {
  displayName: "",
  role: "",
  bio: "",
  avatarData: null,
};

function editableFields(profile: UserProfileResponse): UserProfileInput {
  return {
    displayName: profile.displayName,
    role: profile.role,
    bio: profile.bio,
    avatarData: profile.avatarData,
  };
}

export function UserProfile({
  request,
}: {
  request: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [saved, setSaved] = useState<UserProfileInput>(emptyProfile);
  const [draft, setDraft] = useState<UserProfileInput>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const nameHelpId = useId();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    void request("me/profile")
      .then((response) => response.json() as Promise<UserProfileResponse>)
      .then((profile) => {
        if (!active) return;
        setSaved(editableFields(profile));
        setDraft(editableFields(profile));
      })
      .catch((caught: unknown) => {
        if (active) {
          setLoadFailed(true);
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo cargar tu perfil.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, loadAttempt]);

  async function selectPhoto(file?: File) {
    if (!file) return;
    setNotice("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 500_000
    ) {
      setError("Usa una foto PNG, JPG o WebP de hasta 500 KB.");
      return;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("No se pudo leer la foto."));
      reader.readAsDataURL(file);
    }).catch((caught: unknown) => {
      setError(
        caught instanceof Error ? caught.message : "No se pudo leer la foto.",
      );
      return null;
    });
    if (data) {
      setDraft((current) => ({ ...current, avatarData: data }));
      setError("");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || loadFailed || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await request("me/profile", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      const profile = (await response.json()) as UserProfileResponse;
      setSaved(editableFields(profile));
      setDraft(editableFields(profile));
      setNotice("Tu perfil se guardó correctamente.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo guardar tu perfil.",
      );
    } finally {
      setSaving(false);
    }
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <section className="daily-desk user-profile" aria-label="Tu perfil">
      <header className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">TU IDENTIDAD EN AETHER</p>
          <h1>Perfil</h1>
          <p>Preséntate a tu equipo y mantén actualizada tu información.</p>
        </div>
      </header>

      <div className="user-profile__layout">
        <form
          className="day-panel user-profile__card"
          onSubmit={(event) => void save(event)}
          aria-busy={loading || saving}
        >
          {loading ? (
            <p className="user-profile__feedback" role="status">
              Cargando perfil…
            </p>
          ) : null}
          <div className="user-profile__intro">
            <div
              className="user-profile__avatar"
              role="img"
              aria-label="Vista previa de tu foto"
            >
              {draft.avatarData ? (
                <img src={draft.avatarData} alt="" />
              ) : (
                <UserRound size={42} strokeWidth={1.4} aria-hidden="true" />
              )}
            </div>
            <div className="user-profile__photo-actions">
              <h2>Tu foto</h2>
              <p>PNG, JPG o WebP · máximo 500 KB</p>
              <input
                ref={fileInput}
                className="user-profile__file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void selectPhoto(event.target.files?.[0])}
                disabled={loading || loadFailed || saving}
              />
              <div className="user-profile__photo-buttons">
                <button
                  type="button"
                  className="day-button day-button--secondary"
                  onClick={() => fileInput.current?.click()}
                  disabled={loading || loadFailed || saving}
                >
                  <Camera size={16} aria-hidden="true" />{" "}
                  {draft.avatarData ? "Cambiar foto" : "Subir foto"}
                </button>
                {draft.avatarData ? (
                  <button
                    type="button"
                    className="day-button day-button--quiet"
                    onClick={() =>
                      setDraft((current) => ({ ...current, avatarData: null }))
                    }
                    disabled={loading || loadFailed || saving}
                  >
                    <X size={16} aria-hidden="true" /> Quitar
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="user-profile__fields">
            <div className="user-profile__field">
              <label htmlFor={nameId}>Nombre</label>
              <input
                id={nameId}
                value={draft.displayName}
                onChange={(event) =>
                  setDraft({ ...draft, displayName: event.target.value })
                }
                maxLength={120}
                placeholder="¿Cómo quieres que te llamen?"
                autoComplete="name"
                aria-describedby={nameHelpId}
                disabled={loading || loadFailed || saving}
              />
              <small id={nameHelpId}>
                Puedes cambiar cómo apareces en Aether sin modificar tu acceso.
              </small>
            </div>
            <ProfileRoleField
              value={draft.role}
              onChange={(role) => setDraft((current) => ({ ...current, role }))}
              disabled={loading || loadFailed || saving}
            />
            <label className="user-profile__field user-profile__field--full">
              <span>Biografía</span>
              <textarea
                value={draft.bio}
                onChange={(event) =>
                  setDraft({ ...draft, bio: event.target.value })
                }
                maxLength={600}
                rows={5}
                placeholder="Cuéntale al equipo en qué trabajas, qué te interesa o cómo pueden colaborar contigo."
                disabled={loading || loadFailed || saving}
              />
              <small>{draft.bio.length}/600 caracteres</small>
            </label>
          </div>
          {error ? (
            <p className="user-profile__feedback is-error" role="alert">
              {error}
            </p>
          ) : null}
          {loadFailed ? (
            <button
              type="button"
              className="day-button day-button--secondary"
              onClick={() => setLoadAttempt((count) => count + 1)}
            >
              Reintentar carga
            </button>
          ) : null}
          {notice ? (
            <p className="user-profile__feedback" role="status">
              <Check size={17} aria-hidden="true" />
              {notice}
            </p>
          ) : null}
          <div className="user-profile__footer">
            <p>
              Estos datos se guardan en tu cuenta, aunque cambies de espacio.
            </p>
            <button
              className="day-button day-button--primary"
              type="submit"
              disabled={loading || loadFailed || saving || !changed}
            >
              {saving ? (
                <LoaderCircle
                  className="user-profile__saving-icon"
                  size={16}
                  aria-hidden="true"
                />
              ) : null}
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
        <aside
          className="user-profile__preview"
          aria-labelledby="profile-preview-title"
        >
          <div className="user-profile__preview-heading">
            <div>
              <p className="workspace-kicker">ASÍ SE VERÍA</p>
              <h2 id="profile-preview-title">Vista previa</h2>
            </div>
            <Eye size={19} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="user-profile__preview-card">
            <div className="user-profile__preview-cover" aria-hidden="true">
              <span>AETHER</span>
            </div>
            <div className="user-profile__preview-content">
              <div
                className="user-profile__preview-avatar"
                role="img"
                aria-label="Foto en la vista previa"
              >
                {draft.avatarData ? (
                  <img src={draft.avatarData} alt="" />
                ) : (
                  <UserRound size={36} strokeWidth={1.5} aria-hidden="true" />
                )}
              </div>
              <div className="user-profile__preview-identity">
                <h3
                  className={
                    draft.displayName.trim() ? undefined : "is-placeholder"
                  }
                >
                  {draft.displayName.trim() || "Tu nombre"}
                </h3>
                <p
                  className={
                    draft.role.trim()
                      ? "user-profile__preview-role"
                      : "user-profile__preview-role is-placeholder"
                  }
                >
                  {draft.role.trim() || "Tu rol o especialidad"}
                </p>
              </div>
              <div className="user-profile__preview-about">
                <h4>ACERCA DE MÍ</h4>
                <p className={draft.bio.trim() ? undefined : "is-placeholder"}>
                  {draft.bio.trim() ||
                    "Tu presentación aparecerá aquí cuando escribas tu biografía."}
                </p>
              </div>
            </div>
          </div>
          <p className="user-profile__preview-note">
            Esta tarjeta muestra tus cambios al instante. Para conservarlos,
            selecciona «Guardar cambios».
          </p>
        </aside>
      </div>
    </section>
  );
}
