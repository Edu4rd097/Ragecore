"""
Pruebas del segundo registro de caja (Venta): otros ingresos aparte de las
membresías. Una venta no toca vencimientos ni el semáforo del alumno, el corte
del mes va por separado y solo el administrativo la maneja.
"""
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Alumno, Horario, Maestro, Membresia, Pago, Venta


class VentasTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin", password="x12345678", is_staff=True)
        self.alumno = Alumno.objects.create(nombres="Ana", apellidos="Ruiz")
        self.basica = Membresia.objects.create(
            nombre="Mensualidad Básica", duracion_dias=30, precio=800,
            descripcion="1 disciplina, horario fijo.",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _venta(self, **extra):
        datos = {"concepto": "Inscripción", "monto": "200.00", "metodo": "EFECTIVO"}
        datos.update(extra)
        return self.client.post("/api/ventas/", datos, format="json")

    def test_admin_registra_venta_con_concepto_y_queda_auditada(self):
        r = self._venta(alumno=self.alumno.id)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["concepto"], "Inscripción")
        self.assertEqual(r.data["alumno_nombre"], "Ana Ruiz")
        self.assertEqual(r.data["metodo_display"], "Efectivo")
        self.assertEqual(r.data["registrado_por"], self.admin.id)
        self.assertEqual(Venta.objects.count(), 1)

    def test_venta_a_externo_no_necesita_alumno(self):
        r = self._venta(concepto="Guantes 12 oz", monto="650")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertIsNone(r.data["alumno"])
        self.assertEqual(r.data["alumno_nombre"], "")

    def test_venta_no_toca_membresia_ni_semaforo_del_alumno(self):
        self.assertFalse(self.alumno.al_corriente)
        r = self._venta(alumno=self.alumno.id)
        self.assertEqual(r.status_code, 201, r.data)
        self.alumno.refresh_from_db()
        self.assertFalse(self.alumno.al_corriente)
        self.assertIsNone(self.alumno.dias_para_vencer)
        self.assertEqual(Pago.objects.count(), 0)

    def test_concepto_vacio_y_monto_cero_se_rechazan(self):
        self.assertEqual(self._venta(concepto="   ").status_code, 400)
        self.assertEqual(self._venta(monto="0").status_code, 400)

    def test_cortes_de_membresias_y_ventas_van_por_separado(self):
        Pago.objects.create(alumno=self.alumno, membresia=self.basica, monto=800)
        self._venta(alumno=self.alumno.id)
        self._venta(concepto="Vendas", monto="150")

        pagos = self.client.get("/api/pagos/resumen/").data
        self.assertEqual(Decimal(pagos["total_cobrado"]), Decimal("800"))
        self.assertEqual(pagos["numero_pagos"], 1)

        ventas = self.client.get("/api/ventas/resumen/").data
        self.assertEqual(Decimal(ventas["total_vendido"]), Decimal("350"))
        self.assertEqual(ventas["numero_ventas"], 2)
        self.assertEqual(ventas["por_concepto"][0]["concepto"], "Inscripción")

        panel = self.client.get("/api/dashboard/").data
        self.assertEqual(Decimal(panel["ingresos_mes"]), Decimal("800"))
        self.assertEqual(Decimal(panel["otros_ingresos_mes"]), Decimal("350"))

    def test_maestro_y_alumno_no_acceden_a_ventas(self):
        user_maestro = User.objects.create_user("prof", password="x12345678")
        Maestro.objects.create(nombre="Profe", usuario=user_maestro)
        user_alumno = User.objects.create_user("alu", password="x12345678")
        Alumno.objects.create(nombres="Beto", apellidos="Gil", usuario=user_alumno)

        for user in (user_maestro, user_alumno):
            cliente = APIClient()
            cliente.force_authenticate(user)
            self.assertEqual(cliente.get("/api/ventas/").status_code, 403)
            r = cliente.post(
                "/api/ventas/", {"concepto": "X", "monto": "10"}, format="json"
            )
            self.assertEqual(r.status_code, 403)
        self.assertEqual(Venta.objects.count(), 0)

    def test_filtro_por_rango_de_fechas_en_ventas_y_pagos(self):
        hoy = timezone.localdate()
        hace_40 = hoy - timedelta(days=40)
        Venta.objects.create(concepto="Hoy", monto=10, fecha=hoy)
        Venta.objects.create(concepto="Viejo", monto=10, fecha=hace_40)
        Pago.objects.create(alumno=self.alumno, membresia=self.basica, monto=800, fecha_pago=hoy)
        Pago.objects.create(alumno=self.alumno, membresia=self.basica, monto=800, fecha_pago=hace_40)

        desde = (hoy - timedelta(days=7)).isoformat()
        r = self.client.get(f"/api/ventas/?fecha__gte={desde}")
        self.assertEqual([v["concepto"] for v in r.data["results"]], ["Hoy"])

        r = self.client.get(f"/api/pagos/?fecha_pago__gte={desde}")
        self.assertEqual(r.data["count"], 1)
        r = self.client.get(f"/api/pagos/?fecha_pago__lte={desde}")
        self.assertEqual(r.data["count"], 1)

    def test_busqueda_por_concepto_y_alumno(self):
        self._venta(concepto="Guantes 12 oz", alumno=self.alumno.id)
        self._venta(concepto="Playera", monto="250")
        r = self.client.get("/api/ventas/?search=guantes")
        self.assertEqual(r.data["count"], 1)
        r = self.client.get("/api/ventas/?search=ruiz")
        self.assertEqual([v["concepto"] for v in r.data["results"]], ["Guantes 12 oz"])


class CatalogoDelCartelTest(TestCase):
    """Los campos nuevos de los catálogos (clase de la franja, qué incluye el plan)."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(
            User.objects.create_user("admin", password="x12345678", is_staff=True)
        )

    def test_horario_lleva_la_clase_que_se_imparte(self):
        r = self.client.post(
            "/api/horarios/",
            {
                "hora_inicio": "06:00", "hora_fin": "07:00", "turno": "MATUTINO",
                "dias": ["lunes", "martes", "miercoles", "jueves", "viernes"],
                "nombre": "Striking / Funcional",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["nombre"], "Striking / Funcional")
        horario = Horario.objects.get(pk=r.data["id"])
        self.assertEqual(str(horario), "Matutino 06:00-07:00 · Striking / Funcional")

    def test_horario_sin_clase_conserva_el_texto_de_siempre(self):
        horario = Horario.objects.create(hora_inicio="20:00", hora_fin="21:00", turno="NOCTURNO")
        horario.refresh_from_db()  # las horas llegan como time, no como str
        self.assertEqual(str(horario), "Nocturno 20:00-21:00")

    def test_membresia_expone_que_incluye(self):
        r = self.client.post(
            "/api/membresias/",
            {
                "nombre": "Mensualidad Plus", "duracion_dias": 30, "precio": "1300.00",
                "descripcion": "2 disciplinas, horario fijo.",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["descripcion"], "2 disciplinas, horario fijo.")
