"""Pruebas del módulo de Evaluación MMA: cálculo, API, validaciones y permisos.

El catálogo (7 categorías / 45 habilidades) lo carga la migración de datos
0006_catalogo_mma, así que ya existe en la BD de pruebas sin seed manual.
"""
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.evaluacion_mma import (
    PESOS_PREPARACION,
    calcular_evaluacion,
    historial_evaluacion,
    nivel_por_puntaje,
)
from core.models import (
    Alumno,
    CategoriaMMA,
    EvaluacionMMA,
    HabilidadMMA,
    Horario,
    Maestro,
    PuntajeHabilidadMMA,
)

URL = "/api/evaluaciones-mma/"


# --- Fábricas ---------------------------------------------------------------

def _admin(username="admin-mma"):
    return User.objects.create_user(username, password="x12345678", is_staff=True)


def _maestro(nombre, username, horarios=()):
    """Maestro con cuenta; su alcance son los grupos (horarios) que se le pasan."""
    user = User.objects.create_user(username, password="x12345678")
    maestro = Maestro.objects.create(nombre=nombre, usuario=user)
    maestro.horarios.set(horarios)
    return maestro


def _alumno(nombres, horario=None, con_cuenta=False):
    # Alumno.objects.create() ya dispara core.signals.crear_experiencia (y
    # crear_cuenta); con_cuenta=True liga una cuenta propia conocida.
    alumno = Alumno.objects.create(nombres=nombres, apellidos="Prueba", horario=horario)
    if con_cuenta:
        alumno.usuario = User.objects.create_user(f"alu-{alumno.pk}", password="x12345678")
        alumno.save(update_fields=["usuario"])
    return alumno


def _puntajes(valor=3, solo_categoria=None):
    """Lista de puntajes para TODAS las habilidades activas (o solo una categoría)."""
    qs = HabilidadMMA.objects.filter(activa=True)
    if solo_categoria:
        qs = qs.filter(categoria__clave=solo_categoria)
    return [{"habilidad": h.id, "puntaje": valor} for h in qs]


def _crear_evaluacion(alumno, valor=3, fecha=None, estado=EvaluacionMMA.Estado.FINALIZADA, **extra):
    """Crea directo en BD (sin pasar por la API) una evaluación completa."""
    ev = EvaluacionMMA.objects.create(
        alumno=alumno, fecha=fecha or timezone.localdate(), estado=estado, **extra
    )
    PuntajeHabilidadMMA.objects.bulk_create(
        [
            PuntajeHabilidadMMA(evaluacion=ev, habilidad=h, puntaje=valor)
            for h in HabilidadMMA.objects.filter(activa=True)
        ]
    )
    return ev


# --- Cálculo (servicio, sin API) -------------------------------------------

class CatalogoTest(TestCase):
    def test_catalogo_inicial_cargado_por_migracion(self):
        self.assertEqual(CategoriaMMA.objects.count(), 7)
        self.assertEqual(HabilidadMMA.objects.count(), 45)
        self.assertEqual(sum(CategoriaMMA.objects.values_list("puntos_maximos", flat=True)), 100)
        self.assertEqual(CategoriaMMA.objects.get(clave="striking").puntos_maximos, 20)
        self.assertEqual(CategoriaMMA.objects.get(clave="disciplina").puntos_maximos, 5)


class CalculoTest(TestCase):
    def setUp(self):
        self.alumno = _alumno("Calc")

    def test_todo_en_5_da_100_y_competitivo(self):
        ev = _crear_evaluacion(self.alumno, valor=5)
        c = calcular_evaluacion(ev)
        self.assertEqual(c["puntaje_total"], 100)
        self.assertEqual(c["puntaje_maximo"], 100)
        self.assertEqual(c["nivel"], "Competitivo")
        self.assertTrue(c["completa"])
        self.assertEqual(c["preparacion"]["total"], 100)
        for cat in c["categorias"]:
            self.assertEqual(cat["puntaje"], cat["maximo"])

    def test_todo_en_1_da_20_e_inicial(self):
        ev = _crear_evaluacion(self.alumno, valor=1)
        c = calcular_evaluacion(ev)
        self.assertEqual(c["puntaje_total"], 20)  # 1/5 de cada categoría
        self.assertEqual(c["nivel"], "Inicial")

    def test_puntaje_por_categoria_es_proporcional_al_maximo(self):
        ev = _crear_evaluacion(self.alumno, valor=3)
        c = calcular_evaluacion(ev)
        por_clave = {cat["clave"]: cat for cat in c["categorias"]}
        self.assertEqual(por_clave["striking"]["puntaje"], 12.0)  # 3/5 · 20
        self.assertEqual(por_clave["integracion"]["puntaje"], 9.0)  # 3/5 · 15
        self.assertEqual(por_clave["disciplina"]["puntaje"], 3.0)  # 3/5 · 5
        self.assertEqual(c["puntaje_total"], 60.0)
        self.assertEqual(c["nivel"], "Intermedio")

    def test_categoria_parcial_se_normaliza_por_habilidades_evaluadas(self):
        """Una habilidad nueva en el catálogo no debe bajar evaluaciones viejas."""
        ev = EvaluacionMMA.objects.create(alumno=self.alumno)
        striking = list(HabilidadMMA.objects.filter(categoria__clave="striking"))
        # Solo 4 de las 8 habilidades de striking, todas en 5.
        PuntajeHabilidadMMA.objects.bulk_create(
            [PuntajeHabilidadMMA(evaluacion=ev, habilidad=h, puntaje=5) for h in striking[:4]]
        )
        c = calcular_evaluacion(ev)
        striking_calc = next(x for x in c["categorias"] if x["clave"] == "striking")
        self.assertEqual(striking_calc["puntaje"], 20.0)
        self.assertEqual(striking_calc["habilidades_evaluadas"], 4)
        self.assertEqual(striking_calc["habilidades_total"], 8)
        self.assertFalse(c["completa"])
        # Las demás categorías, sin nada evaluado, valen 0.
        self.assertEqual(c["puntaje_total"], 20.0)

    def test_bandas_de_nivel(self):
        self.assertEqual(nivel_por_puntaje(0), "Inicial")
        self.assertEqual(nivel_por_puntaje(29.9), "Inicial")
        self.assertEqual(nivel_por_puntaje(30), "Principiante")
        self.assertEqual(nivel_por_puntaje(44.9), "Principiante")
        self.assertEqual(nivel_por_puntaje(45), "Básico")
        self.assertEqual(nivel_por_puntaje(60), "Intermedio")
        self.assertEqual(nivel_por_puntaje(74.9), "Intermedio")
        self.assertEqual(nivel_por_puntaje(75), "Avanzado")
        self.assertEqual(nivel_por_puntaje(90), "Competitivo")
        self.assertEqual(nivel_por_puntaje(100), "Competitivo")

    def test_preparacion_separa_componentes_y_pondera(self):
        """Striking/wrestling/grappling en 5 y el resto en 1: técnica 100, lo demás 20."""
        ev = EvaluacionMMA.objects.create(alumno=self.alumno)
        filas = []
        for h in HabilidadMMA.objects.select_related("categoria"):
            alto = h.categoria.clave in ("striking", "wrestling", "grappling")
            filas.append(PuntajeHabilidadMMA(evaluacion=ev, habilidad=h, puntaje=5 if alto else 1))
        PuntajeHabilidadMMA.objects.bulk_create(filas)

        p = calcular_evaluacion(ev)["preparacion"]
        self.assertEqual(p["tecnica"], 100)
        self.assertEqual(p["fisica"], 20)
        self.assertEqual(p["defensa"], 20)
        self.assertEqual(p["tactica"], 20)
        self.assertEqual(p["disciplina"], 20)
        esperado = round(100 * PESOS_PREPARACION["tecnica"] + 20 * (1 - PESOS_PREPARACION["tecnica"]))
        self.assertEqual(p["total"], esperado)
        # El "skill rating" (total /100) es otro número, distinto de la preparación.
        self.assertNotEqual(calcular_evaluacion(ev)["puntaje_total"], p["total"])

    def test_historial_es_cronologico_y_solo_finalizadas(self):
        hoy = timezone.localdate()
        _crear_evaluacion(self.alumno, valor=2, fecha=hoy - timedelta(days=60))
        _crear_evaluacion(self.alumno, valor=4, fecha=hoy - timedelta(days=30))
        _crear_evaluacion(self.alumno, valor=5, fecha=hoy, estado=EvaluacionMMA.Estado.BORRADOR)
        h = historial_evaluacion(self.alumno)
        self.assertEqual([p["puntaje_total"] for p in h], [40.0, 80.0])
        self.assertEqual([p["nivel"] for p in h], ["Principiante", "Avanzado"])
        self.assertIn("striking", h[0]["categorias"])


# --- API: CRUD y validaciones (como administrativo) -------------------------

class EvaluacionAPITest(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.alumno = _alumno("Ana")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _post(self, **cambios):
        datos = {"alumno": self.alumno.id, "puntajes": _puntajes(3), "notas": "Buen avance"}
        datos.update(cambios)
        return self.client.post(URL, datos, format="json")

    def test_crear_evaluacion_completa(self):
        r = self._post()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["puntaje_total"], 60.0)
        self.assertEqual(r.data["nivel"], "Intermedio")
        self.assertEqual(r.data["estado"], "FINALIZADA")
        self.assertTrue(r.data["completa"])
        self.assertEqual(len(r.data["puntajes"]), 45)
        self.assertEqual(len(r.data["categorias"]), 7)
        self.assertEqual(r.data["creado_por"], self.admin.id)
        self.assertIsNone(r.data["evaluador"])  # admin sin maestro ligado
        self.assertIn("preparacion", r.data)
        self.assertEqual(PuntajeHabilidadMMA.objects.count(), 45)

    def test_consultar_y_listar_por_alumno(self):
        ev = _crear_evaluacion(self.alumno)
        otro = _alumno("Otro")
        _crear_evaluacion(otro)
        r = self.client.get(f"{URL}{ev.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["alumno_nombre"], "Ana Prueba")
        r = self.client.get(URL, {"alumno": self.alumno.id})
        self.assertEqual([e["id"] for e in r.data["results"]], [ev.id])

    def test_modificar_puntajes_recalcula_el_score(self):
        ev = _crear_evaluacion(self.alumno, valor=3)
        r = self.client.patch(
            f"{URL}{ev.id}/", {"puntajes": _puntajes(5), "notas": "Subió"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["puntaje_total"], 100)
        self.assertEqual(r.data["notas"], "Subió")
        self.assertEqual(ev.puntajes.count(), 45)  # se reemplazaron, no se duplicaron

    def test_patch_solo_notas_no_toca_puntajes(self):
        ev = _crear_evaluacion(self.alumno, valor=4)
        r = self.client.patch(f"{URL}{ev.id}/", {"notas": "x"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["puntaje_total"], 80.0)

    def test_eliminar(self):
        ev = _crear_evaluacion(self.alumno)
        r = self.client.delete(f"{URL}{ev.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(EvaluacionMMA.objects.filter(pk=ev.pk).exists())

    def test_nueva_evaluacion_no_pisa_la_anterior(self):
        hoy = timezone.localdate()
        _crear_evaluacion(self.alumno, valor=2, fecha=hoy - timedelta(days=30))
        r = self._post(fecha=str(hoy))
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(EvaluacionMMA.objects.filter(alumno=self.alumno).count(), 2)

    # -- validaciones --

    def test_puntaje_fuera_de_rango(self):
        for valor in (0, 6):
            r = self._post(puntajes=_puntajes(valor))
            self.assertEqual(r.status_code, 400, valor)
            self.assertIn("puntajes", r.data)

    def test_habilidad_inexistente(self):
        r = self._post(puntajes=[{"habilidad": 999999, "puntaje": 3}], estado="BORRADOR")
        self.assertEqual(r.status_code, 400)

    def test_habilidad_inactiva_no_se_puede_calificar(self):
        h = HabilidadMMA.objects.first()
        h.activa = False
        h.save()
        r = self._post(puntajes=[{"habilidad": h.id, "puntaje": 3}], estado="BORRADOR")
        self.assertEqual(r.status_code, 400)

    def test_habilidad_repetida(self):
        h = HabilidadMMA.objects.first()
        r = self._post(
            puntajes=[{"habilidad": h.id, "puntaje": 3}, {"habilidad": h.id, "puntaje": 4}],
            estado="BORRADOR",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("puntajes", r.data)

    def test_sin_puntajes(self):
        r = self._post(puntajes=[])
        self.assertEqual(r.status_code, 400)
        self.assertIn("puntajes", r.data)

    def test_alumno_inexistente(self):
        r = self._post(alumno=999999)
        self.assertEqual(r.status_code, 400)
        self.assertIn("alumno", r.data)

    def test_fecha_futura(self):
        r = self._post(fecha=str(timezone.localdate() + timedelta(days=1)))
        self.assertEqual(r.status_code, 400)
        self.assertIn("fecha", r.data)

    def test_duplicado_mismo_dia_da_400(self):
        _crear_evaluacion(self.alumno)
        r = self._post()
        self.assertEqual(r.status_code, 400)
        self.assertIn("fecha", r.data)

    def test_finalizada_incompleta_da_400_pero_borrador_pasa(self):
        parcial = _puntajes(4, solo_categoria="striking")
        r = self._post(puntajes=parcial)
        self.assertEqual(r.status_code, 400)
        self.assertIn("estado", r.data)

        r = self._post(puntajes=parcial, estado="BORRADOR")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(r.data["completa"])
        self.assertEqual(r.data["puntaje_total"], 16.0)  # solo striking: 4/5 · 20

    def test_finalizar_borrador_exige_completarlo(self):
        ev = _crear_evaluacion(self.alumno, estado=EvaluacionMMA.Estado.BORRADOR)
        ev.puntajes.exclude(habilidad__categoria__clave="striking").delete()
        r = self.client.patch(f"{URL}{ev.id}/", {"estado": "FINALIZADA"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(
            f"{URL}{ev.id}/", {"estado": "FINALIZADA", "puntajes": _puntajes(3)}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)

    def test_no_se_puede_reasignar_a_otro_alumno(self):
        ev = _crear_evaluacion(self.alumno)
        otro = _alumno("Otro")
        r = self.client.patch(f"{URL}{ev.id}/", {"alumno": otro.id}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("alumno", r.data)

    # -- resumen e historial del alumno --

    def test_resumen_e_historial(self):
        hoy = timezone.localdate()
        base = f"/api/alumnos/{self.alumno.id}/"

        r = self.client.get(f"{base}evaluacion-resumen/")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["ultima"])
        self.assertEqual(r.data["total_evaluaciones"], 0)

        _crear_evaluacion(self.alumno, valor=2, fecha=hoy - timedelta(days=60))
        _crear_evaluacion(self.alumno, valor=3, fecha=hoy - timedelta(days=30))
        _crear_evaluacion(self.alumno, valor=5, fecha=hoy, estado=EvaluacionMMA.Estado.BORRADOR)

        r = self.client.get(f"{base}evaluacion-resumen/")
        self.assertEqual(r.data["total_evaluaciones"], 2)  # el borrador no cuenta
        self.assertEqual(r.data["ultima"]["puntaje_total"], 60.0)
        self.assertEqual(r.data["variacion"], 20.0)
        self.assertIn("aviso_preparacion", r.data)

        r = self.client.get(f"{base}evaluacion-historial/")
        self.assertEqual([p["puntaje_total"] for p in r.data], [40.0, 60.0])
        self.assertEqual(r.data[0]["categorias"]["striking"], 8.0)


# --- Permisos por rol -------------------------------------------------------

class PermisosEvaluacionTest(TestCase):
    def setUp(self):
        # El alcance del maestro es por grupo (Horario): Ana está en el
        # grupo de la mañana que le asignaron; Luis, en otro.
        self.manana = Horario.objects.create(hora_inicio="07:00", hora_fin="09:00")
        self.tarde = Horario.objects.create(hora_inicio="16:00", hora_fin="18:00", turno="VESPERTINO")
        self.maestro = _maestro("Coach BJJ", "coach-bjj", horarios=[self.manana])
        self.alumno_bjj = _alumno("Ana", horario=self.manana, con_cuenta=True)
        self.alumno_box = _alumno("Luis", horario=self.tarde, con_cuenta=True)

        self.c_maestro = APIClient()
        self.c_maestro.force_authenticate(self.maestro.usuario)
        self.c_alumno = APIClient()
        self.c_alumno.force_authenticate(self.alumno_bjj.usuario)

    def test_anonimo_401(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)
        self.assertEqual(APIClient().get("/api/categorias-mma/").status_code, 401)

    def test_catalogo_lo_leen_todos_pero_solo_admin_escribe(self):
        for cliente in (self.c_maestro, self.c_alumno):
            r = cliente.get("/api/categorias-mma/", {"page_size": 50})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.data["count"], 7)
            self.assertEqual(len(r.data["results"][0]["habilidades"]), 8)  # striking
        r = self.c_maestro.post(
            "/api/categorias-mma/", {"clave": "x", "nombre": "X", "puntos_maximos": 5}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_maestro_evalua_alumno_a_su_cargo_y_queda_como_evaluador(self):
        r = self.c_maestro.post(
            URL, {"alumno": self.alumno_bjj.id, "puntajes": _puntajes(4)}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["evaluador"], self.maestro.id)
        self.assertEqual(r.data["evaluador_nombre"], "Coach BJJ")
        self.assertEqual(r.data["creado_por"], self.maestro.usuario_id)

    def test_maestro_no_evalua_alumno_fuera_de_su_alcance(self):
        r = self.c_maestro.post(
            URL, {"alumno": self.alumno_box.id, "puntajes": _puntajes(4)}, format="json"
        )
        self.assertEqual(r.status_code, 403)
        self.assertFalse(EvaluacionMMA.objects.filter(alumno=self.alumno_box).exists())

    def test_maestro_solo_ve_y_edita_evaluaciones_de_alumnos_a_su_cargo(self):
        propia = _crear_evaluacion(self.alumno_bjj)
        ajena = _crear_evaluacion(self.alumno_box)
        r = self.c_maestro.get(URL)
        self.assertEqual({e["id"] for e in r.data["results"]}, {propia.id})
        self.assertEqual(self.c_maestro.get(f"{URL}{ajena.id}/").status_code, 404)
        self.assertEqual(
            self.c_maestro.patch(f"{URL}{ajena.id}/", {"notas": "x"}, format="json").status_code, 404
        )
        self.assertEqual(
            self.c_maestro.get(f"/api/alumnos/{self.alumno_box.id}/evaluacion-resumen/").status_code,
            404,
        )
        r = self.c_maestro.get(f"/api/alumnos/{self.alumno_bjj.id}/evaluacion-historial/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)

    def test_alumno_solo_lee_las_suyas_finalizadas(self):
        mia = _crear_evaluacion(self.alumno_bjj)
        _crear_evaluacion(
            self.alumno_bjj, fecha=timezone.localdate() - timedelta(days=1),
            estado=EvaluacionMMA.Estado.BORRADOR,
        )
        ajena = _crear_evaluacion(self.alumno_box)

        r = self.c_alumno.get(URL)
        self.assertEqual({e["id"] for e in r.data["results"]}, {mia.id})
        self.assertEqual(self.c_alumno.get(f"{URL}{ajena.id}/").status_code, 404)

        r = self.c_alumno.get(f"/api/alumnos/{self.alumno_bjj.id}/evaluacion-resumen/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["ultima"]["id"], mia.id)
        self.assertEqual(
            self.c_alumno.get(f"/api/alumnos/{self.alumno_box.id}/evaluacion-resumen/").status_code,
            404,
        )

    def test_alumno_no_escribe(self):
        mia = _crear_evaluacion(self.alumno_bjj)
        r = self.c_alumno.post(
            URL, {"alumno": self.alumno_bjj.id, "puntajes": _puntajes(5)}, format="json"
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(
            self.c_alumno.patch(f"{URL}{mia.id}/", {"notas": "yo"}, format="json").status_code, 403
        )
        self.assertEqual(self.c_alumno.delete(f"{URL}{mia.id}/").status_code, 403)

    def test_admin_puede_asignar_evaluador_explicito(self):
        admin = _admin()
        c = APIClient()
        c.force_authenticate(admin)
        r = c.post(
            URL,
            {"alumno": self.alumno_box.id, "evaluador": self.maestro.id, "puntajes": _puntajes(2)},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["evaluador"], self.maestro.id)
