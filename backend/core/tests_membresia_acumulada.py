"""
Los días de membresía se SUMAN: un pago hecho mientras la membresía sigue
vigente arranca donde termina la anterior, no desde la fecha de pago.
Aplica a pagos en caja (API y admin) y a los de Stripe (activar_membresia).
"""
import shutil
import tempfile
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Alumno, Membresia, Pago

MEDIA_TEMPORAL = tempfile.mkdtemp(prefix="membresia-acumulada-")


@override_settings(MEDIA_ROOT=MEDIA_TEMPORAL)
class MembresiaAcumuladaTest(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TEMPORAL, ignore_errors=True)

    def setUp(self):
        self.trimestral = Membresia.objects.create(nombre="Trimestral", duracion_dias=90, precio="2100.00")
        self.mensual = Membresia.objects.create(nombre="Mensual", duracion_dias=30, precio="800.00")
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", membresia=self.trimestral)

    def pagar(self, fecha, membresia=None, **extra):
        return Pago.objects.create(
            alumno=self.alumno, membresia=membresia or self.trimestral,
            monto="1.00", fecha_pago=fecha, **extra,
        )

    def test_pago_con_membresia_vigente_suma_los_dias(self):
        primero = self.pagar(date(2026, 1, 1))
        self.assertEqual(primero.fecha_vencimiento, date(2026, 4, 1))
        # Paga otro trimestral el 15/feb: le quedaban 45 días + 90 nuevos.
        segundo = self.pagar(date(2026, 2, 15))
        self.assertEqual(segundo.fecha_vencimiento, date(2026, 4, 1) + timedelta(days=90))
        self.assertEqual(self.alumno.fecha_vencimiento, date(2026, 6, 30))

    def test_varios_pagos_se_encadenan(self):
        self.pagar(date(2026, 1, 1))                         # hasta 1/abr
        self.pagar(date(2026, 1, 10), self.mensual)          # +30 -> 1/may
        tercero = self.pagar(date(2026, 1, 20))              # +90 -> 30/jul
        self.assertEqual(tercero.fecha_vencimiento, date(2026, 7, 30))
        self.assertEqual(self.alumno.fecha_vencimiento, date(2026, 7, 30))

    def test_si_ya_vencio_cuenta_desde_la_fecha_de_pago(self):
        self.pagar(date(2026, 1, 1), self.mensual)           # vence 31/ene
        nuevo = self.pagar(date(2026, 3, 1), self.mensual)
        self.assertEqual(nuevo.fecha_vencimiento, date(2026, 3, 31))

    def test_pagar_el_mismo_dia_que_vence_no_pierde_ese_dia(self):
        self.pagar(date(2026, 1, 1), self.mensual)           # vence 31/ene
        nuevo = self.pagar(date(2026, 1, 31), self.mensual)
        self.assertEqual(nuevo.fecha_vencimiento, date(2026, 3, 2))

    def test_un_pago_pendiente_no_da_dias(self):
        self.pagar(date(2026, 1, 1), estatus=Pago.Estatus.PENDIENTE)
        nuevo = self.pagar(date(2026, 1, 10), self.mensual)
        self.assertEqual(nuevo.fecha_vencimiento, date(2026, 2, 9))

    def test_vencimiento_explicito_se_respeta(self):
        self.pagar(date(2026, 1, 1))
        manual = self.pagar(date(2026, 1, 5), fecha_vencimiento=date(2026, 2, 1))
        self.assertEqual(manual.fecha_vencimiento, date(2026, 2, 1))
        # El alumno sigue cubierto hasta el más lejano, no hasta el último capturado.
        self.assertEqual(self.alumno.fecha_vencimiento, date(2026, 4, 1))

    def test_semaforo_usa_la_suma(self):
        hoy = timezone.localdate()
        self.pagar(hoy - timedelta(days=80))                 # le quedan 10 días
        self.pagar(hoy)                                      # +90
        self.assertTrue(self.alumno.al_corriente)
        self.assertEqual(self.alumno.dias_para_vencer, 100)

    def test_registro_en_caja_por_api_suma_los_dias(self):
        admin = User.objects.create_user("admin-acum", password="x12345678", is_staff=True)
        cliente = APIClient()
        cliente.force_authenticate(admin)
        hoy = timezone.localdate()
        self.pagar(hoy - timedelta(days=30))                 # le quedan 60 días
        r = cliente.post(
            "/api/pagos/",
            {"alumno": self.alumno.id, "membresia": self.trimestral.id, "monto": "2100.00",
             "metodo": "EFECTIVO", "fecha_pago": hoy.isoformat()},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["fecha_vencimiento"], (hoy + timedelta(days=150)).isoformat())

    def test_pago_en_linea_suma_sobre_un_pago_en_caja(self):
        from payments.models import PagoStripe
        from payments.services.activacion import activar_membresia

        hoy = timezone.localdate()
        self.pagar(hoy - timedelta(days=30))                 # caja: le quedan 60 días
        pago_stripe = PagoStripe.objects.create(
            alumno=self.alumno, membresia=self.trimestral, monto="2100.00",
            stripe_checkout_session_id="cs_test_acumulado",
        )
        pago = activar_membresia(pago_stripe)
        self.assertEqual(pago.fecha_vencimiento, hoy + timedelta(days=150))
        self.assertEqual(self.alumno.dias_para_vencer, 150)
