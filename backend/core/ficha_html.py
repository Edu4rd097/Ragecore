"""
Ficha técnica del peleador en HTML (GET /api/alumnos/{id}/ficha/).

Misma información que el PDF (ambos leen core.ficha.datos_ficha) con el
mismo diseño, pero como página: la app la muestra dentro de un iframe y se
puede imprimir. Es un documento AUTOCONTENIDO —fuentes, foto, QR e iconos
van incrustados como data URI— porque el frontend lo pide con el token por
HttpClient y lo pinta con srcdoc: ahí no hay origen desde el cual resolver
rutas relativas como /media/...
"""
from __future__ import annotations

import base64
import logging
import math
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from django.template.loader import render_to_string
from PIL import Image, ImageOps

from .ficha import datos_ficha, numero

logger = logging.getLogger(__name__)

DIR_FUENTES = Path(__file__).resolve().parent / "fuentes"
FUENTES = [
    ("Oswald", 500, "oswald-500.ttf"),
    ("Oswald", 700, "oswald-700.ttf"),
    ("Inter", 400, "inter-400.ttf"),
    ("Inter", 600, "inter-600.ttf"),
    ("Inter", 700, "inter-700.ttf"),
]

COLOR_CINTURON = {
    "BLANCO": "#f4f4f5",
    "AZUL": "#1d4ed8",
    "PURPURA": "#7e22ce",
    "MARRON": "#7c3f12",
    "NEGRO": "#050505",
}


@lru_cache(maxsize=1)
def _css_fuentes() -> str:
    """@font-face con las TTF incrustadas. Se arma una vez por proceso."""
    reglas = []
    for familia, peso, archivo in FUENTES:
        ruta = DIR_FUENTES / archivo
        if not ruta.exists():
            continue  # sin la fuente, el CSS cae a la genérica
        datos = base64.b64encode(ruta.read_bytes()).decode()
        reglas.append(
            f"@font-face{{font-family:'{familia}';font-weight:{peso};font-style:normal;"
            f"font-display:swap;src:url(data:font/ttf;base64,{datos}) format('truetype');}}"
        )
    return "\n".join(reglas)


def _data_uri(campo, lado_px) -> str | None:
    """Imagen recortada en cuadrado y comprimida, lista para <img src>."""
    if not campo:
        return None
    try:
        with campo.open("rb") as f:
            img = ImageOps.exif_transpose(Image.open(f))
            con_alfa = img.mode in ("RGBA", "LA", "P")
            img = img.convert("RGBA" if con_alfa else "RGB")
            img = ImageOps.fit(img, (lado_px, lado_px), Image.LANCZOS)
            buffer = BytesIO()
            if con_alfa:  # iconos con transparencia
                img.save(buffer, format="PNG", optimize=True)
                tipo = "png"
            else:
                img.save(buffer, format="JPEG", quality=86)
                tipo = "jpeg"
        return f"data:image/{tipo};base64,{base64.b64encode(buffer.getvalue()).decode()}"
    except Exception:
        logger.warning("No se pudo incrustar la imagen %s en la ficha.", getattr(campo, "name", campo))
        return None


def _medidor(fraccion: float, radio=42, apertura=240) -> dict:
    """Longitudes de trazo para el medidor en arco (SVG stroke-dasharray)."""
    circunferencia = 2 * math.pi * radio
    arco = circunferencia * apertura / 360
    return {
        "radio": radio,
        "circunferencia": round(circunferencia, 2),
        "arco": round(arco, 2),
        "lleno": round(arco * max(0.0, min(1.0, fraccion)), 2),
        # Arranca abajo a la izquierda: 90° + la mitad de lo que queda abierto.
        "giro": 90 + (360 - apertura) / 2,
    }


def generar_ficha_html(alumno) -> str:
    d = datos_ficha(alumno)

    if d["evaluacion"]:
        calc = d["evaluacion"]["calculo"]
        maximo = calc["puntaje_maximo"] or 100
        d["evaluacion"]["medidor"] = _medidor(calc["puntaje_total"] / maximo)
        d["evaluacion"]["total_txt"] = numero(calc["puntaje_total"])
        for cat in calc["categorias"]:  # 16.0 -> "16", como en el PDF
            cat["puntaje_txt"] = numero(cat["puntaje"])

    for insignia in d["insignias"]:
        insignia["icono_uri"] = _data_uri(insignia["icono"], 160)

    contexto = {
        **d,
        "css_fuentes": _css_fuentes(),
        "foto_uri": _data_uri(alumno.foto, 520),
        "qr_uri": _data_uri(alumno.qr_imagen, 260),
        "cinturon_color": COLOR_CINTURON.get(d["cinturon"]["clave"]) if d["cinturon"] else None,
        "cinturon_claro": bool(d["cinturon"]) and d["cinturon"]["clave"] == "BLANCO",
        "cinturon_negro": bool(d["cinturon"]) and d["cinturon"]["clave"] == "NEGRO",
    }
    return render_to_string("fichas/ficha.html", contexto)
