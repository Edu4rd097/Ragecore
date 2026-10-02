"""Rutas de pagos en línea, montadas en /api/payments/."""
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from . import views
from .webhooks.stripe import stripe_webhook

router = SimpleRouter()
router.register("", views.PagoStripeViewSet, basename="pago-stripe")

urlpatterns = [
    # Antes del router para que no la capture la ruta de detalle.
    path("webhook/stripe/", stripe_webhook, name="stripe-webhook"),
    path("", include(router.urls)),
]
