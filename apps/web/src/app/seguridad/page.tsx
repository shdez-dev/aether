import type { Metadata } from "next";
import { Header } from "../../components/layout/Header";
import { Footer } from "../../components/layout/Footer";

export const metadata: Metadata = {
  title: "Arquitectura de seguridad | Aether",
  alternates: { canonical: "/seguridad" },
};

export default function SecurityPage() {
  return (
    <div className="home-page">
      <a className="home-skip" href="#contenido" tabIndex={0}>
        Saltar al contenido
      </a>
      <Header />
      <main className="home-container security-document section" id="contenido">
        <p className="eyebrow">Arquitectura de seguridad</p>
        <h1>
          Controles explícitos.
          <br />
          Evidencia verificable.
        </h1>
        <p>
          Descripción de los controles presentes en el proyecto Aether. No
          constituye una certificación ni un acuerdo de nivel de servicio.
        </p>
        <h2>Identidad y sesión</h2>
        <p>
          La autenticación utiliza OIDC con Keycloak, PKCE S256, state y nonce.
          El navegador recibe identificadores de sesión opacos en cookies
          HttpOnly; los tokens del proveedor no se usan como credencial de
          sesión en el navegador.
        </p>
        <h2>Acceso y aislamiento</h2>
        <p>
          La API resuelve identidad, organización, workspace, recurso y acción.
          Las mutaciones verifican origen y token CSRF. Una capacidad visible en
          la interfaz no sustituye la autorización del servidor.
        </p>
        <h2>Auditoría y continuidad</h2>
        <p>
          Los cambios institucionales y sus eventos append-only se confirman en
          la misma transacción. El outbox permite reintentos controlados y
          recuperación de entregas fallidas sin tratar los logs como evidencia
          de negocio.
        </p>
        <h2>Soporte con alcance limitado</h2>
        <p>
          El acceso JIT requiere elegibilidad, autenticación reciente, motivo,
          duración y aprobación por un owner distinto. El diagnóstico es
          agregado y no abre el contenido institucional. El acceso vence, puede
          revocarse y deja auditoría.
        </p>
        <h2>Responsabilidades del despliegue</h2>
        <p>
          TLS, un gestor seguro de secretos, respaldos cifrados y pruebas de
          restauración deben configurarse y validarse en el entorno productivo.
          La disponibilidad y los tiempos de recuperación requieren evidencia
          operacional antes de declararse como garantías del servicio.
        </p>
        <a className="document-back" href="/">
          Volver a Aether
        </a>
      </main>
      <Footer />
    </div>
  );
}
