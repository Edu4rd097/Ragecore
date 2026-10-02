"""Dashboard en tiempo real, polling por cursor, saldo y reembolsos."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.utils import timezone

from ..models import PagoStripe
from .base import PagosStripeTestCase

URL = "/api/payments/"


class DashboardTest(PagosStripeTestCase):
    def test_solo_el_administrativo_ve_el_dashboard(self):
        self.como(self.alumno.usuario)
        for ruta in ("dashboard/", "cambios/?desde=2026-01-01T00:00:00Z", "saldo/"):
            self.assertEqual(self.client.get(URL + ruta).status_code, 403, ruta)

    def test_dashboard_resume_lo_confirmado_por_stripe(self):
        pagado = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(pagado))
        self.crear_pago()  # pendiente
        self.como(self.admin)

        r = self.client.get(URL + "dashboard/")
        self.assertEqual(r.status_code, 200)
        resumen = r.data["resumen"]
        self.assertEqual(resumen["cobrado_hoy"]["cantidad"], 1)
        self.assertEqual(str(resumen["cobrado_mes"]["total"]), "800.00")
        self.assertEqual(resumen["pendientes"]["cantidad"], 1)
        self.assertEqual(resumen["tasa_conversion_mes"], 50.0)
        self.assertEqual(r.data["serie_diaria"][0]["cantidad"], 1)
        self.assertEqual(r.data["por_membresia_mes"][0]["membresia__nombre"], "Mensualidad")
        self.assertEqual(r.data["webhook"]["ultimo_evento"]["tipo"], "checkout.session.completed")
        self.assertEqual(r.data["stripe"], {
            "configurado": True, "webhook_configurado": True, "modo": "test", "moneda": "MXN",
        })
        self.assertIn("cursor", r.data)

    def test_cambios_entrega_lo_modificado_despues_del_cursor(self):
        viejo = self.crear_pago()
        PagoStripe.objects.filter(pk=viejo.pk).update(actualizado_en=timezone.now() - timedelta(minutes=5))
        self.como(self.admin)
        desde = (timezone.now() - timedelta(minutes=1)).isoformat()

        r = self.client.get(URL + "cambios/", {"desde": desde})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["hay_cambios"])

        nuevo = self.crear_pago()
        self.webhook("checkout.session.completed", self.sesion(nuevo))
        r = self.client.get(URL + "cambios/", {"desde": desde})
        self.assertTrue(r.data["hay_cambios"])
        self.assertEqual([p["id"] for p in r.data["pagos"]], [nuevo.id])
        self.assertEqual(r.data["pagos"][0]["estatus"], "PAGADO")
        self.assertGreater(r.data["cursor"], desde)

    def test_cambios_sin_cursor_valido_da_400(self):
        self.como(self.admin)
        self.assertEqual(self.client.get(URL + "cambios/").status_code, 400)
        self.assertEqual(self.client.get(URL + "cambios/", {"desde": "ayer"}).status_code, 400)

    @patch("payments.services.stripe_service.saldo")
    def test_saldo_en_vivo(self, saldo):
        saldo.return_value = {"disponible": [{"moneda": "MXN", "monto": 1500}], "pendiente": []}
        self.como(self.admin)
        r = self.client.get(URL + "saldo/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["disponible"][0]["monto"], 1500)

    @patch("payments.services.stripe_service.reembolsar", return_value=SimpleNamespace(id="re_1"))
    def test_reembolso_se_pide_a_stripe_y_espera_el_webhook(self, reembolsar):
        pago = self.crear_pago()
        self.como(self.admin)
        self.assertEqual(self.client.post(f"{URL}{pago.id}/reembolsar/").status_code, 400)

        self.webhook("checkout.session.completed", self.sesion(pago))
        r = self.client.post(f"{URL}{pago.id}/reembolsar/")
        self.assertEqual(r.status_code, 202)
        reembolsar.assert_called_once()
        pago.refresh_from_db()
        self.assertEqual(pago.estatus, PagoStripe.Estatus.PAGADO)  # hasta que llegue charge.refunded

    def test_alumno_no_reembolsa(self):
        pago = self.crear_pago()
        self.como(self.alumno.usuario)
        self.assertEqual(self.client.post(f"{URL}{pago.id}/reembolsar/").status_code, 403)
