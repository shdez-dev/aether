from pathlib import Path
from copy import deepcopy

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parent
DOCX = ROOT / 'Aether_SRS_2026-09.docx'
BLACK, DARK, PALE, GRID = '000000', '202020', 'F1F1F1', 'BFBFBF'


def set_font(run, size=9, bold=None, color=BLACK, name='Aptos'):
    run.font.name = name
    run._element.rPr.rFonts.set(qn('w:ascii'), name)
    run._element.rPr.rFonts.set(qn('w:hAnsi'), name)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.font.bold = bold


def shade(cell, color):
    node = OxmlElement('w:shd')
    node.set(qn('w:fill'), color)
    cell._tc.get_or_add_tcPr().append(node)


def decorate(cell):
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    props = cell._tc.get_or_add_tcPr()
    borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        border = OxmlElement('w:' + edge)
        border.set(qn('w:val'), 'single')
        border.set(qn('w:sz'), '4')
        border.set(qn('w:color'), GRID)
        borders.append(border)
    props.append(borders)
    margins = OxmlElement('w:tcMar')
    for edge in ('top', 'start', 'bottom', 'end'):
        margin = OxmlElement('w:' + edge)
        margin.set(qn('w:w'), '100')
        margin.set(qn('w:type'), 'dxa')
        margins.append(margin)
    props.append(margins)


def repeat(row):
    element = OxmlElement('w:tblHeader')
    element.set(qn('w:val'), 'true')
    row._tr.get_or_add_trPr().append(element)


def add_text_after(paragraph, text, style=None, bold=False, align=None, before=0, after=5):
    new = OxmlElement('w:p')
    paragraph._p.addnext(new)
    p = type(paragraph)(new, paragraph._parent)
    if style:
        p.style = style
    if text:
        set_font(p.add_run(text), 9.3 if style is None else 9, bold=bold)
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    return p


def replace_paragraph(paragraph, text):
    paragraph.clear()
    set_font(paragraph.add_run(text), 9.3)
    return paragraph


def cell_text(cell, text, header=False):
    cell.text = ''
    decorate(cell)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run(text)
    set_font(r, 7.5 if not header else 7.7, bold=header, color='FFFFFF' if header else BLACK)


def add_table(doc, headings, rows, widths):
    table = doc.add_table(rows=1, cols=len(headings))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for i, heading in enumerate(headings):
        cell = table.rows[0].cells[i]
        cell_text(cell, heading, header=True)
        shade(cell, DARK)
        cell.width = Cm(widths[i])
    repeat(table.rows[0])
    for ri, row in enumerate(rows):
        cells = table.add_row().cells
        for i, value in enumerate(row):
            cell = cells[i]
            cell_text(cell, str(value))
            if ri % 2:
                shade(cell, PALE)
            cell.width = Cm(widths[i])
            if i == 0 and len(str(value)) < 24:
                cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def append_heading(doc, text, level=1):
    p = doc.add_heading(text, level)
    p.paragraph_format.keep_with_next = True
    return p


def append_body(doc, text, after=5):
    p = doc.add_paragraph()
    set_font(p.add_run(text), 9.3)
    p.paragraph_format.space_after = Pt(after)
    return p


def append_numbered(doc, text):
    p = doc.add_paragraph(style='List Number')
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(text), 9.1)
    return p


doc = Document(DOCX)

# Control de versión y aprobaciones: sustituye marcadores sin inventar aprobaciones personales.
doc.tables[0].cell(2, 1).text = '1.1'
doc.tables[0].cell(4, 1).text = 'En revisión para aprobación formal'
for row, role in zip(doc.tables[1].rows[1:], [
    'Patrocinador institucional por designar',
    'Responsable de producto por designar',
    'Responsable de arquitectura y seguridad por designar',
    'Responsable de operación por designar',
]):
    cell_text(row.cells[1], role)
    cell_text(row.cells[2], 'Al aprobar versión 1.1')
    cell_text(row.cells[3], 'Firma pendiente de aprobación formal')

history = doc.tables[2]
for row in list(history.rows)[2:]:
    history._tbl.remove(row._tr)
new = history.add_row().cells
for c, value in zip(new, [
    '1.1', '2026-09-23',
    'Se completan objetivos operativos, retención, control de aprobación y caso de negocio de referencia.',
    'Producto Aether', 'Pendiente de aprobación formal'
]):
    cell_text(c, value)

for p in doc.paragraphs:
    if p.text.startswith('Las metas numéricas sin valor pactado'):
        replace_paragraph(p, 'Los objetivos cuantitativos de esta versión son obligatorios para el primer entorno productivo. La liberación exige pruebas reproducibles de rendimiento, compatibilidad, disponibilidad y recuperación contra los valores de la sección 12.1.')
    elif p.text.startswith('Dato pendiente controlado.'):
        replace_paragraph(p, 'La retención y recuperación se rigen por la política base de la sección 4.1 y el detalle de la sección 12.1. Las obligaciones legales, contractuales o de investigación que exijan un periodo mayor activan retención legal sin borrar la evidencia vinculada.')
    elif p.text == '13.4 Exclusión deliberada de wireframes':
        replace_paragraph(p, '13.4 Alcance del diseño de interfaz')
        p.style = 'Heading 2'
    elif p.text.startswith('Los wireframes, diseños de componentes'):
        replace_paragraph(p, 'Los recorridos y criterios de interfaz se especifican en esta SRS mediante requisitos, casos de uso, permisos y accesibilidad. Los prototipos visuales se gestionan como artefactos de UX separados y no forman parte de esta versión controlada.')

for row in doc.tables[15].rows[1:]:
    if row.cells[0].text == 'SRS-NF-007':
        cell_text(row.cells[3], 'Lecturas p95 <= 400 ms; mutaciones p95 <= 800 ms; 40 rps sostenidas, 200 sesiones concurrentes y error < 1 por ciento.')
    elif row.cells[0].text == 'SRS-NF-010':
        cell_text(row.cells[3], 'Últimas 2 versiones estables de Chrome, Edge y Firefox; Safari actual y anterior. E2E en Chrome y Edge; funcional en Firefox y Safari.')

retention = {
    'Identidad y acceso': 'Sesiones y concesiones: 30 días tras vencimiento. Registro de acceso y cambios de privilegio: 7 años. No se conservan tokens de proveedor.',
    'Gobierno': 'Iniciativas, evaluaciones, decisiones y condiciones: 7 años desde cierre o cancelación; retención legal prevalece.',
    'Ejecución': 'Proyectos, tareas, riesgos, cambios y cierre: 5 años desde archivado, salvo obligación contractual superior.',
    'Contenido': 'Documentos y evidencia publicada: 5 años desde el cierre del agregado; versiones rechazadas o en cuarentena: 180 días, salvo investigación activa.',
    'Trazabilidad': 'Eventos de auditoría: 7 años, append only, con borrado solo por proceso aprobado y evidencia de ejecución.',
    'Operación': 'Logs técnicos: 90 días. Outbox y dead letters: 180 días desde resolución. Métricas agregadas: 25 meses.'
}
for row in doc.tables[16].rows[1:]:
    key = row.cells[0].text
    if key in retention:
        cell_text(row.cells[2], retention[key])

for row in doc.tables[20].rows[1:]:
    if row.cells[0].text == 'DEP-04':
        cell_text(row.cells[1], 'La organización adopta la política base de retención de la sección 4.1 y registra cualquier requisito legal o contractual superior.')
        cell_text(row.cells[2], 'Configuración versionada, retención legal y revisión anual de cumplimiento.')
    elif row.cells[0].text == 'DEP-05':
        cell_text(row.cells[1], 'Producto y operación aceptan los objetivos V1 de navegadores, rendimiento y recuperación.')
        cell_text(row.cells[2], 'Pruebas de carga, compatibilidad, respaldo y restauración antes de liberar.')
for row in doc.tables[24].rows[1:]:
    if row.cells[0].text == 'R-05':
        cell_text(row.cells[1], 'Objetivos de rendimiento, compatibilidad o recuperación incumplidos.')
        cell_text(row.cells[3], 'Valores V1 definidos; pruebas de carga, navegador, backup y restore bloquean la liberación si fallan.')

# Inserta el resumen ejecutivo antes del control documental sin alterar la portada.
anchor = doc.paragraphs[7]
anchor = add_text_after(anchor, 'Resumen ejecutivo', style='Heading 1', before=12, after=4)
anchor = add_text_after(anchor, 'Aether convierte necesidades organizacionales en iniciativas evaluables, decisiones trazables y proyectos ejecutables. La plataforma centraliza el ciclo desde la identificación de una necesidad hasta su seguimiento, evidencia y cierre, manteniendo separación explícita entre iniciativa, evaluación, decisión y ejecución.', after=4)
anchor = add_text_after(anchor, 'La solución establece límites claros entre navegador, aplicación web, servidor, dominio, PostgreSQL, worker, Keycloak y Redis. La seguridad se basa en OIDC con PKCE, sesiones opacas, CSRF y autorización contextual de servidor. Las operaciones relevantes se auditan y los efectos asíncronos se protegen con outbox transaccional, consumidores idempotentes y dead letters.', after=4)
anchor = add_text_after(anchor, 'Esta versión deja definidos los objetivos operativos iniciales, la política de retención, el modelo de aprobación y un caso de negocio de referencia. La autorización formal de las personas designadas sigue siendo una condición previa para construir o liberar a producción.', after=9)

# Anexo de negocio para una evaluación ejecutiva completa.
doc.add_page_break()
append_heading(doc, '14 Caso de negocio y aprobación formal')
append_heading(doc, '14.1 Decisión solicitada', 2)
append_body(doc, 'Se solicita aprobar la inversión de referencia, el cronograma de 32 semanas y los criterios de salida de Aether. La aprobación autoriza el inicio de descubrimiento y construcción; no reemplaza las aprobaciones de seguridad, operación ni liberación detalladas en esta SRS.')
append_heading(doc, '14.2 Problema y oportunidad', 2)
append_body(doc, 'La gestión dispersa de necesidades, evaluaciones y decisiones aumenta el tiempo administrativo, dificulta demostrar el fundamento de una priorización y debilita el vínculo entre una decisión y su ejecución. Aether concentra esos artefactos en un flujo gobernado, con evidencia versionada y trazabilidad verificable.')
append_heading(doc, '14.3 Presupuesto de referencia V1', 2)
append_body(doc, 'Las cifras se expresan en USD sin impuestos y sirven para planificación y autorización inicial; una contratación debe sustituirlas por propuestas vigentes de proveedores y tarifas aprobadas.')
add_table(doc, ['Componente', 'Alcance', 'Monto USD'], [
    ['Descubrimiento y diseño', 'Talleres, definición operativa, arquitectura y plan de datos; 6 semanas.', '18 000'],
    ['Construcción del producto', 'Web, API, dominio, base, worker, identidad, auditoría y contratos; 24 semanas.', '106 000'],
    ['Calidad y endurecimiento', 'Pruebas, seguridad, migración, observabilidad y recuperación; 6 semanas solapadas.', '23 000'],
    ['Piloto y transición', 'Capacitación, operación asistida, correcciones y salida controlada; 4 semanas.', '18 000'],
    ['Contingencia', '15 por ciento sobre los componentes directos.', '24 750'],
    ['Inversión inicial estimada', 'Presupuesto de referencia para la fase de implementación.', '189 750'],
], [4.0, 9.3, 3.0])
append_body(doc, 'El costo operativo anual de referencia es 42 000 USD: infraestructura e identidad 12 000 USD, soporte y mantenimiento 20 000 USD, y seguridad, observabilidad y respaldos 10 000 USD.')
append_heading(doc, '14.4 Cronograma y hitos de control', 2)
add_table(doc, ['Fase', 'Duración', 'Resultado y decisión'], [
    ['Movilización', '2 semanas', 'Equipo, patrocinio, métricas de línea base y registro de riesgos aprobados.'],
    ['Descubrimiento', '4 semanas', 'Procesos, roles, datos, integraciones y casos prioritarios validados.'],
    ['Producto base', '12 semanas', 'Iniciativas, evaluación, decisión, auditoría, OIDC y trazabilidad en entorno de prueba.'],
    ['Integración y resiliencia', '8 semanas', 'Proyecto, documentos, worker, outbox, migraciones, seguridad y pruebas no funcionales.'],
    ['Piloto', '4 semanas', 'Uso con organización designada, correcciones y decisión de expansión.'],
    ['Transición productiva', '2 semanas', 'Runbooks, respaldo probado, capacitación, aceptación y liberación controlada.'],
], [3.7, 2.4, 10.2])
append_heading(doc, '14.5 Beneficio y retorno de referencia', 2)
append_body(doc, 'El escenario base asume 300 iniciativas anuales, 14 horas administrativas evitadas por iniciativa y un costo interno de 40 USD por hora. A ello se añade una reducción anual de 45 000 USD por retrabajo y una reducción de 30 000 USD en preparación de auditorías y consolidación de evidencia. Estas hipótesis deben validarse contra una línea base institucional durante descubrimiento.')
add_table(doc, ['Indicador', 'Cálculo', 'Valor'], [
    ['Tiempo administrativo recuperado', '300 iniciativas x 14 horas x 40 USD por hora.', '168 000 USD por año'],
    ['Retrabajo evitado', 'Hipótesis conservadora de menor reproceso y recolección manual.', '45 000 USD por año'],
    ['Preparación de auditoría reducida', 'Menor búsqueda, consolidación y verificación de evidencia.', '30 000 USD por año'],
    ['Beneficio anual estimado', 'Suma de beneficios anuales de referencia.', '243 000 USD por año'],
    ['Costo total a tres años', 'Inversión inicial de 189 750 USD más operación de 42 000 USD por año.', '315 750 USD'],
    ['ROI a tres años', '(729 000 - 315 750) / 315 750.', '131 por ciento'],
    ['Punto de equilibrio', 'Costo del primer año dividido por beneficio mensual estimado.', 'Aproximadamente 12 meses'],
], [4.4, 8.6, 3.3])
append_heading(doc, '14.6 Condiciones para la aprobación formal', 2)
for item in [
    'Designar patrocinador, responsable de producto, responsable de arquitectura y seguridad, y responsable de operación en la tabla de aprobaciones.',
    'Ratificar el presupuesto, el cronograma y las hipótesis de volumen, horas recuperadas y costo interno del caso de negocio.',
    'Validar la política base de retención con la función legal, contractual y de seguridad de la organización.',
    'Demostrar los objetivos de la sección 12.1 mediante pruebas de rendimiento, compatibilidad, respaldo y restauración antes de liberar.',
    'Registrar la decisión de aprobación o rechazo con fecha, versión de esta SRS y evidencia adjunta.'
]:
    append_numbered(doc, item)
append_body(doc, 'Fin del documento', after=8).alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.core_properties.title = 'Aether Especificacion de Requisitos de Software'
doc.core_properties.subject = 'SRS completa de Aether con caso de negocio y control de aprobación'
doc.core_properties.author = 'Producto Aether'
doc.save(DOCX)
print(DOCX)
