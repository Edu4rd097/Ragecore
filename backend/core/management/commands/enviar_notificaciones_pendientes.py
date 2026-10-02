"""
Despacha por correo los Avisos masivos/individuales creados por un admin.
Es el único lugar que manda el correo de un Aviso — así la creación
(POST /api/avisos/) nunca bloquea la petición HTTP, ni siquiera para "todos
los alumnos".

Pensado para correr frecuente (cada 1-5 min) con el mismo scheduler externo
que ya usa revisar_pagos (cron en Linux, Programador de tareas en Windows):
    */5 * * * * /ruta/al/venv/bin/python /ruta/manage.py enviar_notificaciones_pendientes
"""
from django.core.management.base import BaseCommand
from django.db.models import F
from django.utils import timezone

from core import email_service
from core.models import Aviso, Notificacion


class Command(BaseCommand):
    help = "Manda por correo las Notificacion pendientes de un Aviso, en lotes."

    def add_arguments(self, parser):
        parser.add_argument("--lote", type=int, default=100, help="Tamaño del lote de envío.")
        parser.add_argument(
            "--max-avisos",
            type=int,
            default=5,
            help="Máximo de Aviso pendientes/procesando a atender en una corrida.",
        )

    def handle(self, *args, **options):
        lote = options["lote"]

        avisos = list(
            Aviso.objects.filter(estado__in=[Aviso.Estado.PENDIENTE, Aviso.Estado.PROCESANDO])[
                : options["max_avisos"]
            ]
        )

        for aviso in avisos:
            if aviso.estado == Aviso.Estado.PENDIENTE:
                Aviso.objects.filter(pk=aviso.pk).update(estado=Aviso.Estado.PROCESANDO)

            pendientes = Notificacion.objects.filter(
                aviso=aviso,
                canal=Notificacion.Canal.EMAIL,
                estado_correo=Notificacion.EstadoCorreo.PENDIENTE,
            ).select_related("alumno__usuario")

            enviados_lote, fallidos_lote = 0, 0
            for notif in pendientes.iterator(chunk_size=lote):
                if email_service.enviar_notificacion(notif):
                    enviados_lote += 1
                else:
                    fallidos_lote += 1

            quedan_pendientes = Notificacion.objects.filter(
                aviso=aviso,
                canal=Notificacion.Canal.EMAIL,
                estado_correo=Notificacion.EstadoCorreo.PENDIENTE,
            ).exists()

            if quedan_pendientes:
                nuevo_estado = Aviso.Estado.PROCESANDO
            elif fallidos_lote and not enviados_lote and aviso.total_enviadas == 0:
                nuevo_estado = Aviso.Estado.FALLIDA  # nada se pudo mandar en toda la campaña
            else:
                nuevo_estado = Aviso.Estado.ENVIADA  # éxito total o parcial ya cuenta como enviada

            Aviso.objects.filter(pk=aviso.pk).update(
                estado=nuevo_estado,
                total_enviadas=F("total_enviadas") + enviados_lote,
                total_fallidas=F("total_fallidas") + fallidos_lote,
                procesado_en=None if quedan_pendientes else timezone.now(),
            )

        # Red de seguridad: Notificacion de correo pendiente sin Aviso (no
        # debería pasar en operación normal, ya que las automáticas se mandan
        # en el acto) — cubre, por ejemplo, una corrida interrumpida.
        sueltas = Notificacion.objects.filter(
            canal=Notificacion.Canal.EMAIL,
            estado_correo=Notificacion.EstadoCorreo.PENDIENTE,
            aviso__isnull=True,
        ).select_related("alumno__usuario")[:lote]
        for notif in sueltas:
            email_service.enviar_notificacion(notif)

        self.stdout.write(self.style.SUCCESS(f"Avisos procesados: {len(avisos)}"))
