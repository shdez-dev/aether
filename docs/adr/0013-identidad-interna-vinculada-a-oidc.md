# ADR-0013: Identidad interna vinculada al emisor y subject OIDC

- Estado: aceptado
- Fecha: 2026-09-17

## Decisión

Aether conserva un identificador interno inmutable para cada persona (`actor_id`). El proveedor OIDC sigue siendo la autoridad de autenticación, pero su `sub` no se usa directamente como identificador de autoría ni de autorización.

La vinculación se realiza por el par exacto `(issuer, subject)`, único en `actor_identities`. Cada canje OIDC crea o reutiliza la identidad y actualiza el correo de presentación y el instante de autenticación. No se almacenan tokens de acceso ni refresh tokens.

## Consecuencias

- La rotación o migración de proveedor no puede colisionar con subjects iguales de otro issuer.
- La autoría y las membresías se referencian por el `actor_id` interno estable.
- Los registros históricos que ya contienen un actor legado no se reescriben: continúan siendo auditables y las nuevas autenticaciones usan la vinculación explícita.
