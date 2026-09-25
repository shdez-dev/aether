/** Tokens y componentes accesibles sin conocimiento del dominio. */
export const designTokens = Object.freeze({
  color: {
    ink: "#172033",
    surface: "#ffffff",
    brand: "#193c78",
    muted: "#f4f6fa",
    danger: "#a51d2d",
  },
  radius: { card: "12px", control: "7px" },
  space: { xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem" },
});
export * from "./components.js";
export * from "./primitives/action-button.js";
export * from "./primitives/dialog.js";
export * from "./lib/cn.js";
