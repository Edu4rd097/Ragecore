"""
Ficha técnica del peleador en PDF (GET /api/alumnos/{id}/ficha-pdf/).

Se dibuja con ReportLab directamente (no con xhtml2pdf como el comprobante)
porque el diseño de cartel de la academia —fondo negro, acento azul
eléctrico, tipografía Oswald/Inter, barras y mosaicos— no cabe en el
subset de CSS de xhtml2pdf.

Las fuentes viven en core/fuentes/ (Oswald e Inter, licencia OFL) para no
depender de las del sistema: en el servidor Linux no hay ninguna de las dos.
Si faltaran, se cae a Helvetica y el PDF sale igual, solo menos vistoso.
"""
from __future__ import annotations

import logging
import math
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .ficha import datos_ficha, nombre_archivo, numero  # noqa: F401  (nombre_archivo se reexporta)
from .models import Alumno, Experiencia, Torneo

logger = logging.getLogger(__name__)

# --- Paleta RageCore (misma que src/styles.scss del frontend) ---------------

NEGRO = HexColor("#0a0a0b")
NEGRO_900 = HexColor("#0f1011")
NEGRO_800 = HexColor("#16171a")
NEGRO_700 = HexColor("#1e2024")
BORDE = HexColor("#2a2d33")
AZUL = HexColor("#0095ff")
AZUL_CLARO = HexColor("#33c1ff")
AZUL_OSCURO = HexColor("#0059b3")
TEXTO = HexColor("#f4f4f5")
SUAVE = HexColor("#a1a1aa")
TENUE = HexColor("#6b6b73")
VERDE = HexColor("#16a34a")
AMARILLO = HexColor("#eab308")
ROJO = HexColor("#dc2626")
BLANCO = HexColor("#ffffff")

COLOR_CINTURON = {
    Experiencia.Cinturon.BLANCO: HexColor("#f4f4f5"),
    Experiencia.Cinturon.AZUL: HexColor("#1d4ed8"),
    Experiencia.Cinturon.PURPURA: HexColor("#7e22ce"),
    Experiencia.Cinturon.MARRON: HexColor("#7c3f12"),
    Experiencia.Cinturon.NEGRO: HexColor("#050505"),
}
COLOR_RESULTADO = {
    Torneo.Resultado.GANO: VERDE,
    Torneo.Resultado.PERDIO: ROJO,
    Torneo.Resultado.EMPATO: AMARILLO,
}

ANCHO_PAGINA, ALTO_PAGINA = A4
MARGEN = 36
ANCHO_UTIL = ANCHO_PAGINA - 2 * MARGEN

# --- Tipografía ----------------------------------------------------------------

DIR_FUENTES = Path(__file__).resolve().parent / "fuentes"
_FUENTES = {
    "Titulo": ("oswald-700.ttf", "Helvetica-Bold"),
    "Titulo-Medio": ("oswald-500.ttf", "Helvetica-Bold"),
    "Texto": ("inter-400.ttf", "Helvetica"),
    "Texto-Semi": ("inter-600.ttf", "Helvetica-Bold"),
    "Texto-Bold": ("inter-700.ttf", "Helvetica-Bold"),
}
F: dict[str, str] = {}


def _registrar_fuentes() -> None:
    if F:
        return
    for alias, (archivo, respaldo) in _FUENTES.items():
        nombre = f"Ficha-{alias}"
        try:
            if nombre not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(nombre, str(DIR_FUENTES / archivo)))
            F[alias] = nombre
        except Exception:  # archivo ausente o corrupto: la ficha sale con Helvetica
            logger.warning("Fuente %s no disponible; se usa %s.", archivo, respaldo)
            F[alias] = respaldo


def _estilo(nombre, fuente="Texto", tam=8.5, color=TEXTO, interlineado=None, **kw) -> ParagraphStyle:
    return ParagraphStyle(
        nombre, fontName=F[fuente], fontSize=tam, leading=interlineado or tam * 1.35,
        textColor=color, alignment=TA_LEFT, **kw,
    )


def _esc(texto) -> str:
    """Escapa para Paragraph (mini-HTML de ReportLab)."""
    return (
        str(texto if texto is not None else "")
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


# --- Imágenes ------------------------------------------------------------------

def _imagen_cuadrada(campo, lado_px=600) -> ImageReader | None:
    """Foto recortada al centro en cuadrado (evita rostros estirados)."""
    if not campo:
        return None
    try:
        with campo.open("rb") as f:
            img = Image.open(f)
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "LA", "P"):
                fondo = Image.new("RGB", img.size, (22, 23, 26))
                img = img.convert("RGBA")
                fondo.paste(img, mask=img.split()[-1])
                img = fondo
            else:
                img = img.convert("RGB")
            img = ImageOps.fit(img, (lado_px, lado_px), Image.LANCZOS)
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=88)
            buffer.seek(0)
            return ImageReader(buffer)
    except Exception:
        logger.warning("No se pudo leer la imagen %s para la ficha.", getattr(campo, "name", campo))
        return None


# --- Piezas gráficas reutilizables ---------------------------------------------------

def _logo(c, x, y, tam):
    """Octágono (la jaula) con banda diagonal y monograma RC — igual que el SVG de la app."""
    k = tam / 64.0

    def p(px, py):  # coordenadas del SVG (origen arriba) -> PDF (origen abajo)
        return x + px * k, y + (64 - py) * k

    c.saveState()
    octagono = c.beginPath()
    puntos = [(20, 3), (44, 3), (61, 20), (61, 44), (44, 61), (20, 61), (3, 44), (3, 20)]
    octagono.moveTo(*p(*puntos[0]))
    for pt in puntos[1:]:
        octagono.lineTo(*p(*pt))
    octagono.close()
    c.setFillColor(NEGRO_900)
    c.setStrokeColor(AZUL)
    c.setLineWidth(3 * k)
    c.drawPath(octagono, stroke=1, fill=1)

    banda = c.beginPath()
    banda.moveTo(*p(10, 44))
    banda.lineTo(*p(44, 10))
    banda.lineTo(*p(52, 18))
    banda.lineTo(*p(18, 52))
    banda.close()
    c.setFillColor(Color(AZUL.red, AZUL.green, AZUL.blue, alpha=0.9))
    c.drawPath(banda, stroke=0, fill=1)

    c.setFillColor(BLANCO)
    c.setFont(F["Titulo"], 24 * k)
    c.drawCentredString(*p(32, 41), "RC")
    c.restoreState()


def _pastilla(c, x, y, texto, fondo, color_texto=BLANCO, tam=7, alto=14, fuente="Texto-Bold"):
    """Chip redondeado; devuelve el ancho usado."""
    ancho = pdfmetrics.stringWidth(texto, F[fuente], tam) + 12
    c.setFillColor(fondo)
    c.roundRect(x, y, ancho, alto, alto / 2, stroke=0, fill=1)
    c.setFillColor(color_texto)
    c.setFont(F[fuente], tam)
    c.drawString(x + 6, y + (alto - tam) / 2 + 1.2, texto)
    return ancho


def _estrella(c, cx, cy, radio, color):
    """Estrella de 5 puntas en vector (las fuentes no traen el glifo ★)."""
    trazo = c.beginPath()
    for i in range(10):
        r = radio if i % 2 == 0 else radio * 0.45
        ang = math.pi / 2 + i * math.pi / 5
        x, y = cx + r * math.cos(ang), cy + r * math.sin(ang)
        trazo.moveTo(x, y) if i == 0 else trazo.lineTo(x, y)
    trazo.close()
    c.setFillColor(color)
    c.drawPath(trazo, stroke=0, fill=1)


def _con_alfa(color, alfa):
    return Color(color.red, color.green, color.blue, alpha=alfa)


# --- Fondo y pie de cada página --------------------------------------------------------

class _LienzoNumerado(rl_canvas.Canvas):
    """Canvas que conoce el total de páginas para el pie "Página X de Y"."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._paginas = []

    def showPage(self):
        self._paginas.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._paginas)
        for estado in self._paginas:
            self.__dict__.update(estado)
            self.setFont(F["Texto"], 7)
            self.setFillColor(TENUE)
            self.drawRightString(ANCHO_PAGINA - MARGEN, 20, f"Página {self._pageNumber} de {total}")
            super().showPage()
        super().save()


def _dibujar_fondo(alumno, generada):
    def dibujar(c, doc):
        c.saveState()
        c.setFillColor(NEGRO)
        c.rect(0, 0, ANCHO_PAGINA, ALTO_PAGINA, stroke=0, fill=1)

        # Textura de lona: diagonales apenas visibles, como en la app.
        c.setStrokeColor(_con_alfa(BLANCO, 0.018))
        c.setLineWidth(0.6)
        for i in range(-int(ALTO_PAGINA), int(ANCHO_PAGINA), 14):
            c.line(i, 0, i + ALTO_PAGINA, ALTO_PAGINA)

        # Banda diagonal de acento en la esquina superior derecha.
        banda = c.beginPath()
        banda.moveTo(ANCHO_PAGINA - 170, ALTO_PAGINA)
        banda.lineTo(ANCHO_PAGINA - 120, ALTO_PAGINA)
        banda.lineTo(ANCHO_PAGINA, ALTO_PAGINA - 120)
        banda.lineTo(ANCHO_PAGINA, ALTO_PAGINA - 170)
        banda.close()
        c.setFillColor(_con_alfa(AZUL, 0.16))
        c.drawPath(banda, stroke=0, fill=1)

        # Línea de acento superior.
        c.setFillColor(AZUL)
        c.rect(0, ALTO_PAGINA - 4, ANCHO_PAGINA, 4, stroke=0, fill=1)

        # Encabezado: logo + marca + folio.
        _logo(c, MARGEN, ALTO_PAGINA - 58, 30)
        c.setFillColor(TEXTO)
        c.setFont(F["Titulo"], 13)
        c.drawString(MARGEN + 38, ALTO_PAGINA - 40, "RAGECORE")
        c.setFillColor(SUAVE)
        c.setFont(F["Texto"], 6.8)
        c.drawString(MARGEN + 38, ALTO_PAGINA - 51, "ACADEMIA DE COMBATE")

        c.setFillColor(AZUL_CLARO)
        c.setFont(F["Titulo-Medio"], 9)
        c.drawRightString(ANCHO_PAGINA - MARGEN, ALTO_PAGINA - 38, "FICHA TÉCNICA DEL PELEADOR")
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 6.8)
        c.drawRightString(
            ANCHO_PAGINA - MARGEN, ALTO_PAGINA - 50, f"ID {alumno.codigo_qr}  ·  Folio #{alumno.id:05d}"
        )

        c.setStrokeColor(BORDE)
        c.setLineWidth(0.6)
        c.line(MARGEN, ALTO_PAGINA - 66, ANCHO_PAGINA - MARGEN, ALTO_PAGINA - 66)

        # Pie.
        c.line(MARGEN, 32, ANCHO_PAGINA - MARGEN, 32)
        c.setFont(F["Texto-Semi"], 7)
        c.setFillColor(SUAVE)
        c.drawString(MARGEN, 20, "RAGECORE · Academia de combate")
        c.setFont(F["Texto"], 7)
        c.setFillColor(TENUE)
        c.drawCentredString(ANCHO_PAGINA / 2, 20, f"Generada el {generada:%d/%m/%Y a las %H:%M}")
        c.restoreState()

    return dibujar


# --- Flowables a la medida ------------------------------------------------------------

class Portada(Flowable):
    """Bloque héroe: foto, nombre, apodo, récord, disciplinas y QR."""

    ALTO = 196

    def __init__(self, datos):
        super().__init__()
        self.d = datos
        self.width = ANCHO_UTIL
        self.height = self.ALTO

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c, d = self.canv, self.d
        alto = self.height

        # Tarjeta de fondo.
        c.setFillColor(NEGRO_800)
        c.setStrokeColor(BORDE)
        c.setLineWidth(0.8)
        c.roundRect(0, 0, self.width, alto, 10, stroke=1, fill=1)
        c.setFillColor(AZUL)
        c.rect(0, 10, 3, alto - 20, stroke=0, fill=1)

        # Foto con marco azul y halo.
        lado = 164
        fx, fy = 18, (alto - lado) / 2
        for i, alfa in enumerate((0.07, 0.12, 0.2)):
            ext = 9 - i * 3
            c.setFillColor(_con_alfa(AZUL, alfa))
            c.roundRect(fx - ext, fy - ext, lado + 2 * ext, lado + 2 * ext, 12 + ext, stroke=0, fill=1)
        c.saveState()
        # El halo deja la opacidad de relleno en 0.2 y ReportLab la aplica
        # también a las imágenes: sin esto la foto sale velada de azul.
        c.setFillAlpha(1)
        marco = c.beginPath()
        marco.roundRect(fx, fy, lado, lado, 10)
        c.clipPath(marco, stroke=0, fill=0)
        if d["foto"]:
            c.drawImage(d["foto"], fx, fy, lado, lado)
        else:
            c.setFillColor(NEGRO_700)
            c.rect(fx, fy, lado, lado, stroke=0, fill=1)
            c.setFillColor(AZUL)
            c.setFont(F["Titulo"], 64)
            c.drawCentredString(fx + lado / 2, fy + lado / 2 - 22, d["iniciales"])
        c.restoreState()
        c.setStrokeColor(AZUL)
        c.setLineWidth(1.6)
        c.roundRect(fx, fy, lado, lado, 10, stroke=1, fill=0)

        # Estado sobre la foto.
        estado, color_estado = ("ACTIVO", VERDE) if d["activo"] else ("BAJA", ROJO)
        _pastilla(c, fx + 8, fy + lado - 22, estado, color_estado, tam=6.5, alto=13)

        # Columna de texto.
        x = fx + lado + 26
        ancho_txt = self.width - x - 104  # deja sitio al QR
        y = alto - 30

        c.setFillColor(AZUL_CLARO)
        c.setFont(F["Texto-Bold"], 7)
        c.drawString(x, y, "PELEADOR RAGECORE")
        y -= 8

        nombre = d["nombre"].upper()
        tam = 30
        while tam > 16 and pdfmetrics.stringWidth(nombre, F["Titulo"], tam) > ancho_txt:
            tam -= 1
        lineas = simpleSplit(nombre, F["Titulo"], tam, ancho_txt)[:2]
        c.setFillColor(TEXTO)
        c.setFont(F["Titulo"], tam)
        for linea in lineas:
            y -= tam * 1.02
            c.drawString(x, y, linea)

        if d["apodo"]:
            y -= 20
            c.setFillColor(AZUL)
            c.setFont(F["Titulo-Medio"], 16)
            c.drawString(x, y, f"“{d['apodo'].upper()}”")

        # Cinturón y disciplinas como chips, sin invadir el QR: lo que no cabe va como "+N".
        y -= 22
        cx = x
        limite = x + ancho_txt
        chips = [d.upper() for d in d["disciplinas"]]
        if d["cinturon"]:
            nombre_cint = d["cinturon"][0]
            limite -= pdfmetrics.stringWidth(f"BJJ · {nombre_cint.upper()}", F["Texto-Bold"], 6.5) + 17
        for i, chip in enumerate(chips):
            ancho_chip = pdfmetrics.stringWidth(chip, F["Texto-Bold"], 6.5) + 12
            resto = len(chips) - i
            reserva = 30 if resto > 1 else 0
            if cx + ancho_chip + reserva > limite:
                cx += _pastilla(c, cx, y, f"+{resto}", NEGRO_700, SUAVE, tam=6.5, alto=14) + 5
                break
            cx += _pastilla(c, cx, y, chip, NEGRO_700, TEXTO, tam=6.5, alto=14) + 5
        if d["cinturon"]:
            nombre_cint, color_cint = d["cinturon"]
            claro = color_cint == COLOR_CINTURON[Experiencia.Cinturon.BLANCO]
            w = _pastilla(
                c, cx, y, f"BJJ · {nombre_cint.upper()}", color_cint,
                NEGRO if claro else BLANCO, tam=6.5, alto=14,
            )
            if color_cint == COLOR_CINTURON[Experiencia.Cinturon.NEGRO]:
                c.setStrokeColor(ROJO)
                c.setLineWidth(1)
                c.roundRect(cx, y, w, 14, 7, stroke=1, fill=0)

        # Récord G-P-E.
        g, p, e = d["record"]
        base = 16
        c.setFillColor(NEGRO_900)
        c.setStrokeColor(BORDE)
        c.roundRect(x, base, 208, 58, 8, stroke=1, fill=1)
        c.setFillColor(TENUE)
        c.setFont(F["Texto-Bold"], 6)
        c.drawString(x + 10, base + 46, "RÉCORD DE PELEAS")
        col = 64
        for i, (valor, rotulo, color) in enumerate(
            ((g, "GANADAS", VERDE), (p, "PERDIDAS", ROJO), (e, "EMPATES", AMARILLO))
        ):
            cx = x + 10 + i * col
            c.setFillColor(TEXTO)
            c.setFont(F["Titulo"], 24)
            c.drawString(cx, base + 16, str(valor))
            c.setFillColor(color)
            c.rect(cx, base + 10, 18, 2, stroke=0, fill=1)
            c.setFillColor(SUAVE)
            c.setFont(F["Texto-Semi"], 5.8)
            c.drawString(cx + 22, base + 9.5, rotulo)

        # % victorias.
        c.setFillColor(AZUL)
        c.setFont(F["Titulo"], 20)
        c.drawString(x + 222, base + 38, d["efectividad"])
        c.setFillColor(SUAVE)
        c.setFont(F["Texto-Semi"], 6)
        c.drawString(x + 222, base + 28, "EFECTIVIDAD")

        # QR de identificación.
        if d["qr"]:
            q = 78
            qx, qy = self.width - q - 16, alto - q - 18
            c.setFillColor(BLANCO)
            c.roundRect(qx - 5, qy - 5, q + 10, q + 10, 6, stroke=0, fill=1)
            c.drawImage(d["qr"], qx, qy, q, q)
            c.setFillColor(TENUE)
            c.setFont(F["Texto"], 5.8)
            c.drawCentredString(qx + q / 2, qy - 14, "PASE DE ACCESO")
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 6.5)
        c.drawRightString(self.width - 16, base + 9, f"Miembro desde {d['miembro_desde']}")
        c.drawRightString(self.width - 16, base, d["horario"])


class Titulo(Flowable):
    """Encabezado de sección: barra azul + texto Oswald + línea."""

    def __init__(self, texto, detalle=""):
        super().__init__()
        self.texto = texto.upper()
        self.detalle = detalle
        self.width = ANCHO_UTIL
        self.height = 26

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(AZUL)
        c.rect(0, 6, 4, 14, stroke=0, fill=1)
        c.setFillColor(TEXTO)
        c.setFont(F["Titulo"], 12.5)
        c.drawString(12, 8, self.texto)
        ancho = pdfmetrics.stringWidth(self.texto, F["Titulo"], 12.5)
        if self.detalle:
            c.setFillColor(TENUE)
            c.setFont(F["Texto"], 7)
            c.drawRightString(self.width, 9, self.detalle)
            fin = self.width - pdfmetrics.stringWidth(self.detalle, F["Texto"], 7) - 10
        else:
            fin = self.width
        c.setStrokeColor(BORDE)
        c.setLineWidth(0.6)
        c.line(ancho + 22, 12, fin, 12)


class Mosaicos(Flowable):
    """Rejilla de estadísticas: etiqueta pequeña + valor grande."""

    def __init__(self, celdas, columnas=4, alto_celda=46, hueco=7):
        super().__init__()
        self.celdas = celdas
        self.columnas = columnas
        self.alto_celda = alto_celda
        self.hueco = hueco
        filas = (len(celdas) + columnas - 1) // columnas
        self.width = ANCHO_UTIL
        self.height = filas * alto_celda + (filas - 1) * hueco

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        ancho = (self.width - (self.columnas - 1) * self.hueco) / self.columnas
        for i, celda in enumerate(self.celdas):
            etiqueta, valor, extra = celda[0], celda[1], (celda[2] if len(celda) > 2 else {})
            fila, col = divmod(i, self.columnas)
            x = col * (ancho + self.hueco)
            y = self.height - (fila + 1) * self.alto_celda - fila * self.hueco
            c.setFillColor(NEGRO_800)
            c.setStrokeColor(BORDE)
            c.setLineWidth(0.6)
            c.roundRect(x, y, ancho, self.alto_celda, 6, stroke=1, fill=1)
            c.setFillColor(extra.get("acento", AZUL))
            c.rect(x, y + 8, 2.5, self.alto_celda - 16, stroke=0, fill=1)

            c.setFillColor(SUAVE)
            c.setFont(F["Texto-Semi"], 6.2)
            c.drawString(x + 11, y + self.alto_celda - 15, etiqueta.upper())

            muestra = extra.get("muestra")
            vx = x + 11
            if muestra is not None:
                c.setFillColor(muestra)
                c.setStrokeColor(BORDE)
                c.roundRect(vx, y + 11, 20, 9, 2, stroke=1, fill=1)
                vx += 26
            tam = 17
            while tam > 9 and pdfmetrics.stringWidth(valor, F["Titulo"], tam) > ancho - (vx - x) - 10:
                tam -= 1
            c.setFillColor(TEXTO)
            c.setFont(F["Titulo"], tam)
            c.drawString(vx, y + 10, valor)
            if extra.get("sub"):  # valor secundario, ej. el peso en libras
                sx = vx + pdfmetrics.stringWidth(valor, F["Titulo"], tam) + 6
                c.setFillColor(AZUL_CLARO)
                c.setFont(F["Texto-Semi"], 7.5)
                c.drawString(sx, y + 11, extra["sub"])


class BarraRecord(Flowable):
    """Barra apilada G/P/E + desglose de métodos de victoria."""

    def __init__(self, g, p, e, metodos: dict, favorito: str):
        super().__init__()
        self.g, self.p, self.e = g, p, e
        self.metodos = metodos
        self.favorito = favorito
        self.width = ANCHO_UTIL
        self.height = 92

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(NEGRO_800)
        c.setStrokeColor(BORDE)
        c.setLineWidth(0.6)
        c.roundRect(0, 0, self.width, self.height, 8, stroke=1, fill=1)

        total = self.g + self.p + self.e
        x0, ancho_barra, yb = 16, self.width * 0.56, 48
        c.setFillColor(SUAVE)
        c.setFont(F["Texto-Semi"], 6.5)
        c.drawString(x0, 72, f"DISTRIBUCIÓN DE {total} COMBATES")

        c.saveState()
        pista = c.beginPath()
        pista.roundRect(x0, yb, ancho_barra, 14, 7)
        c.clipPath(pista, stroke=0, fill=0)
        c.setFillColor(NEGRO_700)
        c.rect(x0, yb, ancho_barra, 14, stroke=0, fill=1)
        x = x0
        if total:
            for valor, color in ((self.g, VERDE), (self.p, ROJO), (self.e, AMARILLO)):
                w = ancho_barra * valor / total
                c.setFillColor(color)
                c.rect(x, yb, w, 14, stroke=0, fill=1)
                x += w
        c.restoreState()

        lx = x0
        for valor, rotulo, color in (
            (self.g, "Victorias", VERDE), (self.p, "Derrotas", ROJO), (self.e, "Empates", AMARILLO)
        ):
            pct = f"{valor / total * 100:.0f}%" if total else "0%"
            c.setFillColor(color)
            c.circle(lx + 3, 31, 3, stroke=0, fill=1)
            c.setFillColor(TEXTO)
            c.setFont(F["Texto-Bold"], 8)
            c.drawString(lx + 10, 28, f"{valor}")
            c.setFillColor(SUAVE)
            c.setFont(F["Texto"], 7.5)
            c.drawString(lx + 10 + pdfmetrics.stringWidth(f"{valor} ", F["Texto-Bold"], 8), 28, f"{rotulo} · {pct}")
            lx += ancho_barra / 3
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 7)
        c.drawString(x0, 12, f"Método de victoria favorito: {self.favorito}")

        # Métodos de victoria (de los torneos registrados).
        mx = x0 + ancho_barra + 28
        ancho_m = self.width - mx - 16
        c.setFillColor(SUAVE)
        c.setFont(F["Texto-Semi"], 6.5)
        c.drawString(mx, 72, "VICTORIAS POR MÉTODO")
        maximo = max(self.metodos.values(), default=0) or 1
        y = 56
        for metodo in ("KO/TKO", "Sumisión", "Decisión"):
            n = self.metodos.get(metodo, 0)
            c.setFillColor(TEXTO)
            c.setFont(F["Texto"], 7)
            c.drawString(mx, y, metodo)
            c.setFillColor(NEGRO_700)
            c.roundRect(mx + 46, y - 1, ancho_m - 66, 7, 3.5, stroke=0, fill=1)
            if n:
                c.setFillColor(AZUL)
                c.roundRect(mx + 46, y - 1, (ancho_m - 66) * n / maximo, 7, 3.5, stroke=0, fill=1)
            c.setFillColor(TEXTO)
            c.setFont(F["Texto-Bold"], 7)
            c.drawRightString(mx + ancho_m, y, str(n))
            y -= 17


class BarrasEvaluacion(Flowable):
    """Evaluación MMA: total con nivel + barra por categoría + preparación."""

    def __init__(self, calculo, fecha, total_evaluaciones):
        super().__init__()
        self.calc = calculo
        self.fecha = fecha
        self.total_evaluaciones = total_evaluaciones
        self.width = ANCHO_UTIL
        filas = len(calculo["categorias"])
        self.height = max(116, 30 + filas * 15)

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c, calc = self.canv, self.calc
        c.setFillColor(NEGRO_800)
        c.setStrokeColor(BORDE)
        c.setLineWidth(0.6)
        c.roundRect(0, 0, self.width, self.height, 8, stroke=1, fill=1)

        # Medidor del total.
        cx, cy, r = 70, self.height / 2 + 4, 42
        maximo = calc["puntaje_maximo"] or 100
        fraccion = max(0.0, min(1.0, calc["puntaje_total"] / maximo))
        c.setLineCap(1)
        c.setStrokeColor(NEGRO_700)
        c.setLineWidth(9)
        c.arc(cx - r, cy - r, cx + r, cy + r, startAng=-210, extent=240)
        if fraccion:
            c.setStrokeColor(AZUL)
            c.arc(cx - r, cy - r, cx + r, cy + r, startAng=30, extent=-240 * fraccion)
        c.setLineCap(0)
        c.setFillColor(TEXTO)
        c.setFont(F["Titulo"], 24)
        c.drawCentredString(cx, cy - 6, numero(float(calc["puntaje_total"])))
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 6.5)
        c.drawCentredString(cx, cy - 17, f"de {maximo} puntos")
        _pastilla_centrada(c, cx, cy - r - 16, calc["nivel"].upper())
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 6)
        c.drawCentredString(cx, 8, f"{self.fecha} · {self.total_evaluaciones} evaluación(es)")

        # Barras por categoría.
        x = 150
        ancho = self.width * 0.5
        y = self.height - 22
        c.setFillColor(SUAVE)
        c.setFont(F["Texto-Semi"], 6.5)
        c.drawString(x, y + 4, "DESGLOSE POR CATEGORÍA")
        y -= 15
        for cat in calc["categorias"]:
            c.setFillColor(TEXTO)
            c.setFont(F["Texto"], 7)
            c.drawString(x, y, cat["nombre"][:22])
            bx, bw = x + 84, ancho - 120
            c.setFillColor(NEGRO_700)
            c.roundRect(bx, y - 1, bw, 7, 3.5, stroke=0, fill=1)
            pct = max(0.0, min(100.0, cat["porcentaje"])) / 100
            if pct:
                c.setFillColor(AZUL if pct >= 0.5 else AZUL_OSCURO)
                c.roundRect(bx, y - 1, max(7, bw * pct), 7, 3.5, stroke=0, fill=1)
            c.setFillColor(TEXTO)
            c.setFont(F["Texto-Bold"], 7)
            c.drawRightString(bx + bw + 32, y, f"{numero(float(cat['puntaje']))}/{cat['maximo']}")
            y -= 15

        # Preparación (0-100 por componente).
        px = x + ancho + 20
        pw = self.width - px - 16
        prep = calc["preparacion"]
        y = self.height - 22
        c.setFillColor(SUAVE)
        c.setFont(F["Texto-Semi"], 6.5)
        c.drawString(px, y + 4, "PREPARACIÓN")
        y -= 15
        for clave, rotulo in (
            ("tecnica", "Técnica"), ("fisica", "Física"), ("defensa", "Defensa"),
            ("tactica", "Táctica"), ("disciplina", "Disciplina"),
        ):
            valor = prep.get(clave, 0) or 0
            c.setFillColor(TEXTO)
            c.setFont(F["Texto"], 7)
            c.drawString(px, y, rotulo)
            c.setFillColor(AZUL_CLARO)
            c.setFont(F["Texto-Bold"], 7)
            c.drawRightString(px + pw, y, f"{valor}")
            c.setFillColor(NEGRO_700)
            c.rect(px, y - 4, pw, 1.6, stroke=0, fill=1)
            c.setFillColor(AZUL)
            c.rect(px, y - 4, pw * valor / 100, 1.6, stroke=0, fill=1)
            y -= 15
        c.setFillColor(TEXTO)
        c.setFont(F["Titulo"], 11)
        c.drawString(px, y - 2, f"TOTAL {prep.get('total', 0)}")


def _pastilla_centrada(c, cx, y, texto):
    ancho = pdfmetrics.stringWidth(texto, F["Texto-Bold"], 6.5) + 12
    _pastilla(c, cx - ancho / 2, y, texto, AZUL, tam=6.5, alto=13)


# Nombres cortos para que quepan bajo cada casilla de la escala.
ABREVIATURAS = {"semipesado": "semip.", "superpesado": "súper"}


class EscalaPeso(Flowable):
    """División de MMA del peleador + escala con todas las divisiones."""

    def __init__(self, peso):
        super().__init__()
        self.peso = peso
        self.width = ANCHO_UTIL
        self.height = 92

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c, peso = self.canv, self.peso
        cat = peso["categoria"]
        c.setFillColor(NEGRO_800)
        c.setStrokeColor(BORDE)
        c.setLineWidth(0.6)
        c.roundRect(0, 0, self.width, self.height, 8, stroke=1, fill=1)

        # Bloque izquierdo: la división.
        x = 16
        c.setFillColor(SUAVE)
        c.setFont(F["Texto-Semi"], 6.5)
        c.drawString(x, self.height - 20, "DIVISIÓN")
        c.setFillColor(AZUL)
        c.setFont(F["Titulo"], 21)
        c.drawString(x, self.height - 43, cat["nombre"].upper())
        c.setFillColor(SUAVE)
        c.setFont(F["Texto"], 7.2)
        c.drawString(x, self.height - 55, f"{cat['nombre_en']} · {cat['rango']}")
        c.setFillColor(TEXTO)
        c.setFont(F["Texto-Bold"], 8)
        c.drawString(x, 24, f"{peso['referencia_kg']}  ·  {peso['referencia_lb']}")
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 6.3)
        c.drawString(x, 13, f"Con {peso['fuente']} · {cat['margen']}")

        # Escala de divisiones.
        divisiones = peso["divisiones"]
        ex = self.width * 0.45
        ancho = self.width - ex - 14
        paso = ancho / len(divisiones)
        y = 34
        c.setFillColor(TENUE)
        c.setFont(F["Texto-Semi"], 5.8)
        c.drawString(ex + 1, self.height - 20, "LÍMITE POR DIVISIÓN (LB)")
        for i, div in enumerate(divisiones):
            sx = ex + i * paso
            actual = div["actual"]
            if actual:
                c.setFillColor(_con_alfa(AZUL, 0.25))
                c.roundRect(sx - 1, y - 2, paso + 2, 22, 4, stroke=0, fill=1)
                c.setFillColor(AZUL_CLARO)
                punta = c.beginPath()
                punta.moveTo(sx + paso / 2 - 4, y + 29)
                punta.lineTo(sx + paso / 2 + 4, y + 29)
                punta.lineTo(sx + paso / 2, y + 23)
                punta.close()
                c.drawPath(punta, stroke=0, fill=1)
            c.setFillColor(AZUL if actual else NEGRO_700)
            c.roundRect(sx + 1, y, paso - 2, 18, 3, stroke=0, fill=1)
            c.setFillColor(BLANCO if actual else SUAVE)
            c.setFont(F["Texto-Bold"] if actual else F["Texto"], 6)
            c.drawCentredString(sx + paso / 2, y + 6.5, div["limite"].replace(" lb", ""))
            nombre = ABREVIATURAS.get(div["nombre"], div["nombre"]).upper()
            c.setFillColor(TEXTO if actual else TENUE)
            c.setFont(F["Texto-Semi"], 4.8)
            c.drawCentredString(sx + paso / 2, y - 10, nombre)


class RejillaInsignias(Flowable):
    """Insignias ganadas en tarjetas de 4 por fila (icono o medalla genérica)."""

    COLUMNAS = 4
    ALTO = 64
    HUECO = 8

    def __init__(self, insignias):
        super().__init__()
        self.insignias = insignias  # [(nombre, fecha, ImageReader|None)]
        filas = (len(insignias) + self.COLUMNAS - 1) // self.COLUMNAS
        self.width = ANCHO_UTIL
        self.height = filas * self.ALTO + max(0, filas - 1) * self.HUECO

    def wrap(self, *_):
        return self.width, self.height

    def split(self, ancho_disp, alto_disp):
        # Se parte por filas para no dejar hojas en blanco con muchas insignias.
        filas_caben = int((alto_disp + self.HUECO) // (self.ALTO + self.HUECO))
        if filas_caben < 1 or filas_caben * self.COLUMNAS >= len(self.insignias):
            return []
        corte = filas_caben * self.COLUMNAS
        return [RejillaInsignias(self.insignias[:corte]), RejillaInsignias(self.insignias[corte:])]

    def draw(self):
        c = self.canv
        ancho = (self.width - (self.COLUMNAS - 1) * self.HUECO) / self.COLUMNAS
        for i, (nombre, fecha, icono) in enumerate(self.insignias):
            fila, col = divmod(i, self.COLUMNAS)
            x = col * (ancho + self.HUECO)
            y = self.height - (fila + 1) * self.ALTO - fila * self.HUECO
            c.setFillColor(NEGRO_800)
            c.setStrokeColor(BORDE)
            c.setLineWidth(0.6)
            c.roundRect(x, y, ancho, self.ALTO, 8, stroke=1, fill=1)

            ix, iy, lado = x + 10, y + (self.ALTO - 40) / 2, 40
            c.setFillColor(_con_alfa(AZUL, 0.15))
            c.circle(ix + lado / 2, iy + lado / 2, lado / 2 + 3, stroke=0, fill=1)
            if icono:
                c.saveState()
                c.setFillAlpha(1)  # el halo dejó la opacidad en 0.15
                circulo = c.beginPath()
                circulo.circle(ix + lado / 2, iy + lado / 2, lado / 2)
                c.clipPath(circulo, stroke=0, fill=0)
                c.drawImage(icono, ix, iy, lado, lado, mask="auto")
                c.restoreState()
            else:
                c.setFillColor(AZUL)
                c.circle(ix + lado / 2, iy + lado / 2, lado / 2, stroke=0, fill=1)
                _estrella(c, ix + lado / 2, iy + lado / 2, 12, BLANCO)
            c.setStrokeColor(AZUL)
            c.setLineWidth(1)
            c.circle(ix + lado / 2, iy + lado / 2, lado / 2, stroke=1, fill=0)

            tx = ix + lado + 9
            tw = ancho - (tx - x) - 8
            lineas = simpleSplit(nombre.upper(), F["Titulo-Medio"], 8.5, tw)[:2]
            ty = y + self.ALTO / 2 + (5 if len(lineas) > 1 else 1)
            c.setFillColor(TEXTO)
            c.setFont(F["Titulo-Medio"], 8.5)
            for linea in lineas:
                c.drawString(tx, ty, linea)
                ty -= 10
            c.setFillColor(TENUE)
            c.setFont(F["Texto"], 6.3)
            c.drawString(tx, ty - 1, fecha)


# --- Tablas -----------------------------------------------------------------------------

def _tabla(encabezados, filas, anchos, estilos_extra=()):
    """Tabla oscura con encabezado Oswald azul y filas alternadas."""
    cab = _estilo("cab", "Titulo-Medio", 7.5, AZUL_CLARO)
    celda = _estilo("celda", "Texto", 7.8, TEXTO)
    datos = [[Paragraph(_esc(h).upper(), cab) for h in encabezados]]
    for fila in filas:
        datos.append([v if isinstance(v, Flowable) else Paragraph(_esc(v), celda) for v in fila])
    tabla = Table(datos, colWidths=anchos, repeatRows=1)
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), NEGRO_900),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, AZUL),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [NEGRO_800, NEGRO_700]),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        *estilos_extra,
    ]
    tabla.setStyle(TableStyle(estilo))
    return tabla


class Chip(Flowable):
    """Pastilla de color dentro de una celda de tabla."""

    def __init__(self, texto, color, color_texto=BLANCO):
        super().__init__()
        self.texto = texto.upper()
        self.color = color
        self.color_texto = color_texto
        self.width = pdfmetrics.stringWidth(self.texto, F["Texto-Bold"], 6.5) + 12
        self.height = 13

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        _pastilla(self.canv, 0, 0, self.texto, self.color, self.color_texto, tam=6.5, alto=13)


def _vacio(texto):
    return Table(
        [[Paragraph(_esc(texto), _estilo("vacio", "Texto", 8, TENUE))]],
        colWidths=[ANCHO_UTIL],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NEGRO_800),
            ("BOX", (0, 0), (-1, -1), 0.6, BORDE),
            ("TOPPADDING", (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ]),
    )


def _seccion(titulo, contenido, detalle=""):
    """Título + primer bloque juntos: un título nunca queda huérfano al pie de la hoja."""
    primero, *resto = contenido if isinstance(contenido, list) else [contenido]
    return [KeepTogether([Titulo(titulo, detalle), Spacer(1, 6), primero]), *resto, Spacer(1, 12)]


# --- Armado ------------------------------------------------------------------------------

def generar_ficha_pdf(alumno: Alumno) -> bytes:
    _registrar_fuentes()
    d = datos_ficha(alumno)

    def chip_resultado(clave, rotulo):
        colores = {**COLOR_RESULTADO, "PROXIMO": AZUL, "ASISTIO": AZUL_OSCURO, "NO_ASISTIO": NEGRO_900}
        return Chip(rotulo, colores.get(clave, SUAVE), NEGRO if clave == Torneo.Resultado.EMPATO else BLANCO)

    cint = d["cinturon"]
    color_cint = COLOR_CINTURON.get(cint["clave"], SUAVE) if cint else None
    r = d["record"]
    portada = Portada({
        "foto": _imagen_cuadrada(alumno.foto),
        "qr": _imagen_cuadrada(alumno.qr_imagen, 300),
        "iniciales": d["iniciales"],
        "nombre": d["nombre"],
        "apodo": d["apodo"],
        "activo": d["activo"],
        "disciplinas": d["disciplinas"],
        "cinturon": (cint["nombre"], color_cint) if cint else None,
        "record": (r["g"], r["p"], r["e"]),
        "efectividad": d["efectividad"],
        "miembro_desde": d["miembro_desde"],
        "horario": d["horario"],
    })

    peso, est = d["peso"], d["estadisticas"]

    def en_libras(valor):
        return {"sub": valor} if valor != "—" else {}

    mosaicos = Mosaicos([
        ("Peso actual", peso["actual_kg"], en_libras(peso["actual_lb"])),
        ("Peso de competencia", peso["competencia_kg"], en_libras(peso["competencia_lb"])),
        ("Estatura", est["estatura"]),
        ("Edad", est["edad"]),
        ("Cinturón BJJ", cint["nombre"] if cint else "—", {"muestra": color_cint}),
        ("Puntos RageCore", est["puntos"]),
        ("Asistencias totales", str(est["asistencias_total"])),
        ("Asistencias este mes", str(est["asistencias_mes"])),
        ("Racha actual", est["racha"]),
        ("Racha máxima", est["racha_maxima"], {"acento": AZUL_CLARO}),
        ("Torneos disputados", str(est["torneos"])),
        ("Sparrings", str(est["sparrings"])),
    ])

    historia = []
    historia += _seccion("Perfil físico y estadísticas", mosaicos)
    if peso["categoria"]:
        historia += _seccion("Categoría de peso MMA", EscalaPeso(peso), peso["categoria"]["organismo"])
    else:
        historia += _seccion(
            "Categoría de peso MMA",
            _vacio("Captura el peso actual o de competencia para calcular su división de MMA."),
        )
    historia += _seccion(
        "Récord de combate",
        BarraRecord(r["g"], r["p"], r["e"], dict(d["metodos"]), d["favorito"]),
        f"{r['total']} peleas",
    )

    if d["evaluacion"]:
        ev = d["evaluacion"]
        historia += _seccion(
            "Evaluación técnica MMA",
            BarrasEvaluacion(ev["calculo"], ev["fecha"], ev["total_evaluaciones"]),
            "Última evaluación finalizada",
        )

    if d["torneos"]:
        bloque = _tabla(
            ["Fecha", "Torneo / evento", "Disciplina", "Método", "Resultado"],
            [
                [t["fecha"], t["nombre"], t["disciplina"], t["metodo"],
                 chip_resultado(t["resultado"], t["resultado_display"])]
                for t in d["torneos"]
            ],
            [62, ANCHO_UTIL - 62 - 92 - 88 - 72, 92, 88, 72],
        )
    else:
        bloque = _vacio("Todavía no hay combates registrados en torneos.")
    historia += _seccion(
        "Historial de combate", bloque,
        f"{d['torneos_ganados']} ganados · {d['torneos_perdidos']} perdidos",
    )

    if d["eventos"]:
        bloque = _tabla(
            ["Fecha", "Evento", "Tipo", "Lugar", "Resultado"],
            [
                [e["fecha"], e["titulo"], e["tipo"], e["lugar"], chip_resultado(e["estado"], e["estado_display"])]
                for e in d["eventos"]
            ],
            [62, ANCHO_UTIL - 62 - 86 - 110 - 78, 86, 110, 78],
        )
    else:
        bloque = _vacio("Sin inscripciones a eventos.")
    historia += _seccion("Eventos", bloque, f"{len(d['eventos'])} inscripciones")

    if d["grados"]:
        historia += _seccion(
            "Grados y cinturones",
            _tabla(
                ["Fecha", "Disciplina", "Grado", "Otorgado por"],
                [[g["fecha"], g["disciplina"], g["grado"], g["otorgado_por"]] for g in d["grados"]],
                [62, 130, ANCHO_UTIL - 62 - 130 - 140, 140],
            ),
        )

    if d["insignias"]:
        rejilla = RejillaInsignias([
            (i["nombre"], i["fecha"], _imagen_cuadrada(i["icono"], 200)) for i in d["insignias"]
        ])
        historia += _seccion("Insignias", rejilla, f"{len(d['insignias'])} desbloqueadas")
    else:
        historia += _seccion("Insignias", _vacio("Aún no desbloquea insignias. ¡A entrenar!"))

    notas = []
    if d["lesion"]:
        notas.append([
            Chip("Lesión activa", ROJO),
            Paragraph(_esc(d["lesion"]), _estilo("les", "Texto", 8, TEXTO)),
        ])
    if d["notas"]:
        notas.append([
            Chip("Notas del coach", AZUL),
            Paragraph(_esc(d["notas"]).replace("\n", "<br/>"), _estilo("not", "Texto", 8, TEXTO)),
        ])
    if notas:
        historia += _seccion(
            "Salud y observaciones",
            Table(notas, colWidths=[96, ANCHO_UTIL - 96], style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), NEGRO_800),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDE),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, BORDE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ])),
        )

    buffer = BytesIO()
    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGEN, rightMargin=MARGEN, topMargin=80, bottomMargin=46,
        title=f"Ficha técnica · {d['nombre']}",
        author="RageCore · Academia de combate",
        subject="Ficha técnica del peleador",
    )
    marco = Frame(MARGEN, 46, ANCHO_UTIL, ALTO_PAGINA - 80 - 46, id="cuerpo",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="ficha", frames=[marco], onPage=_dibujar_fondo(alumno, d["generada"]))])
    # Sin el espaciador final: si cae justo al pie, abre una hoja en blanco.
    doc.build([portada, Spacer(1, 14), *historia[:-1]], canvasmaker=_LienzoNumerado)
    return buffer.getvalue()
