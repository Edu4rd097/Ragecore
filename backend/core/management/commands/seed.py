"""
Carga catálogos base (disciplinas, membresías, horarios, insignias)
y, opcionalmente, alumnos de prueba.

    python manage.py seed
    python manage.py seed --demo
"""
import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import (
    Alumno,
    AlumnoDisciplina,
    Asistencia,
    Disciplina,
    Horario,
    Insignia,
    Maestro,
    MaestroDisciplina,
    Membresia,
    Pago,
)

# Catálogos tomados del cartel de horarios y costos de la academia.
DISCIPLINAS = [
    ("Striking", "Golpeo de pie: boxeo, patadas, rodillas y codos. Base del MMA."),
    ("Jiu Jitsu", "Brazilian Jiu Jitsu: control, posiciones y sumisiones."),
    ("MMA", "Artes marciales mixtas: striking, lucha y suelo."),
    ("Jiu Jitsu Kids", "BJJ para niños."),
    ("Striking Kids", "Striking para niños."),
    ("Acrobacia", "Acrobacia. Incluida en la Mensualidad JR."),
    (
        "Entrenamiento Funcional",
        "Acondicionamiento físico. Lunes a viernes 6, 7, 8 y 9 AM y 7 PM.",
    ),
]

# (nombre, días de vigencia, precio, qué incluye). La inscripción ($200) no es
# membresía: se cobra como Venta con concepto "Inscripción".
MEMBRESIAS = [
    ("Mensualidad Básica", 30, 800, "1 disciplina, horario fijo."),
    ("Mensualidad Plus", 30, 1300, "2 disciplinas, horario fijo."),
    ("Mensualidad Premium", 30, 1800, "Hasta 3 horas, horario libre."),
    ("Mensualidad JR", 30, 1000, "Incluye Acrobacia y Jiu Jitsu."),
    ("Mensualidad Kids", 30, 1300, "Incluye Striking y Jiu Jitsu."),
    ("Semana", 7, 300, "Acceso por una semana."),
    ("Clase", 1, 100, "Una clase suelta."),
]

LUNES_A_VIERNES = ["lunes", "martes", "miercoles", "jueves", "viernes"]

# (inicio, fin, turno, días, clase que se imparte). Franjas de una hora, tal
# como el cartel. El funcional coincide con las de 6-9 AM y 7 PM.
HORARIOS = [
    ("06:00", "07:00", "MATUTINO", LUNES_A_VIERNES, "Striking / Funcional"),
    ("07:00", "08:00", "MATUTINO", LUNES_A_VIERNES, "Jiu Jitsu / Funcional"),
    ("08:00", "09:00", "MATUTINO", LUNES_A_VIERNES, "Striking / Funcional"),
    ("09:00", "10:00", "MATUTINO", LUNES_A_VIERNES, "Jiu Jitsu / Funcional"),
    ("16:00", "17:00", "VESPERTINO", LUNES_A_VIERNES, "Jiu Jitsu Kids (L-Mi-V) / Striking Kids (Ma-J)"),
    ("17:00", "18:00", "VESPERTINO", LUNES_A_VIERNES, "Jiu Jitsu Kids"),
    ("18:00", "19:00", "VESPERTINO", LUNES_A_VIERNES, "Striking MMA / Kids"),
    ("19:00", "20:00", "NOCTURNO", LUNES_A_VIERNES, "Striking MMA / Funcional"),
    ("20:00", "21:00", "NOCTURNO", LUNES_A_VIERNES, "Jiu Jitsu"),
    ("21:00", "22:00", "NOCTURNO", LUNES_A_VIERNES, "Jiu Jitsu Fundamentos (L-Mi-V) / Striking Fundamentos (Ma-J)"),
]

INSIGNIAS = [
    ("Primer paso", "Registraste tu primera asistencia.", {"tipo": "asistencias_totales", "valor": 1}, 20),
    ("Constante", "10 entrenamientos seguidos sin romper la racha.", {"tipo": "racha", "valor": 10}, 100),
    ("Inquebrantable", "30 entrenamientos seguidos.", {"tipo": "racha", "valor": 30}, 400),
    ("Veterano", "50 clases acumuladas.", {"tipo": "asistencias_totales", "valor": 50}, 200),
    ("Centurión", "100 clases acumuladas.", {"tipo": "asistencias_totales", "valor": 100}, 500),
    ("Mil puntos", "Acumulaste 1000 puntos.", {"tipo": "puntos", "valor": 1000}, 0),
    ("Primer sparring", "Completaste tu primer sparring.", {"tipo": "sparrings", "valor": 1}, 50),
    ("Competidor", "Participaste en 3 torneos.", {"tipo": "torneos", "valor": 3}, 150),
    ("Invicto", "5 victorias registradas.", {"tipo": "victorias", "valor": 5}, 300),
    ("Espíritu de la casa", "Otorgada por el maestro.", {"tipo": "manual"}, 250),
]

NOMBRES = ["Carlos", "Luis", "Ana", "Miguel", "Sofía", "Diego", "Valeria", "Jorge", "Paola", "Andrés"]
APELLIDOS = ["Ramírez", "Hernández", "López", "Torres", "Vargas", "Castillo", "Mendoza", "Rojas"]
APODOS = ["El Tanque", "La Sombra", "Kid Dinamita", "El Lobo", "La Pantera", "El Martillo", "Fantasma"]


class Command(BaseCommand):
    help = "Carga catálogos base y datos de demostración."

    def add_arguments(self, parser):
        parser.add_argument("--demo", action="store_true", help="Crear alumnos de prueba.")
        parser.add_argument("--alumnos", type=int, default=15, help="Cuántos alumnos demo.")

    def handle(self, *args, **options):
        self.stdout.write("Cargando catálogos...")

        for nombre, desc in DISCIPLINAS:
            Disciplina.objects.get_or_create(nombre=nombre, defaults={"descripcion": desc})

        for nombre, dias, precio, descripcion in MEMBRESIAS:
            Membresia.objects.get_or_create(
                nombre=nombre,
                defaults={"duracion_dias": dias, "precio": precio, "descripcion": descripcion},
            )

        for inicio, fin, turno, dias, nombre in HORARIOS:
            Horario.objects.get_or_create(
                hora_inicio=inicio,
                hora_fin=fin,
                turno=turno,
                defaults={"dias": dias, "nombre": nombre},
            )

        for nombre, desc, criterio, bonus in INSIGNIAS:
            Insignia.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": desc, "criterio": criterio, "puntos_bonus": bonus},
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Catálogos listos: {Disciplina.objects.count()} disciplinas, "
                f"{Membresia.objects.count()} membresías, "
                f"{Horario.objects.count()} horarios, "
                f"{Insignia.objects.count()} insignias."
            )
        )

        if not options["demo"]:
            self.stdout.write("Usa --demo para generar alumnos de prueba.")
            return

        self._crear_demo(options["alumnos"])

    def _crear_demo(self, cantidad):
        self.stdout.write(f"Generando {cantidad} alumnos de prueba...")

        disciplinas = list(Disciplina.objects.all())
        horarios = list(Horario.objects.all())
        membresias = list(Membresia.objects.all())
        hoy = timezone.localdate()

        # Al crearse nace con su cuenta (maestro-<id> / settings.PASSWORD_INICIAL).
        maestro, _ = Maestro.objects.get_or_create(
            nombre="Prof. Ricardo Salgado", defaults={"edad": 38, "telefono": "5512345678"}
        )
        for d in disciplinas[:3]:
            MaestroDisciplina.objects.get_or_create(maestro=maestro, disciplina=d)
        # Su alcance (qué alumnos ve) son los dos primeros grupos/horarios.
        maestro.horarios.add(*horarios[:2])

        for i in range(cantidad):
            membresia = random.choice(membresias)
            alumno = Alumno.objects.create(
                nombres=random.choice(NOMBRES),
                apellidos=f"{random.choice(APELLIDOS)} {random.choice(APELLIDOS)}",
                apodo=random.choice(APODOS) if random.random() > 0.4 else "",
                edad=random.randint(15, 42),
                peso_actual=round(random.uniform(55, 95), 1),
                telefono=f"55{random.randint(10000000, 99999999)}",
                horario=random.choice(horarios),
                membresia=membresia,
                fecha_registro=hoy - timedelta(days=random.randint(10, 400)),
            )

            for d in random.sample(disciplinas, random.randint(1, 3)):
                AlumnoDisciplina.objects.get_or_create(alumno=alumno, disciplina=d)

            fecha_pago = hoy - timedelta(days=random.randint(0, 45))
            Pago.objects.create(
                alumno=alumno,
                membresia=membresia,
                monto=membresia.precio,
                metodo=random.choice(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]),
                fecha_pago=fecha_pago,
            )

            for dia in random.sample(range(0, 30), random.randint(3, 20)):
                Asistencia.objects.get_or_create(
                    alumno=alumno,
                    fecha=hoy - timedelta(days=dia),
                    disciplina=random.choice(disciplinas),
                    horario=alumno.horario,
                    defaults={"metodo_registro": random.choice(["QR", "MANUAL"])},
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Listo: {Alumno.objects.count()} alumnos, "
                f"{Asistencia.objects.count()} asistencias, "
                f"{Pago.objects.count()} pagos."
            )
        )
