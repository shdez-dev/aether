export function WorkspaceSessionLoading() {
  return (
    <main className="workspace-session-loading">
      <div className="workspace-session-loading__brand" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="28" height="28">
          <path
            d="M31 12h38M75 16l19 33M94 57 75 90M69 94H31M25 90 6 57M6 49l19-33"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            transform="translate(5 0) scale(.9)"
          />
        </svg>
        <span>AETHER</span>
      </div>

      <div className="workspace-session-loading__content">
        <div className="workspace-session-loading__graphic" aria-hidden="true">
          <svg viewBox="0 0 320 320" role="presentation">
            <circle
              className="workspace-session-loading__orbit"
              cx="160"
              cy="160"
              r="139"
            />
            <path
              className="workspace-session-loading__outline"
              d="M160 45 260 102.5v115L160 275 60 217.5v-115z"
            />
            <circle
              className="workspace-session-loading__inner-ring"
              cx="160"
              cy="160"
              r="81"
            />
            <g className="workspace-session-loading__segments">
              {[0, 60, 120, 180, 240, 300].map((angle) => (
                <path
                  key={angle}
                  d="M130 92h60"
                  transform={`rotate(${angle} 160 160)`}
                />
              ))}
            </g>
            <circle
              className="workspace-session-loading__core"
              cx="160"
              cy="160"
              r="5"
            />
          </svg>
        </div>

        <div
          className="workspace-session-loading__message"
          role="status"
          aria-live="polite"
        >
          <span className="workspace-session-loading__eyebrow">
            Tu espacio en AETHER
          </span>
          <h1>Preparando tu espacio</h1>
          <p>Verificando tu sesión y cargando tu contexto de trabajo.</p>
        </div>
      </div>

      <p className="workspace-session-loading__footer">
        Todo conectado, en una misma dirección.
      </p>
    </main>
  );
}
