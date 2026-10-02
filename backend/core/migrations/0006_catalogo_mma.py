"""
Catálogo inicial de la Evaluación MMA: 7 categorías (suman 100 puntos) y sus
habilidades. Va como migración de datos — no como seed manual — para que
exista en cualquier entorno (dev, tests, producción) con solo `migrate`.

Es idempotente (get_or_create por clave/nombre): se puede volver a correr y
respeta lo que un administrador haya agregado o desactivado después desde el
panel de Django (CategoriaMMA / HabilidadMMA). Para ampliar el catálogo NO se
edita este archivo: se agregan filas desde el admin.
"""
from django.db import migrations

CATALOGO = [
    # (clave, nombre, puntos_maximos, [habilidades])
    ("striking", "Striking", 20, [
        "Guardia y postura",
        "Desplazamiento",
        "Jab / golpes rectos",
        "Hooks / uppercuts",
        "Patadas",
        "Combinaciones",
        "Defensa de golpes",
        "Timing y distancia",
    ]),
    ("wrestling", "Wrestling", 20, [
        "Takedowns",
        "Defensa de takedown",
        "Sprawl",
        "Control contra jaula",
        "Scrambles",
        "Control posicional",
        "Transiciones",
    ]),
    ("grappling", "Grappling", 20, [
        "Posiciones básicas",
        "Guard",
        "Escapes",
        "Control superior",
        "Sumisiones",
        "Defensa de sumisiones",
        "Transiciones",
    ]),
    ("integracion", "Integración MMA", 15, [
        "Striking → Takedown",
        "Takedown → Ground and Pound",
        "Ground → Stand-up",
        "Transiciones entre disciplinas",
        "Uso de jaula",
        "Adaptación durante sparring",
    ]),
    ("acondicionamiento", "Acondicionamiento", 10, [
        "Resistencia cardiovascular",
        "Resistencia muscular",
        "Potencia",
        "Velocidad",
        "Movilidad",
        "Recuperación entre rounds",
    ]),
    ("defensa", "Defensa", 10, [
        "Protección ante golpes",
        "Defensa de derribos",
        "Defensa en suelo",
        "Defensa ante jaula",
        "Reconocimiento de posiciones peligrosas",
        "Control durante sparring",
    ]),
    ("disciplina", "Disciplina", 5, [
        "Asistencia",
        "Disciplina",
        "Respeto al compañero",
        "Cumplimiento de instrucciones",
        "Seguridad durante entrenamiento",
    ]),
]


def cargar_catalogo(apps, schema_editor):
    CategoriaMMA = apps.get_model("core", "CategoriaMMA")
    HabilidadMMA = apps.get_model("core", "HabilidadMMA")

    for orden, (clave, nombre, maximo, habilidades) in enumerate(CATALOGO, start=1):
        categoria, _ = CategoriaMMA.objects.get_or_create(
            clave=clave,
            defaults={"nombre": nombre, "puntos_maximos": maximo, "orden": orden},
        )
        for pos, nombre_habilidad in enumerate(habilidades, start=1):
            HabilidadMMA.objects.get_or_create(
                categoria=categoria, nombre=nombre_habilidad, defaults={"orden": pos}
            )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_evaluacion_mma"),
    ]

    # Sin reversa: borrar el catálogo se llevaría (o bloquearía, por PROTECT)
    # las evaluaciones ya capturadas. Deshacer 0005 ya elimina las tablas.
    operations = [migrations.RunPython(cargar_catalogo, migrations.RunPython.noop)]
