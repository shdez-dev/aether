from pathlib import Path
from io import BytesIO
from xml.etree import ElementTree as ET

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph as DocxParagraph
from docx.oxml.ns import qn
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image as PdfImage, PageBreak, Paragraph as PdfParagraph, SimpleDocTemplate, Spacer, Table as PdfTable, TableStyle

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'Aether_SRS_2026-09.docx'
OUTPUT = ROOT / 'Aether_SRS_2026-09.pdf'
NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def blocks(parent):
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag == NS + 'p':
            yield DocxParagraph(child, parent)
        elif child.tag == NS + 'tbl':
            yield Table(child, parent)


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(colors.HexColor('#606060'))
    canvas.setFont('Helvetica-Bold', 7.5)
    canvas.drawCentredString(width / 2, height - 1.0 * cm, 'AETHER   |   ESPECIFICACION DE REQUISITOS DE SOFTWARE')
    canvas.setFont('Helvetica', 7.5)
    canvas.drawCentredString(width / 2, 0.75 * cm, f'AETH-SRS-001   |   Uso interno   |   Version 1.1   |   Pagina {doc.page}')
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle('BodyAether', parent=styles['BodyText'], fontName='Helvetica', fontSize=8.7, leading=11.1, textColor=colors.black, spaceAfter=5))
styles.add(ParagraphStyle('TitleAether', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=26, leading=31, alignment=TA_CENTER, textColor=colors.black, spaceAfter=7))
styles.add(ParagraphStyle('SubtitleAether', parent=styles['BodyText'], fontName='Helvetica', fontSize=10.5, leading=13, alignment=TA_CENTER, textColor=colors.HexColor('#606060'), spaceAfter=10))
styles.add(ParagraphStyle('H1Aether', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=15, leading=18, textColor=colors.black, spaceBefore=17, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle('H2Aether', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11, leading=14, textColor=colors.black, spaceBefore=11, spaceAfter=4, keepWithNext=True))
styles.add(ParagraphStyle('BulletAether', parent=styles['BodyText'], fontName='Helvetica', fontSize=8.7, leading=11, textColor=colors.black, leftIndent=13, firstLineIndent=-7, spaceAfter=2))


def esc(value):
    return value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>')


def paragraph_flow(p, first_title=False):
    blips = p._p.xpath('.//a:blip')
    if blips:
        rel_id = blips[0].get(qn('r:embed'))
        blob = p.part.related_parts[rel_id].blob
        probe = Image.open(BytesIO(blob))
        width = 6.35 * 72
        height = width * probe.height / probe.width
        return [PdfImage(BytesIO(blob), width=width, height=height), Spacer(1, 3)]
    xml = p._p.xml
    if '<w:br w:type="page"' in xml:
        return [PageBreak()]
    text = p.text.strip()
    if not text:
        return [Spacer(1, 3)]
    style = p.style.name
    if style == 'Title':
        return [Spacer(1, 5.7 * cm), PdfParagraph(esc(text), styles['TitleAether'])]
    if style == 'Subtitle':
        return [PdfParagraph(esc(text), styles['SubtitleAether'])]
    if style == 'Heading 1':
        return [PdfParagraph(esc(text), styles['H1Aether'])]
    if style == 'Heading 2' or style == 'Heading 3':
        return [PdfParagraph(esc(text), styles['H2Aether'])]
    if 'List Bullet' in style:
        return [PdfParagraph('&bull; ' + esc(text), styles['BulletAether'])]
    if 'List Number' in style:
        return [PdfParagraph(esc(text), styles['BulletAether'])]
    alignment = TA_CENTER if p.alignment == 1 else TA_LEFT
    sty = ParagraphStyle('Dynamic', parent=styles['BodyAether'], alignment=alignment)
    return [PdfParagraph(esc(text), sty)]


def table_flow(table):
    data = []
    for r, row in enumerate(table.rows):
        cells = []
        for cell in row.cells:
            text = '<br/>'.join(esc(p.text.strip()) for p in cell.paragraphs if p.text.strip()) or ' '
            sty = ParagraphStyle('CellHead' if r == 0 else 'Cell', parent=styles['BodyAether'], fontName='Helvetica-Bold' if r == 0 else 'Helvetica', fontSize=7.1, leading=8.7, textColor=colors.white if r == 0 else colors.black, spaceAfter=0)
            cells.append(PdfParagraph(text, sty))
        data.append(cells)
    width = A4[0] - 4 * cm
    col_count = max(len(row) for row in data)
    col_widths = [width / col_count] * col_count
    tbl = PdfTable(data, colWidths=col_widths, repeatRows=1, hAlign='CENTER')
    commands = [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#202020')), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#BFBFBF')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]
    for r in range(1, len(data)):
        if r % 2 == 0:
            commands.append(('BACKGROUND', (0, r), (-1, r), colors.HexColor('#F1F1F1')))
    tbl.setStyle(TableStyle(commands))
    return [tbl, Spacer(1, 4)]


document = Document(SOURCE)
story = []
for block in blocks(document):
    if isinstance(block, DocxParagraph):
        story.extend(paragraph_flow(block))
    else:
        story.extend(table_flow(block))

pdf = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=1.65*cm, bottomMargin=1.45*cm, title='Aether Especificacion de Requisitos de Software', author='Producto Aether')
pdf.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(OUTPUT)
