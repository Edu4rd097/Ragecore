"""
Las fotos y los QR salen como rutas relativas (/media/...), no absolutas.

Con el dev-server de Angular como proxy, Django ve el host 127.0.0.1:8000 y
armaba http://127.0.0.1:8000/media/...; desde un celular en la misma WiFi
127.0.0.1 es el propio celular y no cargaba ni la foto ni el QR (y sin QR no
hay escaneo). Con la ruta relativa el navegador pide la imagen al mismo
origen desde el que abrió la app y el proxy la sirve.
"""
import json
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.test import APIClient

from core.models import Alumno, Maestro


def _png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), (225, 29, 42)).save(buffer, format="PNG")
    return buffer.getvalue()


class MediaRelativaTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(
            User.objects.create_user("admin", password="x12345678", is_staff=True)
        )
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz")
        self.maestro = Maestro.objects.create(nombre="Profe")

    def test_qr_del_alumno_es_ruta_relativa(self):
        r = self.client.get(f"/api/alumnos/{self.alumno.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["qr_imagen"].startswith("/media/"), r.data["qr_imagen"])
        self.assertNotIn("testserver", r.data["qr_imagen"])
        self.assertIsNone(r.data["foto"])

        r = self.client.get(f"/api/alumnos/{self.alumno.id}/qr/")
        self.assertTrue(r.data["qr_imagen"].startswith("/media/"), r.data["qr_imagen"])

    def test_qr_del_maestro_es_ruta_relativa(self):
        r = self.client.get(f"/api/maestros/{self.maestro.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["qr_imagen"].startswith("/media/"), r.data["qr_imagen"])

    def test_subir_foto_sigue_funcionando_y_sale_relativa(self):
        r = self.client.patch(
            f"/api/alumnos/{self.alumno.id}/",
            {"foto": SimpleUploadedFile("cara.png", _png(), content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["foto"].startswith("/media/alumnos/fotos/"), r.data["foto"])

        # Listado y ranking también la dan relativa.
        for url in ("/api/alumnos/", "/api/alumnos/ranking/"):
            r = self.client.get(url)
            self.assertEqual(r.status_code, 200, url)
            texto = json.dumps(r.data)
            self.assertIn("/media/alumnos/fotos/", texto, url)
            self.assertNotIn("testserver", texto, url)

    def test_el_alumno_ve_su_propio_qr_relativo(self):
        user = User.objects.create_user("ana", password="x12345678")
        self.alumno.usuario = user
        self.alumno.save(update_fields=["usuario"])
        cliente = APIClient()
        cliente.force_authenticate(user)
        r = cliente.get("/api/alumnos/yo/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["qr_imagen"].startswith("/media/"), r.data["qr_imagen"])
