"""
Único punto del sistema que habla con la API de Stripe. La llave secreta se
lee de settings (que a su vez la lee del .env) y nunca sale del backend.
"""
import json
from decimal import ROUND_HALF_UP, Decimal

import stripe
from django.conf import settings


class StripeNoConfigurado(Exception):
    """Falta STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET en el .env."""


class FirmaInvalida(Exception):
    """El webhook no viene de Stripe (o el payload se alteró)."""


def configurado() -> bool:
    return bool(settings.STRIPE_SECRET_KEY)


def modo() -> str:
    """'test' o 'live' según la llave configurada."""
    return "live" if settings.STRIPE_SECRET_KEY.startswith("sk_live_") else "test"


def _cliente() -> stripe.StripeClient:
    if not configurado():
        raise StripeNoConfigurado("STRIPE_SECRET_KEY no está configurada.")
    return stripe.StripeClient(settings.STRIPE_SECRET_KEY)


def a_centavos(monto: Decimal) -> int:
    """$499.00 -> 49900. Stripe cobra en la unidad mínima de la moneda."""
    return int((Decimal(monto) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def crear_checkout(pago_stripe):
    """Crea la Checkout Session de un PagoStripe PENDIENTE y la devuelve."""
    membresia = pago_stripe.membresia
    usuario = pago_stripe.alumno.usuario
    params = {
        "mode": "payment",
        "locale": "es",
        "client_reference_id": str(pago_stripe.referencia),
        "line_items": [
            {
                "price_data": {
                    "currency": pago_stripe.moneda.lower(),
                    "product_data": {
                        "name": membresia.nombre,
                        "description": f"{membresia.duracion_dias} días · {pago_stripe.alumno.nombre_completo}",
                    },
                    "unit_amount": a_centavos(pago_stripe.monto),
                },
                "quantity": 1,
            }
        ],
        # Solo ids internos: nada sensible viaja en metadata.
        "metadata": {
            "pago_stripe_id": str(pago_stripe.id),
            "alumno_id": str(pago_stripe.alumno_id),
            "membresia_id": str(membresia.id),
        },
        "success_url": f"{settings.STRIPE_SUCCESS_URL}?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": settings.STRIPE_CANCEL_URL,
    }
    if usuario and usuario.email:
        params["customer_email"] = usuario.email
    return _cliente().v1.checkout.sessions.create(
        params=params,
        options={"idempotency_key": f"checkout-{pago_stripe.referencia}"},
    )


def reembolsar(pago_stripe):
    """Pide el reembolso total a Stripe. El estatus lo cambia el webhook charge.refunded."""
    return _cliente().v1.refunds.create(
        params={"payment_intent": pago_stripe.stripe_payment_intent_id},
        options={"idempotency_key": f"refund-{pago_stripe.referencia}"},
    )


def saldo() -> dict:
    """Saldo de la cuenta de Stripe (disponible y en tránsito), por moneda."""
    balance = _cliente().v1.balance.retrieve()
    return {
        "disponible": [
            {"moneda": b.currency.upper(), "monto": Decimal(b.amount) / 100}
            for b in balance.available
        ],
        "pendiente": [
            {"moneda": b.currency.upper(), "monto": Decimal(b.amount) / 100}
            for b in balance.pending
        ],
    }


def verificar_evento(payload: bytes, firma: str) -> dict:
    """
    Verifica la firma `Stripe-Signature` sobre el cuerpo CRUDO y devuelve el
    evento como dict. Sin firma válida no se procesa nada.
    """
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise StripeNoConfigurado("STRIPE_WEBHOOK_SECRET no está configurada.")
    try:
        stripe.WebhookSignature.verify_header(
            payload, firma, settings.STRIPE_WEBHOOK_SECRET, tolerance=300
        )
        return json.loads(payload)
    except (stripe.SignatureVerificationError, ValueError) as e:
        raise FirmaInvalida(str(e)) from e
