import type { Metadata } from "next";
import { ArrowRight, MailCheck, ShieldCheck } from "lucide-react";
import { AuthFrame } from "../../../components/auth/AuthFrame";

export const metadata: Metadata = {
  title: "Crear cuenta | AETHER",
  description: "Crea tu cuenta personal y comienza en AETHER.",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <AuthFrame mode="register">
      <div className="auth-heading auth-heading--register">
        <span className="auth-kicker">
          <span /> COMIENZA EN AETHER
        </span>
        <h1>Tu lugar en AETHER empieza aquí.</h1>
        <p>
          Crea una cuenta personal. Después podrás comenzar con tu propia
          organización o unirte a un equipo que te haya invitado.
        </p>
      </div>
      <div className="auth-register-card">
        <div className="auth-register-card__step">
          <MailCheck size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>Confirma tu correo para proteger tu identidad.</span>
        </div>
        <div className="auth-register-card__step">
          <ShieldCheck size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>El acceso a cada equipo se concede por separado.</span>
        </div>
        <a className="auth-primary" href="/auth/crear-cuenta">
          Crear mi cuenta
          <ArrowRight size={19} strokeWidth={1.8} aria-hidden="true" />
        </a>
      </div>
      <p className="auth-assurance">
        El registro y la verificación se realizan en el servicio de identidad
        seguro de AETHER.
      </p>
      <div className="auth-switch">
        <span>¿Ya tienes una cuenta?</span>
        <a href="/auth/login">
          Iniciar sesión <ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>
    </AuthFrame>
  );
}
