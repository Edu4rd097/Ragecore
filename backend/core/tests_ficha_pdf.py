"""
Ficha técnica en PDF y HTML (/api/alumnos/{id}/ficha-pdf/ y /ficha/) y
categorías de peso de MMA. Que la ficha se genere con
todos los datos del peleador y que respete el mismo alcance por rol que el
perfil (admin todo, maestro sus alumnos, alumno solo la suya).
"""
import shutil
import tempfile
from datetime import date, timedelta
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from core.ficha import datos_ficha, nombre_archivo
from core.ficha_pdf import generar_ficha_pdf
from core.models import (
    Alumno,
    AlumnoInsignia,
    CategoriaPeso,
    Disciplina,
    Evento,
    EventoInscripcion,
    Grado,
    Insignia,
    Maestro,
    Torneo,
)

MEDIA_TEMPORAL = tempfile.mkdtemp(prefix="ficha-pdf-")


def _foto_png():
    buffer = BytesIO()
    Image.new("RGBA", (320, 480), (0, 149, 255, 255)).save(buffer, format="PNG")
    return SimpleUploadedFile("foto.png", buffer.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=MEDIA_TEMPORAL)
class FichaPdfTest(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TEMPORAL, ignore_errors=True)

    def setUp(self):
        self.mma = Disciplina.objects.create(nombre="MMA")
        self.alumno = Alumno.objects.create(
            nombres="Ñoño", apellidos="Pérez", apodo="El Tanque", edad=24,
            peso_actual="77.50", estatura=178, foto=_foto_png(),
        )
        exp = self.alumno.experiencia
        exp.peleas_ganadas, exp.peleas_perdidas, exp.peleas_empatadas = 5, 2, 1
        exp.bjj_cinturon = "AZUL"
        exp.lesion_activa = True
        exp.detalle_lesion = "Esguince <leve> & tobillo"
        exp.notas_maestro = "Buen jab."
        exp.save()

        evento = Evento.objects.create(titulo="Copa Norte", tipo="TORNEO", fecha=date(2026, 5, 3))
        EventoInscripcion.objects.create(evento=evento, alumno=self.alumno, asistio=True)
        Evento.objects.create(titulo="Futuro", fecha=timezone.localdate() + timedelta(days=9))
        Torneo.objects.create(
            alumno=self.alumno, nombre_torneo="Copa Norte", fecha=date(2026, 5, 3),
            resultado="GANO", metodo="KO", disciplina=self.mma, evento=evento,
        )
        Torneo.objects.create(
            alumno=self.alumno, nombre_torneo="Open", fecha=date(2026, 3, 1), resultado="PERDIO"
        )
        Grado.objects.create(alumno=self.alumno, disciplina=self.mma, nombre_grado="Grado 2")
        for i in range(6):  # más de una fila de insignias
            insignia = Insignia.objects.create(nombre=f"Insignia {i}")
            AlumnoInsignia.objects.create(alumno=self.alumno, insignia=insignia)

        self.otro = Alumno.objects.create(nombres="Otro", apellidos="Alumno")
        self.admin = User.objects.create_user("admin-ficha", password="x12345678", is_staff=True)
        self.client = APIClient()

    def _pedir(self, alumno, usuario):
        self.client.force_authenticate(usuario)
        return self.client.get(f"/api/alumnos/{alumno.id}/ficha-pdf/")

    def test_admin_descarga_la_ficha_en_pdf(self):
        r = self._pedir(self.alumno, self.admin)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertIn('attachment; filename="ficha-el-tanque-', r["Content-Disposition"])
        self.assertTrue(r.content.startswith(b"%PDF"))

    def test_alumno_descarga_la_suya_pero_no_la_de_otro(self):
        self.assertEqual(self._pedir(self.alumno, self.alumno.usuario).status_code, 200)
        self.assertEqual(self._pedir(self.otro, self.alumno.usuario).status_code, 404)

    def test_maestro_solo_la_de_sus_alumnos(self):
        user = User.objects.create_user("profe-ficha", password="x12345678")
        maestro = Maestro.objects.create(nombre="Profe", usuario=user)
        maestro.alumnos_asignados.set([self.alumno])
        self.assertEqual(self._pedir(self.alumno, user).status_code, 200)
        self.assertEqual(self._pedir(self.otro, user).status_code, 404)

    def test_sin_sesion_no_hay_ficha(self):
        r = APIClient().get(f"/api/alumnos/{self.alumno.id}/ficha-pdf/")
        self.assertIn(r.status_code, (401, 403))

    def test_alumno_sin_datos_tambien_genera(self):
        """Sin foto, sin peleas, sin eventos: sale con iniciales y secciones vacías."""
        self.assertTrue(generar_ficha_pdf(self.otro).startswith(b"%PDF"))

    def test_nombre_de_archivo_solo_ascii(self):
        self.alumno.apodo = ""
        self.assertEqual(nombre_archivo(self.alumno), f"ficha-nono-perez-{self.alumno.id}.pdf")


class EstaturaTest(TestCase):
    def setUp(self):
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz")
        self.client = APIClient()

    def test_el_alumno_captura_su_estatura(self):
        self.client.force_authenticate(self.alumno.usuario)
        r = self.client.patch("/api/alumnos/yo/", {"estatura": 172}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["estatura"], 172)

    def test_estatura_fuera_de_rango(self):
        self.client.force_authenticate(self.alumno.usuario)
        r = self.client.patch("/api/alumnos/yo/", {"estatura": 17}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("estatura", r.data)


@override_settings(MEDIA_ROOT=MEDIA_TEMPORAL)
class FichaHtmlTest(TestCase):
    """Plantilla HTML de la ficha: mismo alcance por rol que el PDF."""

    def setUp(self):
        self.alumno = Alumno.objects.create(
            nombres="Ana", apellidos="Ruiz", apodo="<script>alert(1)</script>", peso_actual="65.00",
        )
        self.otro = Alumno.objects.create(nombres="Otro", apellidos="Alumno")
        self.admin = User.objects.create_user("admin-html", password="x12345678", is_staff=True)
        self.client = APIClient()

    def _pedir(self, alumno, usuario):
        self.client.force_authenticate(usuario)
        return self.client.get(f"/api/alumnos/{alumno.id}/ficha/")

    def test_admin_ve_la_ficha_en_html(self):
        r = self._pedir(self.alumno, self.admin)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r["Content-Type"].startswith("text/html"))
        html = r.content.decode()
        self.assertIn("ANA RUIZ".lower(), html.lower())
        self.assertIn("65 kg", html)
        self.assertIn("143.3 lb", html)
        self.assertIn("Peso pluma", html)

    def test_datos_del_usuario_van_escapados(self):
        html = self._pedir(self.alumno, self.admin).content.decode()
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_alcance_por_rol(self):
        self.assertEqual(self._pedir(self.alumno, self.alumno.usuario).status_code, 200)
        self.assertEqual(self._pedir(self.otro, self.alumno.usuario).status_code, 404)
        user = User.objects.create_user("profe-html", password="x12345678")
        maestro = Maestro.objects.create(nombre="Profe", usuario=user)
        maestro.alumnos_asignados.set([self.alumno])
        self.assertEqual(self._pedir(self.alumno, user).status_code, 200)
        self.assertEqual(self._pedir(self.otro, user).status_code, 404)
        self.assertIn(APIClient().get(f"/api/alumnos/{self.alumno.id}/ficha/").status_code, (401, 403))

    def test_sin_peso_pide_capturarlo(self):
        html = self._pedir(self.otro, self.admin).content.decode()
        self.assertIn("Captura el peso actual o de competencia", html)


class CategoriaPesoTest(TestCase):
    """Divisiones precargadas por la migración 0013 (Reglas Unificadas / IMMAF)."""

    def test_clasifica_por_limite_en_kg_mostrado(self):
        casos = {
            47.6: "Peso átomo", 50: "Peso paja", 56.7: "Peso mosca", 61.2: "Peso gallo",
            65.8: "Peso pluma", 65.9: "Peso ligero", 77.1: "Peso wélter", 83.9: "Peso medio",
            88: "Peso semipesado", 120.2: "Peso pesado", 130: "Peso superpesado",
        }
        for kg, esperada in casos.items():
            with self.subTest(kg=kg):
                self.assertEqual(CategoriaPeso.para_peso(kg)[0].nombre, esperada)

    def test_sin_peso_no_hay_categoria(self):
        self.assertEqual(CategoriaPeso.para_peso(None), (None, None))

    def test_usa_el_peso_de_competencia_si_existe(self):
        alumno = Alumno.objects.create(nombres="Leo", apellidos="Paz", peso_actual="80.00")
        alumno.experiencia.peso_competencia = "77.00"
        alumno.experiencia.save()
        peso = datos_ficha(alumno)["peso"]
        self.assertEqual(peso["categoria"]["nombre"], "Peso wélter")
        self.assertEqual(peso["fuente"], "peso de competencia")
        self.assertEqual(peso["actual_lb"], "176.4 lb")
        self.assertEqual(peso["competencia_lb"], "169.8 lb")

    def test_una_division_desactivada_no_se_usa(self):
        CategoriaPeso.objects.filter(nombre="Peso átomo").update(activa=False)
        self.assertEqual(CategoriaPeso.para_peso(45)[0].nombre, "Peso paja")

    def test_catalogo_por_api(self):
        alumno = Alumno.objects.create(nombres="Mia", apellidos="Sol")
        cliente = APIClient()
        cliente.force_authenticate(alumno.usuario)
        r = cliente.get("/api/categorias-peso/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data[4]["nombre"], "Peso pluma")
        self.assertEqual(r.data[4]["limite_kg"], "65.8")
        # El alumno solo consulta: editar es del administrativo.
        self.assertEqual(cliente.post("/api/categorias-peso/", {"nombre": "X"}).status_code, 403)
