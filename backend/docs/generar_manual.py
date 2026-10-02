"""
Genera el Manual Técnico del Backend en PDF.

Rutas, permisos, filtros y relaciones entre modelos se leen del propio
proyecto Django (router y _meta), así que el manual no se desincroniza de la
API: basta con volver a correr el script.

    python docs/generar_manual.py                        # sin logo (usa el wordmark)
    python docs/generar_manual.py --logo ruta/logo.png   # PNG, JPG o SVG
    python docs/generar_manual.py --salida otro.pdf
"""
import argparse
import os
import re
import sys
from datetime import date
from html import escape
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.apps import apps  # noqa: E402
from django.urls import URLResolver, get_resolver  # noqa: E402
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_CENTER  # noqa: E402
from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents  # noqa: E402

VERSION = "2.0"
NEGRO = colors.HexColor("#111111")
ROJO = colors.HexColor("#c0202c")
GRIS = colors.HexColor("#8a8a8a")
GRIS_CLARO = colors.HexColor("#f2f2f2")
GRIS_LINEA = colors.HexColor("#e0e0e0")
TEXTO = colors.HexColor("#222222")
AZUL = colors.HexColor("#1f4e79")
VERDE = colors.HexColor("#2e7d32")
AMBAR = colors.HexColor("#b26a00")

ANCHO, ALTO = letter
MARGEN = 2 * cm
ANCHO_UTIL = ANCHO - 2 * MARGEN


# ---------------------------------------------------------------------------
# Tipografía y estilos
# ---------------------------------------------------------------------------

def registrar_fuentes():
    fuentes = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    pares = {
        "Texto": "calibri.ttf", "Texto-Bold": "calibrib.ttf",
        "Texto-Italic": "calibrii.ttf", "Texto-BoldItalic": "calibriz.ttf",
        "Mono": "consola.ttf", "Mono-Bold": "consolab.ttf",
    }
    if all((fuentes / f).exists() for f in pares.values()):
        for nombre, archivo in pares.items():
            pdfmetrics.registerFont(TTFont(nombre, str(fuentes / archivo)))
        pdfmetrics.registerFontFamily(
            "Texto", normal="Texto", bold="Texto-Bold", italic="Texto-Italic", boldItalic="Texto-BoldItalic"
        )
        pdfmetrics.registerFontFamily("Mono", normal="Mono", bold="Mono-Bold", italic="Mono", boldItalic="Mono-Bold")
        return "Texto", "Mono"
    return "Helvetica", "Courier"


TEXTO_F, MONO_F = registrar_fuentes()
NEGRITA_F = f"{TEXTO_F}-Bold" if TEXTO_F == "Texto" else "Helvetica-Bold"

E = {
    "cuerpo": ParagraphStyle("cuerpo", fontName=TEXTO_F, fontSize=10.5, leading=14.5, textColor=TEXTO, spaceAfter=6),
    "h1": ParagraphStyle("h1", fontName=NEGRITA_F, fontSize=21, leading=25, textColor=NEGRO, spaceBefore=4, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName=NEGRITA_F, fontSize=14, leading=18, textColor=ROJO, spaceBefore=12, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName=NEGRITA_F, fontSize=11.5, leading=15, textColor=NEGRO, spaceBefore=8, spaceAfter=4),
    "celda": ParagraphStyle("celda", fontName=TEXTO_F, fontSize=8.8, leading=11, textColor=TEXTO),
    "celda_mono": ParagraphStyle("celda_mono", fontName=MONO_F, fontSize=8, leading=10.5, textColor=NEGRO),
    "celda_cab": ParagraphStyle("celda_cab", fontName=NEGRITA_F, fontSize=8.8, leading=11, textColor=colors.white),
    "codigo": ParagraphStyle("codigo", fontName=MONO_F, fontSize=8.2, leading=10.6, textColor=NEGRO),
    "nota": ParagraphStyle("nota", fontName=TEXTO_F, fontSize=9.5, leading=13, textColor=TEXTO),
    "pie": ParagraphStyle("pie", fontName=TEXTO_F, fontSize=8, textColor=GRIS),
    "titulo_indice": ParagraphStyle("titulo_indice", fontName=NEGRITA_F, fontSize=21, leading=25, textColor=NEGRO, spaceAfter=10),
    "toc1": ParagraphStyle("toc1", fontName=NEGRITA_F, fontSize=11, leading=16, leftIndent=0, textColor=NEGRO),
    "toc2": ParagraphStyle("toc2", fontName=TEXTO_F, fontSize=10, leading=13.5, leftIndent=14, textColor=TEXTO),
    "vineta": ParagraphStyle("vineta", fontName=TEXTO_F, fontSize=10.5, leading=14.5, textColor=TEXTO,
                             leftIndent=14, bulletIndent=3, spaceAfter=2),
}


def P(texto, estilo="cuerpo"):
    return Paragraph(texto, E[estilo])


def c(texto):
    """Código en línea (escapa el texto)."""
    return f'<font face="{MONO_F}" color="#8b1a22">{escape(str(texto))}</font>'


def vinetas(items):
    return [Paragraph(i, E["vineta"], bulletText="•") for i in items]


def H1(texto):
    return P(texto, "h1")


def H2(texto):
    return P(texto, "h2")


def H3(texto):
    return P(texto, "h3")


def codigo(texto):
    t = Table(
        [[Preformatted(texto.strip("\n"), E["codigo"])]],
        colWidths=[ANCHO_UTIL],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GRIS_CLARO),
        ("LINEBEFORE", (0, 0), (0, -1), 3, ROJO),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return KeepTogether([t, Spacer(1, 6)])


def nota(texto, color=AZUL, titulo="Nota"):
    t = Table([[P(f"<b>{titulo}.</b> {texto}", "nota")]], colWidths=[ANCHO_UTIL])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f6f8fb") if color == AZUL else colors.HexColor("#fdf3f3")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return KeepTogether([t, Spacer(1, 8)])


def tabla(filas, anchos, cabecera=True, mono_cols=(), repetir=1):
    datos = []
    for i, fila in enumerate(filas):
        celdas = []
        for j, v in enumerate(fila):
            if isinstance(v, Flowable):
                celdas.append(v)
            elif i == 0 and cabecera:
                celdas.append(P(v, "celda_cab"))
            elif j in mono_cols:
                celdas.append(P(escape(str(v)), "celda_mono"))
            else:
                celdas.append(P(str(v), "celda"))
        datos.append(celdas)
    t = Table(datos, colWidths=[a * ANCHO_UTIL for a in anchos], repeatRows=repetir if cabecera else 0)
    estilo = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, GRIS_LINEA),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if cabecera:
        estilo += [("BACKGROUND", (0, 0), (-1, 0), NEGRO), ("LINEBELOW", (0, 0), (-1, 0), 2, ROJO)]
    for i in range(1 if cabecera else 0, len(datos)):
        if i % 2 == 0:
            estilo.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fafafa")))
    t.setStyle(TableStyle(estilo))
    return t


# ---------------------------------------------------------------------------
# Logo
# ---------------------------------------------------------------------------

class Wordmark(Flowable):
    """Logotipo tipográfico de respaldo, igual al encabezado de los correos."""

    def __init__(self, ancho=9 * cm, claro=True):
        super().__init__()
        self.ancho, self.claro = ancho, claro
        self.alto = self.ancho * 0.26

    def wrap(self, *args):
        return self.ancho, self.alto

    def draw(self):
        cv = self.canv
        tam = self.ancho / 6.2
        cv.setFillColor(colors.white if self.claro else NEGRO)
        cv.setFont(NEGRITA_F, tam)
        cv.drawCentredString(self.ancho / 2, self.alto * 0.42, "CASA BRAVA")
        cv.setFillColor(ROJO)
        cv.rect(self.ancho * 0.18, self.alto * 0.25, self.ancho * 0.64, 2.2, fill=1, stroke=0)
        cv.setFont(TEXTO_F, tam * 0.3)
        cv.drawCentredString(self.ancho / 2, self.alto * 0.02, "A C A D E M I A   D E   C O M B A T E")


def cargar_logo(ruta, ancho_max, alto_max):
    """Devuelve un Flowable con el logo escalado, o None si no hay logo."""
    if not ruta:
        return None
    ruta = Path(ruta)
    if not ruta.exists():
        raise SystemExit(f"No existe el logo: {ruta}")
    if ruta.suffix.lower() == ".svg":
        from svglib.svglib import svg2rlg

        dib = svg2rlg(str(ruta))
        escala = min(ancho_max / dib.width, alto_max / dib.height)
        dib.width, dib.height = dib.width * escala, dib.height * escala
        dib.scale(escala, escala)
        return dib
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import Image

    w, h = ImageReader(str(ruta)).getSize()
    escala = min(ancho_max / w, alto_max / h)
    return Image(str(ruta), width=w * escala, height=h * escala)


# ---------------------------------------------------------------------------
# Plantilla del documento
# ---------------------------------------------------------------------------

class Manual(BaseDocTemplate):
    def __init__(self, archivo, logo_ruta=None, **kw):
        super().__init__(
            archivo, pagesize=letter, leftMargin=MARGEN, rightMargin=MARGEN,
            topMargin=2.3 * cm, bottomMargin=1.9 * cm,
            title="Manual Técnico del Backend — Casa Brava",
            author="Equipo de desarrollo Casa Brava",
            subject="API REST, perfiles de usuario, modelo de datos y pagos con Stripe",
            **kw,
        )
        self.logo_ruta = logo_ruta
        marco = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        marco_portada = Frame(MARGEN, MARGEN, ANCHO_UTIL, ALTO - 2 * MARGEN, id="portada")
        self.addPageTemplates([
            PageTemplate(id="Portada", frames=[marco_portada], onPage=self._fondo_portada),
            PageTemplate(id="Normal", frames=[marco], onPage=self._encabezado),
        ])

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name in ("h1", "h2"):
            nivel = 0 if f.style.name == "h1" else 1
            texto = re.sub("<[^>]+>", "", f.getPlainText())
            clave = f"s{self.seq.nextf('toc')}"
            self.canv.bookmarkPage(clave)
            self.canv.addOutlineEntry(texto, clave, level=nivel, closed=nivel > 0)
            self.notify("TOCEntry", (nivel, texto, self.page, clave))

    def _fondo_portada(self, cv, doc):
        cv.saveState()
        cv.setFillColor(NEGRO)
        cv.rect(0, 0, ANCHO, ALTO, fill=1, stroke=0)
        cv.setFillColor(ROJO)
        cv.rect(0, ALTO - 10, ANCHO, 10, fill=1, stroke=0)
        cv.rect(0, 0, ANCHO, 4, fill=1, stroke=0)
        cv.restoreState()

    def _encabezado(self, cv, doc):
        cv.saveState()
        cv.setFillColor(NEGRO)
        cv.rect(0, ALTO - 1.35 * cm, ANCHO, 1.35 * cm, fill=1, stroke=0)
        cv.setFillColor(ROJO)
        cv.rect(0, ALTO - 1.35 * cm - 2.5, ANCHO, 2.5, fill=1, stroke=0)
        cv.setFillColor(colors.white)
        cv.setFont(NEGRITA_F, 11)
        cv.drawString(MARGEN, ALTO - 0.85 * cm, "CASA BRAVA")
        cv.setFont(TEXTO_F, 8.5)
        cv.setFillColor(colors.HexColor("#d0d0d0"))
        cv.drawRightString(ANCHO - MARGEN, ALTO - 0.85 * cm, "Manual Técnico del Backend · API REST")
        cv.setStrokeColor(GRIS_LINEA)
        cv.line(MARGEN, 1.3 * cm, ANCHO - MARGEN, 1.3 * cm)
        cv.setFont(TEXTO_F, 8)
        cv.setFillColor(GRIS)
        cv.drawString(MARGEN, 0.85 * cm, f"Versión {VERSION} · {date.today():%d/%m/%Y} · Uso interno")
        cv.drawRightString(ANCHO - MARGEN, 0.85 * cm, f"Página {doc.page}")
        cv.restoreState()


# ---------------------------------------------------------------------------
# Diagramas
# ---------------------------------------------------------------------------

def _caja(d, x, y, w, h, titulo, sub="", relleno=colors.white, borde=NEGRO, color_txt=NEGRO, tam=9):
    d.add(Rect(x, y, w, h, rx=4, ry=4, fillColor=relleno, strokeColor=borde, strokeWidth=1.1))
    if sub:
        d.add(String(x + w / 2, y + h / 2 + 2, titulo, fontName=NEGRITA_F, fontSize=tam, fillColor=color_txt, textAnchor="middle"))
        d.add(String(x + w / 2, y + h / 2 - tam + 1, sub, fontName=TEXTO_F, fontSize=tam - 1.8, fillColor=GRIS if relleno == colors.white else color_txt, textAnchor="middle"))
    else:
        d.add(String(x + w / 2, y + h / 2 - tam / 3, titulo, fontName=NEGRITA_F, fontSize=tam, fillColor=color_txt, textAnchor="middle"))


def _etiqueta(d, x, y, texto, color=NEGRO, tam=7.5, anchor="middle", fuente=None):
    """Texto con fondo blanco, para que no lo crucen líneas del diagrama."""
    fuente = fuente or TEXTO_F
    w = pdfmetrics.stringWidth(texto, fuente, tam)
    x0 = x - w / 2 if anchor == "middle" else (x - w if anchor == "end" else x)
    d.add(Rect(x0 - 2, y - 2.2, w + 4, tam + 2.6, fillColor=colors.white, strokeColor=colors.white, strokeWidth=0))
    d.add(String(x, y, texto, fontName=fuente, fontSize=tam, fillColor=color, textAnchor=anchor))


def _flecha(d, x1, y1, x2, y2, color=NEGRO, texto="", dx=0, dy=4, grosor=1, anchor="middle", tam=7.5):
    d.add(Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=grosor))
    import math

    ang = math.atan2(y2 - y1, x2 - x1)
    L, a = 6, 0.42
    d.add(Polygon(
        [x2, y2, x2 - L * math.cos(ang - a), y2 - L * math.sin(ang - a), x2 - L * math.cos(ang + a), y2 - L * math.sin(ang + a)],
        fillColor=color, strokeColor=color, strokeWidth=0.5,
    ))
    if texto:
        _etiqueta(d, (x1 + x2) / 2 + dx, (y1 + y2) / 2 + dy, texto, color=color, tam=tam, anchor=anchor)


def diagrama_arquitectura():
    W, H = ANCHO_UTIL, 250
    d = Drawing(W, H)
    _caja(d, 0, 180, 130, 46, "PWA Angular", "admin · maestro · alumno", relleno=GRIS_CLARO)
    _caja(d, 0, 105, 130, 46, "Tablet de recepción", "check-in por QR", relleno=GRIS_CLARO)
    _caja(d, 0, 30, 130, 46, "Cron del servidor", "revisar_pagos · envíos", relleno=GRIS_CLARO)

    _caja(d, 185, 55, 150, 160, "", relleno=colors.white, borde=ROJO)
    d.add(Rect(185, 190, 150, 25, rx=4, ry=4, fillColor=NEGRO, strokeColor=NEGRO))
    d.add(String(260, 198, "Django + DRF  /api/", fontName=NEGRITA_F, fontSize=9.5, fillColor=colors.white, textAnchor="middle"))
    for i, (t, s) in enumerate([("core", "academia, roles, reglas"), ("payments", "Stripe Checkout + webhook"),
                                ("signals / gamificación", "efectos automáticos"), ("management commands", "tareas programadas")]):
        _caja(d, 195, 150 - i * 30, 130, 25, t, s, tam=8)

    _caja(d, 390, 160, 92, 46, "Base de datos", "SQLite · PostgreSQL", relleno=GRIS_CLARO)
    _caja(d, 390, 95, 92, 46, "Stripe", "Checkout · Webhooks", relleno=colors.HexColor("#efeafd"), borde=colors.HexColor("#635bff"))
    _caja(d, 390, 30, 92, 46, "SMTP", "comprobantes · avisos", relleno=GRIS_CLARO)

    _flecha(d, 130, 203, 185, 180, texto="HTTPS + Token", dy=8, tam=7)
    _flecha(d, 130, 128, 185, 128, texto="POST checkin", dy=4, tam=7)
    _flecha(d, 130, 53, 185, 80, texto="manage.py", dy=-12, tam=7)
    _flecha(d, 335, 170, 390, 183)
    _flecha(d, 335, 122, 390, 122, color=colors.HexColor("#635bff"), texto="sesión", dy=3, tam=7)
    _flecha(d, 390, 108, 335, 108, color=colors.HexColor("#635bff"), texto="webhook firmado", dy=-10, tam=7)
    _flecha(d, 335, 70, 390, 53)
    d.add(String(W / 2, 5, "Figura 1. Componentes del sistema y cómo se comunican.", fontName=TEXTO_F, fontSize=8, fillColor=GRIS, textAnchor="middle"))
    return d


def diagrama_er():
    """Árbol: el alumno a la izquierda, sus relaciones directas y, en cadena, las de segundo nivel."""
    filas = [
        ("User", "1:1", []),
        ("Maestro", "N:M", [("Horario · Disciplina", "N:M"), ("User", "1:1")]),
        ("Horario", "N:1", []),
        ("Membresia", "N:1", []),
        ("Disciplina", "N:M", [("vía AlumnoDisciplina", "")]),
        ("Pago", "1:N", [("PagoStripe", "1:1"), ("EventoStripe", "1:N")]),
        ("Venta", "1:N", [("User (registrado_por)", "N:1")]),
        ("Asistencia", "1:N", [("Disciplina · Horario · Maestro", "N:1")]),
        ("Experiencia", "1:1", []),
        ("Torneo", "1:N", [("Evento", "N:1")]),
        ("EventoInscripcion", "1:N", [("Evento", "N:1")]),
        ("Grado", "1:N", [("Disciplina · Maestro", "N:1")]),
        ("Insignia", "N:M", [("vía AlumnoInsignia", "")]),
        ("Notificacion", "1:N", [("Aviso", "N:1"), ("User (creado_por)", "N:1")]),
        ("EvaluacionMMA", "1:N", [("PuntajeHabilidadMMA", "1:N"), ("HabilidadMMA → Categoría", "N:1")]),
    ]
    alto_fila, h = 25, 19
    W, H = ANCHO_UTIL, len(filas) * alto_fila + 10
    d = Drawing(W, H)
    x_bus, x2, w2 = 92, 128, 100
    c1 = x2 + w2 + 34
    c2 = c1 + 118 + 30
    cols = [(c1, 118), (c2, W - c2)]
    y_top = H - 5 - h
    ys = [y_top - i * alto_fila for i in range(len(filas))]
    y_alumno = (ys[0] + ys[-1]) / 2
    _caja(d, 0, y_alumno - 6, 76, h + 12, "Alumno", relleno=colors.HexColor("#fdecee"), borde=ROJO, tam=9.5)
    d.add(Line(76, y_alumno + h / 2, x_bus, y_alumno + h / 2, strokeColor=ROJO, strokeWidth=1.2))
    d.add(Line(x_bus, ys[-1] + h / 2, x_bus, ys[0] + h / 2, strokeColor=ROJO, strokeWidth=1.2))
    morado = colors.HexColor("#635bff")
    for (nombre, card, cadena), y in zip(filas, ys):
        cy = y + h / 2
        d.add(Line(x_bus, cy, x2, cy, strokeColor=ROJO, strokeWidth=0.9))
        d.add(String(x_bus + 18, cy + 2.5, card, fontName=TEXTO_F, fontSize=6.8, fillColor=AZUL, textAnchor="middle"))
        _caja(d, x2, y, w2, h, nombre, tam=7.8, borde=morado if "Stripe" in nombre else NEGRO)
        x_prev = x2 + w2
        for (texto, card2), (xc, wc) in zip(cadena, cols):
            via = texto.startswith("vía")
            d.add(Line(x_prev, cy, xc, cy, strokeColor=GRIS, strokeWidth=0.8, strokeDashArray=[2, 2] if via else None))
            if card2:
                _etiqueta(d, (x_prev + xc) / 2, cy + 2.5, card2, color=AZUL, tam=6.8)
            es_stripe = "Stripe" in texto
            _caja(d, xc, y, wc, h, texto, tam=7.3,
                  relleno=colors.HexColor("#efeafd") if es_stripe else (colors.white if via else GRIS_CLARO),
                  borde=morado if es_stripe else (GRIS if via else NEGRO))
            x_prev = xc + wc
    return d


def diagrama_flujo_stripe():
    W, H = ANCHO_UTIL, 300
    d = Drawing(W, H)
    carriles = [("Angular (PWA)", 55), ("Django (backend)", 235), ("Stripe", 430)]
    for nombre, x in carriles:
        _caja(d, x - 55, H - 30, 110, 24, nombre, relleno=NEGRO if "Django" in nombre else GRIS_CLARO,
              color_txt=colors.white if "Django" in nombre else NEGRO, borde=NEGRO)
        d.add(Line(x, 20, x, H - 30, strokeColor=GRIS_LINEA, strokeWidth=1, strokeDashArray=[3, 3]))
    xa, xd, xs = 55, 235, 430
    pasos = [
        (xa, xd, "1. POST /payments/checkout/ {membresia_id}", NEGRO),
        (xd, xd, "2. Valida rol y alumno; precio de la BD; PagoStripe PENDIENTE", AMBAR),
        (xd, xs, "3. checkout.sessions.create (llave secreta)", colors.HexColor("#635bff")),
        (xd, xa, "4. {checkout_url}", NEGRO),
        (xa, xs, "5. Redirección: el usuario paga en Stripe", NEGRO),
        (xs, xd, "6. Webhook session.completed (firmado)", colors.HexColor("#635bff")),
        (xd, xd, "7. Firma e importe OK · PAGADO · crea core.Pago", VERDE),
        (xs, xa, "8. Redirige a success_url?session_id=...", GRIS),
        (xa, xd, "9. GET /payments/sesion/  (solo UX)", NEGRO),
    ]
    y = H - 55
    for x1, x2, texto, color in pasos:
        if x1 == x2:
            d.add(Rect(x1 - 4, y - 5, 8, 10, fillColor=color, strokeColor=color))
            _etiqueta(d, x1 + 10, y - 3, texto, color=color, tam=7.6, anchor="start")
        else:
            _flecha(d, x1, y, x2, y, color=color)
            _etiqueta(d, min(x1, x2) + 8, y + 4, texto, color=color, tam=7.6, anchor="start")
        y -= 27
    return d


def diagrama_estados():
    import math

    W, H = ANCHO_UTIL, 185
    d = Drawing(W, H)
    cw, ch = 92, 28
    nodos = {
        "PENDIENTE": (10, 95, GRIS_CLARO), "PROCESANDO": (W / 2 - cw / 2, 145, colors.HexColor("#fff4e0")),
        "PAGADO": (W - cw - 10, 95, colors.HexColor("#e6f4ea")), "REEMBOLSADO": (W - cw - 10, 22, colors.HexColor("#eef2f7")),
        "CANCELADO": (10, 22, colors.HexColor("#f3f3f3")), "FALLIDO": (W / 2 - cw / 2, 22, colors.HexColor("#fdecee")),
    }

    def centro(n):
        x, y, _ = nodos[n]
        return x + cw / 2, y + ch / 2

    def borde(n, hacia):
        cx, cy = centro(n)
        ang = math.atan2(hacia[1] - cy, hacia[0] - cx)
        kx = (cw / 2 + 2) / abs(math.cos(ang)) if abs(math.cos(ang)) > 1e-6 else 1e9
        ky = (ch / 2 + 2) / abs(math.sin(ang)) if abs(math.sin(ang)) > 1e-6 else 1e9
        k = min(kx, ky)
        return cx + k * math.cos(ang), cy + k * math.sin(ang)

    def f(a, b, texto, lx, ly, anchor="middle"):
        x1, y1 = borde(a, centro(b))
        x2, y2 = borde(b, centro(a))
        _flecha(d, x1, y1, x2, y2, color=AZUL)
        _etiqueta(d, lx, ly, texto, color=AZUL, tam=7, anchor=anchor)

    for n, (x, y, rel) in nodos.items():
        _caja(d, x, y, cw, ch, n, relleno=rel, tam=8.5)
    f("PENDIENTE", "PAGADO", "completed · paid", W / 2 + 70, 111)
    f("PENDIENTE", "PROCESANDO", "completed · unpaid (OXXO)", 120, 146)
    f("PROCESANDO", "PAGADO", "async_payment_succeeded", W - 120, 146)
    f("PROCESANDO", "FALLIDO", "async_payment_failed", W / 2 + 6, 80, anchor="start")
    f("PENDIENTE", "FALLIDO", "importe inconsistente", 150, 58)
    f("PENDIENTE", "CANCELADO", "expired", 60, 72, anchor="start")
    f("PAGADO", "REEMBOLSADO", "charge.refunded", W - 60, 72, anchor="end")
    d.add(String(W / 2, 3, "Figura 4. Estados de PagoStripe. Solo el webhook firmado cambia el estado.", fontName=TEXTO_F, fontSize=8, fillColor=GRIS, textAnchor="middle"))
    return d


# ---------------------------------------------------------------------------
# Introspección del proyecto
# ---------------------------------------------------------------------------

ROLES_POR_PERMISO = {
    "AllowAny": ("Público (sin token)", "Público (sin token)"),
    "IsAuthenticated": ("Cualquier usuario autenticado", "Cualquier usuario autenticado"),
    "EsAdministrativo": ("Admin", "Admin"),
    "EsPersonal": ("Admin, Maestro (con alcance)", "Admin, Maestro (con alcance)"),
    "EsAdministrativoOSoloLectura": ("Cualquier autenticado", "Admin"),
    "EsAdministrativoOPersonalSoloLectura": ("Admin, Maestro", "Admin"),
    "EsDuenoOAdministrativo": ("Admin · Alumno (lo suyo)", "Admin"),
    "PermisoAlumno": ("Admin · Maestro (sus alumnos) · Alumno (lo suyo)", "Admin"),
    "EsDuenoOPersonal": ("Admin · Maestro (con alcance) · Alumno (lo suyo)", "Admin, Maestro (con alcance)"),
    "EsPersonalOSoloLectura": ("Cualquier autenticado", "Admin · Maestro (sus propios eventos)"),
    "PermisoInscripcionEvento": ("Admin · Maestro (con alcance) · Alumno (lo suyo)", "Admin, Maestro · Alumno: POST/DELETE propios"),
    "EsAdministrativoOAlumno": ("Admin · Alumno (lo suyo)", "Admin · Alumno (lo suyo)"),
}

DESCRIPCIONES = {
    "/api/auth/login/": "Inicia sesión con usuario o correo y contraseña. Devuelve token y perfil con rol.",
    "/api/auth/logout/": "Invalida el token actual.",
    "/api/auth/yo/": "Perfil y rol del usuario autenticado (rehidrata la sesión de la PWA).",
    "/api/auth/cambiar-password/": "Cambia la contraseña propia y emite un token nuevo.",
    "/api/auth/token/": "Alternativa estándar de DRF: devuelve solo el token.",
    "/api/dashboard/": "Métricas generales: alumnos, asistencias, ingresos, desglose por disciplina/horario, top 5.",
    "/api/alumnos/": "Lista (con alcance por rol) y alta de alumnos. El alta crea cuenta y QR.",
    "/api/alumnos/{pk}/": "Detalle, edición y baja de un alumno.",
    "/api/alumnos/morosos/": "Alumnos activos con pago vencido o sin pagos.",
    "/api/alumnos/por-vencer/": "Alumnos cuyo pago vence en los próximos ?dias=N.",
    "/api/alumnos/ranking/": "Tabla de posiciones por puntos (?limite=20), con el alcance del listado.",
    "/api/alumnos/yo/": "Perfil del alumno autenticado; PATCH edita solo datos personales y correo.",
    "/api/alumnos/{pk}/asistencias/": "Historial de asistencias del alumno.",
    "/api/alumnos/{pk}/evaluacion-historial/": "Serie cronológica de evaluaciones MMA, para graficar.",
    "/api/alumnos/{pk}/evaluacion-resumen/": "Última evaluación MMA finalizada y variación contra la anterior.",
    "/api/alumnos/{pk}/evaluar-insignias/": "Reevalúa y otorga las insignias que el alumno ya cumple.",
    "/api/alumnos/{pk}/insignias/": "Insignias ganadas por el alumno.",
    "/api/alumnos/{pk}/pagos/": "Pagos de membresía del alumno.",
    "/api/alumnos/{pk}/perfil/": "Tarjeta completa de peleador: estadísticas, récord y estado de pago.",
    "/api/alumnos/{pk}/qr/": "Código QR del alumno y URL de su imagen.",
    "/api/alumnos/{pk}/restablecer-password/": "Restablece la contraseña a PASSWORD_INICIAL.",
    "/api/maestros/": "Catálogo de maestros; el alta crea su cuenta.",
    "/api/maestros/{pk}/": "Detalle y edición de un maestro (disciplinas, grupos y alumnos a cargo).",
    "/api/maestros/{pk}/restablecer-password/": "Restablece la contraseña del maestro.",
    "/api/usuarios/": "Cuentas administrativas (is_staff). Sin PUT ni DELETE: se desactivan con PATCH.",
    "/api/usuarios/{pk}/": "Detalle y edición parcial de una cuenta administrativa.",
    "/api/usuarios/{pk}/restablecer-password/": "Restablece la contraseña de una cuenta administrativa.",
    "/api/horarios/": "Catálogo de horarios (grupos) del cartel.",
    "/api/horarios/{pk}/": "Detalle y edición de un horario.",
    "/api/horarios/{pk}/alumnos/": "Alumnos activos del grupo (el maestro, solo los que tiene a cargo).",
    "/api/disciplinas/": "Catálogo de disciplinas.",
    "/api/disciplinas/{pk}/": "Detalle y edición de una disciplina.",
    "/api/membresias/": "Catálogo de planes con precio y duración (fuente del precio de Stripe).",
    "/api/membresias/{pk}/": "Detalle y edición de un plan.",
    "/api/pagos/": "Pagos de membresía (caja). Mueven vencimiento y semáforo del alumno.",
    "/api/pagos/{pk}/": "Detalle y edición de un pago.",
    "/api/pagos/resumen/": "Corte de caja del mes por método.",
    "/api/pagos/{pk}/comprobante/": "Recibo en HTML; ?formato=pdf para PDF; ?enviar=1 lo reenvía por correo.",
    "/api/ventas/": "Otros ingresos (inscripción, equipo...). No tocan membresías.",
    "/api/ventas/{pk}/": "Detalle y edición de una venta.",
    "/api/ventas/resumen/": "Corte de ventas del mes por método y concepto.",
    "/api/experiencias/": "Ficha técnica del peleador (cinturón, récord, lesiones).",
    "/api/experiencias/{pk}/": "Detalle y edición de la ficha técnica.",
    "/api/experiencias/{pk}/sincronizar-record/": "Recalcula el récord G-P-E desde los torneos.",
    "/api/asistencias/": "Historial de asistencias.",
    "/api/asistencias/{pk}/": "Detalle, corrección o borrado (devuelve los puntos).",
    "/api/asistencias/checkin/": "Check-in por QR desde la tablet de recepción (sin token).",
    "/api/asistencias/hoy/": "Asistencias del día.",
    "/api/asistencias/manual/": "Registro manual por recepción (alumno_id, fecha opcional no futura).",
    "/api/asistencias/mi-checkin/": "El alumno registra su propia asistencia de hoy desde la app.",
    "/api/notificaciones/": "Bandeja de notificaciones (el maestro solo ve las de sus avisos).",
    "/api/notificaciones/{pk}/": "Detalle de una notificación.",
    "/api/notificaciones/{pk}/marcar-leida/": "Marca la notificación como leída (solo su dueño).",
    "/api/avisos/": "Campañas de aviso: individual, grupo o todos (todos, solo Admin).",
    "/api/avisos/{pk}/": "Detalle y edición mientras siga PENDIENTE.",
    "/api/avisos/{pk}/cancelar/": "Cancela los envíos pendientes del aviso.",
    "/api/torneos/": "Resultados de peleas; recalculan el récord del alumno.",
    "/api/torneos/{pk}/": "Detalle y edición de un resultado.",
    "/api/grados/": "Grados/cinturones otorgados.",
    "/api/grados/{pk}/": "Detalle y edición de un grado.",
    "/api/insignias/": "Catálogo de insignias con su criterio JSON.",
    "/api/insignias/{pk}/": "Detalle y edición de una insignia.",
    "/api/insignias/{pk}/otorgar/": "Otorga una insignia manualmente: {\"alumno_id\": 3}.",
    "/api/eventos/": "Cartelera de torneos, seminarios y exámenes.",
    "/api/eventos/{pk}/": "Detalle y edición (el maestro, solo sus eventos).",
    "/api/inscripciones-evento/": "Inscripciones a eventos. El alumno se inscribe a sí mismo.",
    "/api/inscripciones-evento/{pk}/": "Detalle; PATCH asistio (personal); DELETE cancela.",
    "/api/inscripciones-evento/{pk}/resultado/": "Captura (POST) o quita (DELETE) el resultado del alumno en el evento.",
    "/api/categorias-mma/": "Catálogo de categorías y habilidades de la Evaluación MMA.",
    "/api/categorias-mma/{pk}/": "Detalle y edición de una categoría.",
    "/api/evaluaciones-mma/": "Evaluaciones periódicas por habilidad (1-5), con historial.",
    "/api/evaluaciones-mma/{pk}/": "Detalle y edición de una evaluación (reemplaza la lista de puntajes).",
    "/api/payments/": "Pagos en línea (Stripe). Admin: todos; alumno: los suyos.",
    "/api/payments/{pk}/": "Detalle de un pago en línea.",
    "/api/payments/checkout/": "Inicia el pago: crea la Checkout Session y devuelve checkout_url.",
    "/api/payments/sesion/": "Estado de un pago por ?session_id= (pantalla de éxito).",
    "/api/payments/dashboard/": "Tablero de pagos en línea: resumen, serie diaria, recientes, salud del webhook y cursor.",
    "/api/payments/cambios/": "Polling en tiempo real: pagos modificados desde ?desde=<cursor>.",
    "/api/payments/saldo/": "Saldo disponible y pendiente consultado en vivo a Stripe.",
    "/api/payments/{pk}/reembolsar/": "Solicita a Stripe el reembolso total (se confirma por webhook).",
    "/api/payments/webhook/stripe/": "Receptor de eventos de Stripe. Público, pero exige firma Stripe-Signature.",
}

MODULOS = [
    ("Autenticación", ["/api/auth/"]),
    ("Dashboard general", ["/api/dashboard/"]),
    ("Alumnos", ["/api/alumnos/"]),
    ("Maestros y cuentas administrativas", ["/api/maestros/", "/api/usuarios/"]),
    ("Catálogos", ["/api/horarios/", "/api/disciplinas/", "/api/membresias/", "/api/insignias/", "/api/categorias-mma/"]),
    ("Caja: pagos de membresía y ventas", ["/api/pagos/", "/api/ventas/"]),
    ("Pagos en línea (Stripe)", ["/api/payments/"]),
    ("Asistencias y check-in", ["/api/asistencias/"]),
    ("Ficha deportiva, torneos, grados y evaluación MMA", ["/api/experiencias/", "/api/torneos/", "/api/grados/", "/api/evaluaciones-mma/"]),
    ("Eventos", ["/api/eventos/", "/api/inscripciones-evento/"]),
    ("Notificaciones y avisos", ["/api/notificaciones/", "/api/avisos/"]),
]

ESCRITURA = {"POST", "PUT", "PATCH", "DELETE"}


def _limpiar_ruta(r):
    r = r.replace("^", "").replace("$", "").replace("\\Z", "")
    r = re.sub(r"\(\?P<(\w+)>[^)]*\)", r"{\1}", r)
    return "/" + r


def recorrer(patrones, prefijo=""):
    for p in patrones:
        if isinstance(p, URLResolver):
            yield from recorrer(p.url_patterns, prefijo + str(p.pattern))
        else:
            yield prefijo + str(p.pattern), p


def endpoints():
    vistos, salida = set(), []
    for ruta, patron in recorrer(get_resolver().url_patterns):
        if not ruta.startswith("api/") or "format" in ruta:
            continue
        path = _limpiar_ruta(ruta)
        if path in vistos or path == "/api/":
            continue
        vistos.add(path)
        cb = patron.callback
        cls, acciones = getattr(cb, "cls", None), getattr(cb, "actions", None)
        if cls is None:  # vista Django pura (webhook)
            salida.append({"path": path, "metodos": ["POST"], "lectura": "Stripe (firma HMAC)", "escritura": "Stripe (firma HMAC)", "extra": {}})
            continue
        ini = getattr(cb, "initkwargs", {}) or {}
        perm = [p.__name__ for p in ini.get("permission_classes", cls.permission_classes)]
        permitidos = set(getattr(cls, "http_method_names", []))
        if acciones:
            metodos = [m.upper() for m in acciones if m in permitidos]
        else:
            metodos = [m.upper() for m in cls.http_method_names if hasattr(cls, m) and m not in ("options", "head")]
        lectura, escritura = ROLES_POR_PERMISO.get(perm[0] if perm else "AllowAny", (", ".join(perm), ", ".join(perm)))
        extra = {}
        if "{" not in path and acciones and "list" in acciones.values():
            fs = getattr(cls, "filterset_fields", None)
            if fs:
                extra["filtros"] = [f"{k}__{op}" if op != "exact" else k for k, ops in fs.items() for op in ops] if isinstance(fs, dict) else list(fs)
            if getattr(cls, "search_fields", None):
                extra["busqueda"] = list(cls.search_fields)
            if getattr(cls, "ordering_fields", None):
                extra["orden"] = list(cls.ordering_fields)
        salida.append({"path": path, "metodos": metodos, "lectura": lectura, "escritura": escritura, "extra": extra})
    return salida


def roles_de(e):
    lect = [m for m in e["metodos"] if m not in ESCRITURA]
    escr = [m for m in e["metodos"] if m in ESCRITURA]
    if not escr:
        return e["lectura"]
    if not lect:
        return e["escritura"]
    if e["lectura"] == e["escritura"]:
        return e["lectura"]
    return f"<b>Lectura:</b> {e['lectura']}<br/><b>Escritura:</b> {e['escritura']}"


def modelos():
    salida = []
    for app in ("core", "payments"):
        for m in apps.get_app_config(app).get_models():
            rels = []
            for f in m._meta.get_fields():
                if not f.is_relation or (f.auto_created and not f.concrete):
                    continue
                tipo = "N:M" if f.many_to_many else ("1:1" if f.one_to_one else "N:1")
                od = getattr(f.remote_field, "on_delete", None)
                through = f.remote_field.through if f.many_to_many else None
                rels.append({
                    "campo": f.name, "tipo": tipo, "destino": f.related_model.__name__,
                    "on_delete": od.__name__ if od else ("vía " + through.__name__ if through and not through._meta.auto_created else "—"),
                    "inversa": f.remote_field.related_name or "",
                    "nulo": "Sí" if getattr(f, "null", False) else "No",
                })
            salida.append({
                "nombre": m.__name__, "app": app, "tabla": m._meta.db_table,
                "verbose": str(m._meta.verbose_name),
                "campos": [f.name for f in m._meta.get_fields() if not f.is_relation and f.concrete],
                "rels": rels,
                "unicas": [cst.name for cst in m._meta.constraints],
            })
    return salida


# ---------------------------------------------------------------------------
# Contenido
# ---------------------------------------------------------------------------

def portada(logo_ruta):
    logo = cargar_logo(logo_ruta, 11 * cm, 5.5 * cm) or Wordmark(10 * cm)
    logo.hAlign = "CENTER"
    blanco = ParagraphStyle("pb", fontName=NEGRITA_F, fontSize=30, leading=36, textColor=colors.white, alignment=TA_CENTER)
    sub = ParagraphStyle("ps", fontName=TEXTO_F, fontSize=13.5, leading=19, textColor=colors.HexColor("#d0d0d0"), alignment=TA_CENTER)
    rojo = ParagraphStyle("pr", fontName=NEGRITA_F, fontSize=10.5, leading=14, textColor=ROJO, alignment=TA_CENTER)
    meta = ParagraphStyle("pm", fontName=TEXTO_F, fontSize=10, leading=15, textColor=colors.HexColor("#bdbdbd"), alignment=TA_CENTER)
    return [
        Spacer(1, 3.2 * cm), logo, Spacer(1, 2.4 * cm),
        Paragraph("MANUAL TÉCNICO DEL BACKEND", rojo), Spacer(1, 10),
        Paragraph("API REST de la plataforma Casa Brava", blanco), Spacer(1, 14),
        Paragraph("Endpoints · perfiles de usuario y permisos · modelo de datos<br/>pagos en línea con Stripe y dashboard en tiempo real", sub),
        Spacer(1, 4.2 * cm),
        Paragraph(f"Versión {VERSION} · {HOY.day} de {_MESES[HOY.month]} de {HOY.year}", meta),
        Paragraph("Django 6.1 · Django REST Framework 3.18 · Stripe 15.6", meta),
        Paragraph("Documento de uso interno", meta),
        NextPageTemplate("Normal"), PageBreak(),
    ]


HOY = date.today()
_MESES = {1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio", 7: "julio",
          8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"}


def indice():
    toc = TableOfContents(levelStyles=[E["toc1"], E["toc2"]], dotsMinLevel=0)
    return [P("Contenido", "titulo_indice"), toc, PageBreak()]


def seccion_introduccion():
    s = [H1("1. Introducción"), P(
        "Este manual describe el backend de la plataforma Casa Brava: una API REST en Django que da servicio a la "
        "PWA en Angular (administración, maestros y alumnos), a la tablet de recepción que registra asistencias por "
        "código QR y a las tareas programadas del servidor. Está dirigido a quienes desarrollan o mantienen el "
        "backend y a quienes consumen la API desde el frontend."
    )]
    s += [H2("1.1 Alcance del sistema"), *vinetas([
        "<b>Academia:</b> alumnos, maestros, horarios (grupos), disciplinas y membresías.",
        "<b>Caja:</b> pagos de membresía (mueven el vencimiento del alumno) y ventas de otros conceptos.",
        "<b>Pagos en línea:</b> cobro de membresías con Stripe Checkout, confirmado por webhook, con dashboard en tiempo real.",
        "<b>Operación diaria:</b> check-in por QR, registro manual y desde la app; recordatorios de pago por correo.",
        "<b>Desarrollo deportivo:</b> ficha técnica, torneos, grados, eventos con inscripción y Evaluación MMA por habilidad.",
        "<b>Gamificación:</b> puntos, rachas de asistencia e insignias con criterios configurables.",
        "<b>Comunicación:</b> notificaciones y avisos a un alumno, a un grupo o a toda la academia.",
    ])]
    s += [H2("1.2 Arquitectura"), diagrama_arquitectura(), Spacer(1, 6), P(
        "El backend es un único proyecto Django con dos aplicaciones: <b>core</b> (toda la lógica de la academia) y "
        "<b>payments</b> (integración con Stripe). La autenticación es por token de DRF; no se usan cookies de sesión. "
        "El backend es la autoridad sobre precios, alcance por rol y estado de los pagos: ocultar algo en Angular "
        "nunca cuenta como seguridad."
    )]
    s += [H2("1.3 Stack tecnológico"), tabla([
        ["Componente", "Versión", "Uso"],
        ["Python", "3.13", "Lenguaje"],
        ["Django", "6.1.1", "Framework web, ORM, admin, migraciones"],
        ["djangorestframework", "3.18.1", "ViewSets, serializers, token auth, throttling"],
        ["django-filter", "26.1", "Filtros por query string"],
        ["django-cors-headers", "4.9.0", "CORS para la PWA"],
        ["python-decouple", "3.8", "Lectura del .env"],
        ["qrcode + pillow", "8.2 / 12.3.0", "Códigos QR de alumnos y maestros; imágenes"],
        ["xhtml2pdf", "0.2.18", "Comprobantes de pago en PDF"],
        ["stripe", "15.6.1", "Checkout Sessions, webhooks firmados, reembolsos, saldo"],
        ["PostgreSQL (prod.)", "psycopg 3.3.5", "Base de datos de producción (SQLite en desarrollo)"],
        ["gunicorn + whitenoise", "26.2.0 / 6.12.0", "Servidor WSGI y estáticos en producción"],
    ], [0.3, 0.2, 0.5])]
    s += [H2("1.4 Estructura del proyecto"), codigo("""
academia_backend/
├── config/                 settings.py (entorno, DRF, CORS, correo, Stripe), urls.py raíz
├── core/                   Aplicación principal
│   ├── models.py           Modelos de la academia (24 tablas)
│   ├── serializers.py      Validaciones y representación de la API
│   ├── views.py            ViewSets y endpoints de negocio
│   ├── auth_views.py       Login, logout, yo, cambiar-password
│   ├── permissions.py      Roles y clases de permiso
│   ├── signals.py          Efectos automáticos (cuentas, puntos, récord, comprobantes)
│   ├── gamificacion.py     Puntos, rachas e insignias
│   ├── evaluacion_mma.py   Cálculo de la Evaluación MMA
│   ├── avisos.py / email_service.py   Notificaciones y correo
│   └── management/commands/  seed, revisar_pagos, enviar_notificaciones_pendientes
├── payments/               Pagos en línea con Stripe
│   ├── models.py           PagoStripe, EventoStripe
│   ├── views.py            checkout, sesion, dashboard, cambios, saldo, reembolsar
│   ├── services/           stripe_service.py (única llamada a Stripe), activacion.py
│   ├── webhooks/stripe.py  Receptor firmado e idempotente
│   └── tests/              Checkout, webhooks y dashboard
├── templates/correos/      Plantillas HTML/TXT de correo
└── docs/                   Este manual y su generador
""")]
    return s


def seccion_configuracion():
    s = [PageBreak(), H1("2. Instalación y configuración"), H2("2.1 Puesta en marcha"), codigo("""
python -m venv .venv && .venv\\Scripts\\activate      # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt                    # o requirements-dev.txt / requirements-prod.txt
copy .env.example .env                             # y ajustar valores
python manage.py migrate
python manage.py seed                              # catálogos del cartel y datos demo
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000
""")]
    s += [H2("2.2 Variables de entorno"), P(
        "Todas se leen del archivo <b>.env</b> con python-decouple. Ningún secreto vive en el código ni en el frontend."
    ), tabla([
        ["Variable", "Por defecto", "Descripción"],
        ["SECRET_KEY", "clave de desarrollo", "Obligatoria y aleatoria en producción."],
        ["DEBUG", "True", "False en producción: activa HSTS, cookies seguras y redirección HTTPS."],
        ["ALLOWED_HOSTS", "*", "Dominios que sirve la API (ej. api.casabrava.mx)."],
        ["TIME_ZONE", "America/Mexico_City", "Zona horaria de fechas de pago, asistencias y vencimientos."],
        ["DB_ENGINE / DB_*", "sqlite", "postgresql + DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT."],
        ["CORS_ALLOWED_ORIGINS", "(vacío)", "Orígenes del frontend. En DEBUG se permite cualquiera."],
        ["CSRF_TRUSTED_ORIGINS", "http://localhost:4200", "Origen del frontend para peticiones POST."],
        ["FRONTEND_URL", "http://localhost:4200", "Base de las ligas dentro de los correos."],
        ["PASSWORD_INICIAL", "rotoplas", "Contraseña con la que nacen las cuentas creadas por el sistema."],
        ["EMAIL_BACKEND, EMAIL_HOST, EMAIL_PORT, EMAIL_USE_TLS / EMAIL_USE_SSL, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL, EMAIL_TIMEOUT",
         "consola · 587 · TLS · 15 s", "Envío de comprobantes, avisos y recordatorios. TLS y SSL son excluyentes."],
        ["STRIPE_SECRET_KEY", "(vacío)", "sk_test_… o sk_live_…. Sin ella el checkout responde 503."],
        ["STRIPE_WEBHOOK_SECRET", "(vacío)", "whsec_… del endpoint de webhook. Sin él el webhook responde 503."],
        ["STRIPE_CURRENCY", "mxn", "Moneda de cobro."],
        ["STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL", "FRONTEND_URL/payment/success | cancel", "A dónde regresa Stripe al usuario."],
        ["THROTTLE_CHECKOUT", "10/min", "Límite de peticiones al checkout por usuario."],
        ["LOG_LEVEL_PAGOS", "INFO", "Nivel del logger payments (solo ids y estatus)."],
    ], [0.33, 0.22, 0.45], mono_cols=(0,))]
    s += [H2("2.3 Convenciones de la API"), *vinetas([
        f"Base: {c('/api/')}. Formato JSON. Fechas {c('YYYY-MM-DD')}, fechas-hora ISO-8601 con zona horaria.",
        f"Autenticación: encabezado {c('Authorization: Token <token>')} en toda petición salvo las públicas.",
        f"Paginación: {c('{count, next, previous, results}')}, 25 elementos por página; {c('?page=')} y {c('?page_size=')} (máx. 500).",
        f"Filtros: {c('?campo=valor')}; rangos con {c('__gte')} / {c('__lte')}; búsqueda con {c('?search=')}; orden con {c('?ordering=-campo')} donde aplique.",
        f"Importes: decimales como texto con dos cifras ({c('\"800.00\"')}). Moneda MXN.",
    ])]
    s += [H3("Códigos de respuesta"), tabla([
        ["Código", "Significado en esta API"],
        ["200 / 201", "Correcto / recurso creado."],
        ["202", "Solicitud aceptada pero se confirma después (reembolso de Stripe)."],
        ["204", "Borrado correcto."],
        ["400", "Datos inválidos: el cuerpo trae el campo y el motivo."],
        ["401", "Falta el token o es inválido."],
        ["403", "El rol no tiene permiso, o el recurso está fuera de su alcance (alumno dado de baja en check-in)."],
        ["404", "No existe, o no es visible para el rol (el alcance se aplica en el queryset)."],
        ["409", "Conflicto: asistencia duplicada de la misma clase el mismo día."],
        ["429", "Demasiadas peticiones al checkout (throttling)."],
        ["502", "Stripe rechazó o no respondió la operación."],
        ["503", "Pagos en línea sin configurar (faltan llaves de Stripe)."],
    ], [0.15, 0.85])]
    return s


def seccion_perfiles():
    s = [PageBreak(), H1("3. Perfiles de usuario y permisos"), P(
        "Todos los perfiles comparten el modelo <b>User</b> de Django. El rol no se guarda en un campo: se deduce de "
        f"con qué está ligada la cuenta. {c('GET /api/auth/yo/')} y el login devuelven el rol ya resuelto."
    ), tabla([
        ["Rol", "Cómo se determina", "Qué puede hacer"],
        ["ADMINISTRATIVO", f"{c('User.is_staff = True')}", "Acceso total: catálogos, alumnos, maestros, caja, reportes, avisos a todos, pagos en línea, reembolsos y dashboards."],
        ["MAESTRO", f"Tiene un {c('Maestro')} ligado ({c('Maestro.usuario')})",
         "Trabaja solo con sus <b>alumnos a cargo</b>: los ve, escribe su ficha técnica y Evaluación MMA, los inscribe a eventos, captura resultados y les manda avisos (individual o a sus grupos). Nunca edita datos personales ni pagos."],
        ["ALUMNO", f"Tiene un {c('Alumno')} ligado ({c('Alumno.usuario')})",
         f"Lee solo lo suyo; edita sus datos personales en {c('/api/alumnos/yo/')}; hace check-in desde la app; se inscribe a eventos; paga su membresía en línea."],
        ["SIN_ROL", "Cuenta sin ninguna de las anteriores", "No ve nada."],
        ["Público", "Sin token", "Login, check-in por QR (tablet) y webhook de Stripe (con firma)."],
    ], [0.17, 0.28, 0.55])]
    s += [H2("3.1 Alcance del maestro"), P(
        f"Lo define el administrativo al editar al maestro: grupos completos ({c('Maestro.horarios')}) más alumnos sueltos "
        f"({c('Maestro.alumnos_asignados')}). {c('Maestro.alumnos_a_cargo()')} devuelve la unión de alumnos activos y cada "
        "vista la aplica en su queryset, sin confiar en filtros del cliente. Las disciplinas del maestro son solo catálogo "
        "(qué imparte) y no dan visibilidad."
    )]
    s += [H2("3.2 Cuentas automáticas"), *vinetas([
        f"Todo alumno y maestro nace con cuenta: usuario {c('alumno-<id>')} / {c('maestro-<id>')} y contraseña {c('PASSWORD_INICIAL')} (guardada con hash). El alta devuelve {c('username')} y {c('password_inicial')} una sola vez.",
        "El correo no es único (hermanos pueden compartir el del tutor); el login acepta usuario o correo y prueba cada cuenta con ese correo.",
        f"Cada usuario cambia su contraseña en {c('POST /api/auth/cambiar-password/')}; el administrativo la restablece con {c('POST /api/<alumnos|maestros|usuarios>/{id}/restablecer-password/')}.",
        "Cambiar o restablecer la contraseña invalida los tokens anteriores.",
    ])]
    s += [H2("3.3 Clases de permiso"), tabla([
        ["Clase", "Lectura", "Escritura", "Se usa en"],
        ["EsAdministrativo", "Admin", "Admin", "usuarios, ventas, dashboard, reportes"],
        ["EsPersonal", "Admin, Maestro", "Admin, Maestro", "avisos, alumnos por grupo"],
        ["EsAdministrativoOSoloLectura", "Autenticado", "Admin", "horarios, disciplinas, membresías, insignias, categorías MMA"],
        ["EsAdministrativoOPersonalSoloLectura", "Admin, Maestro", "Admin", "maestros"],
        ["EsDuenoOAdministrativo", "Admin, Alumno dueño", "Admin", "pagos, asistencias, torneos, grados"],
        ["PermisoAlumno", "Admin, Maestro (alcance), Alumno dueño", "Admin", "alumnos, notificaciones"],
        ["EsDuenoOPersonal", "Admin, Maestro (alcance), Alumno dueño", "Admin, Maestro", "experiencias, evaluaciones MMA"],
        ["EsPersonalOSoloLectura", "Autenticado", "Admin; Maestro solo sus eventos", "eventos"],
        ["PermisoInscripcionEvento", "Admin, Maestro, Alumno dueño", "Personal; Alumno POST/DELETE propios", "inscripciones a eventos"],
        ["EsAdministrativoOAlumno", "Admin, Alumno dueño", "Admin, Alumno (checkout propio)", "pagos en línea"],
    ], [0.3, 0.22, 0.22, 0.26], mono_cols=(0,))]
    s += [H2("3.4 Matriz de acceso por recurso"), P(
        "L = lectura, E = escritura, — = sin acceso. \"Propio\" significa que el queryset filtra a los registros del alumno autenticado; "
        "\"alcance\", a los alumnos a cargo del maestro."
    )]
    matriz = [
        ["Recurso", "Admin", "Maestro", "Alumno", "Público"],
        ["Autenticación (login)", "E", "E", "E", "E"],
        ["Dashboard general", "L", "—", "—", "—"],
        ["Alumnos", "L / E", "L (alcance)", "L propio; E en /yo/", "—"],
        ["Morosos, por vencer", "L", "—", "—", "—"],
        ["Ranking", "L", "L (alcance)", "L", "—"],
        ["Maestros", "L / E", "L", "—", "—"],
        ["Cuentas administrativas", "L / E", "—", "—", "—"],
        ["Catálogos (horarios, disciplinas, membresías, insignias, categorías MMA)", "L / E", "L", "L", "—"],
        ["Pagos de membresía (caja)", "L / E", "—", "L propio", "—"],
        ["Ventas", "L / E", "—", "—", "—"],
        ["Pagos en línea: checkout", "E (a cualquier alumno)", "—", "E (propio)", "—"],
        ["Pagos en línea: dashboard, cambios, saldo, reembolso", "L / E", "—", "—", "—"],
        ["Asistencias", "L / E", "—", "L propio", "—"],
        ["Check-in QR", "E", "E", "E", "E"],
        ["Check-in manual / del día", "E / L", "—", "—", "—"],
        ["Mi check-in (app)", "—", "—", "E", "—"],
        ["Experiencia y Evaluación MMA", "L / E", "L / E (alcance)", "L propio", "—"],
        ["Torneos y grados", "L / E", "—", "L propio", "—"],
        ["Eventos", "L / E", "L / E (propios)", "L", "—"],
        ["Inscripciones a eventos", "L / E", "L / E (alcance)", "L / inscribirse / cancelar propio", "—"],
        ["Notificaciones", "L / E", "L (de sus avisos)", "L propio; marcar leída", "—"],
        ["Avisos", "L / E (incl. a todos)", "L / E (sus alumnos y grupos)", "—", "—"],
        ["Webhook de Stripe", "—", "—", "—", "Solo con firma de Stripe"],
    ]
    s.append(tabla(matriz, [0.36, 0.14, 0.17, 0.2, 0.13]))
    return s


def seccion_autenticacion():
    s = [PageBreak(), H1("4. Autenticación"), P(
        "La API usa <b>TokenAuthentication</b> de DRF. El frontend guarda el token y lo envía en cada petición. No se usa "
        "SessionAuthentication porque exige CSRF incluso a peticiones anónimas y rompía el login."
    ), H3("Iniciar sesión"), codigo("""
POST /api/auth/login/
{"username": "alumno-12", "password": "********"}      // también acepta el correo

200 OK
{
  "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b",
  "usuario": {
    "id": 31, "username": "alumno-12", "email": "ana@correo.com", "nombre": "Ana Ruiz",
    "rol": "ALUMNO",                // ADMINISTRATIVO | MAESTRO | ALUMNO | SIN_ROL
    "alumno_id": 12, "maestro_id": null,
    "alumno": { ...perfil completo del alumno... }
  }
}
401 usuario o contraseña incorrectos · 403 cuenta desactivada
"""), H3("Uso del token"), codigo("""
GET /api/auth/yo/
Authorization: Token 9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b
"""), tabla([
        ["Endpoint", "Cuerpo", "Respuesta"],
        ["POST /api/auth/logout/", "—", "{detail}; borra el token."],
        ["GET /api/auth/yo/", "—", "Mismo objeto usuario que el login."],
        ["POST /api/auth/cambiar-password/", "{actual, nueva} (mín. 8 caracteres)", "{detail, token} con token nuevo."],
    ], [0.36, 0.34, 0.3])]
    return s


def seccion_modelo():
    ms = modelos()
    s = [PageBreak(), H1("5. Modelo de datos"), P(
        f"El sistema tiene {len(ms)} modelos: {sum(1 for m in ms if m['app'] == 'core')} en <b>core</b> y "
        f"{sum(1 for m in ms if m['app'] == 'payments')} en <b>payments</b>. El alumno es el centro del modelo: casi todo "
        "lo operativo cuelga de él. La figura muestra las relaciones principales; las tablas que siguen se generan del "
        "propio código e incluyen todas."
    ), diagrama_er(), P("Figura 2. Relaciones principales entre entidades (en rojo, el alumno; en morado, pagos en línea).", "pie"), Spacer(1, 8)]
    s += [H2("5.1 Reglas de integridad relevantes"), *vinetas([
        f"<b>CASCADE</b> desde Alumno: al borrar un alumno se borran sus pagos, asistencias, experiencia, torneos, grados, notificaciones, evaluaciones e inscripciones. En operación normal se da de baja con {c('activo=false')}.",
        "<b>PROTECT</b> en PagoStripe → Alumno/Membresía: no se puede borrar un alumno o plan con pagos en línea (auditoría financiera).",
        "<b>SET_NULL</b> en catálogos (horario, membresía, disciplina) y en autores (creado_por, registrado_por): el historial sobrevive.",
        f"Unicidades: una asistencia por alumno/clase/día ({c('asistencia_unica_por_clase')}, también validada con NULL), un resultado por alumno y evento, una evaluación MMA por alumno y día, una inscripción por alumno y evento, un horario por franja.",
        f"Idempotencia de Stripe: {c('EventoStripe.event_id')}, {c('PagoStripe.stripe_checkout_session_id')} y {c('stripe_payment_intent_id')} son únicos.",
    ])]
    s += [H2("5.2 Diccionario de relaciones")]
    for m in ms:
        bloque = [H3(f"{m['nombre']} <font size=8.5 color='#8a8a8a'>· {escape(m['verbose'])} · tabla {m['tabla']}</font>"),
                  P(f"<b>Campos:</b> {escape(', '.join(m['campos']))}", "celda")]
        if m["unicas"]:
            bloque.append(P(f"<b>Restricciones:</b> {escape(', '.join(m['unicas']))}", "celda"))
        bloque.append(Spacer(1, 3))
        if m["rels"]:
            filas = [["Campo", "Tipo", "Apunta a", "Al borrar destino", "Nulo", "Relación inversa"]]
            filas += [[r["campo"], r["tipo"], r["destino"], r["on_delete"], r["nulo"], r["inversa"]] for r in m["rels"]]
            bloque.append(tabla(filas, [0.2, 0.08, 0.18, 0.2, 0.08, 0.26], mono_cols=(0, 5)))
        bloque.append(Spacer(1, 6))
        s.append(KeepTogether(bloque))
    return s


def seccion_endpoints():
    eps = endpoints()
    s = [PageBreak(), H1("6. Referencia de endpoints"), P(
        f"La API expone {len(eps)} rutas. La tabla de cada módulo se genera del router de Django, por lo que métodos y "
        "permisos corresponden exactamente al código. Las rutas de colección aceptan GET (lista paginada) y POST (alta); "
        "las de detalle {pk}, GET, PUT, PATCH y DELETE, salvo que se indique otra cosa."
    )]
    usados = set()
    for titulo, prefijos in MODULOS:
        grupo = [e for e in eps if any(e["path"].startswith(p) for p in prefijos) and e["path"] not in usados]
        if not grupo:
            continue
        usados.update(e["path"] for e in grupo)
        filas = [["Método", "Ruta", "Roles", "Descripción"]]
        for e in grupo:
            filas.append([
                P(" ".join(e["metodos"]), "celda_mono"),
                P(escape(e["path"]), "celda_mono"),
                P(roles_de(e), "celda"),
                P(escape(DESCRIPCIONES.get(e["path"], "")), "celda"),
            ])
        s += [CondPageBreak(5 * cm), H2(f"6.{MODULOS.index((titulo, prefijos)) + 1} {titulo}"),
              tabla(filas, [0.13, 0.3, 0.24, 0.33])]
        filtros = [e for e in grupo if e["extra"]]
        for e in filtros:
            partes = []
            if "filtros" in e["extra"]:
                partes.append("<b>Filtros:</b> " + ", ".join(c(f) for f in e["extra"]["filtros"]))
            if "busqueda" in e["extra"]:
                partes.append("<b>?search=</b> " + ", ".join(c(f) for f in e["extra"]["busqueda"]))
            if "orden" in e["extra"]:
                partes.append("<b>?ordering=</b> " + ", ".join(c(f) for f in e["extra"]["orden"]))
            s.append(P(f"{c(e['path'])} — " + " · ".join(partes), "nota"))
        s.append(Spacer(1, 4))
    resto = [e for e in eps if e["path"] not in usados]
    if resto:
        filas = [["Método", "Ruta", "Roles", "Descripción"]] + [
            [P(" ".join(e["metodos"]), "celda_mono"), P(escape(e["path"]), "celda_mono"), P(roles_de(e), "celda"),
             P(escape(DESCRIPCIONES.get(e["path"], "")), "celda")] for e in resto]
        s += [H2("6.13 Otros"), tabla(filas, [0.13, 0.3, 0.24, 0.33])]

    s += [H2("6.12 Ejemplo: check-in por QR"), codigo("""
POST /api/asistencias/checkin/                     (público: tablet de recepción)
{"codigo_qr": "ALU-364F1A7C0D6E", "disciplina_id": 1, "horario_id": 2}

201 Created
{
  "detail": "Asistencia registrada para Ana Ruiz.",
  "alumno": {"id": 13, "nombre": "Ana Ruiz", "puntos": 30, "al_corriente": false, "dias_para_vencer": null},
  "racha": 1, "puntos_otorgados": 10, "insignias_desbloqueadas": ["Primer paso"], "asistencia_id": 150
}
400 QR desconocido · 403 alumno dado de baja · 409 ya registró esa clase hoy
""")]
    return s


def seccion_stripe():
    s = [PageBreak(), H1("7. Pagos en línea con Stripe"), P(
        "Los alumnos pagan su membresía con <b>Stripe Checkout</b>: la página de pago la hospeda Stripe, así que el sistema "
        "nunca ve ni guarda datos de tarjeta. El frontend solo dice <i>qué</i> se compra; el backend decide el precio, "
        "crea la sesión con la llave secreta y únicamente el <b>webhook firmado</b> confirma el pago y activa la membresía."
    ), H2("7.1 Flujo completo"), diagrama_flujo_stripe(),
        P("Figura 3. Secuencia de un pago. La success_url es solo experiencia de usuario: nada se activa por visitarla.", "pie")]
    s += [H2("7.2 Modelos"), tabla([
        ["Modelo", "Propósito", "Campos clave"],
        ["PagoStripe", "Un intento de cobro en línea. Nace PENDIENTE; el webhook lo mueve de estado. Al pagarse crea el core.Pago que cubre los días.",
         "alumno, membresia, solicitado_por, monto, moneda, estatus, referencia (UUID), stripe_checkout_session_id, stripe_payment_intent_id, checkout_url, pago (1:1 core.Pago), pagado_en, detalle_error"],
        ["EventoStripe", "Registro de cada evento de webhook ya procesado. Su event_id único garantiza que un reenvío no se aplique dos veces.",
         "event_id, tipo, pago_stripe, procesado_en"],
    ], [0.16, 0.42, 0.42]), Spacer(1, 6), diagrama_estados()]
    s += [H2("7.3 Endpoints"), H3("Iniciar pago · POST /api/payments/checkout/"), P(
        "Alumno: paga su propia membresía (sin membresia_id usa la que tiene asignada). Administrativo: genera la liga para "
        "cualquier alumno y la puede compartir. Si ya existe una liga PENDIENTE del mismo alumno, plan y precio de menos de "
        "23 horas, se devuelve esa misma (200) en lugar de crear otra. Limitado a 10 peticiones por minuto por usuario."
    ), codigo("""
POST /api/payments/checkout/
Authorization: Token <token del alumno>
{"membresia_id": 3}                      // admin: {"alumno_id": 12, "membresia_id": 3}

201 Created
{
  "id": 41,
  "referencia": "5b1f0a8e-2c1d-4b8e-9d7a-0f3c2e9b6a11",
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_a1B2...",
  "monto": "800.00",
  "moneda": "MXN"
}
400 sin membresía / alumno de baja / plan sin precio · 403 pagar por otro alumno o rol maestro
429 demasiadas peticiones · 502 Stripe rechazó la sesión · 503 Stripe sin configurar
"""), P(f"Cualquier {c('monto')} o {c('amount')} que envíe el frontend se ignora: el precio sale de {c('Membresia.precio')}."),
        H3("Pantalla de éxito · GET /api/payments/sesion/?session_id=cs_..."),
        P("Devuelve el PagoStripe de esa sesión (solo el dueño o un administrativo). El frontend lo consulta al volver de Stripe "
          "y, si sigue PENDIENTE o PROCESANDO, reintenta cada pocos segundos: el webhook suele llegar en 1–5 s."),
        H3("Listado · GET /api/payments/"),
        P(f"Filtros {c('alumno')}, {c('estatus')}, {c('membresia')}, {c('creado_en__gte')}, {c('creado_en__lte')}. Admin ve todos; el alumno, los suyos."),
        H3("Reembolso · POST /api/payments/{id}/reembolsar/"),
        P("Solo administrativo y solo pagos PAGADO. Pide a Stripe el reembolso total y responde 202; el estado cambia a "
          "REEMBOLSADO cuando llega charge.refunded. Nunca se simula un reembolso editando la base de datos."),
        H3("Saldo · GET /api/payments/saldo/"),
        codigo("""
{"disponible": [{"moneda": "MXN", "monto": "12500.00"}], "pendiente": [{"moneda": "MXN", "monto": "1600.00"}]}
""")]
    s += [H2("7.4 Webhook · POST /api/payments/webhook/stripe/"), P(
        "Es público porque Stripe necesita alcanzarlo, pero se verifica la firma HMAC del encabezado "
        f"{c('Stripe-Signature')} sobre el cuerpo crudo antes de leer nada (tolerancia de 5 minutos contra repetición). "
        "Firma inválida: 400. Todo el procesamiento es una transacción: si algo falla se responde 500, el evento no queda "
        "registrado y Stripe lo reintenta."
    ), tabla([
        ["Evento", "Efecto"],
        ["checkout.session.completed", "payment_status = paid: verifica importe y moneda, marca PAGADO y activa la membresía. unpaid (OXXO, transferencia): PROCESANDO."],
        ["checkout.session.async_payment_succeeded", "Pago diferido confirmado: PAGADO y activación."],
        ["checkout.session.async_payment_failed", "Pago diferido no completado: FALLIDO."],
        ["checkout.session.expired", "La sesión venció sin pago: CANCELADO."],
        ["charge.refunded", "Reembolso total: REEMBOLSADO y se borra el core.Pago (deja de cubrir días). Parcial: se registra y se conserva la membresía."],
        ["Cualquier otro", "Se registra en EventoStripe y se responde 200 sin efecto."],
    ], [0.38, 0.62], mono_cols=(0,))]
    s += [H3("Activación de la membresía"), *vinetas([
        f"Se crea un {c('core.Pago')} con método TARJETA por el monto cobrado; su señal manda el comprobante por correo.",
        "Si el alumno sigue al corriente, los días se suman a partir de su vencimiento actual (renovar antes no le quita días); si ya venció, cuentan desde hoy.",
        f"Si compró un plan distinto al asignado, se actualiza {c('Alumno.membresia')}.",
        "Si el importe o la moneda recibidos no coinciden con lo esperado, no se activa nada y el pago queda FALLIDO con el detalle.",
        "La sesión del evento debe coincidir con la guardada en el PagoStripe; si no, el evento se ignora.",
    ])]
    s += [H2("7.5 Dashboard de pagos en tiempo real"), P(
        "El webhook actualiza la base de datos en cuanto Stripe confirma, así que el tablero refleja cada cobro en segundos "
        "sin consultar a Stripe en cada carga. El frontend usa dos llamadas, ambas solo para administrativos:"
    ), *vinetas([
        f"{c('GET /api/payments/dashboard/')}: foto completa del tablero y un {c('cursor')}.",
        f"{c('GET /api/payments/cambios/?desde=<cursor>')}: los pagos creados o modificados después del cursor y el cursor siguiente. Se consulta cada 3–5 s y se aplica un upsert por id; cuando {c('hay_cambios')} es true se recarga el dashboard para refrescar los totales.",
    ]), codigo("""
GET /api/payments/dashboard/
{
  "cursor": "2026-09-23T17:04:55.120000+00:00",
  "stripe": {"configurado": true, "webhook_configurado": true, "modo": "test", "moneda": "MXN"},
  "resumen": {
    "periodo": "2026-09",
    "cobrado_hoy":  {"total": "1600.00", "cantidad": 2},
    "cobrado_mes":  {"total": "24000.00", "cantidad": 28},
    "ticket_promedio_mes": "857.14",
    "reembolsado_mes": {"total": "800.00", "cantidad": 1},
    "pendientes":   {"total": "2400.00", "cantidad": 3},
    "por_estatus_mes": {"PENDIENTE": 2, "PROCESANDO": 1, "PAGADO": 28,
                        "FALLIDO": 1, "CANCELADO": 4, "REEMBOLSADO": 1},
    "tasa_conversion_mes": 75.7
  },
  "serie_diaria": [{"dia": "2026-09-22", "total": "3200.00", "cantidad": 4}, ...],      // 30 días
  "por_membresia_mes": [{"membresia": 1, "membresia__nombre": "Mensualidad Básica",
                         "total": "16000.00", "cantidad": 20}],
  "recientes": [ ...10 PagoStripe más recientes... ],
  "webhook": {"ultimo_evento": {"tipo": "checkout.session.completed", "procesado_en": "..."},
              "eventos_24h": 9}
}

GET /api/payments/cambios/?desde=2026-09-23T17%3A04%3A55.120000%2B00%3A00
{"cursor": "2026-09-23T17:05:00.410000+00:00", "hay_cambios": true, "pagos": [ {...PagoStripe...} ]}
"""), nota(
        f"El cursor lleva un solape de 5 segundos para no perder filas cuya transacción se confirmó justo después de la "
        f"consulta anterior; por eso un pago puede llegar dos veces y el cliente debe hacer upsert por id. El signo + de la "
        f"zona horaria debe ir codificado en la URL ({c('%2B')}); en Angular, {c('HttpParams')} lo hace solo."
    ), H3("Consumo desde Angular (referencia)"), codigo("""
// payments-dashboard.service.ts
dashboard$ = this.http.get<Dashboard>('/api/payments/dashboard/');

enVivo(cursorInicial: string): Observable<CambiosPagos> {
  let cursor = cursorInicial;
  return timer(0, 4000).pipe(
    switchMap(() => this.http.get<CambiosPagos>('/api/payments/cambios/',
                    { params: new HttpParams().set('desde', cursor) })),
    tap(r => cursor = r.cursor),
    filter(r => r.hay_cambios),
  );
}
// En el componente: upsert de r.pagos por id en la tabla y recargar dashboard$ para los totales.
"""), P(
        "La salud del webhook (último evento y eventos en 24 h) permite mostrar una alerta si Stripe dejó de notificar. "
        f"{c('/saldo/')} sí consulta a Stripe en vivo, así que conviene llamarlo bajo demanda y no en el ciclo de polling."
    )]
    s += [H2("7.6 Desarrollo local con Stripe CLI"), codigo("""
stripe login
stripe listen --forward-to localhost:8000/api/payments/webhook/stripe/
#  -> imprime whsec_...: cópialo a STRIPE_WEBHOOK_SECRET en el .env y reinicia el servidor
stripe trigger checkout.session.completed
#  -> evento de prueba sin PagoStripe asociado: se registra y se responde 200 sin efecto
"""), P("Para un recorrido completo, crea el checkout desde la app con las llaves sk_test_ y paga con las tarjetas de prueba "
          "de Stripe (aprobada, rechazada, 3D Secure, fondos insuficientes). Nunca uses tarjetas reales en modo prueba.")]
    s += [H2("7.7 Seguridad"), tabla([
        ["Control", "Implementación"],
        ["Precio en el servidor", "El monto sale de Membresia.precio; lo que mande el frontend se ignora."],
        ["Autorización (IDOR)", "El alumno solo paga y consulta lo suyo; el admin elige alumno; el maestro no tiene acceso."],
        ["Secretos", "STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET solo en el .env; nunca en Git ni en Angular."],
        ["Firma del webhook", "stripe.WebhookSignature.verify_header sobre el cuerpo crudo, tolerancia 300 s."],
        ["Idempotencia", "EventoStripe.event_id único + estatus del PagoStripe + select_for_update + idempotency_key en llamadas a Stripe."],
        ["Transacciones", "El webhook procesa todo en transaction.atomic; un fallo responde 500 y Stripe reintenta."],
        ["Integridad del importe", "amount_total y currency del evento deben coincidir con lo guardado."],
        ["Rate limiting", "ScopedRateThrottle 'checkout' (THROTTLE_CHECKOUT, 10/min por usuario)."],
        ["Logs", "Logger payments registra ids, tipo de evento y estatus; nunca llaves, tokens ni datos de tarjeta."],
        ["Datos de tarjeta", "Ninguno: Stripe Checkout procesa la tarjeta; solo se guardan referencias cs_ / pi_."],
        ["Auditoría", "El admin de Django muestra PagoStripe y EventoStripe en solo lectura."],
    ], [0.27, 0.73])]
    return s


def seccion_automatismos():
    s = [PageBreak(), H1("8. Automatismos y tareas programadas"), H2("8.1 Señales"), tabla([
        ["Disparador", "Efecto"],
        ["Alta de Alumno o Maestro", "Crea su cuenta de acceso y su código QR (imagen PNG)."],
        ["Alta de Alumno", "Crea su Experiencia (ficha técnica) vacía."],
        ["Alta de Asistencia", "Suma puntos con F(), recalcula la racha y evalúa insignias (con notificación)."],
        ["Borrado de Asistencia", "Devuelve los puntos y recalcula la racha."],
        ["Alta/borrado de Torneo", "Recalcula el récord G-P-E de la Experiencia."],
        ["Alta de Pago", "Envía el comprobante por correo; nunca revierte el pago si el correo falla."],
        ["Webhook de Stripe pagado", "Crea el Pago (y con él, el comprobante) y ajusta la membresía del alumno."],
    ], [0.35, 0.65])]
    s += [H2("8.2 Comandos de administración"), tabla([
        ["Comando", "Qué hace", "Frecuencia sugerida"],
        ["python manage.py revisar_pagos --dias 5", "Refresca estatus de pagos y genera avisos de vencimiento y de vencido, sin duplicarlos.", "Diario, 8:00"],
        ["python manage.py enviar_notificaciones_pendientes", "Envía los correos de avisos masivos pendientes.", "Cada 5 min"],
        ["python manage.py seed", "Carga catálogos del cartel (horarios, disciplinas, planes, insignias) y datos demo.", "Una vez"],
    ], [0.42, 0.4, 0.18], mono_cols=(0,)), codigo("""
# crontab del servidor
0 8 * * *   /ruta/venv/bin/python /ruta/manage.py revisar_pagos
*/5 * * * * /ruta/venv/bin/python /ruta/manage.py enviar_notificaciones_pendientes
""")]
    s += [H2("8.3 Reglas de negocio destacadas"), *vinetas([
        "<b>Estatus de pago calculado:</b> PAGADO o VENCIDO se derivan de fecha_vencimiento; solo PENDIENTE se respeta si se fija a mano.",
        "<b>Racha con tolerancia:</b> permite huecos de hasta 3 días entre sesiones (TOLERANCIA_RACHA_DIAS).",
        "<b>Doble check-in bloqueado:</b> una asistencia por clase y día, aunque falten disciplina u horario.",
        "<b>Pagos y ventas separados:</b> las ventas no mueven vencimientos ni el semáforo del alumno.",
        "<b>Imágenes con ruta relativa:</b> foto y QR salen como /media/..., para que funcionen detrás de proxy y desde el celular.",
    ])]
    return s


def seccion_calidad(total_tests):
    s = [PageBreak(), H1("9. Pruebas y despliegue"), H2("9.1 Pruebas automatizadas"), P(
        f"La suite tiene {total_tests} pruebas (Django TestCase) que cubren modelos, reglas de negocio, permisos por rol, "
        "avisos, eventos, Evaluación MMA, ventas, media y la integración con Stripe (checkout, firma del webhook, "
        "idempotencia, activación, reembolsos y dashboard). Las pruebas de Stripe no llaman a la red: simulan la API y "
        "firman los webhooks con el mismo HMAC que usa Stripe."
    ), codigo("""
python manage.py test                     # suite completa
python manage.py test --parallel 4        # más rápido
python manage.py test payments            # solo pagos en línea
""")]
    s += [H2("9.2 Lista de verificación para producción"), tabla([
        ["", "Punto"],
        ["[&nbsp;&nbsp;]", "DEBUG=False y SECRET_KEY real (activa HSTS, cookies seguras, redirección HTTPS)."],
        ["[&nbsp;&nbsp;]", "ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS y CSRF_TRUSTED_ORIGINS acotados a los dominios reales."],
        ["[&nbsp;&nbsp;]", "PostgreSQL (DB_ENGINE=postgresql) con respaldos programados."],
        ["[&nbsp;&nbsp;]", "pip install -r requirements-prod.txt; collectstatic; gunicorn config.wsgi:application."],
        ["[&nbsp;&nbsp;]", "Media (fotos y QR) en almacenamiento persistente (S3 o similar)."],
        ["[&nbsp;&nbsp;]", "EMAIL_BACKEND SMTP real y cron de revisar_pagos y enviar_notificaciones_pendientes."],
        ["[&nbsp;&nbsp;]", "Llaves live de Stripe (sk_live_) en el .env del servidor, nunca en Git."],
        ["[&nbsp;&nbsp;]", "Endpoint de webhook HTTPS registrado en el Dashboard de Stripe con los eventos checkout.session.* y charge.refunded; su whsec_ en STRIPE_WEBHOOK_SECRET."],
        ["[&nbsp;&nbsp;]", "STRIPE_SUCCESS_URL y STRIPE_CANCEL_URL apuntando al dominio del frontend."],
        ["[&nbsp;&nbsp;]", "Prueba de extremo a extremo en modo test: checkout, webhook, activación, reembolso."],
        ["[&nbsp;&nbsp;]", "Check-in público protegido por red cerrada o token de dispositivo si la tablet sale de la red local."],
        ["[&nbsp;&nbsp;]", "python manage.py check --deploy sin advertencias."],
    ], [0.06, 0.94])]
    return s


def construir(salida, logo, total_tests):
    doc = Manual(str(salida), logo_ruta=logo)
    historia = []
    historia += portada(logo)
    historia += indice()
    historia += seccion_introduccion()
    historia += seccion_configuracion()
    historia += seccion_perfiles()
    historia += seccion_autenticacion()
    historia += seccion_modelo()
    historia += seccion_endpoints()
    historia += seccion_stripe()
    historia += seccion_automatismos()
    historia += seccion_calidad(total_tests)
    doc.multiBuild(historia)
    return salida


def contar_tests():
    import unittest

    cargador = unittest.TestLoader()
    total = 0
    for app in ("core", "payments"):
        ruta = BASE_DIR / app
        patron = "test*.py"
        total += cargador.discover(str(ruta), pattern=patron, top_level_dir=str(BASE_DIR)).countTestCases()
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logo", help="Logo del frontend (PNG, JPG o SVG). Sin él se usa el wordmark CASA BRAVA.")
    ap.add_argument("--salida", default=str(Path(__file__).parent / "Manual_Tecnico_Backend.pdf"))
    args = ap.parse_args()
    archivo = construir(Path(args.salida), args.logo, contar_tests())
    print(f"Manual generado: {archivo}")


if __name__ == "__main__":
    main()
