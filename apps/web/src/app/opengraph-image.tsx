import { ImageResponse } from "next/og";
export const alt = "AETHER. Tus iniciativas. Tu equipo. Una misma dirección.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0f172a",
        color: "white",
        display: "flex",
        flexDirection: "column",
        padding: "70px",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          display: "flex",
          color: "#93c5fd",
          fontSize: 24,
          letterSpacing: 6,
        }}
      >
        AETHER
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 76,
          fontWeight: 700,
          letterSpacing: -3,
        }}
      >
        <span>Tus iniciativas. Tu equipo.</span>
        <span style={{ color: "#93c5fd" }}>Una misma dirección.</span>
      </div>
      <div style={{ display: "flex", fontSize: 24, color: "#cbd5e1" }}>
        Ideas, decisiones y proyectos conectados.
      </div>
    </div>,
    size,
  );
}
