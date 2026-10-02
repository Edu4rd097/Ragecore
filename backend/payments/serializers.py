from rest_framework import serializers

from .models import PagoStripe


class PagoStripeSerializer(serializers.ModelSerializer):
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    membresia_nombre = serializers.CharField(source="membresia.nombre", read_only=True)
    estatus_display = serializers.CharField(source="get_estatus_display", read_only=True)

    class Meta:
        model = PagoStripe
        fields = [
            "id", "referencia", "alumno", "alumno_nombre", "membresia", "membresia_nombre",
            "monto", "moneda", "estatus", "estatus_display", "checkout_url",
            "stripe_checkout_session_id", "stripe_payment_intent_id", "pago",
            "pagado_en", "detalle_error", "creado_en", "actualizado_en",
        ]
        read_only_fields = fields


class CheckoutSerializer(serializers.Serializer):
    """Lo único que manda el frontend: QUÉ comprar, nunca el precio."""

    membresia_id = serializers.IntegerField(required=False)
    alumno_id = serializers.IntegerField(required=False)
