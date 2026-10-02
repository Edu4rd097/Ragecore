"""Pruebas del módulo de notificaciones: Aviso, envío de correo, idempotencia."""
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.management.commands.enviar_notificaciones_pendientes import (
    Command as ComandoEnviarPendientes,
)
from core.management.commands.revisar_pagos import Command as ComandoRevisarPagos
from core.models import (
    Alumno,
    Aviso,
    Horario,
    Insignia,
    Membresia,
    Notificacion,
    Pago,
)


def _alumno_con_correo(nombres, apellidos, username, **kwargs):
    user = User.objects.create_user(username, email=f"{username}@correo.test", password="x")
    return Alumno.objects.create(nombres=nombres, apellidos=apellidos, usuario=user, **kwargs)


class AvisoAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("recepcion", password="x", is_staff=True)
        self.client.force_authenticate(self.admin)

        self.horario = Horario.objects.create(hora_inicio="07:00", hora_fin="08:00")
        self.a1 = _alumno_con_correo("Juan", "Pérez", "juan", horario=self.horario)
        self.a2 = _alumno_con_correo("María", "López", "maria", horario=self.horario)
        self.a3_inactivo = _alumno_con_correo(
            "Inactivo", "Alumno", "inactivo", horario=self.horario, activo=False
        )
        self.a4_otro_horario = _alumno_con_correo("Otro", "Horario", "otro")

    def test_aviso_individual_crea_una_notificacion(self):
        r = self.client.post(
            "/api/avisos/",
            {
                "titulo": "Aviso importante",
                "mensaje": "El próximo lunes hay mantenimiento.",
                "tipo_destinatario": "INDIVIDUAL",
                "alumno": self.a1.id,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["total_destinatarios"], 1)
        self.assertEqual(
            Notificacion.objects.filter(aviso_id=r.data["id"]).count(), 1
        )
        self.assertTrue(
            Notificacion.objects.filter(aviso_id=r.data["id"], alumno=self.a1).exists()
        )

    def test_aviso_grupo_excluye_inactivos_y_otros_horarios(self):
        r = self.client.post(
            "/api/avisos/",
            {
                "titulo": "Cambio de horario",
                "mensaje": "La clase de mañana empieza a las 8.",
                "tipo_destinatario": "GRUPO",
                "horario": self.horario.id,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        # a1 y a2 (activos, ese horario) sí; a3 (inactivo) y a4 (otro horario) no.
        self.assertEqual(r.data["total_destinatarios"], 2)
        destinatarios = set(
            Notificacion.objects.filter(aviso_id=r.data["id"]).values_list("alumno_id", flat=True)
        )
        self.assertEqual(destinatarios, {self.a1.id, self.a2.id})

    def test_aviso_todos_incluye_todos_los_activos(self):
        r = self.client.post(
            "/api/avisos/",
            {
                "titulo": "Aviso general",
                "mensaje": "El gimnasio cierra el lunes.",
                "tipo_destinatario": "TODOS",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["total_destinatarios"], Alumno.objects.filter(activo=True).count())

    def test_individual_sin_alumno_da_400(self):
        r = self.client.post(
            "/api/avisos/",
            {"titulo": "X", "mensaje": "Y", "tipo_destinatario": "INDIVIDUAL"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_grupo_sin_horario_da_400(self):
        r = self.client.post(
            "/api/avisos/",
            {"titulo": "X", "mensaje": "Y", "tipo_destinatario": "GRUPO"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_todos_con_alumno_da_400(self):
        r = self.client.post(
            "/api/avisos/",
            {
                "titulo": "X", "mensaje": "Y", "tipo_destinatario": "TODOS",
                "alumno": self.a1.id,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_alumno_no_puede_crear_avisos(self):
        user_alumno = User.objects.create_user("normal", password="x")
        Alumno.objects.create(nombres="N", apellidos="N", usuario=user_alumno)
        self.client.force_authenticate(user_alumno)
        r = self.client.post(
            "/api/avisos/",
            {"titulo": "X", "mensaje": "Y", "tipo_destinatario": "TODOS"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)

    def test_borrar_solo_permitido_sin_envios(self):
        r = self.client.post(
            "/api/avisos/",
            {
                "titulo": "X", "mensaje": "Y", "tipo_destinatario": "INDIVIDUAL",
                "alumno": self.a1.id,
            },
            format="json",
        )
        aviso_id = r.data["id"]
        self.assertEqual(self.client.delete(f"/api/avisos/{aviso_id}/").status_code, 204)

        r2 = self.client.post(
            "/api/avisos/",
            {
                "titulo": "X", "mensaje": "Y", "tipo_destinatario": "INDIVIDUAL",
                "alumno": self.a1.id,
            },
            format="json",
        )
        aviso2_id = r2.data["id"]
        Aviso.objects.filter(pk=aviso2_id).update(total_enviadas=1)
        self.assertEqual(self.client.delete(f"/api/avisos/{aviso2_id}/").status_code, 409)

    def test_cancelar_marca_pendientes_como_fallidas(self):
        r = self.client.post(
            "/api/avisos/",
            {
                "titulo": "X", "mensaje": "Y", "tipo_destinatario": "GRUPO",
                "horario": self.horario.id,
            },
            format="json",
        )
        aviso_id = r.data["id"]
        r2 = self.client.post(f"/api/avisos/{aviso_id}/cancelar/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.data["estado"], "CANCELADA")
        self.assertTrue(
            Notificacion.objects.filter(
                aviso_id=aviso_id, estado_correo=Notificacion.EstadoCorreo.FALLIDO
            ).exists()
        )


class DespachoAvisosTest(TestCase):
    """Nadie debe recibir el mismo correo dos veces aunque el comando corra varias veces."""

    def setUp(self):
        self.horario = Horario.objects.create(hora_inicio="07:00", hora_fin="08:00")
        for i in range(5):
            _alumno_con_correo(f"Alumno{i}", "Apellido", f"alumno{i}", horario=self.horario)

    def test_todos_no_duplica_correos_en_corridas_repetidas(self):
        aviso = Aviso.objects.create(
            titulo="Aviso masivo", mensaje="Hola a todos", tipo_destinatario=Aviso.TipoDestinatario.TODOS
        )
        from core.avisos import crear_notificaciones_de_aviso

        crear_notificaciones_de_aviso(aviso)
        self.assertEqual(Notificacion.objects.filter(aviso=aviso).count(), 5)

        ComandoEnviarPendientes().handle(lote=100, max_avisos=5)
        self.assertEqual(len(mail.outbox), 5)

        # Segunda corrida: nada pendiente, no debe mandar correos nuevos.
        ComandoEnviarPendientes().handle(lote=100, max_avisos=5)
        self.assertEqual(len(mail.outbox), 5)

        aviso.refresh_from_db()
        self.assertEqual(aviso.estado, Aviso.Estado.ENVIADA)
        self.assertEqual(aviso.total_enviadas, 5)
        self.assertEqual(aviso.total_fallidas, 0)


class RevisarPagosTest(TestCase):
    def setUp(self):
        self.membresia = Membresia.objects.create(nombre="Mensual", duracion_dias=30, precio=800)
        self.alumno = _alumno_con_correo("Carlos", "Ruiz", "carlos", membresia=self.membresia)

    def test_no_duplica_aviso_ni_correo_en_el_mismo_dia(self):
        hoy = timezone.localdate()
        Pago.objects.create(
            alumno=self.alumno, monto=800,
            fecha_pago=hoy - timedelta(days=25), duracion=30,  # vence en 5 días
        )
        # Crear el Pago ya manda 1 correo de comprobante (señal post_save).
        self.assertEqual(len(mail.outbox), 1)

        ComandoRevisarPagos().handle(dias=10, frecuencia_vencido_dias=7)
        ComandoRevisarPagos().handle(dias=10, frecuencia_vencido_dias=7)

        self.assertEqual(
            Notificacion.objects.filter(
                alumno=self.alumno, tipo=Notificacion.Tipo.PAGO_POR_VENCER
            ).count(),
            1,
        )
        # +1 del recordatorio de vencimiento — nunca se duplica aunque el
        # comando corra dos veces.
        self.assertEqual(len(mail.outbox), 2)

    def test_recordatorio_de_vencido_respeta_la_frecuencia(self):
        hoy = timezone.localdate()
        Pago.objects.create(
            alumno=self.alumno, monto=800,
            fecha_pago=hoy - timedelta(days=40), duracion=30,  # venció hace 10 días
        )

        ComandoRevisarPagos().handle(dias=10, frecuencia_vencido_dias=7)
        self.assertEqual(
            Notificacion.objects.filter(
                alumno=self.alumno, tipo=Notificacion.Tipo.PAGO_VENCIDO
            ).count(),
            1,
        )

        # Correr el mismo día de nuevo: no debe crear un segundo aviso.
        ComandoRevisarPagos().handle(dias=10, frecuencia_vencido_dias=7)
        self.assertEqual(
            Notificacion.objects.filter(
                alumno=self.alumno, tipo=Notificacion.Tipo.PAGO_VENCIDO
            ).count(),
            1,
        )

        # Simular que ya pasaron 8 días desde ese aviso (>= frecuencia de 7).
        notif = Notificacion.objects.get(alumno=self.alumno, tipo=Notificacion.Tipo.PAGO_VENCIDO)
        Notificacion.objects.filter(pk=notif.pk).update(
            fecha_envio=timezone.now() - timedelta(days=8)
        )
        ComandoRevisarPagos().handle(dias=10, frecuencia_vencido_dias=7)
        self.assertEqual(
            Notificacion.objects.filter(
                alumno=self.alumno, tipo=Notificacion.Tipo.PAGO_VENCIDO
            ).count(),
            2,
        )


class ComprobantePagoTest(TestCase):
    def setUp(self):
        self.alumno = _alumno_con_correo("Diana", "Vega", "diana")

    def test_pago_exitoso_manda_comprobante_por_correo(self):
        pago = Pago.objects.create(alumno=self.alumno, monto=800, duracion=30)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("comprobante", mail.outbox[0].subject.lower())
        pago.refresh_from_db()
        self.assertIsNotNone(pago.comprobante_enviado_en)

    def test_falla_de_correo_no_revierte_el_pago(self):
        with patch(
            "django.core.mail.EmailMultiAlternatives.send",
            side_effect=Exception("SMTP caído"),
        ):
            pago = Pago.objects.create(alumno=self.alumno, monto=800, duracion=30)
        self.assertTrue(Pago.objects.filter(pk=pago.pk).exists())
        pago.refresh_from_db()
        self.assertIsNone(pago.comprobante_enviado_en)


class InsigniaOtorgadaTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("recepcion2", password="x", is_staff=True)
        self.client.force_authenticate(self.admin)
        self.alumno = _alumno_con_correo("Pedro", "Gómez", "pedro")
        self.insignia = Insignia.objects.create(
            nombre="Constancia", criterio={"tipo": "manual"}, puntos_bonus=50
        )

    def test_otorgar_suma_puntos_y_crea_notificacion_y_correo(self):
        r = self.client.post(
            f"/api/insignias/{self.insignia.id}/otorgar/", {"alumno_id": self.alumno.id}
        )
        self.assertEqual(r.status_code, 201)
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.puntos, 50)
        self.assertTrue(
            Notificacion.objects.filter(
                alumno=self.alumno, tipo=Notificacion.Tipo.INSIGNIA
            ).exists()
        )
        self.assertEqual(len(mail.outbox), 1)

    def test_otorgar_dos_veces_da_409_sin_duplicar(self):
        self.client.post(f"/api/insignias/{self.insignia.id}/otorgar/", {"alumno_id": self.alumno.id})
        r = self.client.post(
            f"/api/insignias/{self.insignia.id}/otorgar/", {"alumno_id": self.alumno.id}
        )
        self.assertEqual(r.status_code, 409)
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.puntos, 50)
        self.assertEqual(len(mail.outbox), 1)
