"""Serializers de la API REST."""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .evaluacion_mma import calcular_evaluacion, cargar_categorias
from .models import (
    Alumno,
    AlumnoDisciplina,
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
    MaestroDisciplina,
    Membresia,
    Notificacion,
    Pago,
    PuntajeHabilidadMMA,
    Torneo,
    Venta,
    crear_cuenta_acceso,
)


# ---------------------------------------------------------------------------
# Cuenta de acceso (Alumno y Maestro comparten el mismo patrón: un correo que
# no vive en su propio modelo sino en el User ligado por 'usuario'). La
# cuenta la crea la señal core.signals.crear_cuenta al dar de alta; aquí
# solo se mantiene el correo y se expone el username.
# ---------------------------------------------------------------------------

def _normalizar_email(value: str) -> str:
    return value.strip().lower()


def _vincular_cuenta(instancia, email: str) -> None:
    """Guarda este correo en la cuenta (User) ligada a `instancia` (Alumno o
    Maestro). No se toca la contraseña de una cuenta ya existente. Varios
    registros SÍ pueden compartir un mismo correo (ej. hermanos con el mismo
    tutor) — no se bloquea; el login (auth_views.login) ya sabe resolver un
    correo repetido probando cada cuenta que lo tenga. Si el registro es
    viejo y aún no tiene cuenta, se le crea aquí (misma regla que la señal:
    usuario <prefijo>-<id>, contraseña inicial)."""
    if instancia.usuario_id:
        instancia.usuario.email = email
        instancia.usuario.save(update_fields=["email"])
        return
    crear_cuenta_acceso(instancia, email=email)


def _datos_cuenta(instancia) -> dict:
    """Campos de solo lectura que ambos serializers exponen de la cuenta ligada."""
    if not instancia.usuario_id:
        return {"email": "", "username": ""}
    return {"email": instancia.usuario.email, "username": instancia.usuario.username}


# ---------------------------------------------------------------------------
# Catálogos
# ---------------------------------------------------------------------------

class HorarioSerializer(serializers.ModelSerializer):
    turno_display = serializers.CharField(source="get_turno_display", read_only=True)
    total_alumnos = serializers.IntegerField(source="alumnos.count", read_only=True)

    class Meta:
        model = Horario
        fields = [
            "id", "hora_inicio", "hora_fin", "turno", "turno_display",
            "dias", "nombre", "total_alumnos",
        ]

    def validate_dias(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Debe ser una lista de días.")
        invalidos = [d for d in value if str(d).lower() not in Horario.DIAS_SEMANA]
        if invalidos:
            raise serializers.ValidationError(
                f"Días no válidos: {invalidos}. Use: {Horario.DIAS_SEMANA}"
            )
        return [str(d).lower() for d in value]

    def validate(self, attrs):
        inicio = attrs.get("hora_inicio", getattr(self.instance, "hora_inicio", None))
        fin = attrs.get("hora_fin", getattr(self.instance, "hora_fin", None))
        if inicio and fin and inicio >= fin:
            raise serializers.ValidationError(
                {"hora_fin": "La hora de fin debe ser posterior a la de inicio."}
            )
        return attrs


class DisciplinaSerializer(serializers.ModelSerializer):
    total_alumnos = serializers.IntegerField(source="alumnos.count", read_only=True)

    class Meta:
        model = Disciplina
        fields = ["id", "nombre", "descripcion", "total_alumnos"]


class MembresiaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Membresia
        fields = ["id", "nombre", "duracion_dias", "precio", "descripcion"]


class CategoriaPesoSerializer(serializers.ModelSerializer):
    limite_kg = serializers.DecimalField(max_digits=6, decimal_places=1, read_only=True)

    class Meta:
        model = CategoriaPeso
        fields = ["id", "nombre", "nombre_en", "limite_lb", "limite_kg", "organismo", "activa"]


# ---------------------------------------------------------------------------
# Maestro
# ---------------------------------------------------------------------------

class MaestroDisciplinaSerializer(serializers.ModelSerializer):
    disciplina_nombre = serializers.CharField(source="disciplina.nombre", read_only=True)

    class Meta:
        model = MaestroDisciplina
        fields = ["id", "maestro", "disciplina", "disciplina_nombre", "fecha_inicio", "es_titular"]


class EnteroOpcional(serializers.IntegerField):
    """Entero que acepta "" como "sin dato" (los formularios y el multipart
    mandan el campo vacío como cadena; DecimalField ya lo hace, IntegerField no)."""

    def to_internal_value(self, data):
        if data == "":
            return None
        return super().to_internal_value(data)


class ImagenRelativa(serializers.ImageField):
    """
    Devuelve la URL relativa del archivo (/media/...) en vez de la absoluta.

    DRF arma la absoluta con el host que ve Django. Con el dev-server de
    Angular como proxy ese host es 127.0.0.1:8000, y desde un celular en la
    misma WiFi 127.0.0.1 es el propio celular: no cargaban fotos ni QR. Con
    la ruta relativa el navegador la pide al mismo origen desde el que abrió
    la app (localhost, IP de la LAN o dominio) y el proxy/servidor la sirve.
    Sigue aceptando subidas igual que ImageField.
    """

    def to_representation(self, value):
        if not value:
            return None
        try:
            return value.url
        except (AttributeError, ValueError):
            return None


class MaestroSerializer(serializers.ModelSerializer):
    asignaciones = MaestroDisciplinaSerializer(many=True, read_only=True)
    disciplinas_ids = serializers.PrimaryKeyRelatedField(
        queryset=Disciplina.objects.all(), many=True, write_only=True, required=False
    )
    foto = ImagenRelativa(required=False, allow_null=True)
    qr_imagen = ImagenRelativa(read_only=True)

    # Alcance (qué alumnos ve): grupos completos y/o alumnos sueltos. Mismo
    # par lectura/escritura que asignaciones/disciplinas_ids.
    horarios_ids = serializers.PrimaryKeyRelatedField(
        queryset=Horario.objects.all(), many=True, write_only=True, required=False
    )
    alumnos_ids = serializers.PrimaryKeyRelatedField(
        queryset=Alumno.objects.all(), many=True, write_only=True, required=False
    )
    horarios = serializers.SerializerMethodField()
    alumnos_asignados = serializers.SerializerMethodField()
    total_alumnos = serializers.SerializerMethodField()

    # No es un campo del modelo Maestro: vive en el User ligado
    # (maestro.usuario.email). Mismo patrón que AlumnoDetailSerializer.email.
    email = serializers.EmailField(required=False, allow_blank=True)
    tiene_cuenta = serializers.SerializerMethodField()

    def get_tiene_cuenta(self, obj):
        return bool(obj.usuario_id)

    def get_horarios(self, obj):
        return [{"id": h.id, "nombre": str(h)} for h in obj.horarios.all()]

    def get_alumnos_asignados(self, obj):
        return [
            {"id": a.id, "nombre_completo": a.nombre_completo, "apodo": a.apodo}
            for a in obj.alumnos_asignados.all()
        ]

    def get_total_alumnos(self, obj):
        """Cuántos alumnos activos ve en total (grupos + individuales, sin repetir)."""
        return obj.alumnos_a_cargo().filter(activo=True).count()

    class Meta:
        model = Maestro
        fields = [
            "id", "nombre", "edad", "telefono", "email", "tiene_cuenta", "foto", "activo",
            "codigo_qr", "qr_imagen", "asignaciones", "disciplinas_ids",
            "horarios", "horarios_ids", "alumnos_asignados", "alumnos_ids", "total_alumnos",
        ]
        read_only_fields = ["codigo_qr", "qr_imagen"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.update(_datos_cuenta(instance))
        return data

    def validate_email(self, value):
        return _normalizar_email(value)

    def create(self, validated_data):
        disciplinas = validated_data.pop("disciplinas_ids", [])
        horarios = validated_data.pop("horarios_ids", None)
        alumnos = validated_data.pop("alumnos_ids", None)
        email = validated_data.pop("email", None)
        maestro = super().create(validated_data)  # post_save -> crear_cuenta
        for d in disciplinas:
            MaestroDisciplina.objects.get_or_create(maestro=maestro, disciplina=d)
        if horarios is not None:
            maestro.horarios.set(horarios)
        if alumnos is not None:
            maestro.alumnos_asignados.set(alumnos)
        if email is not None:
            _vincular_cuenta(maestro, email)
        return maestro

    def update(self, instance, validated_data):
        disciplinas = validated_data.pop("disciplinas_ids", None)
        horarios = validated_data.pop("horarios_ids", None)
        alumnos = validated_data.pop("alumnos_ids", None)
        email = validated_data.pop("email", None)
        maestro = super().update(instance, validated_data)
        if disciplinas is not None:
            maestro.asignaciones.exclude(disciplina__in=disciplinas).delete()
            for d in disciplinas:
                MaestroDisciplina.objects.get_or_create(maestro=maestro, disciplina=d)
        if horarios is not None:
            maestro.horarios.set(horarios)
        if alumnos is not None:
            maestro.alumnos_asignados.set(alumnos)
        if email is not None:
            _vincular_cuenta(maestro, email)
        return maestro


# ---------------------------------------------------------------------------
# Experiencia
# ---------------------------------------------------------------------------

class ExperienciaSerializer(serializers.ModelSerializer):
    total_peleas = serializers.IntegerField(read_only=True)
    bjj_cinturon_display = serializers.CharField(source="get_bjj_cinturon_display", read_only=True)

    class Meta:
        model = Experiencia
        fields = [
            "id", "alumno",
            "bjj_cinturon", "bjj_cinturon_display", "numero_torneos", "numero_sparrings",
            "peleas_ganadas", "peleas_perdidas", "peleas_empatadas", "total_peleas",
            "metodo_victoria_favorito", "peso_competencia", "lesion_activa",
            "detalle_lesion", "notas_maestro",
            "racha_asistencia", "racha_maxima",
        ]
        read_only_fields = ["racha_asistencia", "racha_maxima"]


# ---------------------------------------------------------------------------
# Alumno
# ---------------------------------------------------------------------------

class AlumnoDisciplinaSerializer(serializers.ModelSerializer):
    disciplina_nombre = serializers.CharField(source="disciplina.nombre", read_only=True)

    class Meta:
        model = AlumnoDisciplina
        fields = ["id", "alumno", "disciplina", "disciplina_nombre", "fecha_inicio"]


class AlumnoInsigniaSerializer(serializers.ModelSerializer):
    insignia_nombre = serializers.CharField(source="insignia.nombre", read_only=True)
    insignia_icono = serializers.ImageField(source="insignia.icono", read_only=True)

    class Meta:
        model = AlumnoInsignia
        fields = ["id", "alumno", "insignia", "insignia_nombre", "insignia_icono", "fecha_obtencion"]


class AlumnoListSerializer(serializers.ModelSerializer):
    """Versión ligera para listados y tarjetas."""

    nombre_completo = serializers.CharField(read_only=True)
    foto = ImagenRelativa(read_only=True)
    horario_display = serializers.SerializerMethodField()
    membresia_nombre = serializers.CharField(source="membresia.nombre", read_only=True)
    al_corriente = serializers.BooleanField(read_only=True)
    dias_para_vencer = serializers.IntegerField(read_only=True)
    record = serializers.CharField(read_only=True)

    def get_horario_display(self, obj):
        # source="horario.__str__" se ve equivalente pero produce basura
        # ("<method-wrapper '__str__' of NoneType...>") cuando horario es
        # None, porque None.__str__ existe y es "callable" — no dispara el
        # AttributeError que activaría un default.
        return str(obj.horario) if obj.horario_id else None

    class Meta:
        model = Alumno
        fields = [
            "id", "nombres", "apellidos", "nombre_completo", "apodo", "foto",
            "activo", "puntos", "record", "horario", "horario_display",
            "membresia", "membresia_nombre", "al_corriente", "dias_para_vencer",
        ]


class AlumnoDetailSerializer(serializers.ModelSerializer):
    """Perfil completo del peleador."""

    nombre_completo = serializers.CharField(read_only=True)
    foto = ImagenRelativa(required=False, allow_null=True)
    qr_imagen = ImagenRelativa(read_only=True)
    experiencia = ExperienciaSerializer(read_only=True)
    inscripciones = AlumnoDisciplinaSerializer(many=True, read_only=True)
    insignias_ganadas = AlumnoInsigniaSerializer(many=True, read_only=True)
    al_corriente = serializers.BooleanField(read_only=True)
    dias_para_vencer = serializers.IntegerField(read_only=True)
    fecha_vencimiento = serializers.DateField(read_only=True)
    record = serializers.CharField(read_only=True)
    total_asistencias = serializers.IntegerField(source="asistencias.count", read_only=True)
    estatura = EnteroOpcional(required=False, allow_null=True)

    disciplinas_ids = serializers.PrimaryKeyRelatedField(
        queryset=Disciplina.objects.all(), many=True, write_only=True, required=False
    )

    # No es un campo del modelo Alumno: vive en el User ligado (alumno.usuario.email).
    # Captura este correo es lo que permite que le lleguen avisos/recordatorios/
    # comprobantes por correo (ver core/email_service.py). La cuenta en sí la
    # crea la señal al dar de alta; el correo es opcional.
    email = serializers.EmailField(required=False, allow_blank=True)
    # Independiente de si 'email' está vacío: un alumno puede tener cuenta con
    # el correo borrado. Esto es lo que decide si mostrar el botón de
    # restablecer contraseña en el frontend.
    tiene_cuenta = serializers.SerializerMethodField()

    def get_tiene_cuenta(self, obj):
        return bool(obj.usuario_id)

    class Meta:
        model = Alumno
        fields = [
            "id", "nombres", "apellidos", "nombre_completo", "apodo", "edad",
            "peso_actual", "estatura", "telefono", "email", "tiene_cuenta", "foto", "codigo_qr", "qr_imagen",
            "fecha_registro", "horario", "membresia", "activo", "puntos",
            "experiencia", "inscripciones", "insignias_ganadas", "disciplinas_ids",
            "al_corriente", "dias_para_vencer", "fecha_vencimiento",
            "record", "total_asistencias", "creado_en",
        ]
        read_only_fields = ["codigo_qr", "qr_imagen", "puntos", "creado_en"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.update(_datos_cuenta(instance))
        return data

    def validate_edad(self, value):
        if value is not None and not (3 <= value <= 100):
            raise serializers.ValidationError("La edad debe estar entre 3 y 100 años.")
        return value

    def validate_peso_actual(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("El peso debe ser mayor a cero.")
        return value

    def validate_estatura(self, value):
        if value is not None and not (80 <= value <= 250):
            raise serializers.ValidationError("La estatura debe estar entre 80 y 250 cm.")
        return value

    def validate_email(self, value):
        return _normalizar_email(value)

    def create(self, validated_data):
        disciplinas = validated_data.pop("disciplinas_ids", [])
        email = validated_data.pop("email", None)
        alumno = super().create(validated_data)  # post_save -> crear_cuenta
        for d in disciplinas:
            AlumnoDisciplina.objects.get_or_create(alumno=alumno, disciplina=d)
        if email is not None:
            _vincular_cuenta(alumno, email)
        return alumno

    def update(self, instance, validated_data):
        disciplinas = validated_data.pop("disciplinas_ids", None)
        email = validated_data.pop("email", None)
        alumno = super().update(instance, validated_data)
        if disciplinas is not None:
            alumno.inscripciones.exclude(disciplina__in=disciplinas).delete()
            for d in disciplinas:
                AlumnoDisciplina.objects.get_or_create(alumno=alumno, disciplina=d)
        if email is not None:
            _vincular_cuenta(alumno, email)
        return alumno


# ---------------------------------------------------------------------------
# Usuario administrativo (staff/admin). Es el User de Django tal cual — no
# hay un modelo propio: el rol lo da is_staff (ver core/permissions.py).
# ---------------------------------------------------------------------------

class UsuarioAdministrativoSerializer(serializers.ModelSerializer):
    nombre = serializers.SerializerMethodField()

    def get_nombre(self, obj):
        return obj.get_full_name() or obj.username

    class Meta:
        model = get_user_model()
        fields = [
            "id", "username", "first_name", "last_name", "nombre", "email",
            "is_active", "is_superuser", "last_login", "date_joined",
        ]
        read_only_fields = ["is_superuser", "last_login", "date_joined"]

    def validate_username(self, value):
        return value.strip()

    def validate_email(self, value):
        return _normalizar_email(value)

    def create(self, validated_data):
        # create_user guarda la contraseña con hash; is_staff es lo que lo
        # convierte en administrativo para toda la API.
        return get_user_model().objects.create_user(
            password=settings.PASSWORD_INICIAL, is_staff=True, **validated_data
        )


# ---------------------------------------------------------------------------
# Pago
# ---------------------------------------------------------------------------

class PagoSerializer(serializers.ModelSerializer):
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    estatus_display = serializers.CharField(source="get_estatus_display", read_only=True)

    class Meta:
        model = Pago
        fields = [
            "id", "alumno", "alumno_nombre", "membresia", "monto", "metodo",
            "fecha_pago", "fecha_vencimiento", "duracion", "estatus",
            "estatus_display", "nota", "comprobante_enviado_en",
        ]
        read_only_fields = ["estatus", "comprobante_enviado_en"]
        extra_kwargs = {
            "fecha_vencimiento": {"required": False},
            "duracion": {"required": False},
        }

    def validate_monto(self, value):
        if value <= 0:
            raise serializers.ValidationError("El monto debe ser mayor a cero.")
        return value


class VentaSerializer(serializers.ModelSerializer):
    """Otros ingresos (inscripción, equipo...). Registro de caja aparte de Pago."""

    alumno_nombre = serializers.CharField(
        source="alumno.nombre_completo", read_only=True, default=""
    )
    metodo_display = serializers.CharField(source="get_metodo_display", read_only=True)
    registrado_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Venta
        fields = [
            "id", "concepto", "monto", "metodo", "metodo_display", "fecha",
            "alumno", "alumno_nombre", "nota", "registrado_por",
            "registrado_por_nombre", "creado_en",
        ]
        read_only_fields = ["registrado_por", "creado_en"]

    def get_registrado_por_nombre(self, obj):
        u = obj.registrado_por
        if u is None:
            return ""
        return u.get_full_name() or u.username

    def validate_concepto(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Indica qué se vendió.")
        return value

    def validate_monto(self, value):
        if value <= 0:
            raise serializers.ValidationError("El monto debe ser mayor a cero.")
        return value


# ---------------------------------------------------------------------------
# Asistencia
# ---------------------------------------------------------------------------

class AsistenciaSerializer(serializers.ModelSerializer):
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    disciplina_nombre = serializers.CharField(source="disciplina.nombre", read_only=True)

    class Meta:
        model = Asistencia
        fields = [
            "id", "alumno", "alumno_nombre", "disciplina", "disciplina_nombre",
            "horario", "registrada_por", "fecha", "hora_registro",
            "metodo_registro", "puntos_otorgados",
        ]
        read_only_fields = ["hora_registro", "puntos_otorgados"]


class CheckinQRSerializer(serializers.Serializer):
    """Payload que manda la app al escanear el QR de un alumno."""

    codigo_qr = serializers.CharField(max_length=64)
    disciplina_id = serializers.IntegerField(required=False, allow_null=True)
    horario_id = serializers.IntegerField(required=False, allow_null=True)
    maestro_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_codigo_qr(self, value):
        value = value.strip().upper()
        if not Alumno.objects.filter(codigo_qr=value).exists():
            raise serializers.ValidationError("Código QR no reconocido.")
        return value


class AsistenciaManualSerializer(serializers.Serializer):
    """
    Payload del registro manual (recepción busca al alumno por nombre, o el
    botón "Marcar asistencia" de su ficha). Mismo resultado que el check-in
    por QR, pero identifica al alumno por id y permite fecha pasada.
    """

    alumno_id = serializers.IntegerField()
    disciplina_id = serializers.IntegerField(required=False, allow_null=True)
    horario_id = serializers.IntegerField(required=False, allow_null=True)
    fecha = serializers.DateField(required=False, allow_null=True)

    def validate_alumno_id(self, value):
        if not Alumno.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Alumno no encontrado.")
        return value

    def validate_fecha(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("No se puede registrar una asistencia a futuro.")
        return value


# ---------------------------------------------------------------------------
# Notificacion, Torneo, Grado, Insignia
# ---------------------------------------------------------------------------

class NotificacionSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    estado_correo_display = serializers.CharField(source="get_estado_correo_display", read_only=True)

    class Meta:
        model = Notificacion
        fields = [
            "id", "alumno", "alumno_nombre", "tipo", "tipo_display", "titulo", "mensaje",
            "fecha_envio", "leida", "canal", "aviso",
            "estado_correo", "estado_correo_display", "enviado_en", "error_correo",
        ]
        read_only_fields = ["estado_correo", "enviado_en", "error_correo"]


class AvisoSerializer(serializers.ModelSerializer):
    tipo_destinatario_display = serializers.CharField(
        source="get_tipo_destinatario_display", read_only=True
    )
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)
    alumno_nombre = serializers.CharField(
        source="alumno.nombre_completo", read_only=True, default=""
    )
    horario_display = serializers.SerializerMethodField()
    creado_por_username = serializers.CharField(
        source="creado_por.username", read_only=True, default=""
    )

    def get_horario_display(self, obj):
        return str(obj.horario) if obj.horario_id else ""

    class Meta:
        model = Aviso
        fields = [
            "id", "titulo", "mensaje", "tipo_destinatario", "tipo_destinatario_display",
            "alumno", "alumno_nombre", "horario", "horario_display",
            "creado_por", "creado_por_username", "estado", "estado_display",
            "total_destinatarios", "total_enviadas", "total_fallidas",
            "creado_en", "actualizado_en", "procesado_en",
        ]
        read_only_fields = [
            "creado_por", "estado", "total_destinatarios", "total_enviadas",
            "total_fallidas", "creado_en", "actualizado_en", "procesado_en",
        ]

    def validate_titulo(self, value):
        if not value.strip():
            raise serializers.ValidationError("El título es obligatorio.")
        return value

    def validate_mensaje(self, value):
        if not value.strip():
            raise serializers.ValidationError("El mensaje es obligatorio.")
        return value

    def validate(self, attrs):
        tipo = attrs.get("tipo_destinatario", getattr(self.instance, "tipo_destinatario", None))
        alumno = attrs.get("alumno", getattr(self.instance, "alumno", None))
        horario = attrs.get("horario", getattr(self.instance, "horario", None))

        if tipo == Aviso.TipoDestinatario.INDIVIDUAL and not alumno:
            raise serializers.ValidationError(
                {"alumno": "Requerido cuando el tipo de destinatario es 'Alumno individual'."}
            )
        if tipo == Aviso.TipoDestinatario.GRUPO and not horario:
            raise serializers.ValidationError(
                {"horario": "Requerido cuando el tipo de destinatario es 'Grupo'."}
            )
        if tipo == Aviso.TipoDestinatario.TODOS and (alumno or horario):
            raise serializers.ValidationError(
                "No indiques alumno ni horario cuando el tipo de destinatario es 'Todos'."
            )
        if self.instance is not None and self.instance.estado != Aviso.Estado.PENDIENTE:
            raise serializers.ValidationError(
                "Solo se puede editar un aviso mientras está PENDIENTE "
                "(todavía no se procesó ningún envío)."
            )
        return attrs


class TorneoSerializer(serializers.ModelSerializer):
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    resultado_display = serializers.CharField(source="get_resultado_display", read_only=True)
    metodo_display = serializers.CharField(source="get_metodo_display", read_only=True)
    evento_titulo = serializers.CharField(source="evento.titulo", read_only=True, default="")

    class Meta:
        model = Torneo
        fields = [
            "id", "alumno", "alumno_nombre", "nombre_torneo", "fecha",
            "resultado", "resultado_display", "metodo", "metodo_display",
            "disciplina", "evento", "evento_titulo", "notas",
        ]
        # El UniqueConstraint (evento, alumno) del modelo haría que DRF exija
        # 'evento' en todo POST a /torneos/, rompiendo la captura manual sin
        # evento. La unicidad la garantiza la BD y el upsert de
        # EventoInscripcionViewSet.resultado (mismo criterio que en
        # EventoInscripcionSerializer).
        validators = []


class GradoSerializer(serializers.ModelSerializer):
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    disciplina_nombre = serializers.CharField(source="disciplina.nombre", read_only=True)
    otorgado_por_nombre = serializers.CharField(source="otorgado_por.nombre", read_only=True)

    class Meta:
        model = Grado
        fields = [
            "id", "alumno", "alumno_nombre", "disciplina", "disciplina_nombre",
            "nombre_grado", "fecha_obtencion", "otorgado_por",
            "otorgado_por_nombre", "notas",
        ]


class InsigniaSerializer(serializers.ModelSerializer):
    total_otorgadas = serializers.IntegerField(source="otorgamientos.count", read_only=True)

    class Meta:
        model = Insignia
        fields = [
            "id", "nombre", "descripcion", "icono", "criterio",
            "puntos_bonus", "activa", "total_otorgadas",
        ]

    def validate_criterio(self, value):
        if not value:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("El criterio debe ser un objeto JSON.")
        tipo = value.get("tipo")
        validos = [c.value for c in Insignia.TipoCriterio]
        if tipo not in validos:
            raise serializers.ValidationError(f"'tipo' debe ser uno de: {validos}")
        if tipo != Insignia.TipoCriterio.MANUAL and "valor" not in value:
            raise serializers.ValidationError("Falta la clave 'valor' en el criterio.")
        return value


# ---------------------------------------------------------------------------
# Evento
# ---------------------------------------------------------------------------

class EventoSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    disciplina_nombre = serializers.CharField(
        source="disciplina.nombre", read_only=True, default=""
    )
    creado_por_username = serializers.CharField(
        source="creado_por.username", read_only=True, default=""
    )
    total_inscritos = serializers.IntegerField(source="inscripciones.count", read_only=True)
    inscrito = serializers.SerializerMethodField()

    def get_inscrito(self, obj):
        """¿El alumno autenticado ya está inscrito? None si quien consulta no es alumno."""
        request = self.context.get("request")
        alumno = getattr(getattr(request, "user", None), "alumno", None) if request else None
        if alumno is None:
            return None
        return obj.inscripciones.filter(alumno_id=alumno.id).exists()

    class Meta:
        model = Evento
        fields = [
            "id", "titulo", "tipo", "tipo_display", "fecha", "lugar", "descripcion",
            "disciplina", "disciplina_nombre", "creado_por", "creado_por_username",
            "total_inscritos", "inscrito", "creado_en", "actualizado_en",
        ]
        read_only_fields = ["creado_por", "creado_en", "actualizado_en"]

    def validate_titulo(self, value):
        if not value.strip():
            raise serializers.ValidationError("El título es obligatorio.")
        return value


class EventoInscripcionSerializer(serializers.ModelSerializer):
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    evento_titulo = serializers.CharField(source="evento.titulo", read_only=True)
    # Resultado del alumno en el evento (null si no se ha capturado). Se
    # escribe por la acción /inscripciones-evento/{id}/resultado/, no aquí.
    torneo = TorneoSerializer(read_only=True)

    class Meta:
        model = EventoInscripcion
        fields = [
            "id", "evento", "evento_titulo", "alumno", "alumno_nombre",
            "fecha_inscripcion", "asistio", "torneo",
        ]
        read_only_fields = ["fecha_inscripcion"]
        extra_kwargs = {"alumno": {"required": False}}
        # Sin esto, DRF genera un UniqueTogetherValidator a partir del
        # UniqueConstraint del modelo que vuelve a forzar 'alumno' como
        # obligatorio (para poder validar la unicidad en Python), pisando el
        # required=False de arriba. La unicidad ya se cubre en
        # EventoInscripcionViewSet.create() capturando el IntegrityError.
        validators = []


# ---------------------------------------------------------------------------
# Evaluación MMA
# ---------------------------------------------------------------------------

class HabilidadMMASerializer(serializers.ModelSerializer):
    class Meta:
        model = HabilidadMMA
        fields = ["id", "categoria", "nombre", "orden", "activa"]


class CategoriaMMASerializer(serializers.ModelSerializer):
    """Catálogo con sus habilidades activas anidadas: es lo que pinta el formulario."""

    habilidades = HabilidadMMASerializer(many=True, read_only=True)

    class Meta:
        model = CategoriaMMA
        fields = ["id", "clave", "nombre", "puntos_maximos", "orden", "activa", "habilidades"]


class PuntajeHabilidadMMASerializer(serializers.ModelSerializer):
    # Solo habilidades activas: una dada de baja no se puede calificar en una
    # evaluación nueva (las viejas que la tengan se conservan).
    habilidad = serializers.PrimaryKeyRelatedField(
        queryset=HabilidadMMA.objects.filter(activa=True)
    )
    habilidad_nombre = serializers.CharField(source="habilidad.nombre", read_only=True)
    categoria = serializers.IntegerField(source="habilidad.categoria_id", read_only=True)

    class Meta:
        model = PuntajeHabilidadMMA
        fields = ["habilidad", "habilidad_nombre", "categoria", "puntaje"]
        # La unicidad (evaluacion, habilidad) se valida en
        # EvaluacionMMASerializer.validate_puntajes sobre la lista completa.
        validators = []


class EvaluacionMMASerializer(serializers.ModelSerializer):
    """
    Evaluación con sus puntajes anidados (escritura y lectura). En la lectura
    se agregan las cifras derivadas — categorias, puntaje_total, nivel,
    preparacion, completa — calculadas en core/evaluacion_mma.py; nunca se
    guardan.
    """

    puntajes = PuntajeHabilidadMMASerializer(many=True)
    alumno_nombre = serializers.CharField(source="alumno.nombre_completo", read_only=True)
    evaluador_nombre = serializers.CharField(
        source="evaluador.nombre", read_only=True, default=""
    )
    creado_por_username = serializers.CharField(
        source="creado_por.username", read_only=True, default=""
    )
    estado_display = serializers.CharField(source="get_estado_display", read_only=True)

    class Meta:
        model = EvaluacionMMA
        fields = [
            "id", "alumno", "alumno_nombre", "evaluador", "evaluador_nombre",
            "fecha", "estado", "estado_display", "notas", "puntajes",
            "creado_por", "creado_por_username", "creado_en", "actualizado_en",
        ]
        read_only_fields = ["creado_por", "creado_en", "actualizado_en"]
        # Mismo motivo que EventoInscripcionSerializer: el UniqueTogetherValidator
        # automático (alumno, fecha) forzaría 'fecha' como obligatoria pese a
        # tener default. El duplicado se revisa en validate() con mensaje claro.
        validators = []

    # El catálogo se consulta una vez por petición y se comparte entre todas
    # las evaluaciones de un listado (el ListSerializer comparte el context).
    def _categorias(self):
        ctx = self.context
        if "categorias_mma" not in ctx:
            ctx["categorias_mma"] = cargar_categorias()
        return ctx["categorias_mma"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.update(calcular_evaluacion(instance, self._categorias()))
        return data

    # --- Validaciones ------------------------------------------------------

    def validate_fecha(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("La fecha de evaluación no puede ser futura.")
        return value

    def validate_puntajes(self, value):
        if not value:
            raise serializers.ValidationError("Captura al menos una habilidad.")
        ids = [p["habilidad"].id for p in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Hay habilidades repetidas en la evaluación.")
        return value

    def validate(self, attrs):
        instancia = self.instance

        if instancia is not None and "alumno" in attrs and attrs["alumno"].id != instancia.alumno_id:
            raise serializers.ValidationError(
                {"alumno": "Una evaluación no se puede reasignar a otro alumno."}
            )

        alumno = attrs.get("alumno", getattr(instancia, "alumno", None))
        fecha = attrs.get("fecha", getattr(instancia, "fecha", None) or timezone.localdate())
        if alumno is not None:
            repetida = EvaluacionMMA.objects.filter(alumno=alumno, fecha=fecha)
            if instancia is not None:
                repetida = repetida.exclude(pk=instancia.pk)
            if repetida.exists():
                raise serializers.ValidationError(
                    {"fecha": "Este alumno ya tiene una evaluación en esa fecha. "
                              "Edítala en vez de crear otra, o elige otra fecha."}
                )

        estado = attrs.get("estado", getattr(instancia, "estado", EvaluacionMMA.Estado.FINALIZADA))
        if estado == EvaluacionMMA.Estado.FINALIZADA:
            # Puntajes efectivos: los que llegan; en un PATCH sin puntajes, los ya guardados.
            if "puntajes" in attrs:
                calificadas = {p["habilidad"].id for p in attrs["puntajes"]}
            elif instancia is not None:
                calificadas = set(instancia.puntajes.values_list("habilidad_id", flat=True))
            else:
                calificadas = set()
            faltan = [
                h.nombre
                for cat in self._categorias()
                for h in cat.habilidades.all()
                if h.id not in calificadas
            ]
            if faltan:
                muestra = ", ".join(faltan[:4]) + ("…" if len(faltan) > 4 else "")
                raise serializers.ValidationError(
                    {"estado": f"Para finalizar hay que calificar todas las habilidades. "
                               f"Faltan {len(faltan)}: {muestra}. Guárdala como borrador si "
                               f"aún no terminas."}
                )
        return attrs

    # --- Escritura anidada ---------------------------------------------------

    def _guardar_puntajes(self, evaluacion, puntajes):
        PuntajeHabilidadMMA.objects.bulk_create(
            [
                PuntajeHabilidadMMA(
                    evaluacion=evaluacion, habilidad=p["habilidad"], puntaje=p["puntaje"]
                )
                for p in puntajes
            ]
        )

    @transaction.atomic
    def create(self, validated_data):
        puntajes = validated_data.pop("puntajes")
        evaluacion = super().create(validated_data)
        self._guardar_puntajes(evaluacion, puntajes)
        return evaluacion

    @transaction.atomic
    def update(self, instance, validated_data):
        puntajes = validated_data.pop("puntajes", None)
        evaluacion = super().update(instance, validated_data)
        if puntajes is not None:
            # Se reemplaza la lista completa: es lo que manda el formulario.
            evaluacion.puntajes.all().delete()
            self._guardar_puntajes(evaluacion, puntajes)
        return evaluacion
