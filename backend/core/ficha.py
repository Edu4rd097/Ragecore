"""
Datos de la ficha técnica del peleador, en estructuras planas.

Una sola fuente para las dos salidas —la plantilla HTML
(templates/fichas/ficha.html) y el PDF (core/ficha_pdf.py)— para que nunca
muestren cosas distintas. Aquí no hay nada de presentación: ni colores ni
tipografía, solo qué se muestra y cómo se calcula.
"""
from __future__ import annotations

import unicodedata
from collections import Counter
from decimal import Decimal

from django.utils import timezone

from .evaluacion_mma import cargar_categorias, calcular_evaluacion, evaluaciones_finalizadas
from .models import LIBRAS_POR_KG, Alumno, CategoriaPeso, Torneo

METODOS_VICTORIA = ("KO/TKO", "Sumisión", "Decisión")


def fecha(valor) -> str:
    return valor.strftime("%d/%m/%Y") if valor else "—"


def numero(valor, sufijo="") -> str:
    """72.50 -> "72.5", 64.98 -> "64.98", 64 -> "64"; None -> "—"."""
    if valor is None or valor == "":
        return "—"
    texto = f"{Decimal(str(valor)):.2f}".rstrip("0").rstrip(".")
    return f"{texto}{sufijo}"


def a_libras(kg) -> Decimal | None:
    if kg in (None, ""):
        return None
    return (Decimal(str(kg)) * LIBRAS_POR_KG).quantize(Decimal("0.1"))


def clases(n) -> str:
    return f"{n} clase" if n == 1 else f"{n} clases"


def _peso(alumno, exp) -> dict:
    """
    Peso en kg y lb, y su división de MMA. La categoría se calcula con el
    peso de competencia (con el que pelea); si no se capturó, con el actual.
    """
    actual = alumno.peso_actual
    competencia = exp.peso_competencia if exp else None
    referencia = competencia or actual
    categoria, anterior = CategoriaPeso.para_peso(referencia)

    info = {
        "actual_kg": numero(actual, " kg"),
        "actual_lb": numero(a_libras(actual), " lb"),
        "competencia_kg": numero(competencia, " kg"),
        "competencia_lb": numero(a_libras(competencia), " lb"),
        "referencia_kg": numero(referencia, " kg"),
        "referencia_lb": numero(a_libras(referencia), " lb"),
        "fuente": "peso de competencia" if competencia else "peso actual",
        "categoria": None,
        "divisiones": [],
    }
    if categoria is None:
        return info

    if categoria.limite_lb is None:
        rango = f"Más de {numero(anterior.limite_kg)} kg / {numero(anterior.limite_lb)} lb" if anterior else "Sin límite"
        margen = "División sin límite superior"
    else:
        kg, lb = numero(categoria.limite_kg), numero(categoria.limite_lb)
        if anterior:
            rango = f"{numero(anterior.limite_kg)}–{kg} kg · {numero(anterior.limite_lb)}–{lb} lb"
        else:
            rango = f"Hasta {kg} kg · {lb} lb"
        holgura = categoria.limite_kg - Decimal(str(referencia))
        if holgura <= 0:
            margen = "Justo en el límite de la división"
        else:
            margen = (
                f"A {numero(holgura)} kg ({numero(a_libras(holgura))} lb) del límite de la división"
            )

    info["categoria"] = {
        "nombre": categoria.nombre,
        "nombre_en": categoria.nombre_en,
        "organismo": categoria.organismo,
        "rango": rango,
        "margen": margen,
    }
    # Escala completa para dibujar dónde cae el peleador.
    info["divisiones"] = [
        {
            "nombre": c.nombre.replace("Peso ", ""),
            "limite": f"{numero(c.limite_lb)} lb" if c.limite_lb else "+",
            "actual": c.id == categoria.id,
        }
        for c in CategoriaPeso.objects.filter(activa=True)
    ]
    return info


def _estado_evento(inscripcion, resultado, hoy) -> tuple[str, str]:
    """(clave, rótulo) del chip de un evento."""
    if resultado:
        return resultado.resultado, resultado.get_resultado_display()
    if inscripcion.evento.fecha > hoy:
        return "PROXIMO", "Próximo"
    return ("ASISTIO", "Asistió") if inscripcion.asistio else ("NO_ASISTIO", "No asistió")


def datos_ficha(alumno: Alumno) -> dict:
    ahora = timezone.localtime()
    hoy = ahora.date()
    exp = getattr(alumno, "experiencia", None)

    torneos = list(alumno.torneos.select_related("disciplina", "evento").order_by("-fecha", "-id"))
    inscripciones = list(
        alumno.inscripciones_eventos.select_related("evento").order_by("-evento__fecha")
    )
    grados = list(alumno.grados.select_related("disciplina", "otorgado_por").order_by("-fecha_obtencion"))
    insignias = list(alumno.insignias_ganadas.select_related("insignia").order_by("-fecha_obtencion"))

    g = exp.peleas_ganadas if exp else 0
    p = exp.peleas_perdidas if exp else 0
    e = exp.peleas_empatadas if exp else 0
    total = g + p + e

    horario = ""
    if alumno.horario:
        horario = alumno.horario.nombre or (
            f"{alumno.horario.hora_inicio:%H:%M}–{alumno.horario.hora_fin:%H:%M}"
        )

    evaluacion = None
    finalizadas = list(evaluaciones_finalizadas(alumno))
    if finalizadas:
        ultima = finalizadas[-1]
        calculo = calcular_evaluacion(ultima, cargar_categorias())
        evaluacion = {
            "calculo": calculo,
            "fecha": fecha(ultima.fecha),
            "total_evaluaciones": len(finalizadas),
            "porcentaje_total": (
                round(calculo["puntaje_total"] / calculo["puntaje_maximo"] * 100)
                if calculo["puntaje_maximo"] else 0
            ),
        }

    resultado_por_evento = {t.evento_id: t for t in torneos if t.evento_id}
    metodos = Counter(
        t.get_metodo_display() for t in torneos if t.resultado == Torneo.Resultado.GANO and t.metodo
    )

    return {
        "alumno": alumno,
        "generada": ahora,
        "folio": f"{alumno.id:05d}",
        "iniciales": "".join(x[0] for x in (alumno.nombres, alumno.apellidos) if x).upper()[:2] or "?",
        "nombre": alumno.nombre_completo,
        "apodo": alumno.apodo,
        "activo": alumno.activo,
        "disciplinas": [i.disciplina.nombre for i in alumno.inscripciones.select_related("disciplina")],
        "cinturon": (
            {"clave": exp.bjj_cinturon, "nombre": exp.get_bjj_cinturon_display()} if exp else None
        ),
        "record": {"g": g, "p": p, "e": e, "total": total},
        "efectividad": f"{g / total * 100:.0f}%" if total else "—",
        "reparto": {
            clave: (valor / total * 100 if total else 0) for clave, valor in (("g", g), ("p", p), ("e", e))
        },
        "miembro_desde": fecha(alumno.fecha_registro),
        "horario": f"Grupo: {horario}" if horario else "Sin grupo asignado",
        "peso": _peso(alumno, exp),
        "estadisticas": {
            "estatura": numero(alumno.estatura, " cm"),
            "edad": numero(alumno.edad, " años"),
            "puntos": f"{alumno.puntos:,}".replace(",", " "),
            "asistencias_total": alumno.asistencias.count(),
            "asistencias_mes": alumno.asistencias.filter(fecha__gte=hoy.replace(day=1)).count(),
            "racha": clases(exp.racha_asistencia if exp else 0),
            "racha_maxima": clases(exp.racha_maxima if exp else 0),
            "torneos": max(exp.numero_torneos if exp else 0, len(torneos)),
            "sparrings": exp.numero_sparrings if exp else 0,
        },
        "metodos": [(m, metodos.get(m, 0)) for m in METODOS_VICTORIA],
        "metodos_max": max(metodos.values(), default=0) or 1,
        "favorito": (
            exp.get_metodo_victoria_favorito_display() if exp and exp.metodo_victoria_favorito else "—"
        ),
        "evaluacion": evaluacion,
        "torneos": [
            {
                "fecha": fecha(t.fecha),
                "nombre": t.nombre_torneo,
                "disciplina": t.disciplina.nombre if t.disciplina else "—",
                "metodo": t.get_metodo_display() if t.metodo else "—",
                "resultado": t.resultado,
                "resultado_display": t.get_resultado_display(),
            }
            for t in torneos
        ],
        "torneos_ganados": sum(t.resultado == Torneo.Resultado.GANO for t in torneos),
        "torneos_perdidos": sum(t.resultado == Torneo.Resultado.PERDIO for t in torneos),
        "eventos": [
            {
                "fecha": fecha(i.evento.fecha),
                "titulo": i.evento.titulo,
                "tipo": i.evento.get_tipo_display(),
                "lugar": i.evento.lugar or "—",
                "estado": estado[0],
                "estado_display": estado[1],
            }
            for i in inscripciones
            for estado in [_estado_evento(i, resultado_por_evento.get(i.evento_id), hoy)]
        ],
        "grados": [
            {
                "fecha": fecha(gr.fecha_obtencion),
                "disciplina": gr.disciplina.nombre,
                "grado": gr.nombre_grado,
                "otorgado_por": gr.otorgado_por.nombre if gr.otorgado_por else "—",
            }
            for gr in grados
        ],
        # El archivo (no la URL): cada salida lo incrusta a su manera.
        "insignias": [
            {"nombre": ai.insignia.nombre, "fecha": fecha(ai.fecha_obtencion), "icono": ai.insignia.icono}
            for ai in insignias
        ],
        "lesion": (exp.detalle_lesion or "Sin detalle registrado.") if exp and exp.lesion_activa else None,
        "notas": exp.notas_maestro if exp else "",
    }


def nombre_archivo(alumno: Alumno, extension="pdf") -> str:
    base = (alumno.apodo or alumno.nombre_completo or "peleador").lower()
    # Solo ASCII: Content-Disposition con acentos/ñ rompe algunos navegadores.
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()
    limpio = "".join(ch if ch.isalnum() else "-" for ch in base)
    limpio = "-".join(filter(None, limpio.split("-")))[:40] or "peleador"
    return f"ficha-{limpio}-{alumno.id}.{extension}"
