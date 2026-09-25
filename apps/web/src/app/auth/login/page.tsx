import type { Metadata } from "next";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { AuthFrame } from "../../../components/auth/AuthFrame";

export const metadata: Metadata = {
  title: "Iniciar sesión | AETHER",
  description: "Accede a tu espacio de trabajo en AETHER.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <AuthFrame mode="login">
      <div className="auth-heading">
        <span className="auth-kicker">
          <span /> ACCESO A TU ESPACIO
        </span>
        <h1>Qué bueno tenerte de vuelta.</h1>
        <p>
          Ingresa para retomar tus iniciativas, decisiones y proyectos justo
          donde los dejaste.
        </p>
      </div>
      <div className="auth-access-card">
        <div className="auth-access-card__icon">
          <LockKeyhole size={22} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div>
          <h2>Acceso seguro</h2>
          <p>Continuarás con el servicio de identidad de AETHER.</p>
        </div>
        <a className="auth-primary" href="/auth/continuar">
          Iniciar sesión
          <ArrowRight size={19} strokeWidth={1.8} aria-hidden="true" />
        </a>
      </div>
      <p className="auth-assurance">
        <ShieldCheck size={17} strokeWidth={1.7} aria-hidden="true" />
        AETHER no solicita ni guarda tu contraseña en esta página.
      </p>
      <div className="auth-switch">
        <span>¿Aún no tienes una cuenta?</span>
        <a href="/auth/registro">
          Crear cuenta <ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>
    </AuthFrame>
  );
}
