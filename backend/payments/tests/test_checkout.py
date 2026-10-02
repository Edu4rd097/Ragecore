"""Inicio de pago: autenticación, autorización, precio desde la BD y ligas reutilizadas."""
from types import SimpleNamespace
from unittest.mock import patch

import stripe
from django.contrib.auth.models import User
from django.test import override_settings

from core.models import Alumno, Maestro, Membresia

from ..models import PagoStripe
from .base import PagosStripeTestCase

URL = "/api/payments/checkout/"
CREAR = "payments.services.stripe_service.crear_checkout"


def sesion_falsa(pago):
    return SimpleNamespace(id=f"cs_test_{pago.id}", url=f"https://checkout.stripe.com/c/pay/cs_test_{pago.id}")


@patch(CREAR, side_effect=sesion_falsa)
class CheckoutTest(PagosStripeTestCase):
    def test_alumno_paga_su_membresia_con_el_precio_de_la_bd(self, crear):
        self.como(self.alumno.usuario)
        r = self.client.post(URL, {"monto": "1.00"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data["checkout_url"].startswith("https://checkout.stripe.com/"))
        pago = PagoStripe.objects.get()
        self.assertEqual(str(pago.monto), "800.00")
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PENDIENTE)
        self.assertEqual(pago.stripe_checkout_session_id, f"cs_test_{pago.id}")
        self.assertEqual(pago.solicitado_por, self.alumno.usuario)

    def test_alumno_elige_otra_membresia(self, crear):
        trimestral = Membresia.objects.create(nombre="Trimestral", duracion_dias=90, precio=2100)
        self.como(self.alumno.usuario)
        r = self.client.post(URL, {"membresia_id": trimestral.id}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(str(r.data["monto"]), "2100.00")

    def test_alumno_no_paga_por_otro(self, crear):
        otro = Alumno.objects.create(nombres="Luis", apellidos="Paz", membresia=self.mensual)
        self.como(self.alumno.usuario)
        r = self.client.post(URL, {"alumno_id": otro.id}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertFalse(PagoStripe.objects.exists())

    def test_maestro_y_anonimo_no_acceden(self, crear):
        maestro = Maestro.objects.create(nombre="Profe", usuario=User.objects.create_user("profe"))
        self.como(maestro.usuario)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 401)

    def test_admin_genera_liga_para_un_alumno(self, crear):
        self.como(self.admin)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 400)
        r = self.client.post(URL, {"alumno_id": self.alumno.id}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(PagoStripe.objects.get().solicitado_por, self.admin)

    def test_liga_pendiente_se_reutiliza(self, crear):
        self.como(self.alumno.usuario)
        r1 = self.client.post(URL, {}, format="json")
        r2 = self.client.post(URL, {}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.data["id"], r2.data["id"])
        self.assertEqual(crear.call_count, 1)

    def test_alumno_inactivo_o_sin_membresia_da_400(self, crear):
        sin_plan = Alumno.objects.create(nombres="Sin", apellidos="Plan")
        self.como(sin_plan.usuario)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 400)
        self.alumno.activo = False
        self.alumno.save()
        self.como(self.alumno.usuario)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 400)

    def test_membresia_bajo_el_minimo_de_stripe_da_400_sin_llamarle(self, crear):
        """Stripe no acepta menos de $10 MXN: se avisa claro en vez de un 502."""
        barata = Membresia.objects.create(nombre="Prueba", duracion_dias=1, precio="1.00")
        self.como(self.alumno.usuario)
        r = self.client.post(URL, {"membresia_id": barata.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("a partir de $10.00 MXN", str(r.data["membresia_id"]))
        self.assertIn("$1.00", str(r.data["membresia_id"]))
        crear.assert_not_called()
        self.assertFalse(PagoStripe.objects.exists())

    @override_settings(STRIPE_SECRET_KEY="")
    def test_sin_llaves_responde_503(self, crear):
        self.como(self.alumno.usuario)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 503)
        crear.assert_not_called()

    def test_error_de_stripe_da_502_y_queda_fallido(self, crear):
        crear.side_effect = stripe.APIConnectionError("sin red")
        self.como(self.alumno.usuario)
        r = self.client.post(URL, {}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(PagoStripe.objects.get().estatus, PagoStripe.Estatus.FALLIDO)

    def test_alumno_solo_ve_sus_pagos_y_consulta_su_sesion(self, crear):
        otro = Alumno.objects.create(nombres="Luis", apellidos="Paz", membresia=self.mensual)
        ajeno = self.crear_pago(alumno=otro)
        propio = self.crear_pago()
        self.como(self.alumno.usuario)
        r = self.client.get("/api/payments/")
        self.assertEqual([p["id"] for p in r.data["results"]], [propio.id])
        r = self.client.get("/api/payments/sesion/", {"session_id": propio.stripe_checkout_session_id})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["estatus"], "PENDIENTE")
        r = self.client.get("/api/payments/sesion/", {"session_id": ajeno.stripe_checkout_session_id})
        self.assertEqual(r.status_code, 404)


class CentavosTest(PagosStripeTestCase):
    def test_conversion_a_unidad_minima(self):
        from decimal import Decimal

        from ..services.stripe_service import a_centavos

        self.assertEqual(a_centavos(Decimal("499.00")), 49900)
        self.assertEqual(a_centavos(Decimal("0.295")), 30)
