"""
Revisa vencimientos, genera notificaciones y manda su correo.
Pensado para correr diario con cron (o el Programador de tareas en Windows):
    0 8 * * * /ruta/al/venv/bin/python /ruta/manage.py revisar_pagos
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from core import email_service
from core.models import Alumno, Notificacion, Pago


class Command(BaseCommand):
    help = "Actualiza el estatus de los pagos, notifica vencimientos próximos o pasados y manda su correo."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dias",
            type=int,
            default=10,
            help="Días de anticipación para el aviso de vencimiento (default: 10).",
        )
        parser.add_argument(
            "--frecuencia-vencido-dias",
            type=int,
            default=7,
            help=(
                "Cada cuántos días se repite el aviso de 'ya venció' mientras el "
                "alumno siga sin pagar (default: 7)."
            ),
        )

    def handle(self, *args, **options):
        dias = options["dias"]
        frecuencia_vencido = options["frecuencia_vencido_dias"]
        hoy = timezone.localdate()

        # 1. Refrescar estatus de todos los pagos con vencimiento.
        actualizados = 0
        for pago in Pago.objects.exclude(fecha_vencimiento__isnull=True).exclude(
            estatus=Pago.Estatus.PENDIENTE
        ):
            anterior = pago.estatus
            if pago.refrescar_estatus(guardar=False) != anterior:
                pago.save(update_fields=["estatus"])
                actualizados += 1

        # 2. Notificar (y mandar el correo en el acto: son pocos alumnos, el
        #    comando corre una vez al día, no hay cliente HTTP esperando).
        avisos, vencidos, correos_ok, correos_fallidos = 0, 0, 0, 0
        for alumno in Alumno.objects.filter(activo=True).select_related("usuario"):
            pago = alumno.ultimo_pago
            venc = pago.fecha_vencimiento if pago else None
            if not venc:
                continue

            restantes = (venc - hoy).days
            notif = None

            if 0 <= restantes <= dias:
                tipo = Notificacion.Tipo.PAGO_POR_VENCER
                # Des-duplicación real: una sola fila por (alumno, tipo, ESTE
                # vencimiento) — robusto a correr el comando varias veces el
                # mismo día, a diferencia de un guard "por día calendario".
                ya_existe = Notificacion.objects.filter(
                    alumno=alumno, tipo=tipo, referencia_vencimiento=venc
                ).exists()
                if not ya_existe:
                    notif = Notificacion.objects.create(
                        alumno=alumno,
                        tipo=tipo,
                        titulo="Tu membresía vence pronto",
                        mensaje=(
                            f"Hola {alumno.nombres}, tu membresía vence "
                            f"{'hoy' if restantes == 0 else f'en {restantes} día(s)'} "
                            f"({venc:%d/%m/%Y})."
                        ),
                        canal=Notificacion.Canal.EMAIL,
                        referencia_vencimiento=venc,
                    )
                    avisos += 1

            elif restantes < 0:
                tipo = Notificacion.Tipo.PAGO_VENCIDO
                ultimo_vencido = (
                    Notificacion.objects.filter(
                        alumno=alumno, tipo=tipo, referencia_vencimiento=venc
                    )
                    .order_by("-fecha_envio")
                    .first()
                )
                debe_reenviar = (
                    ultimo_vencido is None
                    or (hoy - ultimo_vencido.fecha_envio.date()).days >= frecuencia_vencido
                )
                if debe_reenviar:
                    notif = Notificacion.objects.create(
                        alumno=alumno,
                        tipo=tipo,
                        titulo="Tu membresía está vencida",
                        mensaje=(
                            f"Hola {alumno.nombres}, tu membresía venció hace "
                            f"{abs(restantes)} día(s). Renuévala para seguir entrenando."
                        ),
                        canal=Notificacion.Canal.EMAIL,
                        referencia_vencimiento=venc,
                    )
                    vencidos += 1

            # Idempotencia de correo: enviar_notificacion() nunca reenvía una
            # fila ya ENVIADO, así que aunque el comando se re-ejecute no hay
            # doble correo (y a nivel de fila, ya no se crea una nueva).
            if notif:
                if email_service.enviar_notificacion(notif):
                    correos_ok += 1
                else:
                    correos_fallidos += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Pagos actualizados: {actualizados} | "
                f"Avisos de vencimiento: {avisos} | Avisos de vencido: {vencidos} | "
                f"Correos OK: {correos_ok} | Correos fallidos: {correos_fallidos}"
            )
        )
