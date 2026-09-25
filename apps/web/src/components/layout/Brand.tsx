export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a
      className={`brand${inverse ? " brand-inverse" : ""}`}
      href="/"
      aria-label="Aether, inicio"
    >
      <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true">
        <path
          d="M31 12h38M75 16l19 33M94 57 75 90M69 94H31M25 90 6 57M6 49l19-33"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          transform="translate(5 0) scale(.9)"
        />
      </svg>
      <span>AETHER</span>
    </a>
  );
}
