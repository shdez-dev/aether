# Roles organizacionales y perfiles de usuario

## Separación de responsabilidades

Aether modela por separado la identidad del usuario, su acceso a la
organización, su acceso a cada espacio y las responsabilidades funcionales que
asume en iniciativas. Un título como «Evaluación de iniciativas» no reemplaza
la membresía ni concede acceso general a los recursos: cada comando valida en
el servidor el contexto y la asignación necesaria.

### Roles de acceso

Los roles de acceso son comunes a todos los tipos de organización:

| Alcance | Rol | Función |
| --- | --- | --- |
| Organización | Propietario (`owner`) | Gobierna la organización y conserva acciones exclusivas de propiedad. |
| Organización | Administrador (`admin`) | Gestiona políticas, espacios y membresías, sin transferir la propiedad. |
| Organización | Miembro (`member`) | Pertenece a la organización; el acceso a espacios se otorga aparte. |
| Espacio | Administrador (`admin`) | Gestiona el espacio, sus equipos y su configuración. |
| Espacio | Miembro (`member`) | Colabora según los permisos de cada recurso. |
| Espacio | Lector (`viewer`) | Consulta los recursos autorizados del espacio. |

Una invitación define el rol organizacional y, de forma independiente, los
espacios iniciales y el rol de acceso en ellos. Ser miembro de una organización
no agrega automáticamente a la persona a todos sus espacios.

### Perfiles de responsabilidades por tipo

`GET /v1/organization-role-profiles/{organizationType}` y
`GET /v1/organizations/{organizationId}/role-profile` devuelven el catálogo
tipado por organización. El perfil clasifica las responsabilidades disponibles;
no crea membresías ni asignaciones por sí solo. El catálogo integrado es de
solo lectura: una persona administradora asigna los roles disponibles, pero no
define roles arbitrarios ni modifica el perfil del tipo organizacional.

| Tipo de organización | Responsabilidades de iniciativas disponibles |
| --- | --- |
| Uso personal | Ninguna por defecto. |
| Equipo o empresa | Coordinación, evaluación. |
| Institución | Coordinación, evaluación, aprobación y mentoría. |

Las responsabilidades tienen alcance específico:

- **Coordinación de iniciativas**: organiza el intake, asigna responsables de
  atención y conserva el siguiente paso.
- **Evaluación de iniciativas**: permite revisar iniciativas asignadas contra
  el estándar vigente, con respuestas y evidencia.
- **Aprobación de iniciativas**: habilita la decisión de gobierno posterior a
  la evaluación, sujeta al flujo y las validaciones del dominio.
- **Mentoría**: da acceso de acompañamiento a una iniciativa concreta; exige
  iniciativa y vencimiento explícitos, y no sustituye una evaluación.

El catálogo también describe responsabilidades de proyecto (patrocinador,
líder, colaborador y observador). Las asignaciones persistidas y administradas
por la interfaz actual cubren responsabilidades de iniciativas; las etiquetas
del catálogo de proyecto no deben tratarse como concesiones de acceso general.

## Asignación, vigencia y auditoría

La administración de organización consulta personas, iniciativas y
responsabilidades por espacio. `GET /v1/organizations/{organizationId}/role-profile`
obtiene el catálogo, `GET /v1/organizations/{organizationId}/responsibilities`
lista asignaciones y `POST` crea una. El `DELETE` de una asignación la revoca.
Sólo `owner` y `admin` de la organización administran estas asignaciones; la
persona asignada debe tener membresía organizacional activa y acceso al espacio
correspondiente.

Coordinación y evaluación se asignan a nivel de espacio. La mentoría exige
además un `initiativeId` y una fecha de vencimiento futura (máximo un año). La
base de datos mantiene la asignación y su evento de auditoría en una transacción;
asignar dos veces el mismo rol a la misma persona en el mismo alcance no crea
duplicados. Los eventos `organization.responsibility_assigned.v1` y
`organization.responsibility_revoked.v1` conservan quién asignó o revocó la
responsabilidad.

La lista de permisos visibles en la interfaz es informativa. Los servicios de
iniciativas, intake y evaluación vuelven a validar rol, organización, espacio,
persona asignada y estado antes de ejecutar cada operación.

## Perfil personal

`GET /v1/me/profile` y `PATCH /v1/me/profile` exponen únicamente el perfil del
actor autenticado. Incluye nombre visible, rol o especialidad, biografía de
hasta 600 caracteres y foto PNG/JPG/WebP de hasta 500 KB. Al mostrar el nombre,
el perfil usa primero el nombre elegido por el usuario y, si todavía no lo ha
personalizado, el nombre de presentación entregado por el proveedor de
identidad al registrarse.

Estos datos no cambian el rol de acceso ni las responsabilidades. La ruta del
perfil y las mutaciones de organización requieren sesión autenticada; las
mutaciones protegidas por CSRF y las operaciones organizacionales que cambian
permisos se validan del lado del servidor.
