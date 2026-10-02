"""
Motor de gamificación: puntos, rachas de asistencia y otorgamiento
automático de insignias según el campo `criterio` de cada Insignia.
"""
from django.db import transaction
from django.db.models import F

from . import email_service
from .models import (
    Alumno,
    AlumnoInsignia,
    Asistencia,
    Experiencia,
    Insignia,
    Notificacion,
    Torneo,
)

# Días de tolerancia: si el alumno entrena cada tercer día la racha no se rompe.
TOLERANCIA_RACHA_DIAS = 3


def calcular_racha(alumno: Alumno) -> int:
    """
    Cuenta días consecutivos de entrenamiento hacia atrás, permitiendo
    huecos de hasta TOLERANCIA_RACHA_DIAS entre sesiones.
    """
    fechas = list(
        Asistencia.objects.filter(alumno=alumno)
        .order_by("-fecha")
        .values_list("fecha", flat=True)
        .distinct()
    )
    if not fechas:
        return 0

    racha = 1
    anterior = fechas[0]
    for fecha in fechas[1:]:
        if (anterior - fecha).days <= TOLERANCIA_RACHA_DIAS:
            racha += 1
            anterior = fecha
        else:
            break
    return racha


def _valor_metrica(alumno: Alumno, exp: Experiencia, tipo: str) -> int:
    """Devuelve el valor actual del alumno para un tipo de criterio."""
    if tipo == Insignia.TipoCriterio.RACHA:
        return exp.racha_asistencia
    if tipo == Insignia.TipoCriterio.ASISTENCIAS:
        return alumno.asistencias.count()
    if tipo == Insignia.TipoCriterio.PUNTOS:
        return alumno.puntos
    if tipo == Insignia.TipoCriterio.SPARRINGS:
        return exp.numero_sparrings
    if tipo == Insignia.TipoCriterio.TORNEOS:
        return alumno.torneos.count()
    if tipo == Insignia.TipoCriterio.VICTORIAS:
        return exp.peleas_ganadas
    return 0


def notificar_insignia_otorgada(alumno_insignia: AlumnoInsignia) -> Notificacion:
    """
    Crea la Notificacion de "insignia obtenida" y manda el correo al alumno.
    Compartido por el otorgamiento automático (evaluar_insignias) y el manual
    (InsigniaViewSet.otorgar) para no duplicar esta lógica en los dos lados.
    """
    notif = Notificacion.objects.create(
        alumno=alumno_insignia.alumno,
        tipo=Notificacion.Tipo.INSIGNIA,
        titulo="¡Nueva insignia desbloqueada!",
        mensaje=f'¡Felicidades! Desbloqueaste la insignia "{alumno_insignia.insignia.nombre}".',
        canal=Notificacion.Canal.EMAIL,
    )
    email_service.enviar_notificacion(notif)
    return notif


@transaction.atomic
def evaluar_insignias(alumno: Alumno) -> list:
    """
    Revisa todas las insignias activas y otorga las que el alumno ya cumple.
    Devuelve la lista de insignias recién otorgadas.
    """
    exp, _ = Experiencia.objects.get_or_create(alumno=alumno)
    ya_ganadas = set(alumno.insignias_ganadas.values_list("insignia_id", flat=True))
    nuevas = []

    for insignia in Insignia.objects.filter(activa=True).exclude(id__in=ya_ganadas):
        criterio = insignia.criterio or {}
        tipo = criterio.get("tipo")
        objetivo = criterio.get("valor")

        if not tipo or tipo == Insignia.TipoCriterio.MANUAL or objetivo is None:
            continue

        if _valor_metrica(alumno, exp, tipo) >= int(objetivo):
            obtenida = AlumnoInsignia.objects.create(alumno=alumno, insignia=insignia)
            nuevas.append(insignia)

            if insignia.puntos_bonus:
                Alumno.objects.filter(pk=alumno.pk).update(
                    puntos=F("puntos") + insignia.puntos_bonus
                )

            notificar_insignia_otorgada(obtenida)

    if nuevas:
        alumno.refresh_from_db(fields=["puntos"])
    return nuevas


@transaction.atomic
def procesar_asistencia(asistencia: Asistencia) -> dict:
    """
    Efecto secundario de registrar una asistencia:
    suma puntos, actualiza la racha y evalúa insignias.
    """
    alumno = asistencia.alumno

    Alumno.objects.filter(pk=alumno.pk).update(
        puntos=F("puntos") + asistencia.puntos_otorgados
    )
    alumno.refresh_from_db(fields=["puntos"])

    exp, _ = Experiencia.objects.get_or_create(alumno=alumno)
    exp.racha_asistencia = calcular_racha(alumno)
    exp.racha_maxima = max(exp.racha_maxima, exp.racha_asistencia)
    exp.save(update_fields=["racha_asistencia", "racha_maxima", "actualizado_en"])

    nuevas = evaluar_insignias(alumno)

    return {
        "puntos_totales": alumno.puntos,
        "racha": exp.racha_asistencia,
        "insignias_nuevas": [i.nombre for i in nuevas],
    }


@transaction.atomic
def sincronizar_record(alumno: Alumno) -> Experiencia:
    """Recalcula el récord de peleas de Experiencia a partir de los Torneos."""
    exp, _ = Experiencia.objects.get_or_create(alumno=alumno)
    torneos = Torneo.objects.filter(alumno=alumno)

    exp.numero_torneos = torneos.count()
    exp.peleas_ganadas = torneos.filter(resultado=Torneo.Resultado.GANO).count()
    exp.peleas_perdidas = torneos.filter(resultado=Torneo.Resultado.PERDIO).count()
    exp.peleas_empatadas = torneos.filter(resultado=Torneo.Resultado.EMPATO).count()
    exp.save(
        update_fields=[
            "numero_torneos",
            "peleas_ganadas",
            "peleas_perdidas",
            "peleas_empatadas",
            "actualizado_en",
        ]
    )
    evaluar_insignias(alumno)
    return exp
