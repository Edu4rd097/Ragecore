"""
Cálculo de la Evaluación MMA: puntaje por categoría, total (/100), nivel y
preparación para competencia.

Es la ÚNICA fuente de verdad de esas cifras. Nada de esto se guarda en la BD:
se deriva de los `PuntajeHabilidadMMA` (1-5) de cada evaluación, igual que
`gamificacion.sincronizar_record` deriva el récord de los Torneos. Si cambia
una fórmula o un peso, cambia aquí y todo el historial se recalcula solo.

Convenciones:
- Puntaje de una categoría = (suma de puntajes / (5 · habilidades evaluadas))
  · puntos_maximos de la categoría. Se normaliza por las habilidades que SÍ se
  calificaron, así una evaluación vieja no baja de puntaje cuando el catálogo
  crece con habilidades nuevas.
- Puntaje total = suma de las categorías (el catálogo inicial suma 100).
- Nivel = banda del total (ver NIVELES). Es un indicador interno de desarrollo
  deportivo, NO una autorización para competir.
- Preparación para competencia = media ponderada de cinco componentes
  (técnica, física, defensa, táctica, disciplina), cada uno 0-100, armados a
  partir del % de dominio de una o varias categorías. Tampoco autoriza a
  competir: es una estimación para el maestro.
"""
from django.db.models import Prefetch

from .models import (
    Alumno,
    CategoriaMMA,
    EvaluacionMMA,
    HabilidadMMA,
    PuntajeHabilidadMMA,
)

# (tope EXCLUSIVO sobre el total normalizado a 100, nombre del nivel)
NIVELES = [
    (30, "Inicial"),
    (45, "Principiante"),
    (60, "Básico"),
    (75, "Intermedio"),
    (90, "Avanzado"),
    (101, "Competitivo"),
]

# Claves de CategoriaMMA (ver migración 0006_catalogo_mma) que alimentan cada
# componente de la preparación para competencia.
COMPONENTES_PREPARACION = {
    "tecnica": ["striking", "wrestling", "grappling"],
    "fisica": ["acondicionamiento"],
    "defensa": ["defensa"],
    "tactica": ["integracion"],
    "disciplina": ["disciplina"],
}

# Pesos de cada componente en el total de preparación. Suman 1.0; si algún
# componente no tiene categorías activas se reparte entre los demás.
PESOS_PREPARACION = {
    "tecnica": 0.35,
    "fisica": 0.20,
    "defensa": 0.20,
    "tactica": 0.15,
    "disciplina": 0.10,
}

AVISO_PREPARACION = (
    "Indicador interno de preparación. Un valor alto NO autoriza automáticamente "
    "al alumno a competir: la decisión es del maestro."
)


def cargar_categorias():
    """Catálogo activo con sus habilidades activas, en una sola consulta.

    Se pasa a las demás funciones para no repetir la consulta por cada
    evaluación cuando se calcula un historial completo."""
    return list(
        CategoriaMMA.objects.filter(activa=True).prefetch_related(
            Prefetch("habilidades", queryset=HabilidadMMA.objects.filter(activa=True))
        )
    )


def nivel_por_puntaje(total: float, maximo: float = 100) -> str:
    """Banda de nivel para un total dado (normalizado a 100 si el máximo cambia)."""
    normalizado = (total / maximo * 100) if maximo else 0
    for tope, nombre in NIVELES:
        if normalizado < tope:
            return nombre
    return NIVELES[-1][1]


def calcular_preparacion(categorias_calculadas: list[dict]) -> dict:
    """Componentes (0-100) + total ponderado, a partir del desglose por categoría."""
    porcentaje = {c["clave"]: c["porcentaje"] for c in categorias_calculadas}
    componentes = {}
    for nombre, claves in COMPONENTES_PREPARACION.items():
        valores = [porcentaje[k] for k in claves if k in porcentaje]
        componentes[nombre] = round(sum(valores) / len(valores)) if valores else None

    presentes = {n: v for n, v in componentes.items() if v is not None}
    peso_total = sum(PESOS_PREPARACION[n] for n in presentes) or 1
    total = sum(v * PESOS_PREPARACION[n] for n, v in presentes.items()) / peso_total

    return {**{n: (v if v is not None else 0) for n, v in componentes.items()}, "total": round(total)}


def calcular_evaluacion(evaluacion: EvaluacionMMA, categorias=None) -> dict:
    """
    Desglose completo de UNA evaluación:
        {
          "categorias": [{"id","clave","nombre","puntaje","maximo","porcentaje",
                          "habilidades_evaluadas","habilidades_total",
                          "habilidades":[{"id","nombre","puntaje"}]}],
          "puntaje_total": 63.5, "puntaje_maximo": 100,
          "nivel": "Intermedio",
          "preparacion": {"tecnica":..,"fisica":..,"defensa":..,"tactica":..,"disciplina":..,"total":..},
          "completa": True/False   # ¿se calificaron todas las habilidades activas?
        }
    """
    if categorias is None:
        categorias = cargar_categorias()

    puntaje_de = {p.habilidad_id: p.puntaje for p in evaluacion.puntajes.all()}
    tope = PuntajeHabilidadMMA.PUNTAJE_MAXIMO

    desglose = []
    total = 0.0
    maximo = 0
    completa = True

    for cat in categorias:
        habilidades = list(cat.habilidades.all())
        filas = []
        suma = 0
        evaluadas = 0
        for h in habilidades:
            p = puntaje_de.get(h.id)
            filas.append({"id": h.id, "nombre": h.nombre, "puntaje": p})
            if p is not None:
                suma += p
                evaluadas += 1
        if evaluadas < len(habilidades):
            completa = False

        porcentaje = (suma / (evaluadas * tope) * 100) if evaluadas else 0.0
        puntaje_cat = round(porcentaje / 100 * cat.puntos_maximos, 1)
        total += puntaje_cat
        maximo += cat.puntos_maximos

        desglose.append(
            {
                "id": cat.id,
                "clave": cat.clave,
                "nombre": cat.nombre,
                "puntaje": puntaje_cat,
                "maximo": cat.puntos_maximos,
                "porcentaje": round(porcentaje, 1),
                "habilidades_evaluadas": evaluadas,
                "habilidades_total": len(habilidades),
                "habilidades": filas,
            }
        )

    total = round(total, 1)
    return {
        "categorias": desglose,
        "puntaje_total": total,
        "puntaje_maximo": maximo,
        "nivel": nivel_por_puntaje(total, maximo),
        "preparacion": calcular_preparacion(desglose),
        "completa": completa,
    }


def evaluaciones_finalizadas(alumno: Alumno):
    """Solo las FINALIZADAS cuentan para resumen/historial (un borrador aún no es una evaluación)."""
    return (
        alumno.evaluaciones_mma.filter(estado=EvaluacionMMA.Estado.FINALIZADA)
        .prefetch_related("puntajes")
        .order_by("fecha", "id")
    )


def historial_evaluacion(alumno: Alumno, categorias=None) -> list[dict]:
    """Serie cronológica ascendente lista para graficar la evolución."""
    if categorias is None:
        categorias = cargar_categorias()
    puntos = []
    for ev in evaluaciones_finalizadas(alumno):
        calculo = calcular_evaluacion(ev, categorias)
        puntos.append(
            {
                "id": ev.id,
                "fecha": ev.fecha,
                "puntaje_total": calculo["puntaje_total"],
                "puntaje_maximo": calculo["puntaje_maximo"],
                "nivel": calculo["nivel"],
                "preparacion_total": calculo["preparacion"]["total"],
                "categorias": {c["clave"]: c["puntaje"] for c in calculo["categorias"]},
            }
        )
    return puntos
