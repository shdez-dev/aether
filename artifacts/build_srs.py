from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = Path(__file__).resolve().parent
DOCX = OUT / 'Aether_SRS_2026-09.docx'
BLACK, DARK, MID, PALE, GRID = '000000', '202020', '606060', 'F1F1F1', 'BFBFBF'

def font(run, size=9, bold=None, color=BLACK):
    run.font.name = 'Aptos'
    run._element.rPr.rFonts.set(qn('w:ascii'), 'Aptos')
    run._element.rPr.rFonts.set(qn('w:hAnsi'), 'Aptos')
    run.font.size = Pt(size); run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None: run.font.bold = bold

def shade(cell, color):
    e = OxmlElement('w:shd'); e.set(qn('w:fill'), color); cell._tc.get_or_add_tcPr().append(e)

def decorate(cell):
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    p = cell._tc.get_or_add_tcPr(); b = OxmlElement('w:tcBorders')
    for edge in ('top','left','bottom','right','insideH','insideV'):
        x = OxmlElement('w:'+edge); x.set(qn('w:val'),'single'); x.set(qn('w:sz'),'4'); x.set(qn('w:color'),GRID); b.append(x)
    p.append(b)
    m = OxmlElement('w:tcMar')
    for edge in ('top','start','bottom','end'):
        x = OxmlElement('w:'+edge); x.set(qn('w:w'),'100'); x.set(qn('w:type'),'dxa'); m.append(x)
    p.append(m)

def repeat(row):
    e = OxmlElement('w:tblHeader'); e.set(qn('w:val'),'true'); row._tr.get_or_add_trPr().append(e)

def page_no(p):
    r=p.add_run(); a=OxmlElement('w:fldChar'); a.set(qn('w:fldCharType'),'begin'); i=OxmlElement('w:instrText'); i.set(qn('xml:space'),'preserve'); i.text='PAGE'; z=OxmlElement('w:fldChar'); z.set(qn('w:fldCharType'),'end'); r._r.extend([a,i,z]); font(r,8,color=MID)

d = Document(); s = d.sections[0]
s.top_margin=Cm(1.75); s.bottom_margin=Cm(1.55); s.left_margin=Cm(2); s.right_margin=Cm(2)
for n,sz,b,pre,post in [('Normal',9.3,False,0,5),('Title',27,True,0,7),('Heading 1',16,True,18,7),('Heading 2',11.5,True,12,4),('Heading 3',10,True,8,3)]:
    st=d.styles[n]; st.font.name='Aptos'; st._element.rPr.rFonts.set(qn('w:ascii'),'Aptos'); st._element.rPr.rFonts.set(qn('w:hAnsi'),'Aptos'); st.font.size=Pt(sz); st.font.bold=b; st.font.color.rgb=RGBColor.from_string(BLACK); st.paragraph_format.space_before=Pt(pre); st.paragraph_format.space_after=Pt(post); st.paragraph_format.line_spacing=1.12
st=d.styles['Subtitle']; st.font.name='Aptos'; st.font.size=Pt(11); st.font.color.rgb=RGBColor.from_string(MID); st.paragraph_format.space_after=Pt(8)
h=s.header.paragraphs[0]; h.alignment=WD_ALIGN_PARAGRAPH.CENTER; r=h.add_run('AETHER   |   ESPECIFICACION DE REQUISITOS DE SOFTWARE'); font(r,8,True,MID)
f=s.footer.paragraphs[0]; f.alignment=WD_ALIGN_PARAGRAPH.CENTER; r=f.add_run('AETH-SRS-001   |   Uso interno   |   Version 1.0   |   Pagina '); font(r,8,color=MID); page_no(f)

def P(text='', style=None, align=None, before=None, after=None):
    p=d.add_paragraph(style=style)
    if text: font(p.add_run(text), 9.3 if not style else 9)
    if align is not None: p.alignment=align
    if before is not None: p.paragraph_format.space_before=Pt(before)
    if after is not None: p.paragraph_format.space_after=Pt(after)
    return p
def H(text,level=1):
    p=d.add_heading(text,level=level); p.paragraph_format.keep_with_next=True; return p
def B(text):
    p=d.add_paragraph(style='List Bullet'); p.paragraph_format.space_after=Pt(2); font(p.add_run(text),9.1); return p
def N(text):
    p=d.add_paragraph(style='List Number'); p.paragraph_format.space_after=Pt(2); font(p.add_run(text),9.1); return p
def T(head, rows, widths=None, small=True):
    t=d.add_table(rows=1,cols=len(head)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    for i,x in enumerate(head):
        c=t.rows[0].cells[i]; c.text=''; decorate(c); shade(c,DARK); p=c.paragraphs[0]; r=p.add_run(str(x)); font(r,7.7 if small else 8.3,True,'FFFFFF')
        if widths: c.width=Cm(widths[i])
    repeat(t.rows[0])
    for ri,row in enumerate(rows):
        cells=t.add_row().cells
        for i,x in enumerate(row):
            c=cells[i]; c.text=''; decorate(c)
            if ri%2: shade(c,PALE)
            p=c.paragraphs[0]; p.paragraph_format.space_after=Pt(0); p.alignment=WD_ALIGN_PARAGRAPH.CENTER if i==0 and len(str(x))<18 else WD_ALIGN_PARAGRAPH.LEFT; font(p.add_run(str(x)),7.55 if small else 8.35)
            if widths: c.width=Cm(widths[i])
    P('',after=3); return t
def pg(): d.add_page_break()
def note(label,text):
    p=P('',after=7); font(p.add_run(label+' '),8.8,True); font(p.add_run(text),8.8,color=MID)

# Portada
P('DOCUMENTO DE SISTEMA',align=WD_ALIGN_PARAGRAPH.CENTER,before=67,after=12)
P('AETHER',style='Title',align=WD_ALIGN_PARAGRAPH.CENTER,after=2)
P('Especificacion de Requisitos de Software',style='Heading 1',align=WD_ALIGN_PARAGRAPH.CENTER,after=6)
P('Marco controlado para convertir necesidades en iniciativas, decisiones trazables y proyectos ejecutables',style='Subtitle',align=WD_ALIGN_PARAGRAPH.CENTER,after=20)
T(['Control','Valor'],[['Codigo','AETH-SRS-001'],['Version','1.0'],['Fecha de emision','23 de septiembre de 2026'],['Estado','Base controlada'],['Propietario','Producto Aether'],['Clasificacion','Uso interno']],[4,12],False)
P('Este documento fija el lenguaje común de producto, ingeniería, seguridad, operación y control de calidad. Debe evolucionar mediante el procedimiento de cambios y conservar evidencia de cada aprobación.',align=WD_ALIGN_PARAGRAPH.CENTER,before=10,after=18)
T(['Aprobacion requerida','Nombre y cargo','Fecha','Firma'],[['Patrocinio','[ Completar ]','[ Completar ]','[ Completar ]'],['Producto','[ Completar ]','[ Completar ]','[ Completar ]'],['Arquitectura y seguridad','[ Completar ]','[ Completar ]','[ Completar ]'],['Operacion','[ Completar ]','[ Completar ]','[ Completar ]']],[4.2,5.6,3,2.8])
P('Distribucion: patrocinio, owners, producto, arquitectura, desarrollo, calidad, seguridad, soporte y operación.',align=WD_ALIGN_PARAGRAPH.CENTER)

pg(); H('Control documental')
P('La SRS es una especificación viva controlada. Todo cambio que afecte alcance, prioridad, dato, interfaz, seguridad, estado, auditoría o aceptación se registra aquí y se vincula con la evidencia técnica correspondiente.')
H('Historial de versiones',2)
T(['Version','Fecha','Cambio','Autor','Aprobacion'],[['1.0','2026-09-23','Emision inicial con alcance, requisitos, trazabilidad y criterios de aceptación de Aether.','Producto Aether','Pendiente'],['[ ]','[ ]','[ Describir cambio controlado ]','[ ]','[ ]'],['[ ]','[ ]','[ Describir cambio controlado ]','[ ]','[ ]']],[1.6,2.3,7,3,2])
H('Reglas de control',2)
for x in ['Solo la versión aprobada puede servir como referencia de construcción, prueba o liberación.','Una modificación conserva el identificador del requisito y aumenta la versión; no se reescribe el historial.','Un requisito retirado conserva motivo, fecha, aprobador e impacto de trazabilidad.','La clasificación define distribución y no reemplaza las políticas de datos de Aether.']: B(x)
H('Indice general',2)
T(['Seccion','Contenido'],[['1','Introducción, propósito, alcance, referencias y glosario'],['2','Descripción general, actores, límites y arquitectura'],['3','Requisitos funcionales y flujos de operación'],['4','Requisitos no funcionales, seguridad y datos'],['5','Interfaces, restricciones, supuestos y dependencias'],['6','Criterios de aceptación, calidad y validación'],['7','Trazabilidad, riesgos y control del cambio'],['A','Plantillas operativas y apéndices']],[1.7,14.3])
H('Indice de tablas',2); P('Tablas 1 a 2 control documental. Tablas 3 a 4 alcance y referencias. Tablas 5 a 10 requisitos funcionales. Tabla 11 requisitos no funcionales. Tablas 12 a 14 datos, interfaces y dependencias. Tablas 15 a 16 aceptación y trazabilidad. Tablas A1 a A4 plantillas y glosario.')

pg(); H('1 Introduccion')
H('1.1 Proposito',2); P('Aether permite que una organización convierta una necesidad en una iniciativa evaluable, una decisión sustentada y un proyecto que pueda ejecutarse, medirse y auditarse. Esta SRS establece qué debe hacer el sistema, qué restricciones lo gobiernan y cómo se verificará su comportamiento.')
H('1.2 Alcance',2); P('El alcance cubre intake, iniciativas, diagnóstico, triage, evaluación, decisión, condiciones, formalización, proyectos, tareas, evidencia, documentos, comentarios, auditoría, notificaciones, exportaciones y métricas. Incluye identidad, tenencia y autorización contextual que hacen seguro ese ciclo.')
T(['Incluido','Excluido del alcance actual'],[['Gestión de organizaciones, workspaces, equipos, roles e invitaciones','ERP, nómina, facturación, CRM comercial y gestión pública de contenidos'],['Iniciativas, evaluación versionada, decisiones y proyectos trazables','Planificación ágil de propósito general sin vínculo institucional'],['Auditoría durable, outbox, datos de evidencia y recuperación','Acceso administrativo genérico de soporte a contenidos institucionales']],[8,8])
H('1.3 Convenciones y glosario básico',2)
T(['Termino','Significado'],[['Must','Obligatorio para que la entrega sea aceptable.'],['Should','Importante; se programa en una entrega acordada.'],['Could','Mejora útil sin dependencia crítica actual.'],['Propuesto, aprobado, implementado, verificado, retirado','Estados de ciclo de vida del requisito.'],['Criterio excluyente','Criterio que debe estar cumplido para aprobar una iniciativa.'],['Evidencia','Referencia verificable que sustenta una evaluación, decisión o resultado.'],['Owner','Rol organizacional con autoridad de gobierno específica.']],[4,12])
H('1.4 Referencias controladas',2)
T(['ID','Referencia','Uso'],[['REF-01','README del repositorio','Visión, topología y verificación local.'],['REF-02','OpenAPI aether.v1.yaml','Contrato HTTP y esquemas de borde.'],['REF-03','ADRs 0001 a 0016','Decisiones arquitectónicas vigentes.'],['REF-04','Documentos de arquitectura','Ciclos, seguridad, datos, workers y frontend.'],['REF-05','Runbooks y gobierno','Operación local, acceso de soporte, secretos y releases.']],[1.7,6.2,8.1])

pg(); H('2 Descripcion general del sistema')
H('2.1 Perspectiva y mapa del sistema',2); P('Aether es un monolito modular desplegado como tres procesos coordinados. El dominio y la aplicación no dependen de marcos, ORM, proveedores de infraestructura ni componentes visuales.')
T(['Elemento','Responsabilidad','Limite de control'],[['Navegador','Presenta recorridos y capacidades calculadas.','No decide autorización ni conserva tokens de proveedor.'],['Aplicación web','Interfaz accesible en Next.js.','Consume contratos; no duplica reglas de dominio.'],['Servidor','API Fastify, autenticación, contexto y casos de uso.','Valida transporte y delega reglas a aplicación y dominio.'],['Dominio','Estados, invariantes y políticas de negocio.','No importa infraestructura ni UI.'],['PostgreSQL','Autoridad transaccional y restricciones durables.','Aislamiento, auditoría, outbox e integridad.'],['Worker','Procesos reintentables de outbox.','Revalida alcance; es idempotente.'],['Keycloak OIDC','Identidad, inicio de sesión y portal de cuenta.','No se exponen sus tokens al navegador.'],['Redis','Caché, presencia e invalidación.','No participa en entrega durable de hechos de negocio.']],[3.2,5.6,7.2])
H('2.2 Actores y partes interesadas',2)
T(['Actor','Objetivo','Responsabilidades y límites'],[['Solicitante','Plantear una necesidad.','Crea, corrige y presenta iniciativas permitidas.'],['Owner','Gobernar la organización.','Aprueba estándares, decisiones, condiciones, acceso temporal y conversiones.'],['Administrador','Administrar alcance delegado.','Gestiona recursos dentro de sus capacidades; no sustituye autoridades exclusivas.'],['Revisor','Evaluar con evidencia.','Registra resultados, conflictos y borradores; no decide por sí mismo.'],['Lider de proyecto','Ejecutar el mandato.','Gestiona estado, hitos, acciones, riesgos y resultados del proyecto.'],['Soporte','Diagnosticar salud operativa.','Solo accede mediante concesión JIT aprobada y a diagnósticos agregados.']],[3.2,3.7,9.1])
H('2.3 Limites de producto',2); P('Una iniciativa y un proyecto son agregados distintos. La aprobación no crea un proyecto de forma implícita. Una evaluación no es una decisión y un triage no cambia el estado de una iniciativa. Aether no infiere gobernanza colegiada, roles, tenencia ni transferencias donde no exista un comando y una regla explícitos.')

pg(); H('3 Requisitos funcionales')
P('Cada requisito tiene identificador estable, prioridad y criterio de verificación. Los nombres de pantallas y rutas pueden evolucionar sin modificar la semántica del requisito.')
H('3.1 Identidad, sesion y tenencia',2)
T(['ID','Requisito','Pri.','Verificacion'],[['SRS-F-001','Autenticar mediante OIDC con PKCE y crear sesiones opacas revocables.','Must','Prueba de inicio, expiración, renovación y cierre de sesión.'],['SRS-F-002','Exigir origen y token CSRF en mutaciones autenticadas, sin exponer tokens OIDC al navegador.','Must','Prueba de petición válida, inválida y ausencia de tokens.'],['SRS-F-003','Aislar organizaciones, workspaces y recursos por contexto completo de organización y workspace.','Must','Pruebas de lectura y mutación cruzada denegadas.'],['SRS-F-004','Administrar organizaciones, workspaces, equipos, membresías, invitaciones, propiedad y archivado.','Must','Pruebas de ciclo de vida y restricciones de owner.'],['SRS-F-005','Calcular capacidades en servidor y repetir autorización en cada operación protegida.','Must','Pruebas de matriz y denegación de cliente manipulado.'],['SRS-F-006','Permitir políticas de residencia y retención explícitas, con herencia y origen visible.','Should','Pruebas de política, override y ausencia de valores inventados.'],['SRS-F-007','Gestionar concesiones temporales exactas por recurso, acción, beneficiario, motivo y vencimiento.','Must','Pruebas de solicitud, separación de deberes, uso y revocación.'],['SRS-F-008','Exigir aprobación independiente para soporte JIT y limitarlo a diagnóstico agregado durante 60 minutos.','Must','Prueba de alcance permitido y denegación de contenido.']],[2.1,8.3,1.1,4.5])
H('3.2 Iniciativas, intake y diagnostico',2)
T(['ID','Requisito','Pri.','Verificacion'],[['SRS-F-010','Crear iniciativas con título, problema, resultado esperado, clasificación y contexto de tenencia.','Must','Prueba de creación con validación de campos y alcance.'],['SRS-F-011','Aplicar solo transiciones draft, presented, under review, returned, approved, rejected y cancelled permitidas.','Must','Prueba de tabla de estados y rechazos de transición.'],['SRS-F-012','Mantener prioridad solicitada separada de prioridad operativa con autoridad y auditoría explícitas.','Must','Prueba de cambio autorizado y conservación histórica.'],['SRS-F-013','Asignar atención a iniciativas presentadas y derivar cola de excepciones sin registros desincronizados.','Should','Prueba de asignación, estado y retiro de la cola.'],['SRS-F-014','Advertir duplicados y registrar relaciones related o continues sin fusionar iniciativas.','Should','Prueba de advertencia no bloqueante y relación append only.'],['SRS-F-015','Registrar diagnóstico de problema, beneficiarios, causas, restricciones, evidencia, hipótesis, alcance, riesgos y experimento.','Must','Prueba de persistencia, consulta y validación de evidencia.']],[2.1,8.3,1.1,4.5])

pg(); H('3 Requisitos funcionales continuacion')
H('3.3 Triage, evaluacion y decision',2)
T(['ID','Requisito','Pri.','Verificacion'],[['SRS-F-020','Publicar estándares de triage y evaluación versionados e inmutables y adoptar una referencia activa explícita.','Must','Pruebas de publicación, adopción y bloqueo de modificación.'],['SRS-F-021','Conservar en cada resultado el snapshot de iniciativa, estándar, criterios, cobertura, calidad y madurez.','Must','Prueba de no reinterpretación tras nueva versión.'],['SRS-F-022','Calcular cobertura como evaluados sobre aplicables y tratar cero aplicables como cero por ciento.','Must','Prueba de met, not met, not applicable y conjunto vacío.'],['SRS-F-023','Requerir que un criterio excluyente esté met antes de aprobar una decisión.','Must','Prueba de aprobación bloqueada y aprobada.'],['SRS-F-024','Asignar revisión, permitir abstención, reasignación y declaración o resolución de conflicto de interés.','Must','Pruebas de permisos, conflicto abierto y auditoría.'],['SRS-F-025','Permitir borradores versionados y exigir mapeo explícito para migrarlos a un estándar nuevo.','Should','Prueba de conflicto de versión y migración trazada.'],['SRS-F-026','Registrar decisiones inmutables con fundamento, evidencia, resultado y fecha de siguiente revisión cuando corresponda.','Must','Prueba de cada outcome y restricción de next review.'],['SRS-F-027','Gestionar condiciones de decisiones aprobadas y bloquear conversión hasta resolverlas o eximirlas.','Must','Prueba de condición pendiente, cumplida, exenta y bloqueo.']],[2.1,8.3,1.1,4.5])
H('3.4 Formalizacion, proyecto y ejecucion',2)
T(['ID','Requisito','Pri.','Verificacion'],[['SRS-F-030','Convertir únicamente una iniciativa aprobada con decisión exacta y condiciones resueltas o exentas.','Must','Prueba de conversión válida y precondiciones fallidas.'],['SRS-F-031','Conservar la cadena iniciativa, decisión y proyecto sin reutilización ni cruce de tenencia.','Must','Pruebas de unicidad, idempotencia y referencias cruzadas.'],['SRS-F-032','Conservar mandato, patrocinador, líder y participantes explícitos; no crear roles implícitos.','Must','Prueba de creación y validación de membresías.'],['SRS-F-033','Gestionar estados planned, active, paused, blocked, completed, cancelled y archived mediante reglas válidas.','Must','Prueba de matriz de estados y autorización.'],['SRS-F-034','Gestionar hitos, próximas acciones, equipos, colaboradores, dependencias, capacidad y orden de ejecución.','Must','Prueba de operación, restricciones y agenda.'],['SRS-F-035','Gestionar riesgos, decisiones operativas, solicitudes de cambio, línea base, cierres y lecciones aprendidas.','Should','Prueba de ciclo de vida y comparación de línea base.']],[2.1,8.3,1.1,4.5])

pg(); H('3 Requisitos funcionales continuacion')
H('3.5 Documentos, evidencia, colaboracion y operacion',2)
T(['ID','Requisito','Pri.','Verificacion'],[['SRS-F-040','Recibir versiones de documentos con clasificación, hash, tamaño, tipo permitido, escaneo y retención.','Must','Prueba de carga, validación, cuarentena y publicación.'],['SRS-F-041','Impedir que documento, evidencia o entregable se consulte o reutilice fuera de su proyecto y tenencia.','Must','Prueba de denegación entre proyectos y workspaces.'],['SRS-F-042','Gestionar comentarios con creación, edición, resolución, reapertura y borrado lógico auditados.','Should','Prueba de ciclo e historial sin contenido expuesto.'],['SRS-F-043','Enviar avisos neutrales y revalidar pertenencia antes de exponerlos en el buzón.','Should','Prueba de evento, visibilidad y protección de detalle.'],['SRS-F-044','Escribir outbox en la misma transacción que el cambio de negocio y procesarlo idempotentemente.','Must','Prueba de atomicidad, reentrega y consumidor.'],['SRS-F-045','Aplicar reintentos, dead letters, replay auditado y autenticación reciente para recuperación operativa.','Must','Prueba de fallo, reintento, dead letter y replay.'],['SRS-F-046','Producir métricas agregadas por organización con periodo, UTC y versión de cálculo declarados.','Should','Prueba de filtros, denominador cero y versión.']],[2.1,8.3,1.1,4.5])
H('3.6 Flujos esenciales',2)
T(['Flujo','Precondicion','Resultado verificable'],[['Necesidad a iniciativa','Membresía y capacidad de creación vigentes.','Iniciativa draft contextualizada, versionada y auditada.'],['Iniciativa a decisión','Presentación, revisión asignada y evaluación completa.','Decisión inmutable con evidencia, métricas y condición si aplica.'],['Decisión a proyecto','Decisión approved y condiciones cerradas.','Proyecto único, trazable e idempotente con mandato y roles explícitos.'],['Documento a evidencia','Permiso de proyecto y metadatos válidos.','Versión escaneada, publicada o rechazada, sin cruce de alcance.'],['Fallo asíncrono','Evento outbox pendiente con consumidor habilitado.','Reintento seguro o dead letter recuperable y auditado.'],['Soporte JIT','Operador elegible y aprobación independiente vigente.','Solo diagnóstico agregado durante el intervalo aprobado.']],[4,5.3,6.2])

pg(); H('4 Requisitos no funcionales')
P('Las metas numéricas sin valor pactado se declaran como objetivo pendiente para evitar una promesa no validada. Antes de liberación productiva, operación y producto deben completar los umbrales y vincularlos a pruebas automatizadas o mediciones reproducibles.')
T(['ID','Categoria','Requisito verificable','Objetivo o evidencia'],[['SRS-NF-001','Seguridad','Evaluar autorización con identidad, organización, workspace, recurso y acción cuando exista alcance.','Pruebas de aislamiento y matriz.'],['SRS-NF-002','Seguridad','Proteger sesión, CSRF, autenticación reciente, idempotencia y secretos.','Pruebas negativas y escaneo de secretos.'],['SRS-NF-003','Privacidad','No revelar tokens, hashes de invitación, SQL, stack traces ni recursos inaccesibles.','Revisión de contratos y pruebas de error seguro.'],['SRS-NF-004','Confiabilidad','Confirmar o revertir mutación, auditoría y outbox en una transacción PostgreSQL.','Prueba de fallo inducido y consistencia.'],['SRS-NF-005','Confiabilidad','Usar consumidores idempotentes y recuperar eventos con reintento y dead letter.','Prueba de reentrega y replay.'],['SRS-NF-006','Disponibilidad','Distinguir liveness y readiness; readiness verifica PostgreSQL y OIDC.','Pruebas de health, ready y dependencia caída.'],['SRS-NF-007','Rendimiento','Medir latencia, tasa de error y saturación en rutas críticas.','Umbrales p95 y throughput: [ completar ].'],['SRS-NF-008','Escalabilidad','Escalar web, API y worker sin convertir Redis en fuente durable.','Prueba de carga y diseño de colas.'],['SRS-NF-009','Mantenibilidad','Respetar direcciones de dependencia entre dominio, aplicación, contratos e infraestructura.','architecture check, lint, typecheck y revisión.'],['SRS-NF-010','Compatibilidad','Ejecutar interfaz en navegadores objetivo definidos por producto.','Matriz de navegadores: [ completar ].'],['SRS-NF-011','Accesibilidad','Conservar semántica, teclado, foco, etiquetas y contraste verificables.','Pruebas de interfaz y revisión manual.'],['SRS-NF-012','Observabilidad','Compartir correlationId entre solicitud, auditoría y trabajo asíncrono cuando corresponda.','Prueba de correlación extremo a extremo.']],[2,2.3,7.8,5.2])

pg(); H('4 Requisitos no funcionales continuacion')
H('4.1 Requisitos de datos',2)
T(['Grupo de datos','Reglas de integridad','Retencion y proteccion'],[['Identidad y acceso','Actor, membresía, invitación, sesión, política y concesión se validan en el alcance correcto.','No se exponen tokens ni correos en auditoría de invitación.'],['Gobierno','Iniciativa, triage, estándar, evaluación, decisión y condiciones mantienen versión y relaciones exactas.','Snapshots conservan interpretación histórica.'],['Ejecución','Proyecto, mandato, participantes, tareas, dependencias, riesgos, cambios y cierre no cruzan organización ni workspace.','Archivado conserva lectura autorizada y bloquea escritura.'],['Contenido','Documento, versión, hash, clasificación, recurso y estado se vinculan al proyecto o agregado exacto.','Retención por política; evidencia no válida no sustituye binario verificado.'],['Trazabilidad','Auditoría es append only; eventos llevan actor, resultado, correlación y carga segura.','Cambios estructurales solo por migración controlada.'],['Operación','Outbox y dead letters conservan evento, intención, intentos y error seguro.','Replay conserva motivo, actor y correlación.']],[3.1,7.2,6.9])
H('4.2 Clasificacion de información',2)
T(['Nivel','Uso','Tratamiento mínimo'],[['Interno','Información de operación ordinaria.','Acceso conforme a membresía y políticas de organización.'],['Confidencial','Información que exige distribución restringida.','Autorización contextual, auditoría y retención aplicable.'],['Restringido','Contenido sujeto a mayor cuidado.','Aplicar política, control de descarga y evidencia de acceso según capacidad disponible.']],[2.7,5,9.5])
note('Dato pendiente controlado.','Los periodos de conservación, objetivos de recuperación y límites de volumen deben completarse por organización y entorno antes de producción. La ausencia de un número no autoriza un valor por defecto.')

pg(); H('5 Interfaces, restricciones y dependencias')
H('5.1 Interfaces externas e internas',2)
T(['Interfaz','Contrato','Regla de seguridad o disponibilidad'],[['HTTP API','OpenAPI 3.1, DTOs validados y errores application problem json.','Errores seguros, correlationId, CSRF e idempotencia en mutaciones.'],['OIDC','Autorización con PKCE, state, nonce y canje de código.','Si el proveedor no está disponible no se crea sesión alternativa.'],['PostgreSQL','Migraciones, restricciones, triggers y transacciones.','Es autoridad transaccional; no se omiten invariantes de tenant.'],['Redis','Caché, presencia e invalidación.','No persiste hechos de negocio ni decide entrega.'],['Almacenamiento de archivos','Binarios asociados a versiones y escaneo.','Worker revalida tenant, agregado y versión antes de promover.'],['Correo y exportaciones','Efectos diferidos por outbox y consumidores.','No se ejecutan antes del commit; son reintentables.']],[3.1,6.3,7.8])
H('5.2 Restricciones',2)
T(['Tipo','Restriccion'],[['Tecnica','TypeScript, monorepo, monolito modular, PostgreSQL, OIDC y contratos explícitos son la base vigente.'],['Arquitectura','Dominio y aplicación no importan framework, ORM, proveedor cloud ni componentes de UI.'],['Seguridad','Ningún rol enviado por cliente ni una URL otorgan acceso; se recalcula en servidor.'],['Datos','No existe transferencia genérica entre organizaciones ni cambio implícito de organizationId o workspaceId.'],['Operación','Redis no es durable; los efectos posteriores al commit pasan por outbox.'],['Gobierno','Una decisión no presupone comité, quórum, voto ni delegación sin agregado y reglas expresas.']],[3,13.9])
H('5.3 Supuestos y dependencias',2)
T(['ID','Supuesto o dependencia','Tratamiento'],[['DEP-01','Keycloak o proveedor OIDC compatible está disponible y configurado por entorno.','Readiness lo verifica; indisponibilidad devuelve error reintentable.'],['DEP-02','PostgreSQL soporta migraciones y restricciones requeridas.','La liberación ejecuta migración y pruebas de integridad.'],['DEP-03','Worker accede a outbox, almacenamiento y dependencias autorizadas.','Monitorear pendiente, intentos y dead letters.'],['DEP-04','Las organizaciones definen residencia y retención explícitamente.','Si faltan, consulta falla de forma segura.'],['DEP-05','Producto define navegadores, rendimiento y recuperación.','Registrar valores aprobados en revisión de NFR.']],[2,8.1,6.8])

pg(); H('6 Criterios de aceptacion y calidad')
P('Una entrega se acepta cuando cada requisito comprometido está aprobado, implementado, verificado y trazado. La demostración visual no reemplaza pruebas de autorización, integridad ni recuperación.')
T(['Area','Condicion de aceptacion','Evidencia minima'],[['Contratos','OpenAPI válido y DTOs de borde coinciden con contratos compartidos.','openapi validate, pruebas de contrato y errores normalizados.'],['Dominio','Transiciones, estados, cobertura, decisiones y conversiones respetan invariantes.','Pruebas unitarias y de aplicación válidas e inválidas.'],['Tenencia','Ninguna identidad lee ni muta recursos fuera de alcance autorizado.','Pruebas cruzadas, inspección de consultas y restricciones.'],['Seguridad','Sesión, CSRF, autenticación reciente, separación de deberes y JIT son correctos.','Pruebas negativas, auditoría y revisión de secretos.'],['Datos','Migraciones, auditoría append only, outbox y relaciones de origen son atómicas.','Pruebas de integración y fallo inducido.'],['Asíncrono','Reintentos son idempotentes; dead letters y replay son controlados.','Prueba de consumidor, reentrega y recuperación.'],['Interfaz','Recorridos muestran capacidades del servidor y cumplen accesibilidad acordada.','Pruebas e2e, accesibilidad y revisión manual.'],['Liberación','Pasan formato, tipado, lint, pruebas, build y arquitectura.','Registro de pipeline y versión liberada.']],[3,7.2,6.7])
H('6.1 Calidad por requisito',2)
T(['Criterio','Pregunta de revision'],[['Claro','¿La acción, actor, alcance y resultado se entienden sin interpretación adicional?'],['Necesario','¿Resuelve una necesidad del alcance y tiene patrocinio o fundamento?'],['Verificable','¿Existe prueba, inspección o demostración reproducible?'],['Factible','¿Arquitectura, tiempo y dependencias permiten entregarlo?'],['Consistente','¿No contradice estados, seguridad, dato, interfaz u otro requisito?'],['Trazable','¿Se vincula con diseño, implementación, prueba, resultado y cambio?']],[3,13.9])
H('6.2 Puerta de liberacion',2)
for x in ['Versiones, migraciones y variables revisadas sin secretos en el repositorio.','typecheck, lint, architecture check, openapi validate, test y build completados con evidencia.','Pruebas de autorización, idempotencia, concurrencia, error seguro y recuperación ejecutadas para requisitos afectados.','Cambios de interfaz, contratos y operación documentados; runbook actualizado cuando corresponda.']: N(x)

pg(); H('7 Trazabilidad, riesgos y cambio')
H('7.1 Matriz de trazabilidad base',2)
T(['Requisito','Diseño o contrato','Implementacion esperada','Prueba o evidencia'],[['F-001 a F-008','Autenticación, tenencia y autorización','auth, domain access, application access grants','Pruebas de sesión, tenant y JIT'],['F-010 a F-015','Ciclo de iniciativa e intake','domain initiative, application intake','Pruebas de transiciones y diagnóstico'],['F-020 a F-027','Evaluación y decisión','domain evaluation, application evaluations','Pruebas de cobertura, conflicto y decisión'],['F-030 a F-035','Proyecto y ejecución','domain project, application projects','Pruebas de conversión, tareas y cierre'],['F-040 a F-046','Documentos, auditoría y outbox','application documents, worker, storage','Pruebas de escaneo, replay y métricas'],['NF-001 a NF-003','Seguridad y privacidad','server middleware, contratos, auditoría','Pruebas negativas y escaneo de secretos'],['NF-004 a NF-006','Transacciones, worker y health','database, outbox, worker, server','Integración y fallo inducido'],['NF-007 a NF-012','Operación, UI y observabilidad','observability, web, runbooks','Carga, accesibilidad y correlación']],[2.5,4.6,4.9,5])
H('7.2 Riesgos principales',2)
T(['ID','Riesgo','Impacto','Control o respuesta'],[['R-01','Cruce de tenencia o permiso por lógica de cliente.','Alto','Autorización de servidor, pruebas cruzadas y restricciones de base.'],['R-02','Decisión sin evidencia o reinterpretable por estándar nuevo.','Alto','Snapshots inmutables, cobertura y trazabilidad de evaluación.'],['R-03','Efecto externo duplicado o perdido después de commit.','Alto','Outbox transaccional, consumidores idempotentes y dead letters.'],['R-04','Acceso de soporte excesivo.','Alto','JIT de alcance mínimo, aprobación independiente y diagnóstico agregado.'],['R-05','Parámetros de rendimiento y recuperación no acordados.','Medio','Completar NFR cuantitativos antes de producción y medirlos.'],['R-06','Cambio de contrato sin trazabilidad.','Medio','OpenAPI, versionamiento, pruebas y revisión de impacto.']],[1.6,5.4,1.7,8.3])
H('7.3 Procedimiento de cambio',2)
for x in ['Registrar solicitud con problema, alcance, requisito afectado, prioridad, riesgo y decisión requerida.','Analizar impacto en datos, interfaz, seguridad, arquitectura, operación, pruebas y trazabilidad.','Aprobar o rechazar la solicitud; actualizar esta SRS y la referencia técnica asociada.','Implementar, verificar y enlazar evidencia; actualizar estado del requisito e historial documental.']: N(x)

pg(); H('A Plantillas operativas')
H('A.1 Ficha de requisito',2)
T(['Campo','Contenido a completar'],[['ID','SRS-F o SRS-NF - [ numero ]'],['Nombre','[ Acción y resultado esperados ]'],['Descripcion','El sistema debe [ verbo ], para [ actor ], dentro de [ alcance ], produciendo [ resultado ].'],['Justificacion','[ Necesidad o riesgo que resuelve ]'],['Prioridad','Must / Should / Could'],['Estado','Propuesto / Aprobado / Implementado / Verificado / Retirado'],['Criterio de aceptacion','Dado [ contexto ], cuando [ acción ], entonces [ resultado verificable ].'],['Dependencias','[ IDs de requisitos, decisión, sistema o equipo ]'],['Trazabilidad','Diseño: [ ]  Implementación: [ ]  Prueba: [ ]  Evidencia: [ ]'],['Aprobacion','[ Responsable, fecha y versión ]']],[4,12])
H('A.2 Caso de uso o flujo',2)
T(['Campo','Contenido a completar'],[['Nombre e ID','UC-[ numero ] [ nombre ]'],['Actor principal','[ Rol o sistema ]'],['Precondiciones','[ Autorización, datos, estado y dependencias ]'],['Disparador','[ Evento que inicia el flujo ]'],['Flujo principal','1. [ ]  2. [ ]  3. [ ]'],['Alternativas y errores','[ Validación, conflicto, denegación, recuperación ]'],['Postcondiciones','[ Estado, auditoría, outbox, notificación o dato resultante ]'],['Requisitos vinculados','[ SRS-F / SRS-NF ]']],[4,12])
H('A.3 Registro de revisión SRS',2)
T(['Aspecto','Resultado','Responsable','Fecha','Evidencia'],[['Alcance y actores','[ Conforme / observación ]','[ ]','[ ]','[ ]'],['Funcionalidad y estados','[ Conforme / observación ]','[ ]','[ ]','[ ]'],['Seguridad y privacidad','[ Conforme / observación ]','[ ]','[ ]','[ ]'],['Datos y trazabilidad','[ Conforme / observación ]','[ ]','[ ]','[ ]'],['Interfaces y operación','[ Conforme / observación ]','[ ]','[ ]','[ ]'],['Aceptación y pruebas','[ Conforme / observación ]','[ ]','[ ]','[ ]']],[4.2,3.7,3,2,3.1])
H('A.4 Glosario tecnico',2)
T(['Termino','Definicion'],[['Agregado','Unidad de dominio que protege invariantes y transiciones relacionadas.'],['Append only','Registro que acepta nuevas entradas pero no edición ni eliminación de existentes.'],['CorrelationId','Identificador que vincula solicitud, auditoría y efectos asíncronos.'],['Dead letter','Evento que superó reintentos y requiere recuperación controlada.'],['Idempotencia','Repetir una operación con misma intención no duplica resultado.'],['Outbox','Registro transaccional de hechos que producen efectos posteriores al commit.'],['PKCE','Protección del flujo OIDC para clientes públicos.'],['Snapshot','Copia exacta de datos o criterios aplicada a una decisión histórica.'],['Workspace','Ámbito de trabajo perteneciente a una única organización.']],[3.6,12.4])
P('Fin del documento',align=WD_ALIGN_PARAGRAPH.CENTER,before=16)
d.core_properties.title='Aether Especificacion de Requisitos de Software'; d.core_properties.subject='SRS profesional y operativo de Aether'; d.core_properties.author='Producto Aether'; d.core_properties.keywords='Aether, SRS, requisitos, trazabilidad, seguridad'
d.save(DOCX); print(DOCX)
