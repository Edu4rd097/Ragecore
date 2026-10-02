"""
Resolución de destinatarios de un Aviso y creación de las Notificacion hijas.

El servidor SIEMPRE resuelve la lista de alumnos aquí — nunca se confía en
una lista mandada por el cliente (evita que un admin, o alguien con el token
robado, mande un aviso a un alumno_id ajeno a la regla declarada).
"""
from .models import Alumno, Aviso, Notificacion


def resolver_destinatarios(aviso: Aviso):
    """Devuelve el queryset de Alumno que debe recibir este aviso."""
    if aviso.tipo_destinatario == Aviso.TipoDestinatario.INDIVIDUAL:
        return Alumno.objects.filter(pk=aviso.alumno_id, activo=True)
    if aviso.tipo_destinatario == Aviso.TipoDestinatario.GRUPO:
        return Alumno.objects.filter(horario_id=aviso.horario_id, activo=True)
    return Alumno.objects.filter(activo=True)


def crear_notificaciones_de_aviso(aviso: Aviso) -> int:
    """
    Resuelve los destinatarios y crea una Notificacion por cada uno, vía
    bulk_create (rápido incluso para "todos los alumnos" — no manda correo
    aquí, eso lo hace el comando enviar_notificaciones_pendientes en lotes).
    Devuelve el total de destinatarios resueltos.
    """
    destinatarios = list(resolver_destinatarios(aviso).values_list("id", flat=True))

    Notificacion.objects.bulk_create(
        [
            Notificacion(
                alumno_id=alumno_id,
                aviso=aviso,
                tipo=Notificacion.Tipo.MANUAL,
                titulo=aviso.titulo,
                mensaje=aviso.mensaje,
                canal=Notificacion.Canal.EMAIL,
            )
            for alumno_id in destinatarios
        ]
    )

    Aviso.objects.filter(pk=aviso.pk).update(total_destinatarios=len(destinatarios))
    aviso.total_destinatarios = len(destinatarios)
    return len(destinatarios)
