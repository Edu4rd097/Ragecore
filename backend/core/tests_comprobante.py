"""
Comprobante de pago (correo, vista web y PDF): total bien formateado, saldo
cuando es abono, periodo real (con días acumulados) y marca RageCore.
"""
import shutil
import tempfile
from datetime import date

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.comprobante import datos_comprobante, generar_comprobante_pdf, pesos
from core.models import Alumno, Membresia, Pago

MEDIA_TEMPORAL = tempfile.mkdtemp(prefix="comprobante-")


@override_settings(MEDIA_ROOT=MEDIA_TEMPORAL, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class ComprobanteTest(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TEMPORAL, ignore_errors=True)

    def setUp(self):
        self.anual = Membresia.objects.create(nombre="Anual", duracion_dias=365, precio="7200.00")
        self.trimestral = Membresia.objects.create(nombre="Trimestral", duracion_dias=90, precio="2100.00")
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", apodo="La Roca")
        self.alumno.usuario.email = "ana@correo.test"
        self.alumno.usuario.save()

    def test_formato_de_moneda(self):
        self.assertEqual(pesos("2100"), "$2,100.00")
        self.assertEqual(pesos("7200.5"), "$7,200.50")

    def test_total_es_el_monto_cobrado_y_el_abono_muestra_saldo(self):
        pago = Pago.objects.create(alumno=self.alumno, membresia=self.anual, monto="300.00",
                                   fecha_pago=date(2026, 9, 9))
        d = datos_comprobante(pago)
        self.assertEqual(d["total"], "$300.00")
        self.assertEqual(d["precio"], "$7,200.00")
        self.assertEqual(d["saldo"], "$6,900.00")

    def test_pago_completo_no_muestra_saldo(self):
        pago = Pago.objects.create(alumno=self.alumno, membresia=self.trimestral, monto="2100.00",
                                   fecha_pago=date(2026, 9, 9))
        self.assertIsNone(datos_comprobante(pago)["saldo"])

    def test_periodo_refleja_los_dias_acumulados(self):
        Pago.objects.create(alumno=self.alumno, membresia=self.trimestral, monto="2100",
                            fecha_pago=date(2026, 1, 1))                   # hasta 1/abr
        segundo = Pago.objects.create(alumno=self.alumno, membresia=self.trimestral, monto="2100",
                                      fecha_pago=date(2026, 2, 15))
        d = datos_comprobante(segundo)
        self.assertEqual(d["cubre_desde"], "01/04/2026")
        self.assertEqual(d["vence"], "30/06/2026")
        self.assertTrue(d["acumulado"])

    def test_correo_con_marca_ragecore_y_pdf_adjunto(self):
        mail.outbox.clear()
        pago = Pago.objects.create(alumno=self.alumno, membresia=self.trimestral, monto="2100.00")
        correo = mail.outbox[-1]
        self.assertIn("RageCore", correo.subject)
        html = correo.alternatives[0][0]
        self.assertIn("RAGECORE", html)
        self.assertNotIn("CASA BRAVA", html.upper())
        self.assertIn("$2,100.00", html)
        nombre, contenido, tipo = correo.attachments[0]
        self.assertEqual(nombre, f"comprobante-{pago.id:06d}.pdf")
        self.assertTrue(contenido.startswith(b"%PDF"))

    def test_vista_web_y_pdf_por_api_con_permisos(self):
        pago = Pago.objects.create(alumno=self.alumno, membresia=self.anual, monto="300.00")
        cliente = APIClient()
        cliente.force_authenticate(self.alumno.usuario)
        r = cliente.get(f"/api/pagos/{pago.id}/comprobante/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Saldo pendiente", r.content.decode())
        r = cliente.get(f"/api/pagos/{pago.id}/comprobante/?formato=pdf")
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(r.content.startswith(b"%PDF"))

        otro = Alumno.objects.create(nombres="Otro", apellidos="Alumno")
        cliente.force_authenticate(otro.usuario)
        self.assertEqual(cliente.get(f"/api/pagos/{pago.id}/comprobante/").status_code, 404)
        admin = User.objects.create_user("admin-comp", password="x12345678", is_staff=True)
        cliente.force_authenticate(admin)
        self.assertEqual(cliente.get(f"/api/pagos/{pago.id}/comprobante/").status_code, 200)

    def test_pdf_sin_membresia_ni_vencimiento(self):
        pago = Pago.objects.create(alumno=self.alumno, monto="150.00")
        self.assertTrue(generar_comprobante_pdf(pago).startswith(b"%PDF"))
