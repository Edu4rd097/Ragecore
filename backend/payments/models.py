"""
Pagos en línea con Stripe Checkout.

`PagoStripe` es el intento de cobro: nace PENDIENTE al crear la Checkout
Session y solo el webhook firmado de Stripe lo mueve a PAGADO. Al pagarse se
crea el `core.Pago` de siempre, que es el que mueve vencimiento y semáforo del
alumno — así el resto del sistema no distingue un pago en caja de uno en línea.

Nunca se guarda información de la tarjeta: solo las referencias de Stripe.
"""
import uuid

from django.conf import settings
from django.db import models

from core.models import Alumno, Membresia, Pago, TimeStampedModel


class PagoStripe(TimeStampedModel):
    class Estatus(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        PROCESANDO = "PROCESANDO", "Procesando"
        PAGADO = "PAGADO", "Pagado"
        FALLIDO = "FALLIDO", "Fallido"
        CANCELADO = "CANCELADO", "Cancelado"
        REEMBOLSADO = "REEMBOLSADO", "Reembolsado"

    alumno = models.ForeignKey(Alumno, on_delete=models.PROTECT, related_name="pagos_stripe")
    membresia = models.ForeignKey(
        Membresia, on_delete=models.PROTECT, related_name="pagos_stripe"
    )
    solicitado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pagos_stripe_solicitados",
        help_text="Cuenta que generó la liga de pago (el alumno o un administrativo).",
    )
    # Precio tomado de la BD al crear la sesión: el frontend nunca lo manda.
    monto = models.DecimalField(max_digits=10, decimal_places=2)
    moneda = models.CharField(max_length=3, default="MXN")
    estatus = models.CharField(
        max_length=20, choices=Estatus.choices, default=Estatus.PENDIENTE
    )
    referencia = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    stripe_checkout_session_id = models.CharField(
        max_length=255, unique=True, null=True, blank=True
    )
    stripe_payment_intent_id = models.CharField(
        max_length=255, unique=True, null=True, blank=True
    )
    checkout_url = models.URLField(max_length=1000, blank=True)
    # El Pago de membresía que generó este cobro. Si se reembolsa, ese Pago
    # se borra (deja de cubrir días) y aquí queda el registro de auditoría.
    pago = models.OneToOneField(
        Pago, on_delete=models.SET_NULL, null=True, blank=True, related_name="stripe"
    )
    pagado_en = models.DateTimeField(null=True, blank=True)
    detalle_error = models.TextField(blank=True)

    class Meta:
        verbose_name = "Pago en línea"
        verbose_name_plural = "Pagos en línea"
        ordering = ["-creado_en", "-id"]
        indexes = [
            models.Index(fields=["estatus"]),
            # Cursor del polling del dashboard (/api/payments/cambios/?desde=).
            models.Index(fields=["actualizado_en"]),
        ]

    def __str__(self):
        return f"{self.alumno} - ${self.monto} - {self.get_estatus_display()}"


class EventoStripe(models.Model):
    """Evento de webhook ya procesado. `event_id` único = idempotencia."""

    event_id = models.CharField(max_length=255, unique=True)
    tipo = models.CharField(max_length=255)
    pago_stripe = models.ForeignKey(
        PagoStripe, on_delete=models.SET_NULL, null=True, blank=True, related_name="eventos"
    )
    procesado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Evento de Stripe"
        verbose_name_plural = "Eventos de Stripe"
        ordering = ["-procesado_en", "-id"]

    def __str__(self):
        return f"{self.tipo} ({self.event_id})"
