"""
Permisos por rol.

El sistema tiene tres roles, tal como los define la especificación de frontend:

- Administrativo (staff/admin): usuario con `is_staff=True`. Acceso total.
- Maestro: usuario con un registro `Maestro` ligado. Solo trabaja con los
  alumnos a su cargo — los de los grupos (Horario) que el administrativo le
  asignó más los asignados individualmente, ver `Maestro.alumnos_a_cargo()`.
  Con ellos puede: verlos, escribir la ficha técnica (`Experiencia`) y la
  Evaluación MMA, inscribirlos a `Evento` (y crear eventos) y mandarles
  avisos (individual o a sus grupos). Nunca edita datos personales/pagos.
- Alumno: usuario con un registro `Alumno` ligado. Solo lectura, y solo de
  sus propios datos (salvo inscribirse/cancelar su propia inscripción a un
  Evento y editar sus datos personales en /alumnos/yo/).

Un usuario sin ninguna de las tres cosas no ve nada.

El alcance del maestro se aplica en el QUERYSET de cada vista (el backend
devuelve solo lo autorizado), no solo en los permisos: ocultar algo en
Angular nunca cuenta como seguridad.
"""
from rest_framework import permissions

METODOS_LECTURA = permissions.SAFE_METHODS


def es_administrativo(user) -> bool:
    return bool(user and user.is_authenticated and user.is_staff)


def alumno_de(user):
    """Devuelve el Alumno ligado al usuario, o None."""
    if not (user and user.is_authenticated):
        return None
    return getattr(user, "alumno", None)


def maestro_de(user):
    """Devuelve el Maestro ligado al usuario, o None."""
    if not (user and user.is_authenticated):
        return None
    return getattr(user, "maestro", None)


def es_personal(user) -> bool:
    """Administrativo o maestro: los dos roles que 'dan servicio', no lo reciben."""
    return es_administrativo(user) or maestro_de(user) is not None


class EsAdministrativo(permissions.BasePermission):
    """Solo personal administrativo. Se usa en catálogos y reportes."""

    message = "Esta sección es solo para personal administrativo."

    def has_permission(self, request, view):
        return es_administrativo(request.user)


class EsPersonal(permissions.BasePermission):
    """Solo personal (administrativo o maestro). Avisos y listas de alumnos por grupo."""

    message = "Esta sección es solo para el personal de la academia."

    def has_permission(self, request, view):
        return es_personal(request.user)


class EsAdministrativoOSoloLectura(permissions.BasePermission):
    """
    Escritura reservada al administrativo; lectura para cualquier autenticado.
    Útil en catálogos que el alumno necesita consultar (disciplinas, horarios,
    membresías, insignias).
    """

    def has_permission(self, request, view):
        if request.method in METODOS_LECTURA:
            return bool(request.user and request.user.is_authenticated)
        return es_administrativo(request.user)


class EsAdministrativoOPersonalSoloLectura(permissions.BasePermission):
    """
    Como EsAdministrativoOSoloLectura, pero la lectura es solo para personal:
    el catálogo de maestros (nombre, teléfono, correo, grupos) no es
    información que un alumno deba consultar.
    """

    def has_permission(self, request, view):
        if request.method in METODOS_LECTURA:
            return es_personal(request.user)
        return es_administrativo(request.user)


class EsDuenoOAdministrativo(permissions.BasePermission):
    """
    El alumno solo puede leer lo suyo y nunca escribir.
    El administrativo puede todo.

    La tabla de permisos del documento se traduce así: el alumno tiene
    "solo lectura" en experiencia, asistencia, pagos, torneos y grados, y
    únicamente puede editar sus datos personales (que se resuelve aparte,
    en el endpoint /api/alumnos/yo/).
    """

    def has_permission(self, request, view):
        if es_administrativo(request.user):
            return True
        if request.method not in METODOS_LECTURA:
            return False
        return alumno_de(request.user) is not None

    def has_object_permission(self, request, view, obj):
        if es_administrativo(request.user):
            return True
        alumno = alumno_de(request.user)
        if alumno is None:
            return False
        # El objeto es el propio Alumno, o algo que apunta a él.
        propietario_id = getattr(obj, "alumno_id", None) or getattr(obj, "id", None)
        if hasattr(obj, "alumno_id"):
            propietario_id = obj.alumno_id
        elif obj.__class__.__name__ == "Alumno":
            propietario_id = obj.id
        else:
            return False
        return propietario_id == alumno.id


class PermisoAlumno(permissions.BasePermission):
    """
    Permiso de AlumnoViewSet (y NotificacionViewSet). El administrativo puede
    todo. El maestro solo lee (nunca edita datos personales/pagos/membresía
    de un alumno, solo su ficha técnica vía ExperienciaViewSet) — el propio
    get_queryset de cada vista ya lo acota a lo de los alumnos a su cargo,
    así que aquí basta con permitir lectura. El alumno solo lee lo suyo (su
    edición pasa por /alumnos/yo/).
    """

    def has_permission(self, request, view):
        if es_administrativo(request.user):
            return True
        if request.method not in METODOS_LECTURA:
            return False
        return maestro_de(request.user) is not None or alumno_de(request.user) is not None

    def has_object_permission(self, request, view, obj):
        if es_administrativo(request.user):
            return True
        if request.method not in METODOS_LECTURA:
            return False
        if maestro_de(request.user) is not None:
            return True  # el queryset ya lo acotó a los alumnos a su cargo
        alumno = alumno_de(request.user)
        if alumno is None:
            return False
        # El objeto es el propio Alumno, o algo que apunta a él (Notificacion).
        propietario_id = obj.alumno_id if hasattr(obj, "alumno_id") else obj.id
        return propietario_id == alumno.id


class EsDuenoOPersonal(permissions.BasePermission):
    """
    Como EsDuenoOAdministrativo, pero tratando al maestro igual que al
    administrativo: puede escribir (evaluar), no solo leer. Se usa en
    ExperienciaViewSet y EvaluacionMMAViewSet — el maestro registra la ficha
    técnica y la evaluación por habilidad de sus alumnos; el alumno solo lee
    lo suyo.
    """

    def has_permission(self, request, view):
        if es_personal(request.user):
            return True
        if request.method not in METODOS_LECTURA:
            return False
        return alumno_de(request.user) is not None

    def has_object_permission(self, request, view, obj):
        if es_personal(request.user):
            return True
        alumno = alumno_de(request.user)
        if alumno is None:
            return False
        propietario_id = getattr(obj, "alumno_id", None)
        return propietario_id == alumno.id


class EsPersonalOSoloLectura(permissions.BasePermission):
    """
    Como EsAdministrativoOSoloLectura, pero la escritura también la puede
    hacer un maestro (no solo el administrativo). Se usa en EventoViewSet:
    cualquier autenticado ve la cartelera, admin/maestro dan de alta eventos.
    Un maestro solo edita/borra los eventos que él mismo creó ("sus
    eventos"); el administrativo, cualquiera.
    """

    def has_permission(self, request, view):
        if request.method in METODOS_LECTURA:
            return bool(request.user and request.user.is_authenticated)
        return es_personal(request.user)

    def has_object_permission(self, request, view, obj):
        if request.method in METODOS_LECTURA or es_administrativo(request.user):
            return True
        return getattr(obj, "creado_por_id", None) == request.user.id


class PermisoInscripcionEvento(permissions.BasePermission):
    """
    Un alumno puede inscribirse (POST) y cancelar (DELETE) su propia
    inscripción, y solo ve las suyas (el queryset, vía BaseViewSet con
    campo_propietario="alumno_id", ya lo filtra). Marcar asistencia (PATCH
    'asistio') es exclusivo de admin/maestro. El administrativo ve y edita
    todo; el maestro, solo inscripciones de alumnos a su cargo (lo acota el
    queryset de EventoInscripcionViewSet).
    """

    def has_permission(self, request, view):
        if es_personal(request.user):
            return True
        alumno = alumno_de(request.user)
        if alumno is None:
            return False
        if request.method in (*METODOS_LECTURA, "POST", "DELETE"):
            return True
        return False  # PATCH/PUT (marcar asistio) no es para el alumno

    def has_object_permission(self, request, view, obj):
        if es_personal(request.user):
            return True
        if request.method not in (*METODOS_LECTURA, "DELETE"):
            return False
        alumno = alumno_de(request.user)
        return alumno is not None and obj.alumno_id == alumno.id
