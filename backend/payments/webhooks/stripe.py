"""
Webhook de Stripe: la ÚNICA fuente de verdad del estado de un pago. La
success_url del frontend es solo UX; nada se activa por visitarla.

Garantías:
- Firma verificada sobre el cuerpo crudo antes de leer nada.
- Idempotencia por event_id (EventoStripe) y por estatus del PagoStripe:
  un evento repetido nunca activa dos veces una membresía.
- Todo en una transacción: si algo falla se responde 500, no queda el
  evento registrado y Stripe lo reintenta.
"""
import logging

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from ..models import EventoStripe, PagoStripe
from ..services import stripe_service
from ..services.activacion import activar_membresia, revertir_membresia

logger = logging.getLogger("payments")


@csrf_exempt
@require_POST
def stripe_webhook(request):
    try:
        evento = stripe_service.verificar_evento(
            request.body, request.META.get("HTTP_STRIPE_SIGNATURE", "")
        )
    except stripe_service.StripeNoConfigurado:
        logger.error("Webhook de Stripe recibido sin STRIPE_WEBHOOK_SECRET configurado.")
        return HttpResponse(status=503)
    except stripe_service.FirmaInvalida:
        logger.warning("Webhook de Stripe con firma inválida; se descarta.")
        return HttpResponse(status=400)

    event_id, tipo = evento.get("id"), evento.get("type", "")
    try:
        with transaction.atomic():
            if EventoStripe.objects.filter(event_id=event_id).exists():
                logger.info("Evento %s (%s) repetido; ya estaba procesado.", event_id, tipo)
                return HttpResponse(status=200)
            pago_stripe = procesar_evento(tipo, evento["data"]["object"])
            EventoStripe.objects.create(event_id=event_id, tipo=tipo, pago_stripe=pago_stripe)
    except IntegrityError:
        # Otra entrega simultánea del mismo evento ganó la carrera.
        return HttpResponse(status=200)
    except Exception:
        logger.exception("Error procesando el evento %s (%s); Stripe lo reintentará.", event_id, tipo)
        return HttpResponse(status=500)

    logger.info(
        "Evento %s (%s) procesado · pago_stripe=%s estatus=%s",
        event_id, tipo, getattr(pago_stripe, "id", None), getattr(pago_stripe, "estatus", None),
    )
    return HttpResponse(status=200)


def procesar_evento(tipo: str, objeto: dict):
    """Aplica el evento y devuelve el PagoStripe afectado (o None si no es nuestro)."""
    if tipo.startswith("checkout.session."):
        pago = _pago_de_sesion(objeto)
        if pago is None:
            return None
        if tipo == "checkout.session.completed":
            if objeto.get("payment_status") in ("paid", "no_payment_required"):
                _marcar_pagado(pago, objeto)
            elif pago.estatus == PagoStripe.Estatus.PENDIENTE:
                # Métodos diferidos (OXXO, transferencia): se confirma después
                # con checkout.session.async_payment_succeeded.
                _cambiar_estatus(pago, PagoStripe.Estatus.PROCESANDO)
        elif tipo == "checkout.session.async_payment_succeeded":
            _marcar_pagado(pago, objeto)
        elif tipo == "checkout.session.async_payment_failed":
            if pago.estatus != PagoStripe.Estatus.PAGADO:
                _cambiar_estatus(pago, PagoStripe.Estatus.FALLIDO, "El pago diferido no se completó.")
        elif tipo == "checkout.session.expired":
            if pago.estatus in (PagoStripe.Estatus.PENDIENTE, PagoStripe.Estatus.PROCESANDO):
                _cambiar_estatus(pago, PagoStripe.Estatus.CANCELADO)
        return pago

    if tipo == "charge.refunded":
        pago = (
            PagoStripe.objects.select_for_update()
            .filter(stripe_payment_intent_id=objeto.get("payment_intent"))
            .first()
        )
        if pago is None:
            return None
        if objeto.get("refunded") and pago.estatus == PagoStripe.Estatus.PAGADO:
            revertir_membresia(pago)
            _cambiar_estatus(pago, PagoStripe.Estatus.REEMBOLSADO)
        elif not objeto.get("refunded"):
            logger.warning("Reembolso parcial en pago_stripe=%s; la membresía se conserva.", pago.id)
        return pago

    return None


def _pago_de_sesion(sesion: dict):
    pago_id = (sesion.get("metadata") or {}).get("pago_stripe_id")
    pago = PagoStripe.objects.select_for_update().filter(pk=pago_id).first() if pago_id else None
    if pago is None:
        logger.warning("Sesión %s sin PagoStripe asociado; se ignora.", sesion.get("id"))
        return None
    if pago.stripe_checkout_session_id and pago.stripe_checkout_session_id != sesion.get("id"):
        logger.warning(
            "La sesión %s no corresponde al pago_stripe=%s; se ignora.", sesion.get("id"), pago.id
        )
        return None
    return pago


def _marcar_pagado(pago: PagoStripe, sesion: dict):
    if pago.estatus in (PagoStripe.Estatus.PAGADO, PagoStripe.Estatus.REEMBOLSADO):
        return
    esperado = stripe_service.a_centavos(pago.monto)
    if sesion.get("amount_total") != esperado or (sesion.get("currency") or "").lower() != pago.moneda.lower():
        _cambiar_estatus(
            pago,
            PagoStripe.Estatus.FALLIDO,
            f"Importe recibido {sesion.get('amount_total')} {sesion.get('currency')} "
            f"no coincide con el esperado {esperado} {pago.moneda}.",
        )
        logger.error("Importe inconsistente en pago_stripe=%s; no se activa la membresía.", pago.id)
        return
    pago.stripe_checkout_session_id = sesion.get("id")
    pago.stripe_payment_intent_id = sesion.get("payment_intent") or None
    pago.pagado_en = timezone.now()
    pago.estatus = PagoStripe.Estatus.PAGADO
    pago.detalle_error = ""
    pago.pago = activar_membresia(pago)
    pago.save()


def _cambiar_estatus(pago: PagoStripe, estatus, detalle: str = ""):
    pago.estatus = estatus
    if detalle:
        pago.detalle_error = detalle
    pago.save()
