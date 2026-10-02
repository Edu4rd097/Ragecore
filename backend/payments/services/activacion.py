"""Efecto de un pago en línea sobre la membresía del alumno."""
from django.utils import timezone

from core.models import Pago


def activar_membresia(pago_stripe) -> Pago:
    """
    Registra el core.Pago que cubre los días de la membresía comprada.

    El vencimiento lo calcula Pago.save igual que un pago en caja: si el
    alumno sigue vigente, los días se suman a los que le quedan.
    """
    alumno, membresia = pago_stripe.alumno, pago_stripe.membresia

    pago = Pago.objects.create(  # post_save -> comprobante por correo
        alumno=alumno,
        membresia=membresia,
        monto=pago_stripe.monto,
        metodo=Pago.Metodo.TARJETA,
        fecha_pago=timezone.localdate(),
        duracion=membresia.duracion_dias,
        nota=f"Pago en línea Stripe · {pago_stripe.stripe_checkout_session_id}",
    )
    if alumno.membresia_id != membresia.id:
        alumno.membresia = membresia
        alumno.save(update_fields=["membresia", "actualizado_en"])
    return pago


def revertir_membresia(pago_stripe):
    """Reembolso: el Pago deja de cubrir días; el PagoStripe queda como auditoría."""
    if pago_stripe.pago_id:
        pago_stripe.pago.delete()
        pago_stripe.pago = None
