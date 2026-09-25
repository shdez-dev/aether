import type { Metadata } from "next";
import { Header } from "../components/layout/Header";
import { Footer } from "../components/layout/Footer";
import {
  Hero,
  HexagonDock,
  PhasesSection,
  FeaturesGrid,
  ActorsGrid,
  WorkflowTimeline,
  ValueSection,
  SecuritySection,
  CTASection,
  MotionProvider,
} from "../components/home";
import { publicSite } from "../env";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function HomePage() {
  return (
    <div className="home-page">
      <a className="home-skip" href="#contenido" tabIndex={0}>
        Saltar al contenido
      </a>
      <Header />
      <MotionProvider>
        <HexagonDock />
        <main id="contenido" tabIndex={-1}>
          <Hero />
          <PhasesSection />
          <FeaturesGrid />
          <ActorsGrid />
          <WorkflowTimeline />
          <ValueSection />
          <SecuritySection />
          <CTASection demoEmail={publicSite.demoEmail} />
        </main>
      </MotionProvider>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Aether",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            url: publicSite.appUrl,
            description:
              "AETHER conecta las ideas de tu organización con las decisiones y los proyectos que las hacen avanzar.",
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
