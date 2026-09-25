from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parent
DOCX = ROOT / 'Aether_SRS_2026-09.docx'
DIAGRAMS = ROOT / 'srs_diagrams'
OPENAPI = ROOT.parent / 'packages' / 'contracts' / 'openapi' / 'aether.v1.yaml'
BLACK, DARK, MID, PALE, GRID = '000000', '202020', '606060', 'F1F1F1', 'BFBFBF'


def img_font(size, bold=False):
    candidates = ['C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeuib.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf']
    for c in candidates:
        if Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def text_box(draw, box, title, body='', fill='white'):
    if len(fill) == 6 and not fill.startswith('#'):
        fill = '#' + fill
    draw.rounded_rectangle(box, radius=14, fill=fill, outline='black', width=3)
    x1,y1,x2,y2=box
    draw.text((x1+16,y1+13),title,font=img_font(28,True),fill='black')
    if body:
        y=y1+52
        for ln in body.split('\n'):
            draw.text((x1+16,y),ln,font=img_font(20),fill='black'); y+=25


def arrow(draw, a, b, label=None):
    draw.line([a,b],fill='black',width=4)
    x,y=b; px,py=a; dx=x-px; dy=y-py
    if abs(dx)>=abs(dy):
        pts=[(x,y),(x-18*(1 if dx>0 else -1),y-9),(x-18*(1 if dx>0 else -1),y+9)]
    else:
        pts=[(x,y),(x-9,y-18*(1 if dy>0 else -1)),(x+9,y-18*(1 if dy>0 else -1))]
    draw.polygon(pts,fill='black')
    if label:
        draw.text(((px+x)//2+5,(py+y)//2-18),label,font=img_font(17),fill='black')


def diagram_architecture(path):
    im=Image.new('RGB',(1800,850),'white'); d=ImageDraw.Draw(im)
    text_box(d,(70,285,330,435),'Usuario','Navegador')
    text_box(d,(440,245,720,475),'Web','Next.js\nUI y recorridos',PALE)
    text_box(d,(840,245,1140,475),'Servidor','Fastify\nAPI y casos de uso',PALE)
    text_box(d,(1260,90,1650,235),'Identidad','Keycloak OIDC')
    text_box(d,(1260,285,1650,435),'PostgreSQL','Datos, auditoria\ny outbox')
    text_box(d,(1260,570,1650,730),'Worker','Reintentos, escaneo,\nnotificaciones')
    text_box(d,(835,600,1145,740),'Redis','Cache y presencia')
    arrow(d,(330,360),(440,360),'HTTPS'); arrow(d,(720,360),(840,360),'API'); arrow(d,(1140,315),(1260,185),'OIDC'); arrow(d,(1140,360),(1260,360),'SQL'); arrow(d,(1455,435),(1455,570),'outbox'); arrow(d,(990,475),(990,600),'cache')
    d.text((70,50),'Figura B1  Arquitectura de contexto de Aether',font=img_font(34,True),fill='black'); im.save(path)


def diagram_dfd(path):
    im=Image.new('RGB',(1800,930),'white'); d=ImageDraw.Draw(im)
    text_box(d,(60,300,320,460),'Solicitante','Necesidad\nEvidencia')
    text_box(d,(500,250,840,480),'Proceso Aether','Intake\nEvaluacion\nDecision',PALE)
    text_box(d,(1040,90,1420,230),'D1 Gobierno','Iniciativas, estandares\nevaluaciones, decisiones')
    text_box(d,(1040,350,1420,500),'D2 Ejecucion','Proyectos, tareas\ny dependencias')
    text_box(d,(1040,620,1420,780),'D3 Evidencia','Documentos, auditoria\ny outbox')
    text_box(d,(1530,300,1760,470),'Owner y lider','Decision\nEjecucion')
    arrow(d,(320,380),(500,365),'propuesta'); arrow(d,(840,310),(1040,160),'registrar'); arrow(d,(840,365),(1040,425),'formalizar'); arrow(d,(840,430),(1040,700),'auditar'); arrow(d,(1420,425),(1530,385),'estado'); arrow(d,(1530,430),(1420,700),'resultados')
    d.text((60,45),'Figura B2  Flujo de datos de alto nivel',font=img_font(34,True),fill='black'); im.save(path)


def diagram_er(path):
    im=Image.new('RGB',(1800,1050),'white'); d=ImageDraw.Draw(im)
    entities=[((70,150,340,300),'Organizacion','PK id\npolitica'),((470,150,750,300),'Workspace','PK id\nFK organizationId'),((900,150,1180,300),'Iniciativa','PK id\nFK workspaceId'),((1360,150,1660,300),'Proyecto','PK id\nFK initiativeId'),((470,500,750,650),'Evaluacion','PK id\nFK initiativeId'),((900,500,1180,650),'Decision','PK id\nFK evaluationId'),((1360,500,1660,650),'Documento','PK versionId\nFK resourceId'),((900,800,1180,950),'Auditoria','PK eventId\nFK aggregateId')]
    for b,t,body in entities:text_box(d,b,t,body,PALE)
    for a,b,l in [((340,225),(470,225),'1 a N'),((750,225),(900,225),'1 a N'),((1180,225),(1360,225),'0 a 1'),((1040,300),(610,500),'1 a N'),((1040,300),(1040,500),'0 a N'),((1180,575),(1360,575),'1 a N'),((1040,650),(1040,800),'1 a N'),((1510,300),(1510,500),'1 a N')]:arrow(d,a,b,l)
    d.text((70,45),'Figura B3  Modelo entidad relacion simplificado',font=img_font(34,True),fill='black'); im.save(path)


def diagram_states(path):
    im=Image.new('RGB',(1800,1100),'white'); d=ImageDraw.Draw(im)
    d.text((60,45),'Figura B4  Maquinas de estado institucionales',font=img_font(34,True),fill='black')
    d.text((60,110),'Iniciativa',font=img_font(28,True),fill='black')
    items=[('draft',(80,180)),('presented',(370,180)),('under review',(700,180)),('approved',(1050,130)),('returned',(1050,300)),('rejected',(1400,130)),('cancelled',(1400,300))]
    for lab,(x,y) in items:text_box(d,(x,y,x+210,y+90),lab,'',PALE)
    for a,b in [((290,225),(370,225)),((580,225),(700,225)),((910,210),(1050,175)),((910,240),(1050,345)),((1260,175),(1400,175)),((580,250),(1400,345)),((1180,345),(370,270))]:arrow(d,a,b)
    d.text((60,560),'Proyecto',font=img_font(28,True),fill='black')
    pitems=[('pending lead',(80,640)),('planned',(370,640)),('active',(650,640)),('paused',(940,760)),('blocked',(940,540)),('completed',(1220,640)),('cancelled',(1500,540)),('archived',(1500,780))]
    for lab,(x,y) in pitems:text_box(d,(x,y,x+210,y+90),lab,'',PALE)
    for a,b in [((290,685),(370,685)),((580,685),(650,685)),((860,685),(940,805)),((860,665),(940,585)),((1150,585),(650,665)),((860,685),(1220,685)),((860,705),(1500,585)),((1430,685),(1500,825)),((1710,585),(1710,780))]:arrow(d,a,b)
    im.save(path)


def diagram_usecases(path):
    im=Image.new('RGB',(1800,920),'white'); d=ImageDraw.Draw(im)
    d.text((60,45),'Figura B5  Mapa de casos de uso',font=img_font(34,True),fill='black')
    for x,y,label in [(90,260,'Solicitante'),(90,570,'Revisor'),(1510,260,'Owner'),(1510,570,'Lider')]:
        d.ellipse((x,y,x+70,y+70),outline='black',width=4); d.line((x+35,y+70,x+35,y+165),fill='black',width=4); d.line((x,y+105,x+70,y+105),fill='black',width=4); d.line((x+35,y+165,x,y+225),fill='black',width=4); d.line((x+35,y+165,x+70,y+225),fill='black',width=4); d.text((x-10,y+240),label,font=img_font(22,True),fill='black')
    cases=[((480,140,820,245),'UC01 Proponer iniciativa'),((480,315,820,420),'UC02 Evaluar y decidir'),((480,490,820,595),'UC03 Formalizar proyecto'),((980,140,1320,245),'UC04 Ejecutar proyecto'),((980,315,1320,420),'UC05 Gestionar evidencia'),((980,490,1320,595),'UC06 Recuperar operacion')]
    for b,t in cases:text_box(d,b,t,'',PALE)
    for a,b in [((165,365),(480,190)),((165,675),(480,365)),((165,675),(480,540)),((1510,365),(820,365)),((1510,365),(820,540)),((1510,675),(1320,190)),((1510,675),(1320,365)),((1510,675),(1320,540))]:arrow(d,a,b)
    im.save(path)


DIAGRAMS.mkdir(exist_ok=True)
for fname,make in [('architecture.png',diagram_architecture),('dfd.png',diagram_dfd),('er.png',diagram_er),('states.png',diagram_states),('usecases.png',diagram_usecases)]:
    make(DIAGRAMS / fname)

d = Document(DOCX)

def set_font(run, size=9, bold=None, color=BLACK, name='Aptos'):
    run.font.name=name; run._element.rPr.rFonts.set(qn('w:ascii'),name); run._element.rPr.rFonts.set(qn('w:hAnsi'),name); run.font.size=Pt(size); run.font.color.rgb=RGBColor.from_string(color)
    if bold is not None: run.font.bold=bold

def shade(cell,color):
    e=OxmlElement('w:shd');e.set(qn('w:fill'),color);cell._tc.get_or_add_tcPr().append(e)
def decorate(cell):
    cell.vertical_alignment=WD_ALIGN_VERTICAL.CENTER; p=cell._tc.get_or_add_tcPr();b=OxmlElement('w:tcBorders')
    for edge in ('top','left','bottom','right','insideH','insideV'):
        x=OxmlElement('w:'+edge);x.set(qn('w:val'),'single');x.set(qn('w:sz'),'4');x.set(qn('w:color'),GRID);b.append(x)
    p.append(b);m=OxmlElement('w:tcMar')
    for edge in ('top','start','bottom','end'):
        x=OxmlElement('w:'+edge);x.set(qn('w:w'),'100');x.set(qn('w:type'),'dxa');m.append(x)
    p.append(m)
def repeat(row):
    e=OxmlElement('w:tblHeader');e.set(qn('w:val'),'true');row._tr.get_or_add_trPr().append(e)
def P(text='',style=None,align=None,before=None,after=None):
    p=d.add_paragraph(style=style)
    if text:set_font(p.add_run(text),9.3 if not style else 9)
    if align is not None:p.alignment=align
    if before is not None:p.paragraph_format.space_before=Pt(before)
    if after is not None:p.paragraph_format.space_after=Pt(after)
    return p
def H(text,l=1):
    p=d.add_heading(text,l);p.paragraph_format.keep_with_next=True;return p
def N(text):
    p=d.add_paragraph(style='List Number');p.paragraph_format.space_after=Pt(2);set_font(p.add_run(text),9.1);return p
def T(head,rows,widths=None,small=True):
    t=d.add_table(rows=1,cols=len(head));t.alignment=WD_TABLE_ALIGNMENT.CENTER;t.autofit=False
    for i,x in enumerate(head):
        c=t.rows[0].cells[i];c.text='';decorate(c);shade(c,DARK);r=c.paragraphs[0].add_run(str(x));set_font(r,7.7 if small else 8.3,True,'FFFFFF')
        if widths:c.width=Cm(widths[i])
    repeat(t.rows[0])
    for ri,row in enumerate(rows):
        cells=t.add_row().cells
        for i,x in enumerate(row):
            c=cells[i];c.text='';decorate(c)
            if ri%2:shade(c,PALE)
            p=c.paragraphs[0];p.paragraph_format.space_after=Pt(0);p.alignment=WD_ALIGN_PARAGRAPH.CENTER if i==0 and len(str(x))<18 else WD_ALIGN_PARAGRAPH.LEFT;r=p.add_run(str(x));set_font(r,7.5 if small else 8.3)
            if widths:c.width=Cm(widths[i])
    P('',after=3);return t
def code(text):
    for line in text.split('\n'):
        p=d.add_paragraph();p.paragraph_format.space_after=Pt(0);p.paragraph_format.left_indent=Cm(.45);set_font(p.add_run(line),7.6,name='Consolas')
    P('',after=4)
def fig(name,caption,width=6.35):
    p=d.add_paragraph();p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.add_run().add_picture(str(DIAGRAMS/name),width=Inches(width));p.paragraph_format.space_after=Pt(2)
    p=P(caption,align=WD_ALIGN_PARAGRAPH.CENTER,after=9);p.runs[0].font.italic=True;p.runs[0].font.size=Pt(8.3)
def pg():d.add_page_break()

# Remove former terminal paragraph so expansion remains a coherent document.
for p in list(d.paragraphs)[-3:]:
    if p.text.strip()=='Fin del documento':p._element.getparent().remove(p._element)

pg();H('8 Perfiles, permisos y casos de uso')
H('8.1 Perfiles operativos',2)
T(['Perfil','Objetivo y contexto','Necesidades de interfaz','Riesgo que controla'],[
['Solicitante institucional','Formula necesidades dentro de un workspace y responde observaciones.','Crear, editar, presentar, consultar estado y recibir avisos neutrales.','No debe decidir ni acceder a otros workspaces.'],
['Owner de organizacion','Responde por gobierno, criterios, decisiones y excepciones.','Bandeja de aprobación, trazabilidad completa, condiciones y métricas organizacionales.','Separación de deberes, auditoría y autenticación reciente.'],
['Administrador contextual','Administra miembros, workspaces o ejecución dentro de límites otorgados.','Gestión visible de capacidades y confirmación antes de acciones sensibles.','No debe adquirir una facultad exclusiva de owner.'],
['Revisor asignado','Evalúa una iniciativa contra estándar y evidencia exacta.','Expediente, borrador, criterios, cobertura, conflicto y abstención.','No puede decidir sobre iniciativa con conflicto abierto.'],
['Lider de proyecto','Convierte mandato en plan, tareas, dependencias, riesgos y cierre.','Tablero de estado, próximas acciones, capacidad y bloqueo.','No debe reabrir estados terminales ni cambiar origen del proyecto.'],
['Operador de soporte','Diagnostica un incidente bajo acceso JIT aprobado.','Diagnóstico agregado, vencimiento visible y revocación inmediata.','No ve documentos, correos, nombres ni contenido institucional.']], [3.1,4.8,4.8,3.3])
H('8.2 Matriz de permisos de referencia',2)
T(['Accion','Solicitante','Revisor','Lider','Admin','Owner','Soporte JIT'],[
['Crear o editar iniciativa propia','Si','No','No','Contextual','Si','No'],['Presentar iniciativa','Si','No','No','Contextual','Si','No'],['Asignar atención y prioridad operativa','No','No','No','Si','Si','No'],['Publicar evaluación','No','Asignado','No','No','Si','No'],['Decidir iniciativa','No','No','No','No','Si','No'],['Resolver conflicto de revisión','No','No','No','No','Si','No'],['Crear proyecto desde decisión','No','No','No','No','Si','No'],['Gestionar ejecución de proyecto','Participante','No','Si','Contextual','Si','No'],['Solicitar o aprobar grant temporal','Solicitar','No','No','No','Aprobar','No'],['Consultar diagnóstico agregado','No','No','No','No','No','Aprobado']], [4.4,1.8,1.8,1.8,1.8,1.8,2.0])
fig('usecases.png','Figura 1. Casos de uso principales y actores autorizados.',6.35)
H('8.3 Casos de uso desarrollados',2)
for uc in [
('UC01 Proponer una iniciativa','Solicitante con membresía activa y capacidad de creación.','Captura título, problema, resultado esperado y clasificación. El sistema valida el contexto, guarda draft, asigna versión 0 y audita. El solicitante presenta; la transición es válida solo desde draft o returned.','Si falta dato: VALIDATION_ERROR. Si el workspace está archivado: WORKSPACE_ARCHIVED. Si la versión cambió: CONFLICT o PRECONDITION_FAILED.','Iniciativa presented o draft, con correlationId y auditoría.'),
('UC02 Evaluar una iniciativa','Owner ha asignado revisor, estándar activo y sin conflicto abierto.','Revisor registra respuestas y evidencia. Puede guardar borrador. Al publicar, Aether exige cobertura 100 por ciento y mueve la iniciativa a under review en la misma transacción que la evaluación, auditoría y outbox.','Criterio no aplicable sin fundamento: VALIDATION_ERROR. Conflicto abierto: CONFLICT_OF_INTEREST. Estándar cambiado: CONFLICT.','Evaluación inmutable con snapshot de criterios y métricas.'),
('UC03 Decidir y formalizar un proyecto','Owner, iniciativa under review, evaluación completa y condiciones verificables.','Owner decide approved, rejected, returned o cancelled con fundamento. Para approved, condiciones quedan pending; una vez cumplidas o exentas, el owner formaliza un proyecto con mandato, sponsor, líder y participantes explícitos.','Excluyente no cumplido: conflicto de decisión. Condición pendiente: conversión bloqueada. Idempotency key reutilizada con payload distinto: IDEMPOTENCY_KEY_REUSED.','Decisión inmutable y, si procede, proyecto único vinculado a la decisión.'),
('UC04 Gestionar evidencia y entregables','Participante del proyecto con capacidad de contribución.','Cliente inicia carga con tipo, tamaño, clasificación y SHA256. El binario queda pending scan; worker revalida tenant, recurso y versión antes de publicar o rechazar. Una versión publicada puede aceptar un entregable del mismo proyecto.','Archivo sobredimensionado: PAYLOAD_TOO_LARGE. Hash o alcance inválido: VALIDATION_ERROR o NOT_FOUND. Escaneo fallido: versión rechazada y evento recuperable.','Versión de documento trazable, clasificada y con estado de evidencia.'),
('UC05 Recuperar trabajo asíncrono','Owner o admin de organización con autenticación reciente.','Consulta dead letters, selecciona evento propio, registra motivo y solicita replay idempotente. El worker reintenta con el mismo sobre y consumidor idempotente.','No dead letter: NOT_FOUND. Sin autenticación reciente: RECENT_AUTH_REQUIRED. Otro tenant: NOT_FOUND.','Evento vuelve a pending y replay queda auditado.'),
('UC06 Soporte JIT de mínimo privilegio','Operador incluido en configuración de elegibilidad y owner distinto disponible.','Operador solicita acceso con motivo. Owner aprueba por un máximo total de 60 minutos. La ruta administrativa devuelve solo conteos agregados de salud. Toda consulta revalida vigencia.','Operador no elegible: SUPPORT_OPERATOR_NOT_ELIGIBLE. Solicitud propia aprobada: separación de deberes. Expirado: SUPPORT_ACCESS_EXPIRED.','Diagnóstico agregado auditado, sin exposición de contenido institucional.')]:
    H(uc[0],3);T(['Campo','Especificacion'],[['Actor y precondiciones',uc[1]],['Flujo principal',uc[2]],['Alternativas y errores',uc[3]],['Postcondicion',uc[4]]],[4.2,11.8])

pg();H('9 Diagramas de arquitectura, datos y estados')
P('Los diagramas son parte normativa de esta SRS. Muestran límites y relaciones de dominio; no sustituyen los contratos OpenAPI ni las restricciones de PostgreSQL.')
fig('architecture.png','Figura 2. Arquitectura de contexto: web, API, identidad, datos y trabajo asíncrono.',6.35)
fig('dfd.png','Figura 3. DFD de nivel cero: los datos institucionales se registran, gobiernan, ejecutan y auditan.',6.35)
fig('er.png','Figura 4. Modelo entidad relación simplificado con cardinalidades principales.',6.35)
fig('states.png','Figura 5. Máquinas de estado de iniciativa y proyecto.',6.35)
H('9.1 Reglas de transición que complementan los diagramas',2)
T(['Agregado','Regla','Evidencia de transición'],[['Iniciativa','La versión esperada se valida antes de estado y negocio; approved, rejected y cancelled son terminales.','Auditoría con actor, estado anterior, estado posterior y correlationId.'],['Evaluación','Publicar exige revisor asignado, conflicto resuelto y cobertura completa.','Snapshot de estándar, resultados, cobertura, calidad y madurez.'],['Decisión','Returned exige fecha de próxima revisión; approved exige todos los excluyentes met.','Fundamento, evidencia, condiciones y evento durable.'],['Proyecto','pending lead, planned, active, paused, blocked, completed, cancelled y archived siguen matriz canónica.','Versión, motivo cuando aplica, auditoría y evento outbox.'],['Documento','quarantined, pending scan, published, rejected, withdrawn, superseded y purged preservan trazabilidad de versión.','Hash, clasificación, actor, recurso y evento de escaneo.']],[3.0,7.4,5.6])

pg();H('10 Modelo de datos y contratos')
H('10.1 Cardinalidades y límites de integridad',2)
T(['Relacion','Cardinalidad','Restriccion'],[['Organizacion - Workspace','1 a N','Workspace pertenece a una organización y no puede cambiarla.'],['Workspace - Iniciativa','1 a N','Iniciativa conserva organizationId y workspaceId coincidentes.'],['Iniciativa - Evaluacion','1 a N histórico','Cada evaluación conserva estándar y versión exacta; una activa sustenta la decisión.'],['Evaluacion - Decision','1 a 0..1','Una evaluación decidida no puede anularse ni reutilizarse fuera de la iniciativa.'],['Iniciativa - Proyecto','1 a 0..1','Conversión canónica e idempotente; proyecto no cruza tenencia.'],['Proyecto - Documento','1 a N','Versión de contenido debe pertenecer al agregado y proyecto autorizados.'],['Agregado - Auditoria','1 a N','Audit events append only, con actor, correlación y resultado.'],['Outbox - Consumidor','1 a N','Registro consumer mas eventId evita duplicar un efecto.']],[3.5,3.1,9.4])
H('10.2 Diccionario de datos de gobierno',2)
T(['Entidad','Campo y tipo','Regla'],[['Organization','id uuid; name text; policy json','Límite primario de aislamiento y residencia.'],['Workspace','id uuid; organizationId uuid; status enum','organizationId inmutable; archive bloquea escrituras.'],['Membership','actorId text; role enum; status enum','Rol se resuelve en servidor y puede suspenderse.'],['Initiative','id uuid; title text; problem text; expectedOutcome text; status enum; version int','Version optimista; prioridad solicitada y operativa separadas.'],['Diagnostic','initiativeId uuid; facts json; hypotheses json; risks json','Distingue evidencia, opinión e incertidumbre.'],['Standard','id uuid; version int; criteria json; publishedAt timestamp','Versión publicada y criterios inmutables.'],['Evaluation','id uuid; initiativeId uuid; standardVersion int; coverage numeric','Snapshot exacto de criterios, resultados, calidad y madurez.'],['Decision','id uuid; evaluationId uuid; outcome enum; rationale text','Inmutable; returned exige nextReviewOn.'],['DecisionCondition','id uuid; decisionId uuid; ownerActorId text; status enum','Pending bloquea conversión hasta fulfilled o exempted.']],[3.1,6.3,6.6])
H('10.3 Diccionario de ejecución, evidencia y operación',2)
T(['Entidad','Campo y tipo','Regla'],[['Project','id uuid; initiativeId uuid; decisionId uuid; status enum; version int','Origen, sponsor, líder y participantes explícitos.'],['NextAction','id uuid; projectId uuid; executor; dueDate; order int','Depende de participante y reglas de secuenciación.'],['Risk','id uuid; projectId uuid; severity enum; mitigation text; status enum','Riesgo y resolución conservan historial.'],['ChangeRequest','id uuid; projectId uuid; scope json; review status','Línea base compara mandato con estado actual.'],['DocumentVersion','versionId uuid; resourceId uuid; sha256 string; status enum','Tipo, tamaño, clasificación, retención y escaneo validados.'],['EvidenceReference','id uuid; aggregateId uuid; documentVersionId uuid','Evidencia válida apunta a versión publicada verificable.'],['AuditEvent','eventId uuid; action text; actorId text; correlationId uuid; payload json','Append only; carga útil no incluye secretos.'],['OutboxEvent','eventId uuid; aggregateId uuid; type text; attempts int; state enum','Se escribe atómicamente con el hecho de negocio.'],['Notification','id uuid; recipientActorId text; eventType text; readAt timestamp','Buzón revalida pertenencia antes de mostrar detalle.']],[3.1,6.3,6.6])
H('10.4 Ejemplos de contratos JSON',2)
P('Crear una iniciativa')
code('{\n  "organizationId": "org-uuid",\n  "workspaceId": "workspace-uuid",\n  "title": "Reducir tiempo de evaluación",\n  "problemStatement": "La decisión demora más de lo permitido",\n  "expectedOutcome": "Mediana inferior a 5 días",\n  "classification": "internal",\n  "requestedPriority": "high"\n}')
P('Snapshot de decisión aprobada')
code('{\n  "outcome": "approved",\n  "evaluationId": "evaluation-uuid",\n  "standardVersion": 3,\n  "coveragePercent": 100,\n  "qualityPercent": 82.5,\n  "rationale": "Los criterios excluyentes están cumplidos",\n  "conditions": [{"description": "Validar capacidad", "status": "pending"}]\n}')
P('Evento de auditoría')
code('{\n  "action": "initiative.decided.v2",\n  "aggregateType": "initiative",\n  "aggregateId": "initiative-uuid",\n  "actorId": "actor-123",\n  "correlationId": "request-uuid",\n  "result": "succeeded"\n}')

pg();H('11 API, errores e integración')
H('11.1 Convenciones de API',2)
T(['Elemento','Norma'],[['Formato','JSON UTF-8 sobre HTTPS. Las rutas protegidas usan sesión opaca en cookie.'],['Contexto','Las operaciones reciben organizationId y workspaceId cuando el recurso lo exige; el servidor comprueba ambos.'],['Mutaciones','Origin igual a WEB_ORIGIN, X-CSRF-Token coincidente y Idempotency-Key cuando el comando admite repetición.'],['Trazabilidad','Cliente envía o recibe X-Correlation-ID; la respuesta, auditoría y outbox comparten el valor.'],['Errores','application/problem+json con type, title, status, code, detail seguro, retryable, instance y correlationId.'],['Versionado','Contrato OpenAPI 3.1 es fuente de borde; cambios incompatibles requieren decisión y versión controlada.']],[3.2,12.8])
H('11.2 Ejemplo de respuesta de error',2)
code('{\n  "type": "https://aether.local/problems/conflict",\n  "title": "Conflicto de versión",\n  "status": 409,\n  "code": "CONFLICT",\n  "detail": "El recurso fue actualizado por otra operación",\n  "retryable": true,\n  "instance": "/v1/initiatives/initiative-uuid",\n  "correlationId": "request-uuid"\n}')
H('11.3 Catálogo de códigos de error',2)
raw=OPENAPI.read_text(encoding='utf-8');match=re.search(r'ApiProblem:.*?enum:\s*\[(.*?)\]',raw,re.S);segment=match.group(1) if match else '';codes=[]
for x in re.findall(r'\b[A-Z][A-Z0-9_]+\b',segment):
    if x not in codes:codes.append(x)
def status(c):
    if c in ('UNAUTHENTICATED',):return '401'
    if c in ('FORBIDDEN','RECENT_AUTH_REQUIRED','CONFLICT_OF_INTEREST','BUSINESS_HOURS_ENFORCED','SUPPORT_OPERATOR_NOT_ELIGIBLE','SUPPORT_ACCESS_DENIED'):return '403'
    if c in ('NOT_FOUND','GRANT_RESOURCE_NOT_FOUND'):return '404'
    if c in ('RATE_LIMITED',):return '429'
    if c in ('PRECONDITION_FAILED',):return '412'
    if c in ('PAYLOAD_TOO_LARGE',):return '413'
    if c in ('OIDC_PROVIDER_UNAVAILABLE','DEPENDENCY_UNAVAILABLE','ACCOUNT_MANAGEMENT_UNAVAILABLE'):return '503'
    if c in ('VALIDATION_ERROR','GRANT_INVALID_REQUEST','SUPPORT_ACCESS_INVALID_REQUEST','TARGET_MUST_BE_DIFFERENT','TARGET_MUST_BE_MEMBER','TARGET_NOT_MEMBER','TARGET_IS_OWNER','TARGET_HAS_OPEN_RESPONSIBILITIES'):return '400'
    return '409'
def action(c):
    if status(c) in ('401','403'):return 'Autenticar o solicitar capacidad autorizada.'
    if status(c)=='409':return 'Recargar estado y no repetir con datos divergentes.'
    if status(c)=='503':return 'Reintentar con backoff y conservar correlationId.'
    if status(c)=='429':return 'Respetar límite y Retry-After.'
    return 'Corregir solicitud o consultar recurso autorizado.'
for i in range(0,len(codes),12):T(['Codigo','HTTP','Accion del cliente'],[[c,status(c),action(c)] for c in codes[i:i+12]],[6.2,1.5,8.3])
H('11.4 Integración OIDC paso a paso',2)
for x in ['El navegador inicia login; el servidor genera state, nonce, PKCE verifier y handle temporal en cookie segura.','El proveedor autentica y redirige al callback registrado.','El servidor valida state, nonce, issuer y PKCE; intercambia el código fuera del navegador.','Se crea sesión opaca revocable y cookie httpOnly; tokens del proveedor no llegan a JavaScript.','Cada mutación valida sesión, origen, CSRF y, cuando corresponde, antigüedad de autenticación.','Logout revoca sesión; OIDC indisponible devuelve 503 y no habilita modo local alternativo.']:N(x)

pg();H('12 Operacion, resiliencia y recuperación')
H('12.1 Objetivos cuantitativos base V1',2)
P('Los siguientes valores pasan a ser objetivos verificables para el primer entorno productivo. Cualquier excepción requiere una decisión de cambio y evidencia de riesgo aceptado.')
T(['Metrica','Objetivo base','Medicion y criterio'],[['Disponibilidad API','99.5 por ciento mensual','Excluye mantenimiento aprobado; fuente de observabilidad del servidor.'],['Latencia lectura','p95 menor o igual a 400 ms','Rutas autorizadas de consulta bajo carga nominal.'],['Latencia mutación','p95 menor o igual a 800 ms','Incluye autorización, transacción, auditoría y outbox.'],['Throughput inicial','40 solicitudes por segundo sostenidas','Con 200 sesiones concurrentes y tasa de error menor a 1 por ciento.'],['Procesamiento outbox','95 por ciento de eventos en menos de 60 segundos','Desde commit hasta éxito del consumidor habilitado.'],['RTO','4 horas','Restaurar servicio crítico después de pérdida regional o de datos operativos.'],['RPO','15 minutos','Máxima pérdida de transacciones comprometidas aceptada.'],['Retención de respaldos','35 días diarios y recuperación puntual cada 15 minutos','Cifrado, prueba mensual de restauración y registro de resultado.'],['Navegadores','Últimas 2 versiones estables de Chrome, Edge y Firefox; Safari actual y anterior','Pruebas e2e en Chrome y Edge; prueba funcional de Safari y Firefox.'],['Accesibilidad','WCAG 2.2 AA como objetivo de interfaz','Revisión automatizada, teclado y contraste en recorridos críticos.']],[3.7,4.2,8.1])
H('12.2 Runbooks mínimos de operación',2)
T(['Situacion','Accion inmediata','Criterio de cierre'],[['API no disponible','Comprobar health, ready, PostgreSQL y descubrimiento OIDC; preservar correlationId.','Ready vuelve a 200 y pruebas de lectura y mutación controladas pasan.'],['OIDC no disponible','No crear sesiones nuevas; comunicar 503 con Retry-After 60; conservar sesiones válidas.','Descubrimiento OIDC y login con PKCE completan prueba sintética.'],['Outbox atrasado','Medir pending, processing, edad máxima e intentos; escalar worker sin duplicar consumidores.','Edad de pendiente inferior a 60 segundos y sin incremento de dead letters.'],['Dead letter','Validar tenant, payload, causa y autorización reciente; replay con motivo.','Consumidor procesa una vez y auditoría muestra replay exitoso.'],['Documento bloqueado','Mantener cuarentena; verificar hash, escaneo y contexto antes de publicar.','Estado published o rejected con evento y evidencia de escaneo.'],['Incidente de soporte','Usar JIT vigente; consultar solo diagnóstico agregado; revocar al finalizar.','Grant revocado o expirado y uso auditado.']],[3.2,6.3,6.5])
H('12.3 Rollback y migración de datos',2)
T(['Fase','Migracion segura','Rollback'],[['Preparar','Migración aditiva, compatible con versión previa, índice concurrente cuando aplique y plan de respaldo.','Detener liberación antes de activar comportamiento nuevo.'],['Desplegar','Aplicar migración, verificar checksum, ejecutar smoke test y habilitar código compatible.','Revertir aplicación a versión previa mientras esquema aditivo siga presente.'],['Expandir datos','Backfill idempotente, loteado, medido y auditado; no bloquear tráfico principal.','Detener job y conservar registros ya migrados sin borrado masivo.'],['Contraer','Solo después de ventana de compatibilidad, respaldo validado y lectura de métricas.','Restaurar desde backup probado si se detecta pérdida; no usar cambios destructivos sin plan aprobado.'],['Recuperar','Restaurar backup y logs hasta punto objetivo; verificar conteos, integridad, auditoría y outbox.','Declarar incidente, conservar evidencia y ejecutar postmortem.']],[2.4,7.6,6.0])
H('12.4 Patrón de implementación de transacción y outbox',2)
code('await database.transaction(async (tx) => {\n  const initiative = await initiatives.present(tx, command);\n  await audit.append(tx, { action: "initiative.presented.v1", correlationId });\n  await outbox.enqueue(tx, { type: "initiative.presented.v1", aggregateId: initiative.id });\n  return initiative;\n});\n// El worker registra consumer + eventId antes de reconocer el efecto.')

pg();H('13 Guia de implementación y pruebas')
H('13.1 Patrones obligatorios',2)
T(['Patron','Aplicacion esperada'],[['Autorización contextual','Resolver actor, organización, workspace, recurso y acción en servidor; UI solo refleja capacidades.'],['Concurrencia optimista','Exigir expectedVersion en agregados versionados; responder conflicto determinista y recargar.'],['Idempotencia','Acotar Idempotency-Key por actor y recurso; mismo payload repite respuesta, payload distinto devuelve 409.'],['Errores seguros','Mapear excepción de dominio a ApiProblem; no filtrar SQL, stack trace, secreto o recurso ajeno.'],['Snapshot inmutable','Persistir estándar, criterios, métricas y evidencia aplicados junto con evaluación y decisión.'],['Outbox transaccional','No enviar correo, exportar ni cambiar almacenamiento externo antes de confirmar transacción.'],['Pruebas por capa','Dominio para invariantes, aplicación para casos de uso, integración para base y e2e para recorridos críticos.']],[4.0,12.0])
H('13.2 Secuencias de prueba de extremo a extremo',2)
for x in ['Crear organización, política, workspace y membresías; intentar lectura cruzada y comprobar denegación.','Crear iniciativa, presentarla, asignar revisor, guardar borrador, publicar evaluación y registrar una decisión returned.','Repetir ciclo con criterios excluyentes met; aprobar, cumplir condición y convertir una sola vez a proyecto con misma Idempotency-Key.','Cargar documento, simular evento duplicado, verificar una sola promoción; forzar dead letter y ejecutar replay autorizado.','Solicitar JIT con operador elegible, aprobar con owner distinto, consultar diagnóstico agregado y comprobar que una lectura de contenido se deniega.']:N(x)
H('13.3 Cobertura de pruebas exigida',2)
T(['Nivel','Foco','Salida requerida'],[['Unitarias','Estados, cobertura, calidad, permisos y validadores puros.','Resultado reproducible por paquete de dominio.'],['Aplicación','Casos de uso, puertos, idempotencia, auditoría y outbox.','Pruebas de éxito, denegación y concurrencia.'],['Integración','PostgreSQL, migraciones, triggers, aislamiento, storage y worker.','Base temporal con limpieza y revisión de eventos.'],['Contrato','OpenAPI, DTOs Zod, errores y compatibilidad de clientes.','Validación OpenAPI y pruebas HTTP.'],['E2E','Inicio de sesión, iniciativas, evaluación, proyectos, documentos y accesibilidad.','Recorridos críticos en navegadores objetivo.'],['Resiliencia','OIDC caída, base no disponible, evento duplicado, dead letter y restore.','Evidencia de runbook y tiempo contra RTO RPO.']],[2.4,7.2,6.4])
H('13.4 Exclusión deliberada de wireframes',2)
P('Los wireframes, diseños de componentes y prototipos navegables se mantienen como artefactos de UX independientes. Deben respetar las capacidades calculadas por servidor, los recorridos y criterios definidos aquí, pero su construcción visual se controla en la especificación de diseño de interfaz.')
P('Fin del documento',align=WD_ALIGN_PARAGRAPH.CENTER,before=16)
d.core_properties.title='Aether Especificacion de Requisitos de Software';d.core_properties.subject='SRS completa de Aether';d.core_properties.author='Producto Aether';d.save(DOCX)
print(DOCX)
