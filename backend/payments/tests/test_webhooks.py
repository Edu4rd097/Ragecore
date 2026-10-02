"""Webhook: firma, idempotencia, activación y reversión de la membresía."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from core.models import Pago

from ..models import EventoStripe, PagoStripe
from .base import PagosStripeTestCase


class WebhookTest(PagosStripeTestCase):
    def test_firma_invalida_se_rechaza_sin_tocar_nada(self):
        pago = self.crear_pago()
        r = self.webhook("checkout.session.completed", self.sesion(pago), secreto="whsec_falso")
        self.assertEqual(r.status_code, 400)
        r = self.webhook("checkout.session.completed", self.sesion(pago), firma="")
        self.assertEqual(r.status_code, 400)
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PENDIENTE)
        self.assertFalse(Pago.objects.exists())

    @override_settings(STRIPE_WEBHOOK_SECRET="")
    def test_sin_secreto_de_webhook_responde_503(self):
        pago = self.crear_pago()
        self.assertEqual(self.webhook("checkout.session.completed", self.sesion(pago)).status_code, 503)

    def test_pago_completado_activa_la_membresia(self):
        pago = self.crear_pago()
        self.assertFalse(self.alumno.al_corriente)
        r = self.webhook("checkout.session.completed", self.sesion(pago))
        self.assertEqual(r.status_code, 200)

        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PAGADO)
        self.assertEqual(pago.stripe_payment_intent_id, f"pi_{pago.id}")
        self.assertIsNotNone(pago.pagado_en)
        self.assertEqual(pago.pago.metodo, Pago.Metodo.TARJETA)
        self.assertEqual(pago.pago.fecha_vencimiento, timezone.localdate() + timedelta(days=30))
        self.assertTrue(self.alumno.al_corriente)

    def test_evento_repetido_no_activa_dos_veces(self):
        pago = self.crear_pago()
        for _ in range(3):
            r = self.webhook("checkout.session.completed", self.sesion(pago), event_id="evt_repetido")
            self.assertEqual(r.status_code, 200)
        self.assertEqual(Pago.objects.count(), 1)
        self.assertEqual(EventoStripe.objects.count(), 1)

    def test_eventos_distintos_de_la_misma_sesion_tampoco_duplican(self):
        pago = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pago))
        self.webhook("checkout.session.async_payment_succeeded", self.sesion(pago))
        self.assertEqual(Pago.objects.count(), 1)

    def test_renovar_antes_de_vencer_suma_los_dias(self):
        hoy = timezone.localdate()
        Pago.objects.create(alumno=self.alumno, monto=800, fecha_pago=hoy - timedelta(days=20), duracion=30)
        pago = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pago))
        pago.refresh_from_db()
        self.assertEqual(pago.pago.fecha_vencimiento, hoy + timedelta(days=10 + 30))

    def test_importe_distinto_no_activa(self):
        pago = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pago, amount_total=100))
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.FALLIDO)
        self.assertIn("no coincide", pago.detalle_error)
        self.assertFalse(Pago.objects.exists())

    def test_sesion_que_no_corresponde_se_ignora(self):
        pago = self.crear_pago()
        r = self.webhook("checkout.session.completed", self.sesion(pago, id="cs_test_otra"))
        self.assertEqual(r.status_code, 200)
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PENDIENTE)

    def test_pago_diferido_pasa_por_procesando(self):
        pago = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pago, payment_status="unpaid"))
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PROCESANDO)
        self.assertFalse(Pago.objects.exists())

        self.webhook("checkout.session.async_payment_succeeded", self.sesion(pago))
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PAGADO)

    def test_pago_diferido_fallido(self):
        pago = self.crear_pago(estatus=PagoStripe.Estatus.PROCESANDO)
        self.webhook("checkout.session.async_payment_failed", self.sesion(pago))
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.FALLIDO)

    def test_sesion_expirada_se_cancela(self):
        pago = self.crear_pago()
        self.webhook("checkout.session.expired", self.sesion(pago, payment_status="unpaid"))
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.CANCELADO)

    def test_reembolso_total_revierte_la_membresia(self):
        pago = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pago))
        self.assertTrue(self.alumno.al_corriente)

        r = self.webhook("charge.refunded", {"id": "ch_1", "payment_intent": f"pi_{pago.id}", "refunded": True})
        self.assertEqual(r.status_code, 200)
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.REEMBOLSADO)
        self.assertIsNone(pago.pago)
        self.assertFalse(Pago.objects.exists())
        self.assertFalse(self.alumno.al_corriente)

    def test_reembolso_parcial_conserva_la_membresia(self):
        pago = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pago))
        self.webhook("charge.refunded", {"id": "ch_1", "payment_intent": f"pi_{pago.id}", "refunded": False})
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PAGADO)
        self.assertEqual(Pago.objects.count(), 1)

    def test_evento_desconocido_se_acepta_sin_efecto(self):
        r = self.webhook("customer.created", {"id": "cus_1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(EventoStripe.objects.get().tipo, "customer.created")

    def test_solo_acepta_post(self):
        self.assertEqual(self.client.get("/api/payments/webhook/stripe/").status_code, 405)
