from django.contrib import admin

from .models import EventoStripe, PagoStripe


@admin.register(PagoStripe)
class PagoStripeAdmin(admin.ModelAdmin):
    """Solo lectura: el estatus lo mueve el webhook de Stripe, nunca una edición a mano."""

    list_display = ["id", "alumno", "membresia", "monto", "moneda", "estatus", "pagado_en", "creado_en"]
    list_filter = ["estatus", "membresia", "creado_en"]
    search_fields = [
        "alumno__nombres", "alumno__apellidos", "referencia",
        "stripe_checkout_session_id", "stripe_payment_intent_id",
    ]
    readonly_fields = [f.name for f in PagoStripe._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(EventoStripe)
class EventoStripeAdmin(admin.ModelAdmin):
    list_display = ["event_id", "tipo", "pago_stripe", "procesado_en"]
    list_filter = ["tipo"]
    search_fields = ["event_id"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
