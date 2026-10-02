"""Utilidades compartidas por las pruebas de pagos en línea."""
import hashlib
import hmac
import json
import shutil
import tempfile
import time
from decimal import Decimal
from itertools import count

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.models import Alumno, Membresia

from ..models import PagoStripe
from ..services.stripe_service import a_centavos

WEBHOOK_SECRET = "whsec_pruebas"
URL_WEBHOOK = "/api/payments/webhook/stripe/"
_ids = count(1)

MEDIA_TMP = tempfile.mkdtemp(prefix="pagos-stripe-")


@override_settings(
    STRIPE_SECRET_KEY="sk_test_pruebas",
    STRIPE_WEBHOOK_SECRET=WEBHOOK_SECRET,
    STRIPE_CURRENCY="mxn",
    MEDIA_ROOT=MEDIA_TMP,
)
class PagosStripeTestCase(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TMP, ignore_errors=True)

    def setUp(self):
        self.admin = User.objects.create_user("admin", password="x12345678", is_staff=True)
        self.mensual = Membresia.objects.create(nombre="Mensualidad", duracion_dias=30, precio="800.00")
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", membresia=self.mensual)
        self.client = APIClient()

    def como(self, usuario):
        self.client.force_authenticate(usuario)

    def crear_pago(self, **extra):
        datos = {
            "alumno": self.alumno,
            "membresia": self.mensual,
            "monto": self.mensual.precio,
            "moneda": "MXN",
            "stripe_checkout_session_id": f"cs_test_{next(_ids)}",
        }
        datos.update(extra)
        return PagoStripe.objects.create(**datos)

    def webhook(self, tipo, objeto, event_id=None, secreto=WEBHOOK_SECRET, firma=None):
        """Manda un evento con la misma firma HMAC que usa Stripe."""
        cuerpo = json.dumps(
            {"id": event_id or f"evt_{next(_ids)}", "type": tipo, "data": {"object": objeto}}
        )
        if firma is None:
            ts = int(time.time())
            digest = hmac.new(secreto.encode(), f"{ts}.{cuerpo}".encode(), hashlib.sha256).hexdigest()
            firma = f"t={ts},v1={digest}"
        return self.client.generic(
            "POST", URL_WEBHOOK, cuerpo, content_type="application/json", HTTP_STRIPE_SIGNATURE=firma
        )

    @staticmethod
    def sesion(pago, **extra):
        objeto = {
            "id": pago.stripe_checkout_session_id,
            "object": "checkout.session",
            "payment_status": "paid",
            "amount_total": a_centavos(Decimal(str(pago.monto))),
            "currency": "mxn",
            "payment_intent": f"pi_{pago.id}",
            "metadata": {"pago_stripe_id": str(pago.id)},
        }
        objeto.update(extra)
        return objeto
