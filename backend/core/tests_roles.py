"""
Pruebas de roles y alcance: login de maestro, alcance por grupos (Horario) +
alumnos individuales, cuentas automáticas con contraseña inicial, usuarios
administrativos, avisos del maestro, eventos propios y fugas cerradas.
"""
from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import Alumno, Aviso, Evento, Horario, Maestro, Notificacion


def _maestro_con_correo(nombre, username, horarios=(), alumnos=()):
    user = User.objects.create_user(username, email=f"{username}@correo.test", password="x12345678")
    maestro = Maestro.objects.create(nombre=nombre, usuario=user)
    maestro.horarios.set(horarios)
    maestro.alumnos_asignados.set(alumnos)
    return maestro


def _horario(inicio, fin, turno="MATUTINO"):
    return Horario.objects.create(hora_inicio=inicio, hora_fin=fin, turno=turno)


class LoginMaestroTest(TestCase):
    def test_login_resuelve_rol_maestro(self):
        user = User.objects.create_user("prof", password="x12345678")
        maestro = Maestro.objects.create(nombre="Profe X", usuario=user)
        r = APIClient().post(
            "/api/auth/login/", {"username": "prof", "password": "x12345678"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["usuario"]["rol"], "MAESTRO")
        self.assertEqual(r.data["usuario"]["maestro_id"], maestro.id)
        self.assertEqual(r.data["usuario"]["maestro"]["nombre"], "Profe X")
        self.assertEqual(r.data["usuario"]["maestro"]["horarios"], [])

    def test_administrativo_con_maestro_ligado_sigue_siendo_administrativo(self):
        user = User.objects.create_user("jefe", password="x12345678", is_staff=True)
        Maestro.objects.create(nombre="Jefe que también da clases", usuario=user)
        r = APIClient().post(
            "/api/auth/login/", {"username": "jefe", "password": "x12345678"}, format="json"
        )
        self.assertEqual(r.data["usuario"]["rol"], "ADMINISTRATIVO")


class AlcanceMaestroTest(TestCase):
    """
    El maestro solo ve/evalúa a los alumnos a su cargo: los de sus grupos
    (horarios asignados) más los asignados individualmente. Nada más.
    """

    def setUp(self):
        self.manana = _horario("07:00", "09:00")
        self.tarde = _horario("16:00", "18:00", "VESPERTINO")

        # Alumno.objects.create() ya dispara core.signals.crear_experiencia
        # (post_save), así que no hace falta crear la Experiencia a mano.
        self.a_manana = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", horario=self.manana)
        self.a_manana2 = Alumno.objects.create(nombres="Beto", apellidos="Gil", horario=self.manana)
        self.a_tarde = Alumno.objects.create(nombres="Luis", apellidos="Díaz", horario=self.tarde)
        self.pedro = Alumno.objects.create(nombres="Pedro", apellidos="Solo", horario=self.tarde)
        self.sin_horario = Alumno.objects.create(nombres="Nadie", apellidos="Sin", horario=None)
        self.inactivo = Alumno.objects.create(
            nombres="Baja", apellidos="Dada", horario=self.manana, activo=False
        )

        # Carlos: grupo Mañana completo + Pedro (que es de la tarde) suelto.
        self.maestro = _maestro_con_correo(
            "Carlos", "carlos", horarios=[self.manana], alumnos=[self.pedro]
        )
        self.client = APIClient()
        self.client.force_authenticate(self.maestro.usuario)

    def test_alumnos_a_cargo_es_grupo_mas_individuales(self):
        ids = set(self.maestro.alumnos_a_cargo().values_list("id", flat=True))
        self.assertEqual(
            ids, {self.a_manana.id, self.a_manana2.id, self.pedro.id, self.inactivo.id}
        )
        self.assertTrue(self.maestro.tiene_a_cargo(self.pedro))
        self.assertFalse(self.maestro.tiene_a_cargo(self.a_tarde))

    def test_el_backend_devuelve_solo_sus_alumnos_activos(self):
        r = self.client.get("/api/alumnos/")
        ids = {a["id"] for a in r.data["results"]}
        self.assertEqual(ids, {self.a_manana.id, self.a_manana2.id, self.pedro.id})
        self.assertEqual(r.data["count"], 3)

    def test_filtros_del_cliente_no_amplian_el_alcance(self):
        # Pedir explícitamente el horario de la tarde no le da acceso a él.
        r = self.client.get(f"/api/alumnos/?horario={self.tarde.id}")
        self.assertEqual({a["id"] for a in r.data["results"]}, {self.pedro.id})
        r = self.client.get("/api/alumnos/?activo=false")
        self.assertEqual(r.data["count"], 0)

    def test_ficha_de_alumno_ajeno_da_404(self):
        self.assertEqual(self.client.get(f"/api/alumnos/{self.a_tarde.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/alumnos/{self.pedro.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/alumnos/{self.a_tarde.id}/perfil/").status_code, 404)

    def test_asignar_otro_grupo_amplia_el_alcance(self):
        self.maestro.horarios.add(self.tarde)
        r = self.client.get("/api/alumnos/")
        self.assertEqual(r.data["count"], 4)  # + Luis (Pedro ya estaba)

    def test_sin_asignaciones_no_ve_a_nadie(self):
        self.maestro.horarios.clear()
        self.maestro.alumnos_asignados.clear()
        self.assertEqual(self.client.get("/api/alumnos/").data["count"], 0)

    def test_maestro_no_puede_editar_datos_del_alumno(self):
        r = self.client.patch(
            f"/api/alumnos/{self.a_manana.id}/", {"nombres": "Otro"}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_maestro_no_ve_pagos_del_alumno(self):
        self.assertEqual(self.client.get(f"/api/alumnos/{self.a_manana.id}/pagos/").status_code, 403)

    def test_maestro_edita_experiencia_de_alumno_a_cargo(self):
        exp = self.pedro.experiencia
        r = self.client.patch(
            f"/api/experiencias/{exp.id}/", {"numero_sparrings": 4}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        exp.refresh_from_db()
        self.assertEqual(exp.numero_sparrings, 4)

    def test_maestro_no_ve_ni_edita_experiencia_ajena(self):
        exp = self.a_tarde.experiencia
        self.assertEqual(self.client.get(f"/api/experiencias/{exp.id}/").status_code, 404)
        r = self.client.patch(
            f"/api/experiencias/{exp.id}/", {"numero_sparrings": 4}, format="json"
        )
        self.assertEqual(r.status_code, 404)
        r = self.client.get("/api/experiencias/")
        self.assertEqual(
            {e["alumno"] for e in r.data["results"]},
            {self.a_manana.id, self.a_manana2.id, self.pedro.id, self.inactivo.id},
        )

    def test_ranking_respeta_el_alcance(self):
        r = self.client.get("/api/alumnos/ranking/")
        self.assertEqual({f["id"] for f in r.data}, {self.a_manana.id, self.a_manana2.id, self.pedro.id})

    def test_lista_de_alumnos_por_horario_acotada(self):
        r = self.client.get(f"/api/horarios/{self.tarde.id}/alumnos/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual({a["id"] for a in r.data}, {self.pedro.id})

    def test_admin_asigna_grupos_y_alumnos_al_maestro(self):
        admin = User.objects.create_user("admin-asig", password="x", is_staff=True)
        client = APIClient()
        client.force_authenticate(admin)
        r = client.patch(
            f"/api/maestros/{self.maestro.id}/",
            {"horarios_ids": [self.tarde.id], "alumnos_ids": [self.a_manana.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([h["id"] for h in r.data["horarios"]], [self.tarde.id])
        self.assertEqual([a["id"] for a in r.data["alumnos_asignados"]], [self.a_manana.id])
        self.assertEqual(r.data["total_alumnos"], 3)  # Luis, Pedro (tarde) + Ana
        self.assertEqual(
            set(self.maestro.alumnos_a_cargo().values_list("id", flat=True)),
            {self.a_tarde.id, self.pedro.id, self.a_manana.id},
        )

    def test_alumno_no_ve_alumno_de_otro_alumno(self):
        alumno_user = User.objects.create_user("alu-alcance", password="x")
        self.a_manana.usuario = alumno_user
        self.a_manana.save(update_fields=["usuario"])
        client = APIClient()
        client.force_authenticate(alumno_user)
        r = client.get("/api/alumnos/")
        ids = {a["id"] for a in r.data["results"]}
        self.assertEqual(ids, {self.a_manana.id})
        # Ni por el ranking, ni por el grupo, ni el catálogo de maestros.
        self.assertEqual({f["id"] for f in client.get("/api/alumnos/ranking/").data}, {self.a_manana.id})
        self.assertEqual(client.get(f"/api/horarios/{self.manana.id}/alumnos/").status_code, 403)
        self.assertEqual(client.get("/api/maestros/").status_code, 403)
        self.assertEqual(client.get(f"/api/maestros/{self.maestro.id}/").status_code, 403)

    def test_maestro_lee_catalogo_de_maestros_pero_no_lo_edita(self):
        self.assertEqual(self.client.get("/api/maestros/").status_code, 200)
        r = self.client.patch(f"/api/maestros/{self.maestro.id}/", {"nombre": "X"}, format="json")
        self.assertEqual(r.status_code, 403)


class AvisosMaestroTest(TestCase):
    """El maestro notifica solo a sus alumnos/grupos; nunca a 'todos'."""

    def setUp(self):
        self.manana = _horario("07:00", "09:00")
        self.tarde = _horario("16:00", "18:00", "VESPERTINO")
        self.mio = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", horario=self.manana)
        self.ajeno = Alumno.objects.create(nombres="Luis", apellidos="Díaz", horario=self.tarde)
        self.maestro = _maestro_con_correo("Carlos", "carlos-av", horarios=[self.manana])
        self.client = APIClient()
        self.client.force_authenticate(self.maestro.usuario)

    def _aviso(self, **extra):
        datos = {"titulo": "Aviso", "mensaje": "Mañana no hay clase.", **extra}
        return self.client.post("/api/avisos/", datos, format="json")

    def test_individual_a_alumno_a_cargo(self):
        r = self._aviso(tipo_destinatario="INDIVIDUAL", alumno=self.mio.id)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["creado_por_username"], "carlos-av")
        self.assertTrue(Notificacion.objects.filter(aviso_id=r.data["id"], alumno=self.mio).exists())

    def test_individual_a_alumno_ajeno_403(self):
        r = self._aviso(tipo_destinatario="INDIVIDUAL", alumno=self.ajeno.id)
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Aviso.objects.exists())

    def test_grupo_propio_si_grupo_ajeno_no(self):
        r = self._aviso(tipo_destinatario="GRUPO", horario=self.manana.id)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["total_destinatarios"], 1)
        r = self._aviso(tipo_destinatario="GRUPO", horario=self.tarde.id)
        self.assertEqual(r.status_code, 403)

    def test_todos_solo_administrativo(self):
        self.assertEqual(self._aviso(tipo_destinatario="TODOS").status_code, 403)

    def test_maestro_solo_ve_sus_avisos_y_sus_destinatarios(self):
        admin = User.objects.create_user("admin-av", password="x", is_staff=True)
        del_admin = Aviso.objects.create(
            titulo="Del admin", mensaje="x", tipo_destinatario="TODOS", creado_por=admin
        )
        Notificacion.objects.create(alumno=self.mio, aviso=del_admin, tipo="MANUAL", mensaje="x")
        propio = self._aviso(tipo_destinatario="INDIVIDUAL", alumno=self.mio.id).data["id"]

        r = self.client.get("/api/avisos/")
        self.assertEqual({a["id"] for a in r.data["results"]}, {propio})
        self.assertEqual(self.client.get(f"/api/avisos/{del_admin.id}/").status_code, 404)

        r = self.client.get("/api/notificaciones/")
        self.assertEqual({n["aviso"] for n in r.data["results"]}, {propio})

    def test_alumno_sigue_sin_poder_crear_avisos(self):
        user = User.objects.create_user("alu-av", password="x")
        self.mio.usuario = user
        self.mio.save(update_fields=["usuario"])
        client = APIClient()
        client.force_authenticate(user)
        r = client.post(
            "/api/avisos/",
            {"titulo": "X", "mensaje": "Y", "tipo_destinatario": "INDIVIDUAL", "alumno": self.mio.id},
            format="json",
        )
        self.assertEqual(r.status_code, 403)


class EventosMaestroTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin-evm", password="x", is_staff=True)
        self.maestro = _maestro_con_correo("Carlos", "carlos-ev")
        self.otro = _maestro_con_correo("Otro", "otro-ev")
        self.client = APIClient()
        self.client.force_authenticate(self.maestro.usuario)

    def test_maestro_edita_y_borra_solo_sus_eventos(self):
        propio = Evento.objects.create(titulo="Mío", fecha="2026-06-01", creado_por=self.maestro.usuario)
        ajeno = Evento.objects.create(titulo="Ajeno", fecha="2026-06-02", creado_por=self.otro.usuario)
        del_admin = Evento.objects.create(titulo="Admin", fecha="2026-06-03", creado_por=self.admin)

        # La cartelera completa sí la ve.
        self.assertEqual(self.client.get("/api/eventos/").data["count"], 3)

        self.assertEqual(
            self.client.patch(f"/api/eventos/{propio.id}/", {"lugar": "Arena"}, format="json").status_code, 200
        )
        self.assertEqual(
            self.client.patch(f"/api/eventos/{ajeno.id}/", {"lugar": "Arena"}, format="json").status_code, 403
        )
        self.assertEqual(self.client.delete(f"/api/eventos/{del_admin.id}/").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/eventos/{propio.id}/").status_code, 204)

    def test_admin_edita_cualquier_evento(self):
        ev = Evento.objects.create(titulo="Mío", fecha="2026-06-01", creado_por=self.maestro.usuario)
        client = APIClient()
        client.force_authenticate(self.admin)
        self.assertEqual(client.delete(f"/api/eventos/{ev.id}/").status_code, 204)


class CuentasAutomaticasTest(TestCase):
    """Todo alumno/maestro nace con cuenta: usuario <prefijo>-<id>, contraseña inicial con hash."""

    def setUp(self):
        self.admin = User.objects.create_user("admin-cta", password="x", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_alta_de_alumno_crea_cuenta_y_regresa_credenciales_una_vez(self):
        r = self.client.post(
            "/api/alumnos/", {"nombres": "Ada", "apellidos": "Reyes"}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.data)
        alumno = Alumno.objects.get(pk=r.data["id"])
        self.assertEqual(r.data["username"], f"alumno-{alumno.id}")
        self.assertEqual(r.data["password_inicial"], settings.PASSWORD_INICIAL)
        self.assertTrue(r.data["tiene_cuenta"])

        usuario = alumno.usuario
        self.assertTrue(usuario.check_password(settings.PASSWORD_INICIAL))
        self.assertNotIn(settings.PASSWORD_INICIAL, usuario.password)  # solo el hash
        self.assertEqual((usuario.first_name, usuario.last_name), ("Ada", "Reyes"))

        # Al consultarlo después ya no viaja la contraseña.
        r = self.client.get(f"/api/alumnos/{alumno.id}/")
        self.assertNotIn("password_inicial", r.data)
        self.assertEqual(r.data["username"], f"alumno-{alumno.id}")

    def test_el_alumno_entra_con_sus_credenciales_iniciales(self):
        r = self.client.post(
            "/api/alumnos/", {"nombres": "Ada", "apellidos": "Reyes"}, format="json"
        )
        login = APIClient().post(
            "/api/auth/login/",
            {"username": r.data["username"], "password": settings.PASSWORD_INICIAL},
            format="json",
        )
        self.assertEqual(login.status_code, 200, login.data)
        self.assertEqual(login.data["usuario"]["rol"], "ALUMNO")
        self.assertEqual(login.data["usuario"]["alumno_id"], r.data["id"])

    def test_alta_de_maestro_crea_cuenta(self):
        r = self.client.post(
            "/api/maestros/", {"nombre": "Profe Nuevo", "email": "profe@correo.test"}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.data)
        maestro = Maestro.objects.get(pk=r.data["id"])
        self.assertEqual(r.data["username"], f"maestro-{maestro.id}")
        self.assertEqual(r.data["password_inicial"], settings.PASSWORD_INICIAL)
        self.assertEqual(maestro.usuario.email, "profe@correo.test")
        self.assertTrue(maestro.usuario.check_password(settings.PASSWORD_INICIAL))

    def test_cuenta_ya_ligada_se_respeta(self):
        user = User.objects.create_user("propia", password="miClave123")
        alumno = Alumno.objects.create(nombres="Con", apellidos="Cuenta", usuario=user)
        self.assertEqual(alumno.usuario, user)
        self.assertTrue(user.check_password("miClave123"))

    def test_username_repetido_recibe_sufijo(self):
        siguiente = (Alumno.objects.order_by("-id").values_list("id", flat=True).first() or 0) + 1
        User.objects.create_user(f"alumno-{siguiente}", password="x")
        alumno = Alumno.objects.create(nombres="Choque", apellidos="Nombre")
        self.assertEqual(alumno.id, siguiente)
        self.assertEqual(alumno.usuario.username, f"alumno-{siguiente}-2")


class CambiarPasswordTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("alu-cp", password="rotoplas")
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", usuario=self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_cambia_su_propia_password_y_renueva_token(self):
        r = self.client.post(
            "/api/auth/cambiar-password/",
            {"actual": "rotoplas", "nueva": "unaNuevaClave123"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn("token", r.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("unaNuevaClave123"))

    def test_actual_incorrecta_o_nueva_corta_da_400(self):
        r = self.client.post(
            "/api/auth/cambiar-password/", {"actual": "mala", "nueva": "unaNuevaClave123"}, format="json"
        )
        self.assertEqual(r.status_code, 400)
        r = self.client.post(
            "/api/auth/cambiar-password/", {"actual": "rotoplas", "nueva": "corta"}, format="json"
        )
        self.assertEqual(r.status_code, 400)

    def test_alumno_edita_su_correo_desde_yo(self):
        r = self.client.patch("/api/alumnos/yo/", {"email": "Ana@Correo.Test"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["email"], "ana@correo.test")
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "ana@correo.test")


class UsuariosAdministrativosTest(TestCase):
    URL = "/api/usuarios/"

    def setUp(self):
        self.admin = User.objects.create_user("admin-us", password="x", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_solo_administrativos_entran(self):
        maestro = _maestro_con_correo("Prof", "prof-us")
        client = APIClient()
        client.force_authenticate(maestro.usuario)
        self.assertEqual(client.get(self.URL).status_code, 403)
        user = User.objects.create_user("alu-us", password="x")
        Alumno.objects.create(nombres="A", apellidos="B", usuario=user)
        client.force_authenticate(user)
        self.assertEqual(client.get(self.URL).status_code, 403)

    def test_lista_solo_cuentas_staff(self):
        User.objects.create_user("normal-us", password="x")
        r = self.client.get(self.URL)
        self.assertEqual({u["username"] for u in r.data["results"]}, {"admin-us"})

    def test_crear_usuario_administrativo_con_password_inicial(self):
        r = self.client.post(
            self.URL,
            {"username": "recepcion2", "first_name": "Rosa", "email": "rosa@correo.test"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["password_inicial"], settings.PASSWORD_INICIAL)
        nuevo = User.objects.get(username="recepcion2")
        self.assertTrue(nuevo.is_staff)
        self.assertFalse(nuevo.is_superuser)
        self.assertTrue(nuevo.check_password(settings.PASSWORD_INICIAL))

        login = APIClient().post(
            "/api/auth/login/", {"username": "recepcion2", "password": settings.PASSWORD_INICIAL}, format="json"
        )
        self.assertEqual(login.data["usuario"]["rol"], "ADMINISTRATIVO")

    def test_username_repetido_da_400(self):
        r = self.client.post(self.URL, {"username": "admin-us"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_restablecer_password_de_otro_admin(self):
        otro = User.objects.create_user("otro-us", password="x", is_staff=True)
        r = self.client.post(f"{self.URL}{otro.id}/restablecer-password/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        otro.refresh_from_db()
        self.assertTrue(otro.check_password(r.data["password_generada"]))

    def test_no_restablece_la_propia_ni_se_desactiva_ni_se_borra(self):
        r = self.client.post(f"{self.URL}{self.admin.id}/restablecer-password/", {}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"{self.URL}{self.admin.id}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.delete(f"{self.URL}{self.admin.id}/").status_code, 405)

    def test_desactiva_a_otro(self):
        otro = User.objects.create_user("otro-us2", password="x", is_staff=True)
        r = self.client.patch(f"{self.URL}{otro.id}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        otro.refresh_from_db()
        self.assertFalse(otro.is_active)


class RestablecerPasswordMaestroTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin-rp", password="x", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_sin_cuenta_da_400(self):
        # Registro viejo al que un admin le quitó la cuenta a mano.
        maestro = Maestro.objects.create(nombre="Sin cuenta")
        maestro.usuario = None
        maestro.save(update_fields=["usuario"])
        r = self.client.post(f"/api/maestros/{maestro.id}/restablecer-password/", {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_genera_password_si_no_se_manda(self):
        user = User.objects.create_user("prof-rp", email="prof-rp@correo.test", password="x")
        maestro = Maestro.objects.create(nombre="Con cuenta", usuario=user)
        r = self.client.post(f"/api/maestros/{maestro.id}/restablecer-password/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["password_generada"])
        user.refresh_from_db()
        self.assertTrue(user.check_password(r.data["password_generada"]))

    def test_maestro_no_puede_restablecer_su_propia_password_por_este_endpoint(self):
        user = User.objects.create_user("prof-rp2", password="x")
        maestro = Maestro.objects.create(nombre="Con cuenta 2", usuario=user)
        client = APIClient()
        client.force_authenticate(user)
        r = client.post(f"/api/maestros/{maestro.id}/restablecer-password/", {}, format="json")
        self.assertEqual(r.status_code, 403)
