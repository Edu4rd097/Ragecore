"""ViewSets y endpoints de la API."""
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.db.models import Count, F, Prefetch, Q, Sum
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.crypto import get_random_string
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import comprobante as comprobante_pago
from . import email_service, ficha_html, ficha_pdf
from .avisos import crear_notificaciones_de_aviso
from .evaluacion_mma import (
    AVISO_PREPARACION,
    calcular_evaluacion,
    cargar_categorias,
    evaluaciones_finalizadas,
    historial_evaluacion,
)
from .gamificacion import evaluar_insignias, notificar_insignia_otorgada, sincronizar_record
from .permissions import (
    EsAdministrativo,
    EsAdministrativoOPersonalSoloLectura,
    EsAdministrativoOSoloLectura,
    EsDuenoOAdministrativo,
    EsDuenoOPersonal,
    EsPersonal,
    EsPersonalOSoloLectura,
    PermisoAlumno,
    PermisoInscripcionEvento,
    alumno_de,
    es_administrativo,
    es_personal,
    maestro_de,
)
from .models import (
    Alumno,
    AlumnoInsignia,
    Asistencia,
    Aviso,
    CategoriaMMA,
    CategoriaPeso,
    Disciplina,
    EvaluacionMMA,
    Evento,
    EventoInscripcion,
    Experiencia,
    Grado,
    HabilidadMMA,
    Horario,
    Insignia,
    Maestro,
    Membresia,
    Notificacion,
    Pago,
    Venta,
    Torneo,
)
from .serializers import (
    AlumnoDetailSerializer,
    AlumnoInsigniaSerializer,
    AlumnoListSerializer,
    AsistenciaManualSerializer,
    AsistenciaSerializer,
    AvisoSerializer,
    CategoriaMMASerializer,
    CategoriaPesoSerializer,
    CheckinQRSerializer,
    DisciplinaSerializer,
    EvaluacionMMASerializer,
    EventoInscripcionSerializer,
    EventoSerializer,
    ExperienciaSerializer,
    GradoSerializer,
    HorarioSerializer,
    InsigniaSerializer,
    MaestroSerializer,
    MembresiaSerializer,
    NotificacionSerializer,
    PagoSerializer,
    VentaSerializer,
    TorneoSerializer,
    UsuarioAdministrativoSerializer,
)

DIAS_AVISO_VENCIMIENTO = 5


def _maestro_acotado(user):
    """El Maestro del usuario si —y solo si— hay que acotarle el alcance (no es admin)."""
    if es_administrativo(user):
        return None
    return maestro_de(user)


class BaseViewSet(viewsets.ModelViewSet):
    """Por defecto: el alumno lee lo suyo, el administrativo hace todo."""

    permission_classes = [EsDuenoOAdministrativo]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]

    # Recursos que cuelgan de un alumno se filtran solos para el rol Alumno.
    campo_propietario = "alumno_id"

    def get_queryset(self):
        qs = super().get_queryset()
        # Un catálogo (sin campo_propietario) no "pertenece" a nadie: lo lee
        # cualquier autenticado — incluido el maestro, que no es alumno — y el
        # permiso (EsAdministrativoOSoloLectura) ya frena la escritura.
        if es_administrativo(self.request.user) or not self.campo_propietario:
            return qs
        alumno = alumno_de(self.request.user)
        if alumno is None:
            return qs.none()
        return qs.filter(**{self.campo_propietario: alumno.id})


class CatalogoViewSet(BaseViewSet):
    """Catálogos: cualquiera autenticado consulta, solo el admin escribe."""

    permission_classes = [EsAdministrativoOSoloLectura]
    campo_propietario = None


class RestablecerPasswordMixin:
    """
    Da a un ViewSet (Alumno, Maestro o Usuario administrativo) el endpoint
    POST /<recurso>/{id}/restablecer-password/ {"password": "..."} (opcional).

    Solo el administrativo puede forzar la contraseña de otra cuenta. Si no
    se manda 'password' se genera una automática y se regresa en la
    respuesta para que el admin se la dé al dueño de la cuenta.
    """

    @staticmethod
    def _cuenta_de(obj):
        """Cuenta del objeto: Alumno/Maestro la tienen en `.usuario`; un User ES la cuenta."""
        return obj if isinstance(obj, get_user_model()) else obj.usuario

    @action(
        detail=True, methods=["post"], url_path="restablecer-password",
        permission_classes=[EsAdministrativo],
    )
    def restablecer_password(self, request, pk=None):
        obj = self.get_object()
        usuario = self._cuenta_de(obj)
        if usuario is None:
            return Response(
                {"detail": "Este registro no tiene cuenta de acceso. Guarda su correo para crearle una."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if usuario == request.user:
            return Response(
                {"detail": "Para cambiar tu propia contraseña usa Mi perfil → Seguridad."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        nueva = (request.data.get("password") or "").strip()
        generada = not nueva
        if generada:
            nueva = get_random_string(10)
        elif len(nueva) < 8:
            return Response(
                {"detail": "La contraseña debe tener al menos 8 caracteres."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        usuario.set_password(nueva)
        usuario.save()

        from rest_framework.authtoken.models import Token  # import local, mismo patrón que auth_views

        Token.objects.filter(user=usuario).delete()  # cierra cualquier sesión previa

        return Response(
            {
                "detail": "Se generó una contraseña nueva." if generada else "Contraseña actualizada.",
                "password_generada": nueva if generada else None,
            }
        )


class AltaConCuentaMixin:
    """
    Al dar de alta (POST) un Alumno, Maestro o Usuario administrativo, la
    señal/serializer ya le creó su cuenta con settings.PASSWORD_INICIAL. Aquí
    se agrega esa contraseña a la respuesta del alta —solo ahí— para que el
    administrador se la comunique junto con el `username`. Nunca se vuelve a
    mostrar: en la BD solo vive el hash.
    """

    def create(self, request, *args, **kwargs):
        respuesta = super().create(request, *args, **kwargs)
        if respuesta.status_code == status.HTTP_201_CREATED:
            respuesta.data["password_inicial"] = settings.PASSWORD_INICIAL
        return respuesta


# ---------------------------------------------------------------------------
# Catálogos
# ---------------------------------------------------------------------------

class HorarioViewSet(CatalogoViewSet):
    queryset = Horario.objects.all()
    serializer_class = HorarioSerializer
    filterset_fields = ["turno"]
    ordering_fields = ["hora_inicio", "turno"]

    @action(detail=True, methods=["get"], permission_classes=[EsPersonal])
    def alumnos(self, request, pk=None):
        """Alumnos activos del grupo. Solo personal; el maestro, solo los que tiene a cargo."""
        qs = self.get_object().alumnos.filter(activo=True)
        maestro = _maestro_acotado(request.user)
        if maestro is not None:
            qs = qs.filter(pk__in=maestro.alumnos_a_cargo().values("pk"))
        return Response(AlumnoListSerializer(qs, many=True, context={"request": request}).data)


class DisciplinaViewSet(CatalogoViewSet):
    queryset = Disciplina.objects.all()
    serializer_class = DisciplinaSerializer
    search_fields = ["nombre"]


class CategoriaPesoViewSet(CatalogoViewSet):
    """Divisiones de peso de MMA: cualquiera las consulta, el administrativo las ajusta."""

    queryset = CategoriaPeso.objects.all()
    serializer_class = CategoriaPesoSerializer
    pagination_class = None


class MembresiaViewSet(CatalogoViewSet):
    queryset = Membresia.objects.all()
    serializer_class = MembresiaSerializer
    ordering_fields = ["precio", "duracion_dias"]


class MaestroViewSet(AltaConCuentaMixin, RestablecerPasswordMixin, CatalogoViewSet):
    """
    Catálogo de maestros. Lo lee solo el personal (un alumno no consulta
    datos de maestros) y lo escribe solo el administrativo, que aquí mismo
    decide el alcance del maestro (horarios_ids / alumnos_ids).
    """

    queryset = Maestro.objects.prefetch_related(
        "asignaciones__disciplina", "horarios", "alumnos_asignados"
    )
    serializer_class = MaestroSerializer
    permission_classes = [EsAdministrativoOPersonalSoloLectura]
    filterset_fields = ["activo", "disciplinas", "horarios"]
    search_fields = ["nombre"]


class UsuarioAdministrativoViewSet(
    AltaConCuentaMixin, RestablecerPasswordMixin, viewsets.ModelViewSet
):
    """
    Cuentas del personal administrativo (staff/admin): el User de Django con
    is_staff=True — no hay modelo aparte, es el mismo rol que ya reconoce
    toda la API. Solo un administrativo entra aquí. Al crear una, nace con
    settings.PASSWORD_INICIAL (con hash) y el alta regresa las credenciales
    una sola vez. No hay DELETE: una cuenta se desactiva (is_active), no se
    borra, para conservar la auditoría de avisos/eventos que creó.
    """

    queryset = get_user_model().objects.filter(is_staff=True).order_by("username")
    serializer_class = UsuarioAdministrativoSerializer
    permission_classes = [EsAdministrativo]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["is_active"]
    search_fields = ["username", "first_name", "last_name", "email"]
    ordering_fields = ["username", "date_joined", "last_login"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_update(self, serializer):
        if (
            serializer.instance == self.request.user
            and serializer.validated_data.get("is_active") is False
        ):
            raise ValidationError({"is_active": ["No puedes desactivar tu propia cuenta."]})
        serializer.save()


# ---------------------------------------------------------------------------
# Alumno
# ---------------------------------------------------------------------------

class AlumnoViewSet(AltaConCuentaMixin, RestablecerPasswordMixin, BaseViewSet):
    permission_classes = [PermisoAlumno]
    campo_propietario = "id"
    queryset = (
        Alumno.objects.select_related("horario", "membresia", "experiencia", "usuario")
        .prefetch_related("inscripciones__disciplina", "insignias_ganadas__insignia", "pagos")
    )
    filterset_fields = ["activo", "horario", "membresia", "disciplinas"]
    search_fields = ["nombres", "apellidos", "apodo", "telefono", "codigo_qr"]
    ordering_fields = ["puntos", "apellidos", "fecha_registro"]

    def get_serializer_class(self):
        return AlumnoListSerializer if self.action == "list" else AlumnoDetailSerializer

    def get_queryset(self):
        # BaseViewSet.get_queryset no conoce el rol Maestro (solo administrativo
        # y alumno-dueño) — se resuelve aquí: el maestro recibe del backend
        # ÚNICAMENTE los alumnos activos a su cargo (sus grupos + individuales),
        # sin importar qué filtros mande el cliente.
        maestro = _maestro_acotado(self.request.user)
        if maestro is not None:
            qs = super(BaseViewSet, self).get_queryset()
            return qs.filter(activo=True, pk__in=maestro.alumnos_a_cargo().values("pk"))
        return super().get_queryset()

    # --- Perfil y estadísticas ---------------------------------------------

    @action(detail=True, methods=["get"])
    def perfil(self, request, pk=None):
        """Tarjeta de peleador completa, lista para la pantalla de detalle."""
        alumno = self.get_object()
        exp = getattr(alumno, "experiencia", None)
        return Response(
            {
                "alumno": AlumnoDetailSerializer(alumno, context={"request": request}).data,
                "estadisticas": {
                    "record": alumno.record,
                    "total_asistencias": alumno.asistencias.count(),
                    "asistencias_mes": alumno.asistencias.filter(
                        fecha__gte=timezone.localdate().replace(day=1)
                    ).count(),
                    "racha_actual": exp.racha_asistencia if exp else 0,
                    "racha_maxima": exp.racha_maxima if exp else 0,
                    "total_insignias": alumno.insignias_ganadas.count(),
                    "total_grados": alumno.grados.count(),
                },
                "pago": {
                    "al_corriente": alumno.al_corriente,
                    "fecha_vencimiento": alumno.fecha_vencimiento,
                    "dias_para_vencer": alumno.dias_para_vencer,
                },
            }
        )

    @action(detail=True, methods=["get"], url_path="ficha")
    def ver_ficha(self, request, pk=None):
        """
        GET /api/alumnos/{id}/ficha/ -> ficha técnica en HTML (plantilla
        fichas/ficha.html), autocontenida para mostrarse en un iframe.
        Mismo alcance que ficha-pdf: admin cualquiera, maestro sus alumnos,
        alumno solo la suya.
        """
        alumno = self.get_object()
        respuesta = HttpResponse(ficha_html.generar_ficha_html(alumno), content_type="text/html; charset=utf-8")
        respuesta["Cache-Control"] = "no-store"
        return respuesta

    @action(detail=True, methods=["get"], url_path="ficha-pdf")
    def descargar_ficha(self, request, pk=None):
        """
        GET /api/alumnos/{id}/ficha-pdf/ -> ficha técnica del peleador en PDF.

        Mismo alcance que perfil (get_object): admin cualquiera, maestro sus
        alumnos a cargo, alumno solo la suya. No incluye pagos, que no son
        información permitida del maestro.
        """
        alumno = self.get_object()
        respuesta = HttpResponse(ficha_pdf.generar_ficha_pdf(alumno), content_type="application/pdf")
        respuesta["Content-Disposition"] = f'attachment; filename="{ficha_pdf.nombre_archivo(alumno)}"'
        return respuesta

    @action(detail=True, methods=["get"])
    def asistencias(self, request, pk=None):
        qs = self.get_object().asistencias.select_related("disciplina", "horario")[:100]
        return Response(AsistenciaSerializer(qs, many=True).data)

    # Los pagos no son "información permitida" del maestro: dueño o admin.
    @action(detail=True, methods=["get"], permission_classes=[EsDuenoOAdministrativo])
    def pagos(self, request, pk=None):
        return Response(PagoSerializer(self.get_object().pagos.all(), many=True).data)

    @action(detail=True, methods=["get"])
    def insignias(self, request, pk=None):
        qs = self.get_object().insignias_ganadas.select_related("insignia")
        return Response(AlumnoInsigniaSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="qr")
    def qr(self, request, pk=None):
        alumno = self.get_object()
        return Response(
            {
                "codigo_qr": alumno.codigo_qr,
                # Relativa (/media/...), igual que en los serializers: ver ImagenRelativa.
                "qr_imagen": alumno.qr_imagen.url if alumno.qr_imagen else None,
            }
        )

    @action(detail=True, methods=["post"], url_path="evaluar-insignias")
    def evaluar_insignias_alumno(self, request, pk=None):
        nuevas = evaluar_insignias(self.get_object())
        return Response({"insignias_nuevas": [i.nombre for i in nuevas]})

    # --- Evaluación MMA ------------------------------------------------------
    # Las dos consultas agregadas del módulo de evaluación viven aquí, junto a
    # perfil/asistencias/pagos, porque son "del alumno" (el CRUD de cada
    # evaluación es /api/evaluaciones-mma/?alumno=). get_object() aplica el
    # mismo alcance por rol que el resto de acciones (admin todo, maestro sus
    # alumnos a cargo, alumno solo él mismo).

    @action(detail=True, methods=["get"], url_path="evaluacion-resumen")
    def evaluacion_resumen(self, request, pk=None):
        """Última evaluación finalizada (con su desglose) y variación contra la anterior."""
        alumno = self.get_object()
        evaluaciones = list(evaluaciones_finalizadas(alumno))
        categorias = cargar_categorias()
        ultima = evaluaciones[-1] if evaluaciones else None
        anterior = evaluaciones[-2] if len(evaluaciones) > 1 else None

        datos_ultima = (
            EvaluacionMMASerializer(
                ultima, context={"request": request, "categorias_mma": categorias}
            ).data
            if ultima
            else None
        )
        variacion = None
        if anterior is not None:
            variacion = round(
                datos_ultima["puntaje_total"]
                - calcular_evaluacion(anterior, categorias)["puntaje_total"],
                1,
            )
        return Response(
            {
                "alumno": alumno.id,
                "total_evaluaciones": len(evaluaciones),
                "ultima": datos_ultima,
                "variacion": variacion,
                "aviso_preparacion": AVISO_PREPARACION,
            }
        )

    @action(detail=True, methods=["get"], url_path="evaluacion-historial")
    def evaluacion_historial(self, request, pk=None):
        """Serie cronológica (ascendente) de totales por evaluación, para graficar."""
        return Response(historial_evaluacion(self.get_object()))

    # --- Vista del propio alumno -------------------------------------------

    # Lo único que el alumno puede editar de sí mismo, según la tabla de
    # permisos del documento. Disciplina, horario y membresía los controla
    # el administrativo. 'email' vive en su cuenta (User) y lo guarda el
    # serializer vía _vincular_cuenta.
    CAMPOS_EDITABLES_POR_ALUMNO = [
        "nombres", "apellidos", "apodo", "telefono", "email", "peso_actual", "estatura", "foto",
    ]

    @action(
        detail=False,
        methods=["get", "patch"],
        url_path="yo",
        permission_classes=[IsAuthenticated],
    )
    def yo(self, request):
        """GET devuelve el perfil propio; PATCH edita solo los datos personales."""
        alumno = alumno_de(request.user)
        if alumno is None:
            return Response(
                {"detail": "Esta cuenta no está ligada a un alumno."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == "PATCH":
            datos = {
                k: v
                for k, v in request.data.items()
                if k in self.CAMPOS_EDITABLES_POR_ALUMNO
            }
            rechazados = set(request.data.keys()) - set(datos.keys())
            serializer = AlumnoDetailSerializer(
                alumno, data=datos, partial=True, context={"request": request}
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()
            respuesta = serializer.data
            if rechazados:
                respuesta["_ignorados"] = sorted(rechazados)
            return Response(respuesta)

        return Response(
            AlumnoDetailSerializer(alumno, context={"request": request}).data
        )

    # --- Consultas de conjunto ---------------------------------------------

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def ranking(self, request):
        """
        Tabla de posiciones por puntos, con el mismo alcance que el listado:
        admin todos, maestro sus alumnos, alumno solo él (no ve a otros).
        """
        limite = int(request.query_params.get("limite", 20))
        qs = self.get_queryset().filter(activo=True).order_by("-puntos")[:limite]
        data = [
            {
                "posicion": i,
                "id": a.id,
                "nombre": a.nombre_completo,
                "apodo": a.apodo,
                "puntos": a.puntos,
                "foto": a.foto.url if a.foto else None,
            }
            for i, a in enumerate(qs, start=1)
        ]
        return Response(data)

    @action(detail=False, methods=["get"], url_path="por-vencer",
            permission_classes=[EsAdministrativo])
    def por_vencer(self, request):
        """Alumnos cuyo pago vence dentro de los próximos N días."""
        dias = int(request.query_params.get("dias", DIAS_AVISO_VENCIMIENTO))
        hoy = timezone.localdate()
        ids = (
            Pago.objects.filter(fecha_vencimiento__range=(hoy, hoy + timedelta(days=dias)))
            .values_list("alumno_id", flat=True)
            .distinct()
        )
        qs = Alumno.objects.filter(id__in=ids, activo=True)
        resultado = [a for a in qs if a.al_corriente and a.dias_para_vencer <= dias]
        return Response(
            AlumnoListSerializer(resultado, many=True, context={"request": request}).data
        )

    @action(detail=False, methods=["get"], permission_classes=[EsAdministrativo])
    def morosos(self, request):
        """Alumnos activos con el pago vencido o sin ningún pago registrado."""
        qs = Alumno.objects.filter(activo=True)
        resultado = [a for a in qs if not a.al_corriente]
        return Response(
            AlumnoListSerializer(resultado, many=True, context={"request": request}).data
        )


class ExperienciaViewSet(BaseViewSet):
    permission_classes = [EsDuenoOPersonal]
    # order_by explícito: Experiencia no tiene Meta.ordering y la paginación
    # de DRF avisa (UnorderedObjectListWarning) al listar sin orden.
    queryset = Experiencia.objects.select_related("alumno").order_by("alumno_id")
    serializer_class = ExperienciaSerializer
    filterset_fields = ["alumno", "bjj_cinturon", "lesion_activa"]
    ordering_fields = ["racha_asistencia", "peleas_ganadas"]

    def get_queryset(self):
        # Igual que en AlumnoViewSet: el maestro solo evalúa alumnos a su cargo.
        maestro = _maestro_acotado(self.request.user)
        if maestro is not None:
            qs = super(BaseViewSet, self).get_queryset()
            return qs.filter(alumno__in=maestro.alumnos_a_cargo())
        return super().get_queryset()

    @action(detail=True, methods=["post"], url_path="sincronizar-record")
    def sincronizar(self, request, pk=None):
        exp = sincronizar_record(self.get_object().alumno)
        return Response(ExperienciaSerializer(exp).data)


# ---------------------------------------------------------------------------
# Evaluación MMA (habilidades por categoría, con historial)
# ---------------------------------------------------------------------------

class CategoriaMMAViewSet(CatalogoViewSet):
    """Catálogo de categorías con sus habilidades activas — lo que pinta el formulario."""

    queryset = CategoriaMMA.objects.filter(activa=True).prefetch_related(
        Prefetch("habilidades", queryset=HabilidadMMA.objects.filter(activa=True))
    )
    serializer_class = CategoriaMMASerializer
    search_fields = ["nombre"]


class EvaluacionMMAViewSet(BaseViewSet):
    """
    CRUD de evaluaciones. Mismo reparto que ExperienciaViewSet: admin y
    maestro evalúan (el maestro solo a alumnos a su cargo), el alumno solo
    lee las suyas. Cada evaluación es una fila nueva: nunca se pisa una
    anterior, por eso hay historial.
    """

    permission_classes = [EsDuenoOPersonal]
    queryset = EvaluacionMMA.objects.select_related(
        "alumno", "evaluador", "creado_por"
    ).prefetch_related("puntajes__habilidad")
    serializer_class = EvaluacionMMASerializer
    filterset_fields = ["alumno", "estado", "evaluador"]
    ordering_fields = ["fecha", "creado_en"]

    def get_queryset(self):
        user = self.request.user
        if es_administrativo(user):
            return super(BaseViewSet, self).get_queryset()
        maestro = maestro_de(user)
        if maestro is not None:
            return super(BaseViewSet, self).get_queryset().filter(
                alumno__in=maestro.alumnos_a_cargo()
            )
        # Alumno: solo las suyas (BaseViewSet) y solo finalizadas — un borrador
        # todavía no es una evaluación que deba ver.
        return super().get_queryset().filter(estado=EvaluacionMMA.Estado.FINALIZADA)

    def perform_create(self, serializer):
        user = self.request.user
        maestro = maestro_de(user)
        alumno = serializer.validated_data["alumno"]
        if not es_administrativo(user) and maestro is not None:
            # Mismo alcance que get_queryset, aplicado al alumno que se
            # intenta evaluar (el queryset no interviene en un POST).
            if not maestro.tiene_a_cargo(alumno):
                raise PermissionDenied("Solo puedes evaluar a los alumnos que tienes a cargo.")
        # Si quien evalúa es un maestro y no dijo otra cosa, él es el evaluador.
        evaluador = serializer.validated_data.get("evaluador") or maestro
        serializer.save(creado_por=user, evaluador=evaluador)

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            # Red de seguridad del UniqueConstraint (alumno, fecha); el
            # serializer ya lo detecta antes en el caso normal.
            return Response(
                {"detail": "Este alumno ya tiene una evaluación en esa fecha."},
                status=status.HTTP_409_CONFLICT,
            )


# ---------------------------------------------------------------------------
# Pagos
# ---------------------------------------------------------------------------

class PagoViewSet(BaseViewSet):
    """Pagos de membresía: los únicos que mueven vencimiento y semáforo del alumno."""

    queryset = Pago.objects.select_related("alumno", "membresia")
    serializer_class = PagoSerializer
    # Diccionario para que el rango Desde/Hasta de la pantalla de pagos
    # (fecha_pago__gte / __lte) funcione; la lista plana solo daba "exact".
    filterset_fields = {
        "alumno": ["exact"],
        "estatus": ["exact"],
        "metodo": ["exact"],
        "fecha_pago": ["exact", "gte", "lte"],
    }
    search_fields = ["alumno__nombres", "alumno__apellidos"]
    ordering_fields = ["fecha_pago", "monto", "fecha_vencimiento"]

    @action(detail=False, methods=["get"], permission_classes=[EsAdministrativo])
    def resumen(self, request):
        """Corte de caja del mes en curso."""
        hoy = timezone.localdate()
        mes = Pago.objects.filter(fecha_pago__year=hoy.year, fecha_pago__month=hoy.month)
        return Response(
            {
                "periodo": f"{hoy.year}-{hoy.month:02d}",
                "total_cobrado": mes.aggregate(t=Sum("monto"))["t"] or 0,
                "numero_pagos": mes.count(),
                "por_metodo": list(
                    mes.values("metodo").annotate(total=Sum("monto"), cantidad=Count("id"))
                ),
                "vencidos_historico": Pago.objects.filter(
                    estatus=Pago.Estatus.VENCIDO
                ).count(),
            }
        )

    @action(detail=True, methods=["get"])
    def comprobante(self, request, pk=None):
        """
        GET /api/pagos/{id}/comprobante/         -> HTML del recibo
        GET /api/pagos/{id}/comprobante/?formato=pdf -> descarga en PDF

        Mismo diseño y datos que el correo (core/comprobante.py: HTML de
        correos/comprobante.html y PDF con ReportLab)
        — el permiso lo da get_object() (dueño-o-administrativo, heredado de
        BaseViewSet), así el propio alumno puede descargar su recibo.
        """
        pago = self.get_object()
        if request.query_params.get("formato") == "pdf":
            respuesta = HttpResponse(comprobante_pago.generar_comprobante_pdf(pago), content_type="application/pdf")
            respuesta["Content-Disposition"] = f'attachment; filename="{comprobante_pago.nombre_archivo(pago)}"'
            return respuesta
        # en_app: la app lo muestra en un iframe, donde el botón "Ver mis pagos" sobra.
        contexto = {**comprobante_pago.datos_comprobante(pago), "frontend_url": settings.FRONTEND_URL, "en_app": True}
        return HttpResponse(
            render_to_string("correos/comprobante.html", contexto), content_type="text/html; charset=utf-8"
        )


class VentaViewSet(viewsets.ModelViewSet):
    """
    Otros ingresos (inscripción, guantes, bebidas...). Registro de caja
    independiente de Pago: no toca membresías, vencimientos ni el semáforo
    del alumno. Solo lo maneja el administrativo.
    """

    queryset = Venta.objects.select_related("alumno", "registrado_por")
    serializer_class = VentaSerializer
    permission_classes = [EsAdministrativo]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = {
        "alumno": ["exact"],
        "metodo": ["exact"],
        "fecha": ["exact", "gte", "lte"],
    }
    search_fields = ["concepto", "alumno__nombres", "alumno__apellidos", "alumno__apodo"]
    ordering_fields = ["fecha", "monto", "concepto"]

    def perform_create(self, serializer):
        serializer.save(registrado_por=self.request.user)

    @action(detail=False, methods=["get"])
    def resumen(self, request):
        """Corte de otros ingresos del mes en curso, aparte del de membresías."""
        hoy = timezone.localdate()
        mes = Venta.objects.filter(fecha__year=hoy.year, fecha__month=hoy.month)
        return Response(
            {
                "periodo": f"{hoy.year}-{hoy.month:02d}",
                "total_vendido": mes.aggregate(t=Sum("monto"))["t"] or 0,
                "numero_ventas": mes.count(),
                "por_metodo": list(
                    mes.values("metodo")
                    .annotate(total=Sum("monto"), cantidad=Count("id"))
                    .order_by("-total")
                ),
                "por_concepto": list(
                    mes.values("concepto")
                    .annotate(total=Sum("monto"), cantidad=Count("id"))
                    .order_by("-total")[:8]
                ),
            }
        )


# ---------------------------------------------------------------------------
# Asistencias y check-in
# ---------------------------------------------------------------------------

class AsistenciaViewSet(BaseViewSet):
    queryset = Asistencia.objects.select_related("alumno", "disciplina", "horario")
    serializer_class = AsistenciaSerializer
    filterset_fields = ["alumno", "disciplina", "horario", "fecha", "metodo_registro"]
    ordering_fields = ["fecha", "hora_registro"]

    @action(detail=False, methods=["post"], url_path="checkin", permission_classes=[AllowAny])
    def checkin(self, request):
        """
        Registro de asistencia escaneando el QR del alumno.
        POST /api/asistencias/checkin/
        {"codigo_qr": "ALU-XXXX", "disciplina_id": 1, "horario_id": 2}

        Público a propósito (tablet de recepción sin sesión): el QR es el
        secreto que identifica al alumno.
        """
        serializer = CheckinQRSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        alumno = Alumno.objects.get(codigo_qr=datos["codigo_qr"])
        return self._registrar(
            alumno,
            disciplina_id=datos.get("disciplina_id"),
            horario_id=datos.get("horario_id"),
            maestro_id=datos.get("maestro_id"),
            metodo=Asistencia.MetodoRegistro.QR,
        )

    @action(detail=False, methods=["post"], permission_classes=[EsAdministrativo])
    def manual(self, request):
        """
        Registro manual: recepción busca al alumno por nombre, o el botón
        "Marcar asistencia" de su ficha.
        POST /api/asistencias/manual/
        {"alumno_id": 3, "disciplina_id": 1, "horario_id": 2, "fecha": "2026-09-08"}

        Solo administrativo: aquí el alumno se identifica por id, no por su
        QR, así que no puede ser público. Misma respuesta que el check-in.
        """
        serializer = AsistenciaManualSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        datos = serializer.validated_data
        alumno = Alumno.objects.get(pk=datos["alumno_id"])
        return self._registrar(
            alumno,
            disciplina_id=datos.get("disciplina_id"),
            horario_id=datos.get("horario_id"),
            fecha=datos.get("fecha"),
            metodo=Asistencia.MetodoRegistro.MANUAL,
        )

    @action(detail=False, methods=["post"], url_path="mi-checkin", permission_classes=[IsAuthenticated])
    def mi_checkin(self, request):
        """
        El alumno registra SU asistencia de hoy desde su perfil en la app.
        POST /api/asistencias/mi-checkin/   {"disciplina_id": 1}   (opcional)

        Queda marcada como APP para distinguirla del escaneo en recepción.
        Solo puede elegir una disciplina en la que esté inscrito; el horario
        es el suyo y la fecha siempre es hoy.
        """
        alumno = alumno_de(request.user)
        if alumno is None:
            raise PermissionDenied("Solo un alumno puede registrar su propia asistencia desde la app.")

        disciplina_id = request.data.get("disciplina_id") or None
        if disciplina_id is not None:
            try:
                disciplina_id = int(disciplina_id)
            except (TypeError, ValueError):
                raise ValidationError({"disciplina_id": "Disciplina no válida."})
            if not alumno.disciplinas.filter(pk=disciplina_id).exists():
                raise ValidationError({"disciplina_id": "No estás inscrito en esa disciplina."})

        return self._registrar(
            alumno,
            disciplina_id=disciplina_id,
            horario_id=None,
            metodo=Asistencia.MetodoRegistro.APP,
        )

    def _registrar(self, alumno, *, disciplina_id, horario_id, metodo, fecha=None, maestro_id=None):
        """Crea la asistencia y arma la respuesta común del check-in, el manual y el de la app."""
        if not alumno.activo:
            return Response(
                {"detail": "El alumno está dado de baja.", "alumno": alumno.nombre_completo},
                status=status.HTTP_403_FORBIDDEN,
            )

        campos = {
            "alumno": alumno,
            "disciplina_id": disciplina_id,
            "horario_id": horario_id or alumno.horario_id,
            "registrada_por_id": maestro_id,
            "metodo_registro": metodo,
        }
        if fecha:
            campos["fecha"] = fecha
        try:
            asistencia = Asistencia.objects.create(**campos)
        except IntegrityError:
            cuando = "ese día" if fecha and fecha != timezone.localdate() else "hoy"
            return Response(
                {"detail": f"Este alumno ya registró asistencia en esta clase {cuando}."},
                status=status.HTTP_409_CONFLICT,
            )

        alumno.refresh_from_db()
        exp = getattr(alumno, "experiencia", None)
        nuevas = list(
            alumno.insignias_ganadas.filter(
                fecha_obtencion=timezone.localdate()
            ).values_list("insignia__nombre", flat=True)
        )

        return Response(
            {
                "detail": f"Asistencia registrada para {alumno.nombre_completo}.",
                "alumno": {
                    "id": alumno.id,
                    "nombre": alumno.nombre_completo,
                    "apodo": alumno.apodo,
                    "puntos": alumno.puntos,
                    "al_corriente": alumno.al_corriente,
                    "dias_para_vencer": alumno.dias_para_vencer,
                },
                "racha": exp.racha_asistencia if exp else 0,
                "puntos_otorgados": asistencia.puntos_otorgados,
                "insignias_desbloqueadas": nuevas,
                "asistencia_id": asistencia.id,
                "fecha": asistencia.fecha,
                "metodo_registro": asistencia.metodo_registro,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], permission_classes=[EsAdministrativo])
    def hoy(self, request):
        qs = self.get_queryset().filter(fecha=timezone.localdate())
        return Response(AsistenciaSerializer(qs, many=True).data)


# ---------------------------------------------------------------------------
# Resto
# ---------------------------------------------------------------------------

class NotificacionViewSet(BaseViewSet):
    # PermisoAlumno (no el EsDuenoOAdministrativo de BaseViewSet) para que el
    # maestro pueda LEER —solo leer— el drill-down de destinatarios de sus
    # avisos; escribir Notificacion directo sigue siendo solo del admin.
    permission_classes = [PermisoAlumno]
    queryset = Notificacion.objects.select_related("alumno")
    serializer_class = NotificacionSerializer
    filterset_fields = ["alumno", "tipo", "leida", "canal", "aviso"]

    def get_queryset(self):
        # El maestro solo ve las notificaciones que nacieron de SUS avisos
        # (drill-down de destinatarios), nunca las del sistema (pagos, etc.).
        maestro = _maestro_acotado(self.request.user)
        if maestro is not None:
            return super(BaseViewSet, self).get_queryset().filter(
                aviso__creado_por=self.request.user
            )
        return super().get_queryset()

    @action(detail=True, methods=["post"], url_path="marcar-leida",
            permission_classes=[IsAuthenticated])
    def marcar_leida(self, request, pk=None):
        if _maestro_acotado(request.user) is not None:
            raise PermissionDenied("Solo el alumno marca como leídas sus notificaciones.")
        notif = self.get_object()  # get_queryset ya restringe al dueño
        notif.leida = True
        notif.save(update_fields=["leida"])
        return Response(NotificacionSerializer(notif).data)


class AvisoViewSet(viewsets.ModelViewSet):
    """
    Personal (admin/maestro): un Aviso no tiene concepto de "dueño alumno"
    (por eso no hereda BaseViewSet) — el alumno nunca ve este recurso, solo
    sus Notificacion hijas vía /api/notificaciones/ (existente, ver ?aviso=).

    El administrativo avisa a quien sea (individual, grupo o todos). El
    maestro solo a alumnos a su cargo o a sus grupos asignados —nunca a
    "todos"— y solo ve/administra los avisos que él mismo creó. La lista de
    destinatarios la resuelve siempre el servidor (core/avisos.py).
    """

    queryset = Aviso.objects.select_related("alumno", "horario", "creado_por")
    serializer_class = AvisoSerializer
    permission_classes = [EsPersonal]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo_destinatario", "estado", "horario", "alumno"]
    search_fields = ["titulo", "mensaje"]
    ordering_fields = ["creado_en", "estado"]

    def get_queryset(self):
        qs = super().get_queryset()
        if _maestro_acotado(self.request.user) is not None:
            return qs.filter(creado_por=self.request.user)
        return qs

    def _validar_alcance(self, tipo, alumno, horario):
        """Un maestro solo notifica dentro de su alcance; el admin no se acota."""
        maestro = _maestro_acotado(self.request.user)
        if maestro is None:
            return
        if tipo == Aviso.TipoDestinatario.TODOS:
            raise PermissionDenied("Solo el administrativo puede avisar a todos los alumnos.")
        if tipo == Aviso.TipoDestinatario.INDIVIDUAL and not maestro.tiene_a_cargo(alumno):
            raise PermissionDenied("Solo puedes notificar a los alumnos que tienes a cargo.")
        if (
            tipo == Aviso.TipoDestinatario.GRUPO
            and not maestro.horarios.filter(pk=horario.pk).exists()
        ):
            raise PermissionDenied("Solo puedes notificar a los grupos que tienes asignados.")

    def perform_create(self, serializer):
        datos = serializer.validated_data
        self._validar_alcance(
            datos.get("tipo_destinatario"), datos.get("alumno"), datos.get("horario")
        )
        aviso = serializer.save(creado_por=self.request.user)
        crear_notificaciones_de_aviso(aviso)

    def perform_update(self, serializer):
        datos, actual = serializer.validated_data, serializer.instance
        self._validar_alcance(
            datos.get("tipo_destinatario", actual.tipo_destinatario),
            datos.get("alumno", actual.alumno),
            datos.get("horario", actual.horario),
        )
        aviso = serializer.save()
        # El serializer ya garantiza estado == PENDIENTE (nada enviado aún),
        # así que si el admin corrige título/mensaje hay que resincronizar
        # las Notificacion hijas que ya se crearon.
        Notificacion.objects.filter(aviso=aviso).update(
            titulo=aviso.titulo, mensaje=aviso.mensaje
        )

    def destroy(self, request, *args, **kwargs):
        aviso = self.get_object()
        if aviso.estado != Aviso.Estado.PENDIENTE or aviso.total_enviadas > 0:
            return Response(
                {"detail": "Solo se puede borrar un aviso pendiente que no haya enviado nada."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)  # CASCADE se lleva las Notificacion hijas

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        aviso = self.get_object()
        if aviso.estado in (Aviso.Estado.ENVIADA, Aviso.Estado.CANCELADA):
            return Response(
                {"detail": "Este aviso ya no se puede cancelar."}, status=status.HTTP_409_CONFLICT
            )
        aviso.estado = Aviso.Estado.CANCELADA
        aviso.save(update_fields=["estado", "actualizado_en"])
        # Solo se cancela lo que seguía pendiente de enviar; lo que ya se
        # mandó (o falló) no se toca.
        Notificacion.objects.filter(
            aviso=aviso, estado_correo=Notificacion.EstadoCorreo.PENDIENTE
        ).update(
            estado_correo=Notificacion.EstadoCorreo.FALLIDO,
            error_correo="Cancelado por el administrador.",
        )
        return Response(AvisoSerializer(aviso).data)


class TorneoViewSet(BaseViewSet):
    queryset = Torneo.objects.select_related("alumno", "disciplina", "evento")
    serializer_class = TorneoSerializer
    filterset_fields = ["alumno", "disciplina", "resultado", "evento"]
    search_fields = ["nombre_torneo"]
    ordering_fields = ["fecha"]


class GradoViewSet(BaseViewSet):
    queryset = Grado.objects.select_related("alumno", "disciplina", "otorgado_por")
    serializer_class = GradoSerializer
    filterset_fields = ["alumno", "disciplina", "otorgado_por"]
    ordering_fields = ["fecha_obtencion"]


# ---------------------------------------------------------------------------
# Eventos (torneos/seminarios/exámenes con registro de participantes)
# ---------------------------------------------------------------------------

class EventoViewSet(viewsets.ModelViewSet):
    """
    Como AvisoViewSet: no hereda BaseViewSet porque un Evento no tiene
    concepto de "dueño alumno" — cualquier autenticado lo lee (cartelera),
    admin/maestro lo dan de alta.
    """

    queryset = Evento.objects.select_related("disciplina", "creado_por")
    serializer_class = EventoSerializer
    permission_classes = [EsPersonalOSoloLectura]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "disciplina"]
    search_fields = ["titulo", "lugar"]
    ordering_fields = ["fecha", "creado_en"]

    def perform_create(self, serializer):
        serializer.save(creado_por=self.request.user)


class EventoInscripcionViewSet(BaseViewSet):
    queryset = EventoInscripcion.objects.select_related("evento", "alumno").prefetch_related(
        # Resultados (Torneo ligado a un Evento) de cada alumno, para que
        # EventoInscripcion.torneo se resuelva sin una consulta por fila.
        Prefetch(
            "alumno__torneos",
            queryset=Torneo.objects.filter(evento__isnull=False),
            to_attr="resultados_eventos",
        )
    )
    serializer_class = EventoInscripcionSerializer
    permission_classes = [PermisoInscripcionEvento]
    filterset_fields = ["evento", "alumno", "asistio"]

    def get_queryset(self):
        # BaseViewSet.get_queryset solo conoce administrativo/alumno-dueño.
        # El maestro ve las inscripciones de los alumnos a su cargo (para
        # pasar lista y capturar resultados), no las de alumnos ajenos.
        maestro = _maestro_acotado(self.request.user)
        if maestro is not None:
            return super(BaseViewSet, self).get_queryset().filter(
                alumno__in=maestro.alumnos_a_cargo()
            )
        return super().get_queryset()

    def perform_create(self, serializer):
        # Un alumno solo se inscribe a sí mismo, sin importar qué 'alumno'
        # haya mandado. Personal (admin/maestro) inscribe a otros (recepción o
        # lista de inscritos); el maestro solo a alumnos a su cargo — mismo
        # alcance que EvaluacionMMAViewSet.perform_create.
        alumno = alumno_de(self.request.user)
        if alumno is not None:
            serializer.save(alumno=alumno)
            return
        elegido = serializer.validated_data.get("alumno")
        if elegido is None:
            raise ValidationError({"alumno": ["Indica al alumno que se inscribe."]})
        maestro = _maestro_acotado(self.request.user)
        if maestro is not None and not maestro.tiene_a_cargo(elegido):
            raise PermissionDenied("Solo puedes inscribir a los alumnos que tienes a cargo.")
        serializer.save()

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            propio = alumno_de(request.user) is not None
            return Response(
                {
                    "detail": "Ya estás inscrito a este evento."
                    if propio
                    else "Este alumno ya está inscrito a este evento."
                },
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=True, methods=["post", "delete"], url_path="resultado")
    def resultado(self, request, pk=None):
        """
        Captura (POST) o quita (DELETE) el resultado del alumno en este evento.

        El resultado ES un `Torneo` —el mismo modelo que se captura a mano en
        la ficha del alumno— ligado al Evento por `Torneo.evento`. Así el
        récord G-P-E (gamificacion.sincronizar_record, vía señal) y la línea
        de tiempo de "Mi progreso" lo toman solos, sin una segunda tabla.
        Body del POST: {"resultado": "GANO", "metodo": "KO", "notas": ""}.
        Registrar un resultado también marca la asistencia.
        """
        if not es_personal(request.user):
            raise PermissionDenied("Solo el personal captura resultados.")
        inscripcion = self.get_object()
        evento = inscripcion.evento
        if evento.tipo != Evento.Tipo.TORNEO:
            return Response(
                {"detail": "Solo los eventos de tipo Torneo llevan resultado."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        actual = inscripcion.torneo

        if request.method == "DELETE":
            if actual is not None:
                actual.delete()  # post_delete -> sincronizar_record
        else:
            datos = {
                "alumno": inscripcion.alumno_id,
                "evento": evento.id,
                "nombre_torneo": evento.titulo,
                "fecha": evento.fecha,
                "disciplina": evento.disciplina_id,
                "resultado": request.data.get("resultado"),
                "metodo": request.data.get("metodo") or "",
                "notas": request.data.get("notas") or "",
            }
            serializer = TorneoSerializer(instance=actual, data=datos)
            serializer.is_valid(raise_exception=True)
            serializer.save()  # post_save -> sincronizar_record
            if not inscripcion.asistio:
                inscripcion.asistio = True
                inscripcion.save(update_fields=["asistio"])

        # Se vuelve a leer para que el prefetch de resultados refleje el cambio.
        return Response(self.get_serializer(self.get_object()).data)


class InsigniaViewSet(CatalogoViewSet):
    queryset = Insignia.objects.all()
    serializer_class = InsigniaSerializer
    filterset_fields = ["activa"]
    search_fields = ["nombre"]

    @action(detail=True, methods=["post"], url_path="otorgar")
    def otorgar(self, request, pk=None):
        """Otorga manualmente una insignia: POST {"alumno_id": 3}"""
        insignia = self.get_object()
        alumno_id = request.data.get("alumno_id")
        if not alumno_id:
            return Response(
                {"detail": "Falta 'alumno_id'."}, status=status.HTTP_400_BAD_REQUEST
            )
        alumno = Alumno.objects.filter(pk=alumno_id).first()
        if not alumno:
            return Response({"detail": "Alumno no encontrado."}, status=status.HTTP_404_NOT_FOUND)

        obj, creada = AlumnoInsignia.objects.get_or_create(alumno=alumno, insignia=insignia)
        if not creada:
            return Response(
                {"detail": "El alumno ya tiene esta insignia."}, status=status.HTTP_409_CONFLICT
            )

        if insignia.puntos_bonus:
            Alumno.objects.filter(pk=alumno.pk).update(
                puntos=F("puntos") + insignia.puntos_bonus
            )
        notificar_insignia_otorgada(obj)

        return Response(AlumnoInsigniaSerializer(obj).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([EsAdministrativo])
def dashboard(request):
    """Métricas generales para la pantalla principal del administrador."""
    hoy = timezone.localdate()
    inicio_mes = hoy.replace(day=1)

    activos = Alumno.objects.filter(activo=True)
    morosos = sum(1 for a in activos if not a.al_corriente)

    return Response(
        {
            "alumnos": {
                "total": Alumno.objects.count(),
                "activos": activos.count(),
                "nuevos_mes": Alumno.objects.filter(fecha_registro__gte=inicio_mes).count(),
                "morosos": morosos,
            },
            "asistencias": {
                "hoy": Asistencia.objects.filter(fecha=hoy).count(),
                "semana": Asistencia.objects.filter(
                    fecha__gte=hoy - timedelta(days=7)
                ).count(),
                "mes": Asistencia.objects.filter(fecha__gte=inicio_mes).count(),
            },
            "ingresos_mes": Pago.objects.filter(fecha_pago__gte=inicio_mes).aggregate(
                t=Sum("monto")
            )["t"]
            or 0,
            # Ventas (inscripciones, equipo...) van aparte: no son membresías.
            "otros_ingresos_mes": Venta.objects.filter(fecha__gte=inicio_mes).aggregate(
                t=Sum("monto")
            )["t"]
            or 0,
            "por_disciplina": list(
                Disciplina.objects.annotate(
                    alumnos_activos=Count("alumnos", filter=Q(alumnos__activo=True))
                ).values("id", "nombre", "alumnos_activos")
            ),
            "por_horario": list(
                Horario.objects.annotate(
                    alumnos_activos=Count("alumnos", filter=Q(alumnos__activo=True))
                ).values("id", "turno", "hora_inicio", "hora_fin", "alumnos_activos")
            ),
            "top_5": list(
                activos.order_by("-puntos").values("id", "nombres", "apellidos", "apodo", "puntos")[:5]
            ),
            "maestros_activos": Maestro.objects.filter(activo=True).count(),
        }
    )
