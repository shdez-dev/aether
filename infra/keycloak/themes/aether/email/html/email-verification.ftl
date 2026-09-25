<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.aetherEmail
  preheader="Confirma tu correo para activar tu cuenta de AETHER."
  index="01 / 02"
  eyebrow="VERIFICACIÓN DE CUENTA"
  title="Tu espacio comienza aquí."
  description="Confirma que esta dirección de correo te pertenece para activar tu cuenta y continuar en AETHER."
  actionLabel="Verificar mi correo"
  actionLink=link
  expiration=linkExpirationFormatter(linkExpiration)
  caution="¿No creaste una cuenta en AETHER? Puedes ignorar este mensaje; no se activará ninguna cuenta sin tu confirmación."
/>
