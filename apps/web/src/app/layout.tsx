import type { Metadata } from "next";
import type { ReactNode } from "react";

import localFont from "next/font/local";
import "../styles/globals.css";
import { publicSite } from "../env";

const inter = localFont({
  src: "../styles/fonts/inter-latin-wght-normal.woff2",
  variable: "--font-aether",
  display: "swap",
  weight: "100 900",
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(publicSite.appUrl),
  title: "AETHER | Tus iniciativas. Tu equipo. Una misma dirección.",
  description:
    "Conecta las ideas de tu organización con las decisiones y los proyectos que las hacen avanzar. Descubre AETHER: todo el recorrido en un mismo lugar.",
  openGraph: {
    type: "website",
    locale: "es_CL",
    siteName: "Aether",
    title: "AETHER | Una misma dirección",
    description: "Ideas, decisiones y proyectos conectados con tu equipo.",
  },
  twitter: {
    card: "summary_large_image",
    title: "AETHER | Una misma dirección",
    description: "Ideas, decisiones y proyectos conectados con tu equipo.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
