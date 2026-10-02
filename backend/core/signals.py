"""Señales que mantienen consistente el estado derivado del sistema."""
from django.db.models import F
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from . import email_service
from .models import Alumno, Asistencia, Experiencia, Maestro, Pago, Torneo, crear_cuenta_acceso


@receiver(post_save, sender=Alumno)
def crear_experiencia(sender, instance, created, **kwargs):
    """Todo alumno nuevo arranca con su ficha deportiva vacía."""
    if created:
        Experiencia.objects.get_or_create(alumno=instance)


@receiver(post_save, sender=Alumno)
@receiver(post_save, sender=Maestro)
def crear_cuenta(sender, instance, created, raw=False, **kwargs):
    """
    Todo alumno/maestro nuevo arranca con su cuenta de acceso (usuario
    <prefijo>-<id>, contraseña inicial settings.PASSWORD_INICIAL, con hash).
    Se respeta una cuenta ya ligada (p. ej. tests o alta desde el admin de
    Django con usuario elegido a mano). `raw` = carga de fixtures: no se toca.
    """
    if created and not raw and instance.usuario_id is None:
        if sender is Alumno:
            crear_cuenta_acceso(instance, nombre=instance.nombres, apellidos=instance.apellidos)
        else:
            crear_cuenta_acceso(instance, nombre=instance.nombre)


@receiver(post_save, sender=Asistencia)
def asistencia_registrada(sender, instance, created, **kwargs):
    if created:
        # Import local para evitar dependencia circular al cargar la app.
        from .gamificacion import procesar_asistencia

        procesar_asistencia(instance)


@receiver(post_delete, sender=Asistencia)
def asistencia_eliminada(sender, instance, **kwargs):
    """Si se borra una asistencia (error de captura), se devuelven los puntos."""
    from .gamificacion import calcular_racha

    Alumno.objects.filter(pk=instance.alumno_id).update(
        puntos=F("puntos") - instance.puntos_otorgados
    )
    exp = Experiencia.objects.filter(alumno_id=instance.alumno_id).first()
    if exp:
        exp.racha_asistencia = calcular_racha(exp.alumno)
        exp.save(update_fields=["racha_asistencia", "actualizado_en"])


@receiver([post_save, post_delete], sender=Torneo)
def torneo_cambiado(sender, instance, **kwargs):
    from .gamificacion import sincronizar_record

    sincronizar_record(instance.alumno)


@receiver(post_save, sender=Pago)
def pago_registrado(sender, instance, created, **kwargs):
    """Manda el comprobante por correo al registrar un pago nuevo (nunca en
    ediciones). Nunca revierte el pago si el correo falla."""
    if created:
        email_service.enviar_comprobante(instance)
