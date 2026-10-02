import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from core.models import Alumno, Maestro, Horario, Membresia, Disciplina

PW = "RageCoreQA-2026"
U = get_user_model()

admin, nuevo = U.objects.get_or_create(
    username="qa-admin",
    defaults={"email": "qa-admin@ragecore.test", "first_name": "QA", "last_name": "Admin"},
)
admin.is_staff = True
admin.is_superuser = True
admin.is_active = True
admin.set_password(PW)
admin.save()
print(f"ADMIN    qa-admin   nuevo={nuevo}")

horario = Horario.objects.first()
membresia = Membresia.objects.first()
disciplina = Disciplina.objects.first()

maestro, nuevo_m = Maestro.objects.get_or_create(nombre="QA Maestro")
if horario:
    maestro.horarios.add(horario)
maestro.refresh_from_db()
if maestro.usuario:
    maestro.usuario.set_password(PW)
    maestro.usuario.is_active = True
    maestro.usuario.email = "qa-maestro@ragecore.test"
    maestro.usuario.save()
    print(f"MAESTRO  {maestro.usuario.username}  nuevo={nuevo_m} horario={horario}")

alumno, nuevo_a = Alumno.objects.get_or_create(
    nombres="QA", apellidos="Alumno",
    defaults={"apodo": "El Tester", "telefono": "8110000000",
              "horario": horario, "membresia": membresia, "edad": 25},
)
if disciplina:
    from core.models import AlumnoDisciplina
    AlumnoDisciplina.objects.get_or_create(alumno=alumno, disciplina=disciplina)
alumno.refresh_from_db()
if alumno.usuario:
    alumno.usuario.set_password(PW)
    alumno.usuario.is_active = True
    alumno.usuario.email = "qa-alumno@ragecore.test"
    alumno.usuario.save()
    print(f"ALUMNO   {alumno.usuario.username}  nuevo={nuevo_a} id={alumno.id}")
print("PASSWORD:", PW)
