"""
Comprobante de pago de membresía: datos compartidos y PDF.

Las tres salidas leen de datos_comprobante() para no contradecirse:
  - correo y vista web: templates/correos/comprobante.html
  - PDF (adjunto del correo y descarga): generar_comprobante_pdf(), con
    ReportLab y el diseño de la academia (mismas piezas que la ficha).

El total es el MONTO COBRADO en ese pago. Si es menor al precio de la
membresía (un abono) se muestra el saldo; el precio de lista va aparte.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.utils import timezone
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A5
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as rl_canvas

from .ficha_pdf import (
    AMARILLO, AZUL, AZUL_CLARO, BLANCO, BORDE, F, NEGRO, NEGRO_800, NEGRO_900,
    SUAVE, TENUE, TEXTO, _con_alfa, _logo, _pastilla, _registrar_fuentes,
)


def pesos(valor) -> str:
    """Decimal("2100") -> "$2,100.00"."""
    return f"${Decimal(str(valor or 0)):,.2f}"


def _fecha(valor) -> str:
    return valor.strftime("%d/%m/%Y") if valor else "—"


ESTILO_ESTATUS = {  # clave -> (fondo, texto) para el chip
    "PAGADO": ("#16a34a", "#ffffff"),
    "VENCIDO": ("#dc2626", "#ffffff"),
    "PENDIENTE": ("#eab308", "#0a0a0b"),
}


def datos_comprobante(pago) -> dict:
    alumno, membresia = pago.alumno, pago.membresia
    monto = Decimal(str(pago.monto or 0))
    precio = Decimal(str(membresia.precio)) if membresia and membresia.precio is not None else None
    saldo = precio - monto if precio is not None and monto < precio else None

    cubre_desde = None
    if pago.fecha_vencimiento and pago.duracion:
        cubre_desde = pago.fecha_vencimiento - timedelta(days=pago.duracion)

    en_linea = getattr(pago, "stripe", None)  # PagoStripe que lo originó, si fue en línea
    fondo, texto = ESTILO_ESTATUS.get(pago.estatus, ESTILO_ESTATUS["PENDIENTE"])

    return {
        "pago": pago,
        "alumno": alumno,
        "folio": f"{pago.id:06d}",
        "estatus": pago.estatus,
        "estatus_display": pago.get_estatus_display(),
        "estatus_fondo": fondo,
        "estatus_texto": texto,
        "nombre": alumno.nombre_completo,
        "apodo": alumno.apodo,
        "codigo": alumno.codigo_qr,
        "membresia": membresia.nombre if membresia else "Membresía",
        "precio": pesos(precio) if precio is not None else None,
        "total": pesos(monto),
        "saldo": pesos(saldo) if saldo else None,
        "metodo": pago.get_metodo_display(),
        "fecha_pago": _fecha(pago.fecha_pago),
        "duracion": f"{pago.duracion} días" if pago.duracion else None,
        "cubre_desde": _fecha(cubre_desde) if cubre_desde else None,
        "vence": _fecha(pago.fecha_vencimiento) if pago.fecha_vencimiento else None,
        # Encadenado: el periodo arranca después de la fecha de pago porque se
        # sumó a días que el alumno aún tenía (ver Pago.inicio_de_cobertura).
        "acumulado": bool(cubre_desde and cubre_desde > pago.fecha_pago),
        "referencia": str(en_linea.referencia).upper()[:18] if en_linea else None,
        "nota": pago.nota,
        "emitido": timezone.localtime(),
    }


# --- PDF --------------------------------------------------------------------------

ANCHO, ALTO = A5
M = 28  # margen


def _fila(c, y, etiqueta, valor, fuerte=False, color=TEXTO):
    c.setFillColor(SUAVE)
    c.setFont(F["Texto"], 8.5)
    c.drawString(M + 16, y, etiqueta)
    c.setFillColor(color)
    c.setFont(F["Texto-Bold"] if fuerte else F["Texto-Semi"], 8.8)
    c.drawRightString(ANCHO - M - 16, y, valor)
    c.setStrokeColor(BORDE)
    c.setLineWidth(0.5)
    c.line(M + 16, y - 8, ANCHO - M - 16, y - 8)


def generar_comprobante_pdf(pago) -> bytes:
    _registrar_fuentes()
    d = datos_comprobante(pago)
    buffer = BytesIO()
    c = rl_canvas.Canvas(buffer, pagesize=A5)
    c.setTitle(f"Comprobante #{d['folio']} · RageCore")
    c.setAuthor("RageCore · Academia de combate")

    # Fondo, textura y acentos (como la ficha).
    c.setFillColor(NEGRO)
    c.rect(0, 0, ANCHO, ALTO, stroke=0, fill=1)
    c.setStrokeColor(_con_alfa(BLANCO, 0.018))
    c.setLineWidth(0.6)
    for i in range(-int(ALTO), int(ANCHO), 14):
        c.line(i, 0, i + ALTO, ALTO)
    banda = c.beginPath()
    banda.moveTo(ANCHO - 130, ALTO)
    banda.lineTo(ANCHO - 92, ALTO)
    banda.lineTo(ANCHO, ALTO - 92)
    banda.lineTo(ANCHO, ALTO - 130)
    banda.close()
    c.setFillColor(_con_alfa(AZUL, 0.16))
    c.drawPath(banda, stroke=0, fill=1)
    c.setFillColor(AZUL)
    c.rect(0, ALTO - 4, ANCHO, 4, stroke=0, fill=1)

    # Encabezado.
    _logo(c, M, ALTO - 58, 30)
    c.setFillColor(TEXTO)
    c.setFont(F["Titulo"], 13)
    c.drawString(M + 38, ALTO - 40, "RAGECORE")
    c.setFillColor(SUAVE)
    c.setFont(F["Texto"], 6.5)
    c.drawString(M + 38, ALTO - 50, "ACADEMIA DE COMBATE")
    c.setFillColor(AZUL_CLARO)
    c.setFont(F["Titulo-Medio"], 9)
    c.drawRightString(ANCHO - M, ALTO - 38, "COMPROBANTE DE PAGO")
    c.setFillColor(TENUE)
    c.setFont(F["Texto"], 7)
    c.drawRightString(ANCHO - M, ALTO - 50, f"Folio #{d['folio']}")

    # Tarjeta principal.
    top = ALTO - 76
    alto_tarjeta = top - 70
    c.setFillColor(NEGRO_800)
    c.setStrokeColor(BORDE)
    c.setLineWidth(0.8)
    c.roundRect(M, 70, ANCHO - 2 * M, alto_tarjeta, 10, stroke=1, fill=1)
    c.setFillColor(AZUL)
    c.rect(M, 80, 3, alto_tarjeta - 20, stroke=0, fill=1)

    # Total, grande.
    y = top - 26
    c.setFillColor(SUAVE)
    c.setFont(F["Texto-Semi"], 7)
    c.drawString(M + 16, y, "TOTAL PAGADO")
    fondo, texto = HexColor(d["estatus_fondo"]), HexColor(d["estatus_texto"])
    ancho_chip = pdfmetrics.stringWidth(d["estatus_display"].upper(), F["Texto-Bold"], 7) + 12
    _pastilla(c, ANCHO - M - 16 - ancho_chip, y - 3, d["estatus_display"].upper(), fondo, texto, tam=7, alto=14)
    y -= 36
    c.setFillColor(AZUL)
    c.setFont(F["Titulo"], 34)
    c.drawString(M + 16, y, d["total"])
    c.setFillColor(SUAVE)
    c.setFont(F["Texto-Semi"], 8)
    c.drawString(M + 18 + pdfmetrics.stringWidth(d["total"], F["Titulo"], 34), y + 2, "MXN")
    y -= 16
    c.setFillColor(TENUE)
    c.setFont(F["Texto"], 7.5)
    c.drawString(M + 16, y, f"{d['membresia']} · {d['metodo']} · {d['fecha_pago']}")

    # Alumno.
    y -= 24
    c.setFillColor(NEGRO_900)
    c.setStrokeColor(BORDE)
    c.roundRect(M + 12, y - 30, ANCHO - 2 * M - 24, 40, 7, stroke=1, fill=1)
    c.setFillColor(SUAVE)
    c.setFont(F["Texto-Semi"], 6.5)
    c.drawString(M + 24, y - 2, "PELEADOR")
    c.setFillColor(TEXTO)
    c.setFont(F["Titulo"], 12)
    nombre = d["nombre"].upper()
    while pdfmetrics.stringWidth(nombre, F["Titulo"], 12) > ANCHO - 2 * M - 150 and len(nombre) > 10:
        nombre = nombre[:-2]
    c.drawString(M + 24, y - 18, nombre)
    if d["apodo"]:
        c.setFillColor(AZUL)
        c.setFont(F["Titulo-Medio"], 9)
        c.drawRightString(ANCHO - M - 24, y - 17, f"“{d['apodo'].upper()}”")
    c.setFillColor(TENUE)
    c.setFont(F["Texto"], 6)
    c.drawRightString(ANCHO - M - 24, y - 2, d["codigo"])

    # Detalle.
    y -= 58
    filas = [("Concepto", "Pago de membresía"), ("Membresía", d["membresia"])]
    if d["precio"]:
        filas.append(("Precio de la membresía", d["precio"]))
    filas.append(("Método de pago", d["metodo"]))
    filas.append(("Fecha de pago", d["fecha_pago"]))
    if d["duracion"]:
        filas.append(("Días cubiertos", d["duracion"]))
    if d["cubre_desde"]:
        filas.append(("Periodo", f"{d['cubre_desde']} al {d['vence']}"))
    elif d["vence"]:
        filas.append(("Vigente hasta", d["vence"]))
    if d["referencia"]:
        filas.append(("Referencia en línea", d["referencia"]))
    for etiqueta, valor in filas:
        _fila(c, y, etiqueta, valor)
        y -= 21

    if d["acumulado"]:
        c.setFillColor(AZUL_CLARO)
        c.setFont(F["Texto"], 7)
        c.drawString(M + 16, y + 4, "Estos días se sumaron a los que ya tenías vigentes.")
        y -= 14

    # Totales: el recuadro crece hacia abajo si hay saldo pendiente.
    alto_caja = 48 if d["saldo"] else 30
    base = y - alto_caja + 4
    c.setFillColor(_con_alfa(AZUL, 0.12))
    c.roundRect(M + 12, base, ANCHO - 2 * M - 24, alto_caja, 6, stroke=0, fill=1)
    c.setFillColor(TEXTO)
    c.setFont(F["Titulo"], 12)
    c.drawString(M + 24, base + 10, "TOTAL")
    c.setFillColor(AZUL_CLARO)
    c.drawRightString(ANCHO - M - 24, base + 10, d["total"])
    if d["saldo"]:
        c.setFillColor(AMARILLO)
        c.setFont(F["Texto-Semi"], 8)
        c.drawString(M + 24, base + 31, "Saldo pendiente de la membresía")
        c.drawRightString(ANCHO - M - 24, base + 31, d["saldo"])
    y = base - 18

    if d["nota"]:
        c.setFillColor(TENUE)
        c.setFont(F["Texto"], 7)
        for linea in simpleSplit(f"Nota: {d['nota']}", F["Texto"], 7, ANCHO - 2 * M - 32)[:3]:
            c.drawString(M + 16, y, linea)
            y -= 10

    # Pie.
    c.setStrokeColor(BORDE)
    c.setLineWidth(0.6)
    c.line(M, 50, ANCHO - M, 50)
    c.setFillColor(SUAVE)
    c.setFont(F["Texto-Semi"], 7)
    c.drawString(M, 38, "RAGECORE · Academia de combate")
    c.setFillColor(TENUE)
    c.setFont(F["Texto"], 6.5)
    c.drawRightString(ANCHO - M, 38, f"Emitido el {d['emitido']:%d/%m/%Y %H:%M}")
    c.drawString(M, 27, "Comprobante informativo de pago de membresía. Consérvalo para cualquier aclaración.")

    c.showPage()
    c.save()
    return buffer.getvalue()


def nombre_archivo(pago) -> str:
    return f"comprobante-{pago.id:06d}.pdf"

