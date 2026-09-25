<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.aetherEmail
  preheader="Usa este enlace para restablecer tu contraseña de AETHER."
  index="02 / 02"
  eyebrow="RECUPERACIÓN DE ACCESO"
  title="Volvamos a conectar."
  description="Recibimos una solicitud para restablecer la contraseña de tu cuenta. Continúa con el enlace para elegir una nueva."
  actionLabel="Restablecer contraseña"
  actionLink=link
  expiration=linkExpirationFormatter(linkExpiration)
  caution="¿No solicitaste este cambio? Ignora este mensaje: tu contraseña actual seguirá siendo válida. AETHER nunca te pedirá tu contraseña por correo."
/>
