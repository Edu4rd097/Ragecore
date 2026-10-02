"""
API de pagos en línea (/api/payments/).

- Alumno: paga SU membresía (checkout) y consulta sus pagos en línea.
- Administrativo: genera ligas de pago para cualquier alumno, ve todo,
  reembolsa y consulta el dashboard en tiempo real.
- Maestro: sin acceso (los pagos no son información permitida del maestro).

Tiempo real del dashboard: el webhook actualiza la BD en cuanto Stripe
confirma; el frontend carga /dashboard/ una vez y luego consulta
/cambios/?desde=<cursor> cada pocos segundos, repitiendo el cursor recibido.
"""
import logging
from datetime import timedelta
from decimal import Decimal

import stripe
from django.conf import settings
from django.db.models import Avg, Count, Sum
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from core.models import Alumno, Membresia
from core.permissions import EsAdministrativo, alumno_de, es_administrativo

from .models import EventoStripe, PagoStripe
from .serializers import CheckoutSerializer, PagoStripeSerializer
from .services import stripe_service

logger = logging.getLogger("payments")

# Una liga pendiente se reutiliza en vez de crear otra sesión (Stripe las
# expira a las 24 h).
VIGENCIA_LIGA = timedelta(hours=23)
# Solape del cursor de /cambios/: cubre filas cuya transacción se confirmó
# justo después de la consulta anterior. El cliente hace upsert por id.
SOLAPE_CURSOR = timedelta(seconds=5)
MAX_CAMBIOS = 100


class EsAdministrativoOAlumno(permissions.BasePermission):
    message = "Los pagos en línea son solo para alumnos y personal administrativo."

    def has_permission(self, request, view):
        return es_administrativo(request.user) or alumno_de(request.user) is not None


def _dinero(valor) -> Decimal:
    """Importes siempre con 2 decimales (SQLite devuelve 800 en vez de 800.00)."""
    return Decimal(valor or 0).quantize(Decimal("0.01"))


def _suma(qs):
    datos = qs.aggregate(total=Sum("monto"), cantidad=Count("id"))
    return {"total": _dinero(datos["total"]), "cantidad": datos["cantidad"]}


def _con_dinero(filas):
    return [{**f, "total": _dinero(f["total"])} for f in filas]


class PagoStripeViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PagoStripe.objects.select_related("alumno", "membresia")
    serializer_class = PagoStripeSerializer
    permission_classes = [EsAdministrativoOAlumno]
    filterset_fields = {
        "alumno": ["exact"],
        "estatus": ["exact"],
        "membresia": ["exact"],
        "creado_en": ["gte", "lte"],
    }
    # Solo lo lee ScopedRateThrottle, que únicamente declara la acción checkout.
    throttle_scope = "checkout"

    def get_queryset(self):
        qs = super().get_queryset()
        if es_administrativo(self.request.user):
            return qs
        return qs.filter(alumno=alumno_de(self.request.user))

    # --- Iniciar pago -------------------------------------------------------

    @action(detail=False, methods=["post"], throttle_classes=[ScopedRateThrottle])
    def checkout(self, request):
        """
        Body: {"membresia_id": 3} (alumno) o {"alumno_id": 12, "membresia_id": 3}
        (administrativo). Sin membresia_id se usa la del alumno. El precio
        SIEMPRE sale de la BD.
        """
        entrada = CheckoutSerializer(data=request.data)
        entrada.is_valid(raise_exception=True)
        datos = entrada.validated_data

        alumno = self._alumno_para_checkout(request.user, datos.get("alumno_id"))
        if not alumno.activo:
            raise ValidationError({"alumno_id": "El alumno está dado de baja."})

        membresia_id = datos.get("membresia_id") or alumno.membresia_id
        if not membresia_id:
            raise ValidationError({"membresia_id": "Indica qué membresía se va a pagar."})
        membresia = Membresia.objects.filter(pk=membresia_id).first()
        if membresia is None:
            raise ValidationError({"membresia_id": "La membresía no existe."})
        if membresia.precio <= 0:
            raise ValidationError({"membresia_id": "La membresía no tiene un precio cobrable."})
        minimo = settings.STRIPE_MONTO_MINIMO
        if membresia.precio < minimo:
            raise ValidationError({
                "membresia_id": (
                    f"El pago en línea es a partir de ${minimo:.2f} {settings.STRIPE_CURRENCY.upper()} "
                    f"y «{membresia.nombre}» cuesta ${membresia.precio:.2f}. Págala en recepción."
                )
            })

        if not stripe_service.configurado():
            return Response(
                {"detail": "Los pagos en línea no están configurados."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        vigente = (
            PagoStripe.objects.filter(
                alumno=alumno, membresia=membresia, monto=membresia.precio,
                estatus=PagoStripe.Estatus.PENDIENTE,
                creado_en__gte=timezone.now() - VIGENCIA_LIGA,
            )
            .exclude(checkout_url="")
            .first()
        )
        if vigente:
            return Response(self._respuesta_checkout(vigente), status=status.HTTP_200_OK)

        pago = PagoStripe.objects.create(
            alumno=alumno,
            membresia=membresia,
            solicitado_por=request.user,
            monto=membresia.precio,
            moneda=settings.STRIPE_CURRENCY.upper(),
        )
        try:
            sesion = stripe_service.crear_checkout(pago)
        except stripe.StripeError as e:
            pago.estatus = PagoStripe.Estatus.FALLIDO
            pago.detalle_error = f"No se pudo crear la sesión: {e.user_message or type(e).__name__}"
            pago.save()
            logger.error("Stripe rechazó la sesión de pago_stripe=%s: %s", pago.id, type(e).__name__)
            return Response(
                {"detail": "No se pudo iniciar el pago con Stripe. Intenta de nuevo."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        pago.stripe_checkout_session_id = sesion.id
        pago.checkout_url = sesion.url
        pago.save(update_fields=["stripe_checkout_session_id", "checkout_url", "actualizado_en"])
        logger.info(
            "Checkout creado · pago_stripe=%s alumno=%s usuario=%s sesion=%s",
            pago.id, alumno.id, request.user.id, sesion.id,
        )
        return Response(self._respuesta_checkout(pago), status=status.HTTP_201_CREATED)

    def _alumno_para_checkout(self, user, alumno_id):
        if es_administrativo(user):
            if not alumno_id:
                raise ValidationError({"alumno_id": "Indica a qué alumno se le cobra."})
            return get_object_or_404(Alumno, pk=alumno_id)
        propio = alumno_de(user)
        if alumno_id and alumno_id != propio.id:
            raise PermissionDenied("Solo puedes pagar tu propia membresía.")
        return propio

    @staticmethod
    def _respuesta_checkout(pago):
        return {
            "id": pago.id,
            "referencia": str(pago.referencia),
            "checkout_url": pago.checkout_url,
            "monto": pago.monto,
            "moneda": pago.moneda,
        }

    @action(detail=False, methods=["get"])
    def sesion(self, request):
        """Estado de un pago por session_id, para la pantalla de éxito del frontend."""
        session_id = request.query_params.get("session_id")
        if not session_id:
            raise ValidationError({"session_id": "Requerido."})
        pago = get_object_or_404(self.get_queryset(), stripe_checkout_session_id=session_id)
        return Response(self.get_serializer(pago).data)

    # --- Administración -----------------------------------------------------

    @action(detail=True, methods=["post"], permission_classes=[EsAdministrativo])
    def reembolsar(self, request, pk=None):
        """Pide el reembolso total a Stripe. El estatus cambia al llegar charge.refunded."""
        pago = self.get_object()
        if pago.estatus != PagoStripe.Estatus.PAGADO or not pago.stripe_payment_intent_id:
            raise ValidationError({"detail": "Solo se reembolsan pagos confirmados por Stripe."})
        try:
            stripe_service.reembolsar(pago)
        except stripe.StripeError as e:
            logger.error("Stripe rechazó el reembolso de pago_stripe=%s: %s", pago.id, type(e).__name__)
            return Response(
                {"detail": e.user_message or "Stripe rechazó el reembolso."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        logger.info("Reembolso solicitado · pago_stripe=%s usuario=%s", pago.id, request.user.id)
        return Response(
            {"detail": "Reembolso solicitado. Se reflejará cuando Stripe lo confirme."},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["get"], permission_classes=[EsAdministrativo])
    def dashboard(self, request):
        """Foto completa del tablero de pagos en línea. Incluye el cursor para /cambios/."""
        ahora = timezone.now()
        hoy = timezone.localdate()
        inicio_mes = hoy.replace(day=1)
        pagados = PagoStripe.objects.filter(estatus=PagoStripe.Estatus.PAGADO)
        pagados_mes = pagados.filter(pagado_en__date__gte=inicio_mes)
        creados_mes = PagoStripe.objects.filter(creado_en__date__gte=inicio_mes)
        total_creados_mes = creados_mes.count()
        ultimo_evento = EventoStripe.objects.first()

        return Response(
            {
                "cursor": (ahora - SOLAPE_CURSOR).isoformat(),
                "stripe": {
                    "configurado": stripe_service.configurado(),
                    "webhook_configurado": bool(settings.STRIPE_WEBHOOK_SECRET),
                    "modo": stripe_service.modo(),
                    "moneda": settings.STRIPE_CURRENCY.upper(),
                },
                "resumen": {
                    "periodo": f"{hoy.year}-{hoy.month:02d}",
                    "cobrado_hoy": _suma(pagados.filter(pagado_en__date=hoy)),
                    "cobrado_mes": _suma(pagados_mes),
                    "ticket_promedio_mes": _dinero(pagados_mes.aggregate(p=Avg("monto"))["p"]),
                    "reembolsado_mes": _suma(
                        PagoStripe.objects.filter(
                            estatus=PagoStripe.Estatus.REEMBOLSADO,
                            actualizado_en__date__gte=inicio_mes,
                        )
                    ),
                    "pendientes": _suma(
                        PagoStripe.objects.filter(
                            estatus__in=[PagoStripe.Estatus.PENDIENTE, PagoStripe.Estatus.PROCESANDO]
                        )
                    ),
                    "por_estatus_mes": {
                        e: creados_mes.filter(estatus=e).count() for e in PagoStripe.Estatus.values
                    },
                    "tasa_conversion_mes": (
                        round(creados_mes.filter(estatus=PagoStripe.Estatus.PAGADO).count() / total_creados_mes * 100, 1)
                        if total_creados_mes else 0
                    ),
                },
                "serie_diaria": _con_dinero(
                    pagados.filter(pagado_en__date__gte=hoy - timedelta(days=29))
                    .annotate(dia=TruncDate("pagado_en"))
                    .values("dia")
                    .annotate(total=Sum("monto"), cantidad=Count("id"))
                    .order_by("dia")
                ),
                "por_membresia_mes": _con_dinero(
                    pagados_mes.values("membresia", "membresia__nombre")
                    .annotate(total=Sum("monto"), cantidad=Count("id"))
                    .order_by("-total")
                ),
                "recientes": PagoStripeSerializer(
                    self.get_queryset().order_by("-actualizado_en")[:10], many=True
                ).data,
                "webhook": {
                    "ultimo_evento": (
                        {"tipo": ultimo_evento.tipo, "procesado_en": ultimo_evento.procesado_en}
                        if ultimo_evento else None
                    ),
                    "eventos_24h": EventoStripe.objects.filter(
                        procesado_en__gte=ahora - timedelta(hours=24)
                    ).count(),
                },
            }
        )

    @action(detail=False, methods=["get"], permission_classes=[EsAdministrativo])
    def cambios(self, request):
        """
        Polling del dashboard: ?desde=<cursor ISO-8601>. Devuelve los pagos
        creados o modificados después del cursor y el cursor siguiente.
        """
        crudo = (request.query_params.get("desde") or "").replace(" ", "+")
        desde = parse_datetime(crudo) if crudo else None
        if desde is None:
            raise ValidationError({"desde": "Fecha ISO-8601 requerida, ej. 2026-09-23T10:00:00-06:00."})
        if timezone.is_naive(desde):
            desde = timezone.make_aware(desde)

        ahora = timezone.now()
        pagos = list(
            self.get_queryset().filter(actualizado_en__gt=desde).order_by("actualizado_en")[:MAX_CAMBIOS]
        )
        # Página llena: se sigue desde el último entregado; si no, desde "ahora" con solape.
        siguiente = pagos[-1].actualizado_en if len(pagos) == MAX_CAMBIOS else ahora - SOLAPE_CURSOR
        return Response(
            {
                "cursor": max(siguiente, desde).isoformat(),
                "hay_cambios": bool(pagos),
                "pagos": PagoStripeSerializer(pagos, many=True).data,
            }
        )

    @action(detail=False, methods=["get"], permission_classes=[EsAdministrativo])
    def saldo(self, request):
        """Saldo de la cuenta de Stripe consultado en vivo a su API."""
        try:
            return Response(stripe_service.saldo())
        except stripe_service.StripeNoConfigurado:
            return Response(
                {"detail": "Los pagos en línea no están configurados."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except stripe.StripeError as e:
            logger.error("No se pudo consultar el saldo de Stripe: %s", type(e).__name__)
            return Response(
                {"detail": "Stripe no respondió. Intenta de nuevo."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
