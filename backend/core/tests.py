"""Pruebas de la lógica de negocio del backend."""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    Alumno,
    Asistencia,
    Disciplina,
    Experiencia,
    Insignia,
    Membresia,
    Notificacion,
    Pago,
    Torneo,
)


class ModelosTest(TestCase):
    def setUp(self):
        self.membresia = Membresia.objects.create(
            nombre="Mensual", duracion_dias=30, precio=800
        )
        self.disciplina = Disciplina.objects.create(nombre="MMA")
        self.alumno = Alumno.objects.create(
            nombres="Carlos", apellidos="Ramírez", apodo="El Tanque",
            membresia=self.membresia,
        )

    def test_qr_se_genera_automaticamente(self):
        self.assertTrue(self.alumno.codigo_qr.startswith("ALU-"))
        self.assertTrue(self.alumno.qr_imagen)

    def test_experiencia_se_crea_con_el_alumno(self):
        self.assertTrue(Experiencia.objects.filter(alumno=self.alumno).exists())

    def test_pago_calcula_vencimiento(self):
        pago = Pago.objects.create(alumno=self.alumno, monto=800)
        self.assertEqual(pago.duracion, 30)
        self.assertEqual(pago.fecha_vencimiento, pago.fecha_pago + timedelta(days=30))
        self.assertEqual(pago.estatus, Pago.Estatus.PAGADO)

    def test_pago_viejo_queda_vencido(self):
        pago = Pago.objects.create(
            alumno=self.alumno, monto=800,
            fecha_pago=timezone.localdate() - timedelta(days=60),
        )
        self.assertEqual(pago.estatus, Pago.Estatus.VENCIDO)
        self.assertFalse(self.alumno.al_corriente)

    def test_asistencia_suma_puntos_y_racha(self):
        Asistencia.objects.create(alumno=self.alumno, disciplina=self.disciplina)
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.puntos, Asistencia.PUNTOS_POR_CLASE)
        self.assertEqual(self.alumno.experiencia.racha_asistencia, 1)

    def test_borrar_asistencia_devuelve_puntos(self):
        a = Asistencia.objects.create(alumno=self.alumno, disciplina=self.disciplina)
        a.delete()
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.puntos, 0)

    def test_no_hay_doble_checkin_el_mismo_dia(self):
        Asistencia.objects.create(alumno=self.alumno, disciplina=self.disciplina)
        with self.assertRaises(Exception):
            Asistencia.objects.create(alumno=self.alumno, disciplina=self.disciplina)

    def test_torneo_actualiza_record(self):
        Torneo.objects.create(
            alumno=self.alumno, nombre_torneo="Copa Azteca",
            fecha=timezone.localdate(), resultado=Torneo.Resultado.GANO,
        )
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.record, "1-0-0")


class GamificacionTest(TestCase):
    def setUp(self):
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="López")
        self.insignia = Insignia.objects.create(
            nombre="Primer paso",
            criterio={"tipo": "asistencias_totales", "valor": 1},
            puntos_bonus=20,
        )

    def test_insignia_se_otorga_automaticamente(self):
        Asistencia.objects.create(alumno=self.alumno)
        self.assertTrue(
            self.alumno.insignias_ganadas.filter(insignia=self.insignia).exists()
        )

    def test_bonus_de_insignia_suma_puntos(self):
        Asistencia.objects.create(alumno=self.alumno)
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.puntos, Asistencia.PUNTOS_POR_CLASE + 20)

    def test_notificacion_al_ganar_insignia(self):
        Asistencia.objects.create(alumno=self.alumno)
        self.assertTrue(
            Notificacion.objects.filter(
                alumno=self.alumno, tipo=Notificacion.Tipo.INSIGNIA
            ).exists()
        )


class APITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.disciplina = Disciplina.objects.create(nombre="Box")
        self.alumno = Alumno.objects.create(nombres="Luis", apellidos="Torres")
        self.admin = User.objects.create_user("recepcion", password="x", is_staff=True)
        self.client.force_authenticate(self.admin)

    def test_checkin_por_qr(self):
        r = self.client.post(
            "/api/asistencias/checkin/",
            {"codigo_qr": self.alumno.codigo_qr, "disciplina_id": self.disciplina.id},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["puntos_otorgados"], Asistencia.PUNTOS_POR_CLASE)
        self.assertEqual(r.data["racha"], 1)

    def test_checkin_duplicado_devuelve_409(self):
        payload = {"codigo_qr": self.alumno.codigo_qr, "disciplina_id": self.disciplina.id}
        self.client.post("/api/asistencias/checkin/", payload, format="json")
        r = self.client.post("/api/asistencias/checkin/", payload, format="json")
        self.assertEqual(r.status_code, 409)

    def test_checkin_qr_invalido(self):
        r = self.client.post(
            "/api/asistencias/checkin/", {"codigo_qr": "ALU-NOEXISTE"}, format="json"
        )
        self.assertEqual(r.status_code, 400)

    def test_checkin_alumno_inactivo(self):
        self.alumno.activo = False
        self.alumno.save()
        r = self.client.post(
            "/api/asistencias/checkin/", {"codigo_qr": self.alumno.codigo_qr}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_dashboard(self):
        r = self.client.get("/api/dashboard/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("alumnos", r.data)

    def test_ranking(self):
        r = self.client.get("/api/alumnos/ranking/")
        self.assertEqual(r.status_code, 200)

    def test_listado_de_alumnos(self):
        r = self.client.get("/api/alumnos/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["count"], 1)

    # --- Correo del alumno (crea/liga la cuenta para poder notificarle) ----

    def test_crear_alumno_con_correo_crea_cuenta(self):
        r = self.client.post(
            "/api/alumnos/",
            {"nombres": "Ada", "apellidos": "Reyes", "email": "ada@correo.test"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["email"], "ada@correo.test")
        alumno = Alumno.objects.get(pk=r.data["id"])
        self.assertIsNotNone(alumno.usuario)
        self.assertEqual(alumno.usuario.email, "ada@correo.test")
        self.assertEqual(alumno.usuario.username, f"alumno-{alumno.id}")
        # Nace con la contraseña inicial (con hash), no sin contraseña.
        self.assertTrue(alumno.usuario.check_password(settings.PASSWORD_INICIAL))

    def test_editar_correo_de_alumno_sin_cuenta_le_crea_una(self):
        # Registro viejo (anterior a las cuentas automáticas): sin cuenta.
        self.alumno.usuario = None
        self.alumno.save(update_fields=["usuario"])
        r = self.client.patch(
            f"/api/alumnos/{self.alumno.id}/", {"email": "luis@correo.test"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.alumno.refresh_from_db()
        self.assertIsNotNone(self.alumno.usuario)
        self.assertEqual(self.alumno.usuario.email, "luis@correo.test")
        self.assertTrue(self.alumno.usuario.check_password(settings.PASSWORD_INICIAL))

    def test_editar_correo_de_alumno_con_cuenta_no_pisa_contraseña(self):
        u = User.objects.create_user("luis_ya", password="algosecreto", email="viejo@correo.test")
        self.alumno.usuario = u
        self.alumno.save()

        r = self.client.patch(
            f"/api/alumnos/{self.alumno.id}/", {"email": "nuevo@correo.test"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        u.refresh_from_db()
        self.assertEqual(u.email, "nuevo@correo.test")
        self.assertTrue(u.check_password("algosecreto"))

    def test_dos_alumnos_pueden_compartir_correo(self):
        """P.ej. hermanos con el mismo tutor: el correo no es único, solo el username."""
        Alumno.objects.create(
            nombres="Otro", apellidos="Alumno",
            usuario=User.objects.create_user("ocupado", email="compartido@correo.test"),
        )
        r = self.client.patch(
            f"/api/alumnos/{self.alumno.id}/", {"email": "compartido@correo.test"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.alumno.refresh_from_db()
        self.assertEqual(self.alumno.usuario.email, "compartido@correo.test")
        self.assertNotEqual(self.alumno.usuario.username, "ocupado")

    def test_login_con_correo_compartido_resuelve_la_cuenta_correcta(self):
        hermano1 = User.objects.create_user(
            "alumno-h1", password="claveDeUno123", email="tutor@correo.test"
        )
        hermano2 = User.objects.create_user(
            "alumno-h2", password="claveDeDos456", email="tutor@correo.test"
        )
        Alumno.objects.create(nombres="Hermano", apellidos="Uno", usuario=hermano1)
        Alumno.objects.create(nombres="Hermano", apellidos="Dos", usuario=hermano2)

        r1 = self.client.post(
            "/api/auth/login/",
            {"username": "tutor@correo.test", "password": "claveDeUno123"},
            format="json",
        )
        self.assertEqual(r1.status_code, 200, r1.data)
        self.assertEqual(r1.data["usuario"]["username"], "alumno-h1")

        r2 = self.client.post(
            "/api/auth/login/",
            {"username": "tutor@correo.test", "password": "claveDeDos456"},
            format="json",
        )
        self.assertEqual(r2.status_code, 200, r2.data)
        self.assertEqual(r2.data["usuario"]["username"], "alumno-h2")

        r3 = self.client.post(
            "/api/auth/login/",
            {"username": "tutor@correo.test", "password": "claveIncorrecta"},
            format="json",
        )
        self.assertEqual(r3.status_code, 401)

    # --- Restablecer contraseña (admin) -------------------------------------

    def test_restablecer_password_sin_cuenta_da_400(self):
        self.alumno.usuario = None  # registro viejo sin cuenta
        self.alumno.save(update_fields=["usuario"])
        r = self.client.post(f"/api/alumnos/{self.alumno.id}/restablecer-password/")
        self.assertEqual(r.status_code, 400)

    def test_restablecer_password_genera_una_si_no_se_manda(self):
        u = User.objects.create_user("con_cuenta", email="x@correo.test")
        u.set_unusable_password()
        u.save()
        self.alumno.usuario = u
        self.alumno.save()

        r = self.client.post(f"/api/alumnos/{self.alumno.id}/restablecer-password/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["password_generada"])
        u.refresh_from_db()
        self.assertTrue(u.check_password(r.data["password_generada"]))

    def test_restablecer_password_con_una_propia(self):
        u = User.objects.create_user("con_cuenta2", email="y@correo.test")
        self.alumno.usuario = u
        self.alumno.save()

        r = self.client.post(
            f"/api/alumnos/{self.alumno.id}/restablecer-password/",
            {"password": "unaClaveLarga123"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIsNone(r.data["password_generada"])
        u.refresh_from_db()
        self.assertTrue(u.check_password("unaClaveLarga123"))

    def test_restablecer_password_corta_da_400(self):
        u = User.objects.create_user("con_cuenta3", email="z@correo.test")
        self.alumno.usuario = u
        self.alumno.save()

        r = self.client.post(
            f"/api/alumnos/{self.alumno.id}/restablecer-password/",
            {"password": "corta"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_alumno_no_puede_restablecer_su_propia_password_por_este_endpoint(self):
        u = User.objects.create_user("con_cuenta4", password="original123", email="w@correo.test")
        self.alumno.usuario = u
        self.alumno.save()
        self.client.force_authenticate(u)

        r = self.client.post(
            f"/api/alumnos/{self.alumno.id}/restablecer-password/",
            {"password": "otraClave123"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)


class RolesTest(TestCase):
    """La tabla de permisos del documento, traducida a pruebas."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("dueno", password="x", is_staff=True)

        self.user_ana = User.objects.create_user("ana", password="secreta123")
        self.ana = Alumno.objects.create(
            nombres="Ana", apellidos="López", usuario=self.user_ana
        )
        self.otro = Alumno.objects.create(nombres="Otro", apellidos="Alumno")
        Pago.objects.create(alumno=self.ana, monto=800, duracion=30)
        Pago.objects.create(alumno=self.otro, monto=800, duracion=30)

    # --- Login --------------------------------------------------------------

    def test_login_devuelve_token_y_rol_alumno(self):
        r = self.client.post(
            "/api/auth/login/", {"username": "ana", "password": "secreta123"}, format="json"
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("token", r.data)
        self.assertEqual(r.data["usuario"]["rol"], "ALUMNO")
        self.assertEqual(r.data["usuario"]["alumno_id"], self.ana.id)

    def test_login_devuelve_rol_administrativo(self):
        self.client.post("/api/auth/login/", {"username": "dueno", "password": "x"})
        r = self.client.post(
            "/api/auth/login/", {"username": "dueno", "password": "x"}, format="json"
        )
        self.assertEqual(r.data["usuario"]["rol"], "ADMINISTRATIVO")

    def test_login_con_password_mala(self):
        r = self.client.post(
            "/api/auth/login/", {"username": "ana", "password": "nope"}, format="json"
        )
        self.assertEqual(r.status_code, 401)

    def test_sin_token_no_hay_acceso(self):
        self.assertEqual(self.client.get("/api/alumnos/").status_code, 401)

    # --- Aislamiento de datos ----------------------------------------------

    def test_alumno_solo_se_ve_a_si_mismo(self):
        self.client.force_authenticate(self.user_ana)
        r = self.client.get("/api/alumnos/")
        self.assertEqual(r.data["count"], 1)
        self.assertEqual(r.data["results"][0]["id"], self.ana.id)

    def test_alumno_no_puede_abrir_ficha_ajena(self):
        self.client.force_authenticate(self.user_ana)
        self.assertEqual(self.client.get(f"/api/alumnos/{self.otro.id}/").status_code, 404)

    def test_alumno_solo_ve_sus_pagos(self):
        self.client.force_authenticate(self.user_ana)
        r = self.client.get("/api/pagos/")
        self.assertEqual(r.data["count"], 1)

    def test_admin_ve_todo(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/alumnos/").data["count"], 2)
        self.assertEqual(self.client.get("/api/pagos/").data["count"], 2)

    # --- Escritura ----------------------------------------------------------

    def test_alumno_no_puede_crear_alumnos(self):
        self.client.force_authenticate(self.user_ana)
        r = self.client.post("/api/alumnos/", {"nombres": "X", "apellidos": "Y"})
        self.assertEqual(r.status_code, 403)

    def test_alumno_no_puede_editar_su_experiencia(self):
        self.client.force_authenticate(self.user_ana)
        r = self.client.patch(
            f"/api/experiencias/{self.ana.experiencia.id}/", {"numero_sparrings": 5}
        )
        self.assertEqual(r.status_code, 403)

    def test_alumno_edita_sus_datos_personales(self):
        self.client.force_authenticate(self.user_ana)
        r = self.client.patch("/api/alumnos/yo/", {"apodo": "La Sombra"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.ana.refresh_from_db()
        self.assertEqual(self.ana.apodo, "La Sombra")

    def test_alumno_no_puede_cambiarse_de_membresia(self):
        membresia = Membresia.objects.create(nombre="Anual", duracion_dias=365, precio=7200)
        self.client.force_authenticate(self.user_ana)
        r = self.client.patch(
            "/api/alumnos/yo/",
            {"apodo": "Test", "membresia": membresia.id, "puntos": 9999},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.ana.refresh_from_db()
        self.assertIsNone(self.ana.membresia)
        self.assertEqual(self.ana.puntos, 0)
        self.assertIn("membresia", r.data["_ignorados"])

    # --- Endpoints administrativos -----------------------------------------

    def test_alumno_no_entra_al_dashboard(self):
        self.client.force_authenticate(self.user_ana)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 403)

    def test_alumno_no_ve_la_lista_de_morosos(self):
        self.client.force_authenticate(self.user_ana)
        self.assertEqual(self.client.get("/api/alumnos/morosos/").status_code, 403)

    def test_admin_si_entra_al_dashboard(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 200)
