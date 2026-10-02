"""
Registro manual de asistencia (POST /api/asistencias/manual/): recepción
identifica al alumno por id (lo buscó por nombre) o desde el botón de su
ficha. Queda marcado como MANUAL, acepta fecha pasada y solo lo usa el
administrativo; el check-in por QR sigue igual.
"""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Alumno, AlumnoDisciplina, Asistencia, Disciplina, Horario, Maestro


class AsistenciaManualTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("recepcion", password="x12345678", is_staff=True)
        self.disciplina = Disciplina.objects.create(nombre="Striking")
        self.horario = Horario.objects.create(
            hora_inicio="06:00", hora_fin="07:00", turno="MATUTINO", nombre="Striking"
        )
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz", horario=self.horario)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _manual(self, **extra):
        datos = {"alumno_id": self.alumno.id, "disciplina_id": self.disciplina.id}
        datos.update(extra)
        return self.client.post("/api/asistencias/manual/", datos, format="json")

    def test_registra_por_id_como_manual_y_suma_puntos(self):
        r = self._manual()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["alumno"]["nombre"], "Ana Ruiz")
        self.assertEqual(r.data["puntos_otorgados"], Asistencia.PUNTOS_POR_CLASE)
        self.assertEqual(r.data["metodo_registro"], "MANUAL")
        self.assertEqual(r.data["racha"], 1)

        asistencia = Asistencia.objects.get(pk=r.data["asistencia_id"])
        self.assertEqual(asistencia.metodo_registro, Asistencia.MetodoRegistro.MANUAL)
        self.assertEqual(asistencia.horario, self.horario)  # hereda el del alumno
        self.alumno.refresh_from_db()
        self.assertGreaterEqual(self.alumno.puntos, Asistencia.PUNTOS_POR_CLASE)

    def test_respeta_la_fecha_pasada(self):
        ayer = timezone.localdate() - timedelta(days=1)
        r = self._manual(fecha=ayer.isoformat())
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(str(r.data["fecha"]), ayer.isoformat())
        self.assertEqual(Asistencia.objects.get().fecha, ayer)

    def test_rechaza_fecha_futura_y_alumno_inexistente(self):
        manana = timezone.localdate() + timedelta(days=1)
        self.assertEqual(self._manual(fecha=manana.isoformat()).status_code, 400)
        self.assertEqual(self._manual(alumno_id=99999).status_code, 400)

    def test_duplicado_en_la_misma_clase_da_409(self):
        self.assertEqual(self._manual().status_code, 201)
        r = self._manual()
        self.assertEqual(r.status_code, 409)
        self.assertIn("ya registró asistencia", r.data["detail"])
        # Pero sí puede registrar otra disciplina el mismo día.
        otra = Disciplina.objects.create(nombre="Jiu Jitsu")
        self.assertEqual(self._manual(disciplina_id=otra.id).status_code, 201)

    def test_alumno_dado_de_baja_403(self):
        self.alumno.activo = False
        self.alumno.save()
        self.assertEqual(self._manual().status_code, 403)

    def test_solo_administrativo(self):
        user_maestro = User.objects.create_user("prof", password="x12345678")
        Maestro.objects.create(nombre="Profe", usuario=user_maestro)
        user_alumno = User.objects.create_user("alu", password="x12345678")
        Alumno.objects.create(nombres="Beto", apellidos="Gil", usuario=user_alumno)

        for user in (user_maestro, user_alumno):
            cliente = APIClient()
            cliente.force_authenticate(user)
            r = cliente.post(
                "/api/asistencias/manual/", {"alumno_id": self.alumno.id}, format="json"
            )
            self.assertEqual(r.status_code, 403)
        r = APIClient().post("/api/asistencias/manual/", {"alumno_id": self.alumno.id}, format="json")
        self.assertIn(r.status_code, (401, 403))
        self.assertEqual(Asistencia.objects.count(), 0)

    def test_checkin_por_qr_sigue_marcando_qr(self):
        r = self.client.post(
            "/api/asistencias/checkin/",
            {"codigo_qr": self.alumno.codigo_qr, "disciplina_id": self.disciplina.id},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["metodo_registro"], "QR")


class MiCheckinTest(TestCase):
    """El alumno registra su propia asistencia de hoy desde Mi perfil (queda como APP)."""

    def setUp(self):
        self.striking = Disciplina.objects.create(nombre="Striking")
        self.jiu_jitsu = Disciplina.objects.create(nombre="Jiu Jitsu")
        self.horario = Horario.objects.create(hora_inicio="06:00", hora_fin="07:00", turno="MATUTINO")
        self.user = User.objects.create_user("ana", password="x12345678")
        self.alumno = Alumno.objects.create(
            nombres="Ana", apellidos="Ruiz", usuario=self.user, horario=self.horario
        )
        AlumnoDisciplina.objects.create(alumno=self.alumno, disciplina=self.striking)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _mi_checkin(self, **datos):
        return self.client.post("/api/asistencias/mi-checkin/", datos, format="json")

    def test_alumno_registra_su_asistencia_como_app(self):
        r = self._mi_checkin(disciplina_id=self.striking.id)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["metodo_registro"], "APP")
        self.assertEqual(r.data["alumno"]["id"], self.alumno.id)
        self.assertEqual(r.data["puntos_otorgados"], Asistencia.PUNTOS_POR_CLASE)
        asistencia = Asistencia.objects.get()
        self.assertEqual(asistencia.metodo_registro, Asistencia.MetodoRegistro.APP)
        self.assertEqual(asistencia.horario, self.horario)
        self.assertEqual(asistencia.fecha, timezone.localdate())

    def test_sin_disciplina_tambien_vale(self):
        self.assertEqual(self._mi_checkin().status_code, 201)

    def test_solo_disciplinas_en_las_que_esta_inscrito(self):
        r = self._mi_checkin(disciplina_id=self.jiu_jitsu.id)
        self.assertEqual(r.status_code, 400)
        self.assertIn("disciplina_id", r.data)
        self.assertEqual(Asistencia.objects.count(), 0)

    def test_doble_registro_del_dia_da_409(self):
        self.assertEqual(self._mi_checkin(disciplina_id=self.striking.id).status_code, 201)
        self.assertEqual(self._mi_checkin(disciplina_id=self.striking.id).status_code, 409)

    def test_alumno_dado_de_baja_403(self):
        self.alumno.activo = False
        self.alumno.save()
        self.assertEqual(self._mi_checkin().status_code, 403)

    def test_quien_no_es_alumno_no_puede(self):
        admin = User.objects.create_user("admin", password="x12345678", is_staff=True)
        cliente = APIClient()
        cliente.force_authenticate(admin)
        self.assertEqual(cliente.post("/api/asistencias/mi-checkin/", {}, format="json").status_code, 403)
        anonimo = APIClient().post("/api/asistencias/mi-checkin/", {}, format="json")
        self.assertIn(anonimo.status_code, (401, 403))
        self.assertEqual(Asistencia.objects.count(), 0)
