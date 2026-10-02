"""Pruebas del módulo de Eventos: alta, permisos, inscripción, asistencia y resultados."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import (
    Alumno,
    Disciplina,
    Evento,
    EventoInscripcion,
    Horario,
    Maestro,
    Torneo,
)

URL_INS = "/api/inscripciones-evento/"


class EventoPermisosTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin-ev", password="x", is_staff=True)
        self.maestro_user = User.objects.create_user("prof-ev", password="x")
        self.maestro = Maestro.objects.create(nombre="Profe", usuario=self.maestro_user)
        self.alumno_user = User.objects.create_user("alu-ev", password="x")
        self.alumno = Alumno.objects.create(
            nombres="Ana", apellidos="Ruiz", usuario=self.alumno_user
        )

    def test_alumno_puede_leer_pero_no_crear_evento(self):
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        self.assertEqual(client.get("/api/eventos/").status_code, 200)
        r = client.post(
            "/api/eventos/", {"titulo": "Torneo", "fecha": "2026-01-01"}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_maestro_puede_crear_evento(self):
        client = APIClient()
        client.force_authenticate(self.maestro_user)
        r = client.post(
            "/api/eventos/",
            {"titulo": "Seminario de invierno", "tipo": "SEMINARIO", "fecha": "2026-02-01"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["creado_por_username"], "prof-ev")

    def test_admin_puede_crear_evento(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        r = client.post(
            "/api/eventos/",
            {"titulo": "Examen de grado", "tipo": "EXAMEN", "fecha": "2026-03-01"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)


class InscripcionEventoTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin-ins", password="x", is_staff=True)
        self.alumno_user = User.objects.create_user("alu-ins", password="x")
        self.alumno = Alumno.objects.create(
            nombres="Luis", apellidos="Díaz", usuario=self.alumno_user
        )
        self.otro_user = User.objects.create_user("alu-ins2", password="x")
        self.otro = Alumno.objects.create(
            nombres="Otro", apellidos="Alumno", usuario=self.otro_user
        )
        self.evento = Evento.objects.create(titulo="Torneo Regional", fecha="2026-03-01")

    def test_alumno_se_inscribe_a_si_mismo(self):
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        r = client.post(
            "/api/inscripciones-evento/", {"evento": self.evento.id}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["alumno"], self.alumno.id)

    def test_alumno_no_puede_inscribir_a_otro_aunque_lo_mande(self):
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        r = client.post(
            "/api/inscripciones-evento/",
            {"evento": self.evento.id, "alumno": self.otro.id},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        # El backend ignora el 'alumno' mandado y usa el del propio request.
        self.assertEqual(r.data["alumno"], self.alumno.id)

    def test_doble_inscripcion_da_409(self):
        EventoInscripcion.objects.create(evento=self.evento, alumno=self.alumno)
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        r = client.post(
            "/api/inscripciones-evento/", {"evento": self.evento.id}, format="json"
        )
        self.assertEqual(r.status_code, 409)

    def test_alumno_puede_cancelar_su_inscripcion(self):
        insc = EventoInscripcion.objects.create(evento=self.evento, alumno=self.alumno)
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        r = client.delete(f"/api/inscripciones-evento/{insc.id}/")
        self.assertEqual(r.status_code, 204)

    def test_alumno_no_puede_marcar_su_propia_asistencia(self):
        insc = EventoInscripcion.objects.create(evento=self.evento, alumno=self.alumno)
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        r = client.patch(
            f"/api/inscripciones-evento/{insc.id}/", {"asistio": True}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_admin_puede_marcar_asistencia(self):
        insc = EventoInscripcion.objects.create(evento=self.evento, alumno=self.alumno)
        client = APIClient()
        client.force_authenticate(self.admin)
        r = client.patch(
            f"/api/inscripciones-evento/{insc.id}/", {"asistio": True}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        insc.refresh_from_db()
        self.assertTrue(insc.asistio)

    def test_alumno_solo_ve_sus_propias_inscripciones(self):
        EventoInscripcion.objects.create(evento=self.evento, alumno=self.alumno)
        EventoInscripcion.objects.create(evento=self.evento, alumno=self.otro)
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        r = client.get("/api/inscripciones-evento/")
        ids = {i["alumno"] for i in r.data["results"]}
        self.assertEqual(ids, {self.alumno.id})

    def test_admin_ve_todas_las_inscripciones(self):
        EventoInscripcion.objects.create(evento=self.evento, alumno=self.alumno)
        EventoInscripcion.objects.create(evento=self.evento, alumno=self.otro)
        client = APIClient()
        client.force_authenticate(self.admin)
        r = client.get("/api/inscripciones-evento/")
        ids = {i["alumno"] for i in r.data["results"]}
        self.assertEqual(ids, {self.alumno.id, self.otro.id})


class ResultadoEventoTest(TestCase):
    """
    El personal agrega alumnos a un evento y captura su resultado. El
    resultado es un `Torneo` ligado al Evento (Torneo.evento), así que el
    récord del alumno se recalcula por la señal ya existente.
    """

    def setUp(self):
        self.mma = Disciplina.objects.create(nombre="MMA-res")
        self.manana = Horario.objects.create(hora_inicio="07:00", hora_fin="09:00")
        self.admin = User.objects.create_user("admin-res", password="x", is_staff=True)
        self.maestro_user = User.objects.create_user("prof-res", password="x")
        self.maestro = Maestro.objects.create(nombre="Profe Res", usuario=self.maestro_user)
        self.maestro.horarios.add(self.manana)  # su alcance: el grupo de la mañana
        self.alumno_user = User.objects.create_user("alu-res", password="x")
        self.alumno = Alumno.objects.create(
            nombres="Pepe", apellidos="Res", usuario=self.alumno_user, horario=self.manana
        )
        self.ajeno = Alumno.objects.create(nombres="Ajeno", apellidos="Box")  # sin grupo
        self.torneo = Evento.objects.create(
            titulo="Copa Brava", tipo=Evento.Tipo.TORNEO, fecha="2026-05-10", disciplina=self.mma
        )
        self.seminario = Evento.objects.create(
            titulo="Seminario", tipo=Evento.Tipo.SEMINARIO, fecha="2026-05-11"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.maestro_user)

    def _inscribir(self, alumno=None, evento=None):
        return EventoInscripcion.objects.create(
            evento=evento or self.torneo, alumno=alumno or self.alumno
        )

    # --- Agregar alumnos ----------------------------------------------------

    def test_maestro_inscribe_alumno_a_su_cargo(self):
        r = self.client.post(
            URL_INS, {"evento": self.torneo.id, "alumno": self.alumno.id}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["alumno"], self.alumno.id)
        self.assertIsNone(r.data["torneo"])

    def test_maestro_no_inscribe_alumno_fuera_de_su_alcance(self):
        r = self.client.post(
            URL_INS, {"evento": self.torneo.id, "alumno": self.ajeno.id}, format="json"
        )
        self.assertEqual(r.status_code, 403)
        self.assertFalse(EventoInscripcion.objects.filter(alumno=self.ajeno).exists())

    def test_maestro_solo_ve_inscritos_a_su_cargo(self):
        self._inscribir()
        self._inscribir(alumno=self.ajeno)  # lo inscribió el admin
        r = self.client.get(f"{URL_INS}?evento={self.torneo.id}")
        self.assertEqual({i["alumno"] for i in r.data["results"]}, {self.alumno.id})
        ajena = EventoInscripcion.objects.get(alumno=self.ajeno)
        self.assertEqual(
            self.client.patch(f"{URL_INS}{ajena.id}/", {"asistio": True}, format="json").status_code, 404
        )
        self.assertEqual(
            self.client.post(f"{URL_INS}{ajena.id}/resultado/", {"resultado": "GANO"}, format="json").status_code,
            404,
        )

    def test_admin_inscribe_a_cualquiera(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            URL_INS, {"evento": self.torneo.id, "alumno": self.ajeno.id}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.data)

    def test_personal_sin_alumno_recibe_400(self):
        r = self.client.post(URL_INS, {"evento": self.torneo.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("alumno", r.data)

    def test_inscripcion_repetida_por_personal_da_409(self):
        self._inscribir()
        r = self.client.post(
            URL_INS, {"evento": self.torneo.id, "alumno": self.alumno.id}, format="json"
        )
        self.assertEqual(r.status_code, 409)
        self.assertIn("alumno ya está inscrito", r.data["detail"])

    # --- Resultado ------------------------------------------------------------

    def test_registrar_resultado_crea_torneo_ligado_y_recalcula_record(self):
        insc = self._inscribir()
        r = self.client.post(
            f"{URL_INS}{insc.id}/resultado/", {"resultado": "GANO", "metodo": "KO"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["torneo"]["resultado"], "GANO")
        self.assertEqual(r.data["torneo"]["metodo_display"], "KO/TKO")
        self.assertTrue(r.data["asistio"])  # si peleó, asistió

        t = Torneo.objects.get(evento=self.torneo, alumno=self.alumno)
        self.assertEqual(t.nombre_torneo, "Copa Brava")
        self.assertEqual(str(t.fecha), "2026-05-10")
        self.assertEqual(t.disciplina_id, self.mma.id)

        self.alumno.experiencia.refresh_from_db()
        self.assertEqual(self.alumno.experiencia.peleas_ganadas, 1)
        self.assertEqual(self.alumno.record, "1-0-0")

    def test_registrar_de_nuevo_actualiza_sin_duplicar(self):
        insc = self._inscribir()
        url = f"{URL_INS}{insc.id}/resultado/"
        self.client.post(url, {"resultado": "GANO", "metodo": "KO"}, format="json")
        r = self.client.post(url, {"resultado": "PERDIO", "metodo": "DECISION"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["torneo"]["resultado_display"], "Perdió")
        self.assertEqual(Torneo.objects.filter(evento=self.torneo, alumno=self.alumno).count(), 1)
        exp = self.alumno.experiencia
        exp.refresh_from_db()
        self.assertEqual((exp.peleas_ganadas, exp.peleas_perdidas), (0, 1))

    def test_resultado_o_metodo_invalidos_dan_400(self):
        insc = self._inscribir()
        url = f"{URL_INS}{insc.id}/resultado/"
        self.assertEqual(self.client.post(url, {"resultado": "CASI"}, format="json").status_code, 400)
        self.assertEqual(
            self.client.post(url, {"resultado": "GANO", "metodo": "PATADA"}, format="json").status_code,
            400,
        )
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 400)
        self.assertFalse(Torneo.objects.filter(evento=self.torneo).exists())

    def test_solo_eventos_tipo_torneo_llevan_resultado(self):
        insc = self._inscribir(evento=self.seminario)
        r = self.client.post(
            f"{URL_INS}{insc.id}/resultado/", {"resultado": "GANO"}, format="json"
        )
        self.assertEqual(r.status_code, 400)

    def test_alumno_no_registra_ni_borra_resultado(self):
        insc = self._inscribir()
        client = APIClient()
        client.force_authenticate(self.alumno_user)
        url = f"{URL_INS}{insc.id}/resultado/"
        self.assertEqual(client.post(url, {"resultado": "GANO"}, format="json").status_code, 403)
        self.assertEqual(client.delete(url).status_code, 403)

    def test_borrar_resultado_quita_torneo_y_record(self):
        insc = self._inscribir()
        url = f"{URL_INS}{insc.id}/resultado/"
        self.client.post(url, {"resultado": "GANO"}, format="json")
        r = self.client.delete(url)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIsNone(r.data["torneo"])
        self.assertFalse(Torneo.objects.filter(evento=self.torneo, alumno=self.alumno).exists())
        self.alumno.experiencia.refresh_from_db()
        self.assertEqual(self.alumno.experiencia.peleas_ganadas, 0)

    def test_lista_de_inscritos_trae_el_resultado(self):
        self._inscribir()
        Torneo.objects.create(
            alumno=self.alumno, evento=self.torneo, nombre_torneo="Copa Brava",
            fecha="2026-05-10", resultado=Torneo.Resultado.EMPATO,
        )
        r = self.client.get(f"{URL_INS}?evento={self.torneo.id}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["results"][0]["torneo"]["resultado_display"], "Empató")

    def test_torneo_suelto_sin_evento_sigue_funcionando(self):
        # La captura manual desde la ficha del alumno (sin evento) no cambia.
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            "/api/torneos/",
            {"alumno": self.alumno.id, "nombre_torneo": "Abierto", "fecha": "2026-01-01", "resultado": "GANO"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertIsNone(r.data["evento"])
