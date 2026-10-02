"""
Punto único de envío de correos y de renderizado de PDF de la academia.

Ningún llamador debe preocuparse por excepciones de SMTP/PDF: esta capa las
atrapa todas, las loggea, y persiste el resultado en la fila correspondiente
(Notificacion.estado_correo / Pago.comprobante_enviado_en) — nunca las deja
propagar, para no romper la transacción de negocio que disparó el envío
(ej. un pago se guarda aunque el correo del comprobante falle).
"""
import logging
from io import BytesIO

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone
from xhtml2pdf import pisa

logger = logging.getLogger(__name__)


def renderizar_pdf(html: str) -> bytes:
    """Convierte un HTML (ya renderizado) a PDF. CSS soportado: el subset de
    xhtml2pdf (tablas/floats/bloques) — nada de flexbox/grid."""
    buffer = BytesIO()
    pisa.CreatePDF(src=html, dest=buffer)
    return buffer.getvalue()


def _correo_de(alumno) -> str:
    if alumno.usuario_id and alumno.usuario.email:
        return alumno.usuario.email
    return ""


def _enviar(destinatario: str, asunto: str, plantilla: str, contexto: dict, adjuntos=None):
    """Devuelve (ok: bool, error: str). Nunca lanza."""
    if not destinatario:
        return False, "El alumno no tiene correo registrado (sin cuenta o sin email)."
    contexto = {**contexto, "frontend_url": settings.FRONTEND_URL}
    try:
        html = render_to_string(f"correos/{plantilla}.html", contexto)
        texto = render_to_string(f"correos/{plantilla}.txt", contexto)
        mensaje = EmailMultiAlternatives(asunto, texto, settings.DEFAULT_FROM_EMAIL, [destinatario])
        mensaje.attach_alternative(html, "text/html")
        for nombre, contenido, tipo in adjuntos or []:
            mensaje.attach(nombre, contenido, tipo)
        mensaje.send(fail_silently=False)
        return True, ""
    except Exception as e:  # nunca debe tumbar al llamador
        logger.exception("Fallo al enviar correo '%s' a %s", plantilla, destinatario)
        return False, str(e)


def enviar_notificacion(notificacion) -> bool:
    """
    Envía por correo una Notificacion ya existente (avisos manuales,
    recordatorios de vencimiento, insignias). Idempotente: si el canal no es
    EMAIL, o si ya se mandó (estado_correo=ENVIADO), no hace nada.
    """
    from .models import Notificacion  # import local: evita ciclo con models

    if notificacion.canal != Notificacion.Canal.EMAIL:
        return True
    if notificacion.estado_correo == Notificacion.EstadoCorreo.ENVIADO:
        return True

    alumno = notificacion.alumno
    ok, error = _enviar(
        _correo_de(alumno),
        asunto=notificacion.titulo or notificacion.get_tipo_display(),
        plantilla="notificacion",
        contexto={"alumno": alumno, "notificacion": notificacion},
    )
    Notificacion.objects.filter(pk=notificacion.pk).update(
        estado_correo=Notificacion.EstadoCorreo.ENVIADO if ok else Notificacion.EstadoCorreo.FALLIDO,
        enviado_en=timezone.now() if ok else None,
        error_correo="" if ok else error,
    )
    return ok


def enviar_comprobante(pago) -> bool:
    """
    Correo de comprobante de pago, con el PDF adjunto. Nunca lanza; el
    resultado exitoso se guarda en Pago.comprobante_enviado_en (idempotencia:
    quien dispare esto debe evitar llamarlo dos veces para el mismo pago).
    """
    from .models import Pago  # import local: evita ciclo con models

    from .comprobante import datos_comprobante, generar_comprobante_pdf, nombre_archivo

    alumno = pago.alumno
    contexto = datos_comprobante(pago)
    adjunto = None
    try:
        adjunto = (nombre_archivo(pago), generar_comprobante_pdf(pago), "application/pdf")
    except Exception:
        logger.exception("No se pudo generar el PDF del comprobante del pago %s", pago.id)

    ok, error = _enviar(
        _correo_de(alumno),
        asunto=f"Tu comprobante de pago #{pago.id:06d} — RageCore",
        plantilla="comprobante",
        contexto=contexto,
        adjuntos=[adjunto] if adjunto else None,
    )
    if ok:
        Pago.objects.filter(pk=pago.pk).update(comprobante_enviado_en=timezone.now())
    else:
        logger.warning("No se pudo enviar el comprobante del pago %s: %s", pago.id, error)
    return ok
