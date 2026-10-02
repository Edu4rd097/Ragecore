"""
Modelos de la academia de MMA / Box / deportes de contacto.
Cada clase corresponde a una tabla del documento de diseño.
"""
import uuid
from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import IntegrityError, models
from django.utils import timezone


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def generar_imagen_qr(texto: str) -> ContentFile:
    """Genera un PNG de código QR a partir de un texto y lo devuelve como archivo."""
    import qrcode

    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(texto)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    return ContentFile(buffer.getvalue(), name=f"{texto}.png")


def crear_cuenta_acceso(instancia, email: str = "", nombre: str = "", apellidos: str = ""):
    """
    Crea la cuenta (User) con la que un Alumno o Maestro recién dado de alta
    entra a la app y la liga en `instancia.usuario`.

    - Usuario: "<prefijo>-<id>" (alumno-12, maestro-3). El username es único
      y el correo NO (hermanos con el mismo tutor comparten correo), por eso
      no se usa el correo como username.
    - Contraseña: settings.PASSWORD_INICIAL, guardada con el hash de Django
      (nunca en texto plano). El dueño la cambia en Mi perfil → Seguridad.

    La dispara core.signals al crear el registro; core.serializers la usa
    como respaldo para registros viejos que aún no tenían cuenta.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()
    base = f"{instancia.PREFIJO_USUARIO}-{instancia.pk}"
    username, n = base, 1
    while User.objects.filter(username=username).exists():  # datos migrados a mano, etc.
        n += 1
        username = f"{base}-{n}"
    usuario = User(username=username, email=email or "", first_name=nombre, last_name=apellidos)
    usuario.set_password(settings.PASSWORD_INICIAL)
    usuario.save()
    instancia.usuario = usuario
    instancia.save(update_fields=["usuario"])
    return usuario


class TimeStampedModel(models.Model):
    """Mixin con marcas de tiempo de creación y actualización."""

    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Horario
# ---------------------------------------------------------------------------

class Horario(TimeStampedModel):
    class Turno(models.TextChoices):
        MATUTINO = "MATUTINO", "Matutino"
        VESPERTINO = "VESPERTINO", "Vespertino"
        NOCTURNO = "NOCTURNO", "Nocturno"
        MIXTO = "MIXTO", "Mixto"

    DIAS_SEMANA = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]

    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()
    turno = models.CharField(max_length=20, choices=Turno.choices, default=Turno.MATUTINO)
    dias = models.JSONField(
        default=list,
        help_text='Lista de días, ej. ["lunes", "miercoles", "viernes"]',
    )
    # Qué clase se imparte en la franja, tal como sale en el cartel de
    # horarios ("Striking", "Jiu Jitsu Kids / Striking Kids"). Es texto libre
    # a propósito: la disciplina puede cambiar según el día dentro de la misma
    # hora y una relación Horario↔Disciplina por día sería sobreingeniería.
    nombre = models.CharField(
        max_length=80,
        blank=True,
        help_text="Clase que se da en esta franja, ej. 'Striking' o 'Jiu Jitsu Kids / Striking Kids'.",
    )

    class Meta:
        verbose_name = "Horario"
        verbose_name_plural = "Horarios"
        ordering = ["hora_inicio"]
        constraints = [
            models.UniqueConstraint(
                fields=["hora_inicio", "hora_fin", "turno"],
                name="horario_unico",
            )
        ]

    def __str__(self):
        base = f"{self.get_turno_display()} {self.hora_inicio:%H:%M}-{self.hora_fin:%H:%M}"
        return f"{base} · {self.nombre}" if self.nombre else base


# ---------------------------------------------------------------------------
# Disciplina
# ---------------------------------------------------------------------------

class Disciplina(TimeStampedModel):
    nombre = models.CharField(max_length=80, unique=True)
    descripcion = models.TextField(blank=True)

    class Meta:
        verbose_name = "Disciplina"
        verbose_name_plural = "Disciplinas"
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


# ---------------------------------------------------------------------------
# Membresia
# ---------------------------------------------------------------------------

class Membresia(TimeStampedModel):
    nombre = models.CharField(max_length=60, unique=True)
    duracion_dias = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    descripcion = models.TextField(
        blank=True,
        help_text="Qué incluye el plan, ej. '1 disciplina, horario fijo'.",
    )

    class Meta:
        verbose_name = "Membresía"
        verbose_name_plural = "Membresías"
        ordering = ["duracion_dias"]

    def __str__(self):
        return f"{self.nombre} ({self.duracion_dias} días)"


# ---------------------------------------------------------------------------
# Maestro
# ---------------------------------------------------------------------------

class Maestro(TimeStampedModel):
    PREFIJO_USUARIO = "maestro"  # username de la cuenta automática: maestro-<id>

    # Cuenta de acceso a la PWA, igual que Alumno.usuario. La crea sola la
    # señal core.signals.crear_cuenta al dar de alta; queda nula solo en
    # registros viejos o si un admin desliga la cuenta a mano.
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maestro",
        help_text="Cuenta con la que el maestro entra a la app.",
    )
    nombre = models.CharField(max_length=120)
    edad = models.PositiveSmallIntegerField(null=True, blank=True)
    telefono = models.CharField(max_length=20, blank=True)
    foto = models.ImageField(upload_to="maestros/fotos/", null=True, blank=True)
    codigo_qr = models.CharField(max_length=64, unique=True, editable=False, blank=True)
    qr_imagen = models.ImageField(upload_to="maestros/qr/", null=True, blank=True, editable=False)
    activo = models.BooleanField(default=True)

    disciplinas = models.ManyToManyField(
        Disciplina, through="MaestroDisciplina", related_name="maestros"
    )

    # --- Alcance: qué alumnos ve/evalúa/notifica este maestro -------------
    # Lo decide el administrativo al dar de alta o editar al maestro, por
    # grupos completos (Horario es el "grupo" del sistema: Mañana, Tarde...)
    # y/o alumnos sueltos. Las disciplinas de arriba son solo catálogo (qué
    # imparte); NO dan visibilidad. Todo el backend acota al maestro con
    # alumnos_a_cargo() — nunca se confía en filtros del cliente.
    horarios = models.ManyToManyField(
        Horario,
        blank=True,
        related_name="maestros",
        verbose_name="grupos asignados",
        help_text="El maestro ve a todos los alumnos activos de estos horarios.",
    )
    alumnos_asignados = models.ManyToManyField(
        "Alumno",
        blank=True,
        related_name="maestros_asignados",
        verbose_name="alumnos asignados individualmente",
        help_text="Alumnos sueltos que el maestro ve además de los de sus grupos.",
    )

    class Meta:
        verbose_name = "Maestro"
        verbose_name_plural = "Maestros"
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre

    def save(self, *args, **kwargs):
        if not self.codigo_qr:
            self.codigo_qr = f"MST-{uuid.uuid4().hex[:12].upper()}"
        super().save(*args, **kwargs)
        if not self.qr_imagen:
            self.qr_imagen.save(
                f"{self.codigo_qr}.png", generar_imagen_qr(self.codigo_qr), save=True
            )

    def alumnos_a_cargo(self):
        """
        Queryset de Alumno dentro del alcance del maestro: los de sus grupos
        (horarios) más los asignados individualmente. Es la ÚNICA definición
        de "sus alumnos"; las vistas la usan como `alumno__in=...` o
        `pk__in=...` para que el backend nunca devuelva alumnos ajenos.
        """
        return Alumno.objects.filter(
            models.Q(horario__in=self.horarios.values("pk"))
            | models.Q(pk__in=self.alumnos_asignados.values("pk"))
        )

    def tiene_a_cargo(self, alumno) -> bool:
        """¿Este alumno está dentro del alcance del maestro?"""
        alumno_id = getattr(alumno, "pk", alumno)
        return self.alumnos_a_cargo().filter(pk=alumno_id).exists()


class MaestroDisciplina(models.Model):
    """Tabla intermedia Maestro <-> Disciplina."""

    maestro = models.ForeignKey(Maestro, on_delete=models.CASCADE, related_name="asignaciones")
    disciplina = models.ForeignKey(
        Disciplina, on_delete=models.CASCADE, related_name="asignaciones"
    )
    fecha_inicio = models.DateField(default=timezone.localdate)
    es_titular = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Disciplina del maestro"
        verbose_name_plural = "Disciplinas del maestro"
        constraints = [
            models.UniqueConstraint(
                fields=["maestro", "disciplina"], name="maestro_disciplina_unica"
            )
        ]

    def __str__(self):
        return f"{self.maestro} -> {self.disciplina}"


# ---------------------------------------------------------------------------
# Alumno
# ---------------------------------------------------------------------------

class Alumno(TimeStampedModel):
    PREFIJO_USUARIO = "alumno"  # username de la cuenta automática: alumno-<id>

    # Cuenta de acceso a la PWA. La crea sola la señal
    # core.signals.crear_cuenta al dar de alta (usuario alumno-<id>,
    # contraseña inicial settings.PASSWORD_INICIAL); queda nula solo en
    # registros viejos o si un admin desliga la cuenta a mano.
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="alumno",
        help_text="Cuenta con la que el alumno entra a la app.",
    )
    nombres = models.CharField(max_length=120)
    apellidos = models.CharField(max_length=120)
    apodo = models.CharField(
        max_length=60, blank=True, help_text="Nombre de peleador, tipo Tapology"
    )
    edad = models.PositiveSmallIntegerField(null=True, blank=True)
    peso_actual = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True, help_text="En kilogramos"
    )
    estatura = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="En centímetros"
    )
    telefono = models.CharField(max_length=20, blank=True)
    foto = models.ImageField(upload_to="alumnos/fotos/", null=True, blank=True)

    codigo_qr = models.CharField(max_length=64, unique=True, editable=False, blank=True)
    qr_imagen = models.ImageField(upload_to="alumnos/qr/", null=True, blank=True, editable=False)

    fecha_registro = models.DateField(default=timezone.localdate)
    horario = models.ForeignKey(
        Horario, on_delete=models.SET_NULL, null=True, blank=True, related_name="alumnos"
    )
    membresia = models.ForeignKey(
        Membresia, on_delete=models.SET_NULL, null=True, blank=True, related_name="alumnos"
    )
    activo = models.BooleanField(default=True)
    puntos = models.IntegerField(default=0)

    disciplinas = models.ManyToManyField(
        Disciplina, through="AlumnoDisciplina", related_name="alumnos"
    )
    insignias = models.ManyToManyField(
        "Insignia", through="AlumnoInsignia", related_name="alumnos"
    )

    class Meta:
        verbose_name = "Alumno"
        verbose_name_plural = "Alumnos"
        ordering = ["apellidos", "nombres"]
        indexes = [
            models.Index(fields=["activo"]),
            models.Index(fields=["codigo_qr"]),
        ]

    def __str__(self):
        base = f"{self.nombres} {self.apellidos}"
        return f'{base} "{self.apodo}"' if self.apodo else base

    @property
    def nombre_completo(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()

    def save(self, *args, **kwargs):
        if not self.codigo_qr:
            self.codigo_qr = f"ALU-{uuid.uuid4().hex[:12].upper()}"
        super().save(*args, **kwargs)
        if not self.qr_imagen:
            self.qr_imagen.save(
                f"{self.codigo_qr}.png", generar_imagen_qr(self.codigo_qr), save=True
            )

    # --- Estado de pago -----------------------------------------------------

    @property
    def ultimo_pago(self):
        """
        El pago que vence más tarde: es el que marca hasta cuándo está
        cubierto. Como los pagos se encadenan (ver Pago.save), no siempre es
        el de fecha_pago más reciente — p. ej. si se captura tarde uno viejo.
        """
        return (
            self.pagos.exclude(fecha_vencimiento__isnull=True)
            .order_by("-fecha_vencimiento", "-fecha_pago", "-id")
            .first()
        ) or self.pagos.order_by("-fecha_pago", "-id").first()

    @property
    def fecha_vencimiento(self):
        pago = self.ultimo_pago
        return pago.fecha_vencimiento if pago else None

    @property
    def dias_para_vencer(self):
        venc = self.fecha_vencimiento
        return (venc - timezone.localdate()).days if venc else None

    @property
    def al_corriente(self) -> bool:
        dias = self.dias_para_vencer
        return dias is not None and dias >= 0

    @property
    def record(self) -> str:
        """Récord estilo Tapology: 'G-P-E'."""
        exp = getattr(self, "experiencia", None)
        if not exp:
            return "0-0-0"
        return f"{exp.peleas_ganadas}-{exp.peleas_perdidas}-{exp.peleas_empatadas}"


class AlumnoDisciplina(models.Model):
    """Tabla intermedia Alumno <-> Disciplina."""

    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="inscripciones")
    disciplina = models.ForeignKey(
        Disciplina, on_delete=models.CASCADE, related_name="inscripciones"
    )
    fecha_inicio = models.DateField(default=timezone.localdate)

    class Meta:
        verbose_name = "Disciplina del alumno"
        verbose_name_plural = "Disciplinas del alumno"
        constraints = [
            models.UniqueConstraint(
                fields=["alumno", "disciplina"], name="alumno_disciplina_unica"
            )
        ]

    def __str__(self):
        return f"{self.alumno} -> {self.disciplina}"


# ---------------------------------------------------------------------------
# Pago
# ---------------------------------------------------------------------------

class Pago(TimeStampedModel):
    class Metodo(models.TextChoices):
        EFECTIVO = "EFECTIVO", "Efectivo"
        TARJETA = "TARJETA", "Tarjeta"
        TRANSFERENCIA = "TRANSFERENCIA", "Transferencia"

    class Estatus(models.TextChoices):
        PAGADO = "PAGADO", "Pagado"
        VENCIDO = "VENCIDO", "Vencido"
        PENDIENTE = "PENDIENTE", "Pendiente"

    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="pagos")
    membresia = models.ForeignKey(
        Membresia, on_delete=models.SET_NULL, null=True, blank=True, related_name="pagos"
    )
    monto = models.DecimalField(max_digits=10, decimal_places=2)
    metodo = models.CharField(max_length=20, choices=Metodo.choices, default=Metodo.EFECTIVO)
    fecha_pago = models.DateField(default=timezone.localdate)
    fecha_vencimiento = models.DateField(blank=True, null=True)
    duracion = models.PositiveIntegerField(blank=True, null=True, help_text="Días cubiertos")
    estatus = models.CharField(max_length=20, choices=Estatus.choices, default=Estatus.PAGADO)
    nota = models.TextField(blank=True)
    comprobante_enviado_en = models.DateTimeField(
        null=True, blank=True, help_text="Cuándo se mandó el correo con el comprobante."
    )

    class Meta:
        verbose_name = "Pago"
        verbose_name_plural = "Pagos"
        ordering = ["-fecha_pago", "-id"]
        indexes = [models.Index(fields=["fecha_vencimiento", "estatus"])]

    def __str__(self):
        return f"{self.alumno} - ${self.monto} - {self.fecha_pago}"

    def save(self, *args, **kwargs):
        if self.membresia_id is None and self.alumno_id:
            self.membresia_id = self.alumno.membresia_id
        if not self.duracion and self.membresia_id:
            self.duracion = self.membresia.duracion_dias
        if not self.fecha_vencimiento and self.duracion:
            self.fecha_vencimiento = self.inicio_de_cobertura() + timedelta(days=self.duracion)
        self.refrescar_estatus(guardar=False)
        super().save(*args, **kwargs)

    def inicio_de_cobertura(self):
        """
        Desde cuándo cuentan los días de este pago. Los días se SUMAN: si al
        pagar el alumno aún tiene membresía vigente, el pago nuevo arranca
        donde termina la anterior (no se pierden los días que le quedaban).
        Si ya había vencido, cuenta desde la fecha de pago.

        Ej.: trimestral (90 días) pagado el 1/ene vence el 1/abr; si el
        15/feb paga otro trimestral, vence el 1/abr + 90 = 30/jun.

        Los PENDIENTE no cuentan: todavía no son dinero cobrado.
        """
        vigente = (
            Pago.objects.filter(alumno_id=self.alumno_id, fecha_vencimiento__gte=self.fecha_pago)
            .exclude(pk=self.pk)
            .exclude(estatus=self.Estatus.PENDIENTE)
            .aggregate(hasta=models.Max("fecha_vencimiento"))["hasta"]
        )
        return max(vigente, self.fecha_pago) if vigente else self.fecha_pago

    def refrescar_estatus(self, guardar: bool = True):
        if self.estatus != self.Estatus.PENDIENTE and self.fecha_vencimiento:
            vencido = self.fecha_vencimiento < timezone.localdate()
            self.estatus = self.Estatus.VENCIDO if vencido else self.Estatus.PAGADO
        if guardar:
            self.save(update_fields=["estatus"])
        return self.estatus


# ---------------------------------------------------------------------------
# Venta (otros ingresos)
# ---------------------------------------------------------------------------

class Venta(TimeStampedModel):
    """
    Cobro que NO es una membresía: inscripción, guantes, vendas, playera,
    bebida... Es una tabla aparte de Pago a propósito: Pago arrastra el ciclo
    de la membresía (vencimiento, estatus, "al corriente", recordatorios,
    comprobante por correo) y meter ahí una venta de guantes pondría al
    alumno "al corriente" o lo marcaría "vencido" sin sentido. Venta es un
    registro de caja plano: concepto, monto, método, fecha y, si aplica, a
    quién se le vendió.
    """

    concepto = models.CharField(
        max_length=120, help_text="Qué se vendió, ej. 'Inscripción' o 'Guantes 12 oz'."
    )
    monto = models.DecimalField(max_digits=10, decimal_places=2)
    metodo = models.CharField(
        max_length=20, choices=Pago.Metodo.choices, default=Pago.Metodo.EFECTIVO
    )
    fecha = models.DateField(default=timezone.localdate)
    alumno = models.ForeignKey(
        Alumno,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ventas",
        help_text="Opcional: a qué alumno se le vendió. Vacío si fue a un externo.",
    )
    nota = models.TextField(blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ventas_registradas",
    )

    class Meta:
        verbose_name = "Venta"
        verbose_name_plural = "Ventas (otros ingresos)"
        ordering = ["-fecha", "-id"]
        indexes = [models.Index(fields=["fecha"])]

    def __str__(self):
        return f"{self.concepto} - ${self.monto} - {self.fecha}"


# ---------------------------------------------------------------------------
# Experiencia
# ---------------------------------------------------------------------------

class Experiencia(TimeStampedModel):
    class Cinturon(models.TextChoices):
        BLANCO = "BLANCO", "Blanco"
        AZUL = "AZUL", "Azul"
        PURPURA = "PURPURA", "Púrpura"
        MARRON = "MARRON", "Marrón"
        NEGRO = "NEGRO", "Negro"

    class MetodoVictoria(models.TextChoices):
        KO = "KO", "KO/TKO"
        SUMISION = "SUMISION", "Sumisión"
        DECISION = "DECISION", "Decisión"

    alumno = models.OneToOneField(Alumno, on_delete=models.CASCADE, related_name="experiencia")
    bjj_cinturon = models.CharField(
        max_length=20, choices=Cinturon.choices, default=Cinturon.BLANCO
    )
    numero_torneos = models.PositiveIntegerField(default=0)
    numero_sparrings = models.PositiveIntegerField(default=0)
    peleas_ganadas = models.PositiveIntegerField(default=0)
    peleas_perdidas = models.PositiveIntegerField(default=0)
    peleas_empatadas = models.PositiveIntegerField(default=0)
    metodo_victoria_favorito = models.CharField(
        max_length=20, choices=MetodoVictoria.choices, blank=True
    )
    peso_competencia = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    lesion_activa = models.BooleanField(default=False)
    detalle_lesion = models.TextField(blank=True)
    notas_maestro = models.TextField(blank=True)
    racha_asistencia = models.PositiveIntegerField(default=0)
    racha_maxima = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Experiencia"
        verbose_name_plural = "Experiencias"

    def __str__(self):
        return f"Experiencia de {self.alumno}"

    @property
    def total_peleas(self) -> int:
        return self.peleas_ganadas + self.peleas_perdidas + self.peleas_empatadas


# ---------------------------------------------------------------------------
# Asistencia
# ---------------------------------------------------------------------------

class Asistencia(models.Model):
    class MetodoRegistro(models.TextChoices):
        QR = "QR", "Código QR"
        MANUAL = "MANUAL", "Manual (recepción)"
        APP = "APP", "Desde la app del alumno"

    PUNTOS_POR_CLASE = 10

    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="asistencias")
    disciplina = models.ForeignKey(
        Disciplina, on_delete=models.SET_NULL, null=True, blank=True, related_name="asistencias"
    )
    horario = models.ForeignKey(
        Horario, on_delete=models.SET_NULL, null=True, blank=True, related_name="asistencias"
    )
    registrada_por = models.ForeignKey(
        Maestro,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="asistencias_registradas",
    )
    fecha = models.DateField(default=timezone.localdate)
    hora_registro = models.DateTimeField(default=timezone.now)
    metodo_registro = models.CharField(
        max_length=10, choices=MetodoRegistro.choices, default=MetodoRegistro.QR
    )
    puntos_otorgados = models.PositiveIntegerField(default=PUNTOS_POR_CLASE)

    class Meta:
        verbose_name = "Asistencia"
        verbose_name_plural = "Asistencias"
        ordering = ["-fecha", "-hora_registro"]
        constraints = [
            # Evita doble check-in en la misma clase el mismo día.
            models.UniqueConstraint(
                fields=["alumno", "fecha", "disciplina", "horario"],
                name="asistencia_unica_por_clase",
            )
        ]
        indexes = [models.Index(fields=["fecha"]), models.Index(fields=["alumno", "fecha"])]

    def __str__(self):
        return f"{self.alumno} - {self.fecha}"

    def save(self, *args, **kwargs):
        # La UniqueConstraint de arriba no basta: en SQL dos NULL se consideran
        # distintos, así que un alumno sin disciplina/horario asignado podría
        # duplicar su check-in. Se valida aquí tratando NULL como valor igual.
        if self._state.adding:
            duplicado = Asistencia.objects.filter(
                alumno_id=self.alumno_id,
                fecha=self.fecha,
                disciplina_id=self.disciplina_id,
                horario_id=self.horario_id,
            ).exists()
            if duplicado:
                raise IntegrityError(
                    "Ya existe una asistencia para este alumno en esta clase y fecha."
                )
        super().save(*args, **kwargs)


# ---------------------------------------------------------------------------
# Aviso
# ---------------------------------------------------------------------------

class Aviso(TimeStampedModel):
    """
    Cabecera de una campaña de notificación creada por un administrativo
    (individual / grupo / todos). El servidor resuelve los destinatarios
    (nunca se confía en una lista mandada por el cliente) y crea una fila
    `Notificacion` por cada alumno resuelto, enlazada por `aviso` — así el
    listado/drill-down de destinatarios reutiliza `/api/notificaciones/` en
    vez de duplicar esa tabla. Ver core/avisos.py.
    """

    class TipoDestinatario(models.TextChoices):
        INDIVIDUAL = "INDIVIDUAL", "Alumno individual"
        GRUPO = "GRUPO", "Grupo (horario)"
        TODOS = "TODOS", "Todos los alumnos activos"

    class Estado(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        PROCESANDO = "PROCESANDO", "Procesando"
        ENVIADA = "ENVIADA", "Enviada"
        FALLIDA = "FALLIDA", "Fallida"
        CANCELADA = "CANCELADA", "Cancelada"

    titulo = models.CharField(max_length=150)
    mensaje = models.TextField()
    tipo_destinatario = models.CharField(max_length=12, choices=TipoDestinatario.choices)

    # Referencia resuelta según tipo_destinatario (INDIVIDUAL -> alumno,
    # GRUPO -> horario, TODOS -> ninguno). SET_NULL: si se borra el
    # alumno/horario después, el Aviso se conserva como registro de auditoría.
    alumno = models.ForeignKey(
        Alumno, on_delete=models.SET_NULL, null=True, blank=True, related_name="avisos"
    )
    horario = models.ForeignKey(
        Horario, on_delete=models.SET_NULL, null=True, blank=True, related_name="avisos"
    )

    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="avisos_creados",
    )

    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.PENDIENTE)
    total_destinatarios = models.PositiveIntegerField(default=0)
    total_enviadas = models.PositiveIntegerField(default=0)
    total_fallidas = models.PositiveIntegerField(default=0)
    procesado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Aviso"
        verbose_name_plural = "Avisos"
        ordering = ["-creado_en"]
        indexes = [models.Index(fields=["estado"])]

    def __str__(self):
        return f"{self.titulo} ({self.get_tipo_destinatario_display()})"


# ---------------------------------------------------------------------------
# Notificacion
# ---------------------------------------------------------------------------

class Notificacion(models.Model):
    class Tipo(models.TextChoices):
        PAGO_POR_VENCER = "PAGO_POR_VENCER", "Pago próximo a vencer"
        PAGO_VENCIDO = "PAGO_VENCIDO", "Pago vencido"
        RECORDATORIO_CLASE = "RECORDATORIO_CLASE", "Recordatorio de clase"
        INSIGNIA = "INSIGNIA", "Insignia obtenida"
        GRADO = "GRADO", "Nuevo grado"
        MANUAL = "MANUAL", "Aviso administrativo"

    class Canal(models.TextChoices):
        EMAIL = "EMAIL", "Email"
        PUSH = "PUSH", "Push"
        SMS = "SMS", "SMS"

    class EstadoCorreo(models.TextChoices):
        PENDIENTE = "PENDIENTE", "Pendiente"
        ENVIADO = "ENVIADO", "Enviado"
        FALLIDO = "FALLIDO", "Fallido"

    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="notificaciones")
    tipo = models.CharField(max_length=30, choices=Tipo.choices)
    titulo = models.CharField(max_length=150, blank=True)
    mensaje = models.TextField()
    fecha_envio = models.DateTimeField(default=timezone.now)
    leida = models.BooleanField(default=False)
    canal = models.CharField(max_length=10, choices=Canal.choices, default=Canal.PUSH)

    # Si esta fila nació de un Aviso masivo/individual creado por un admin.
    # Null para las que genera el sistema automáticamente (vencimientos,
    # insignias) sin pasar por ese flujo.
    aviso = models.ForeignKey(
        Aviso, on_delete=models.CASCADE, null=True, blank=True, related_name="notificaciones"
    )
    estado_correo = models.CharField(
        max_length=10, choices=EstadoCorreo.choices, default=EstadoCorreo.PENDIENTE
    )
    enviado_en = models.DateTimeField(null=True, blank=True)
    error_correo = models.TextField(blank=True)
    # Copia de Pago.fecha_vencimiento al crear un aviso de vencimiento: es la
    # clave real para no duplicar avisos/correos del mismo evento aunque el
    # comando revisar_pagos corra varias veces (ver ese comando).
    referencia_vencimiento = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name = "Notificación"
        verbose_name_plural = "Notificaciones"
        ordering = ["-fecha_envio"]
        indexes = [
            models.Index(fields=["alumno", "leida"]),
            models.Index(fields=["alumno", "tipo", "referencia_vencimiento"]),
        ]

    def __str__(self):
        return f"{self.get_tipo_display()} -> {self.alumno}"


# ---------------------------------------------------------------------------
# Torneo
# ---------------------------------------------------------------------------

class Torneo(TimeStampedModel):
    class Resultado(models.TextChoices):
        GANO = "GANO", "Ganó"
        PERDIO = "PERDIO", "Perdió"
        EMPATO = "EMPATO", "Empató"

    class Metodo(models.TextChoices):
        KO = "KO", "KO/TKO"
        SUMISION = "SUMISION", "Sumisión"
        DECISION = "DECISION", "Decisión"
        DESCALIFICACION = "DESCALIFICACION", "Descalificación"

    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="torneos")
    nombre_torneo = models.CharField(max_length=150)
    fecha = models.DateField()
    resultado = models.CharField(max_length=10, choices=Resultado.choices)
    metodo = models.CharField(max_length=20, choices=Metodo.choices, blank=True)
    disciplina = models.ForeignKey(
        Disciplina, on_delete=models.SET_NULL, null=True, blank=True, related_name="torneos"
    )
    # Evento (convocatoria) en el que se dio este resultado, cuando se captura
    # desde la lista de inscritos. Un Torneo capturado a mano en la ficha del
    # alumno lo deja en null. Si se borra el Evento, el resultado sobrevive
    # como historial del peleador.
    evento = models.ForeignKey(
        "Evento", on_delete=models.SET_NULL, null=True, blank=True, related_name="resultados"
    )
    notas = models.TextField(blank=True)

    class Meta:
        verbose_name = "Torneo"
        verbose_name_plural = "Torneos"
        ordering = ["-fecha"]
        constraints = [
            # Un alumno tiene UN resultado por evento (los torneos sueltos, sin
            # evento, no entran en la regla).
            models.UniqueConstraint(
                fields=["evento", "alumno"],
                condition=models.Q(evento__isnull=False),
                name="torneo_resultado_unico_por_evento_alumno",
            )
        ]

    def __str__(self):
        return f"{self.nombre_torneo} - {self.alumno} - {self.get_resultado_display()}"


# ---------------------------------------------------------------------------
# Categoría de peso (divisiones de MMA)
# ---------------------------------------------------------------------------

LIBRAS_POR_KG = Decimal("2.20462262")


class CategoriaPeso(models.Model):
    """
    División de peso de MMA. El límite se guarda en LIBRAS porque así lo
    definen las Reglas Unificadas (IMMAF para amateurs y las comisiones
    profesionales usan esos mismos límites); los kilos se derivan.

    Una categoría cubre desde el límite de la anterior (exclusivo) hasta el
    suyo (inclusivo). La de límite nulo es la última (superpesado).
    Se precarga en la migración 0013 y el administrativo la puede ajustar.
    """

    nombre = models.CharField(max_length=40, unique=True, help_text='Ej. "Peso pluma"')
    nombre_en = models.CharField(max_length=40, blank=True, help_text='Ej. "Featherweight"')
    limite_lb = models.DecimalField(
        max_digits=6, decimal_places=1, null=True, blank=True, unique=True,
        help_text="Peso máximo de la división en libras. Vacío = sin límite (la más pesada).",
    )
    organismo = models.CharField(
        max_length=60, default="IMMAF / FAMM", help_text="Reglamento del que sale el límite."
    )
    activa = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Categoría de peso"
        verbose_name_plural = "Categorías de peso"
        # Nulos al final: la división sin límite es la más pesada.
        ordering = [models.F("limite_lb").asc(nulls_last=True)]

    def __str__(self):
        return f"{self.nombre} (≤ {self.limite_lb} lb)" if self.limite_lb else f"{self.nombre} (sin límite)"

    @property
    def limite_kg(self):
        if self.limite_lb is None:
            return None
        return (self.limite_lb / LIBRAS_POR_KG).quantize(Decimal("0.1"))

    @classmethod
    def para_peso(cls, peso_kg):
        """(categoría, anterior) que corresponde a un peso en kg; (None, None) sin peso o sin catálogo."""
        if not peso_kg:
            return None, None
        # Se compara contra el límite en kg a 1 decimal, el mismo que se
        # muestra: quien pesa 65.8 kg ve "pluma, hasta 65.8 kg" y es pluma
        # (en libras exactas serían 145.06 y caería en ligero por 0.06 lb).
        peso = Decimal(str(peso_kg))
        anterior = None
        for categoria in cls.objects.filter(activa=True):
            if categoria.limite_lb is None or peso <= categoria.limite_kg:
                return categoria, anterior
            anterior = categoria
        return None, anterior


# ---------------------------------------------------------------------------
# Grado
# ---------------------------------------------------------------------------

class Grado(TimeStampedModel):
    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="grados")
    disciplina = models.ForeignKey(Disciplina, on_delete=models.CASCADE, related_name="grados")
    nombre_grado = models.CharField(max_length=80, help_text='Ej. "Cinta Azul", "Grado 2"')
    fecha_obtencion = models.DateField(default=timezone.localdate)
    otorgado_por = models.ForeignKey(
        Maestro, on_delete=models.SET_NULL, null=True, blank=True, related_name="grados_otorgados"
    )
    notas = models.TextField(blank=True)

    class Meta:
        verbose_name = "Grado"
        verbose_name_plural = "Grados"
        ordering = ["-fecha_obtencion"]

    def __str__(self):
        return f"{self.alumno} - {self.nombre_grado} ({self.disciplina})"


# ---------------------------------------------------------------------------
# Insignia
# ---------------------------------------------------------------------------

class Insignia(TimeStampedModel):
    """
    Catálogo de logros. El campo `criterio` define la regla de otorgamiento
    automático evaluada en core/gamificacion.py, por ejemplo:
        {"tipo": "racha", "valor": 10}
        {"tipo": "asistencias_totales", "valor": 50}
        {"tipo": "puntos", "valor": 1000}
        {"tipo": "sparrings", "valor": 1}
        {"tipo": "torneos", "valor": 3}
        {"tipo": "victorias", "valor": 5}
    """

    class TipoCriterio(models.TextChoices):
        RACHA = "racha", "Racha de asistencia"
        ASISTENCIAS = "asistencias_totales", "Asistencias totales"
        PUNTOS = "puntos", "Puntos acumulados"
        SPARRINGS = "sparrings", "Sparrings"
        TORNEOS = "torneos", "Torneos"
        VICTORIAS = "victorias", "Victorias"
        MANUAL = "manual", "Otorgada manualmente"

    nombre = models.CharField(max_length=100, unique=True)
    descripcion = models.TextField(blank=True)
    icono = models.ImageField(upload_to="insignias/", null=True, blank=True)
    criterio = models.JSONField(
        default=dict,
        blank=True,
        help_text='Ej. {"tipo": "racha", "valor": 10}',
    )
    puntos_bonus = models.PositiveIntegerField(default=0)
    activa = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Insignia"
        verbose_name_plural = "Insignias"
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


# ---------------------------------------------------------------------------
# AlumnoInsignia
# ---------------------------------------------------------------------------

class AlumnoInsignia(models.Model):
    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="insignias_ganadas")
    insignia = models.ForeignKey(Insignia, on_delete=models.CASCADE, related_name="otorgamientos")
    fecha_obtencion = models.DateField(default=timezone.localdate)

    class Meta:
        verbose_name = "Insignia del alumno"
        verbose_name_plural = "Insignias del alumno"
        ordering = ["-fecha_obtencion"]
        constraints = [
            models.UniqueConstraint(fields=["alumno", "insignia"], name="alumno_insignia_unica")
        ]

    def __str__(self):
        return f"{self.alumno} + {self.insignia}"


# ---------------------------------------------------------------------------
# Evento
# ---------------------------------------------------------------------------

class Evento(TimeStampedModel):
    """
    Torneo/seminario/examen al que los alumnos se inscriben. Distinto de
    `Torneo`: aquel es el resultado individual de UN alumno en una
    competencia ya disputada; esto es una convocatoria compartida, con lista
    de inscritos (`EventoInscripcion`), previa al evento.
    """

    class Tipo(models.TextChoices):
        TORNEO = "TORNEO", "Torneo"
        SEMINARIO = "SEMINARIO", "Seminario"
        EXAMEN = "EXAMEN", "Examen de grado"
        OTRO = "OTRO", "Otro"

    titulo = models.CharField(max_length=150)
    tipo = models.CharField(max_length=12, choices=Tipo.choices, default=Tipo.OTRO)
    fecha = models.DateField()
    lugar = models.CharField(max_length=150, blank=True)
    descripcion = models.TextField(blank=True)
    disciplina = models.ForeignKey(
        Disciplina, on_delete=models.SET_NULL, null=True, blank=True, related_name="eventos"
    )
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="eventos_creados",
    )

    class Meta:
        verbose_name = "Evento"
        verbose_name_plural = "Eventos"
        ordering = ["fecha"]

    def __str__(self):
        return f"{self.titulo} ({self.fecha})"


class EventoInscripcion(models.Model):
    """Un alumno inscrito a un Evento. `asistio` lo marca personal (admin/maestro)."""

    evento = models.ForeignKey(Evento, on_delete=models.CASCADE, related_name="inscripciones")
    alumno = models.ForeignKey(
        Alumno, on_delete=models.CASCADE, related_name="inscripciones_eventos"
    )
    fecha_inscripcion = models.DateTimeField(auto_now_add=True)
    asistio = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Inscripción a evento"
        verbose_name_plural = "Inscripciones a eventos"
        ordering = ["-fecha_inscripcion"]
        constraints = [
            models.UniqueConstraint(fields=["evento", "alumno"], name="evento_alumno_unico")
        ]

    def __str__(self):
        return f"{self.alumno} -> {self.evento}"

    @property
    def torneo(self):
        """
        Resultado del alumno en este evento — el `Torneo` ligado al Evento — o
        None si todavía no se capturó. Si el queryset trajo
        `alumno.resultados_eventos` (Prefetch en EventoInscripcionViewSet) se
        resuelve en memoria, sin una consulta por fila.
        """
        precargados = getattr(self.alumno, "resultados_eventos", None)
        if precargados is not None:
            return next((t for t in precargados if t.evento_id == self.evento_id), None)
        return Torneo.objects.filter(evento_id=self.evento_id, alumno_id=self.alumno_id).first()


# ---------------------------------------------------------------------------
# Evaluación MMA (habilidades por categoría, con historial)
# ---------------------------------------------------------------------------
#
# Distinto de `Experiencia`: aquella es la ficha técnica ACTUAL del alumno (una
# sola fila por alumno: cinturón, récord, sparrings, lesión, notas). Esto es
# la ÚNICA medición de habilidades del sistema: una evaluación PERIÓDICA y
# detallada — cada fila es una fecha, con una
# calificación 1-5 por cada habilidad del catálogo — que nunca se sobrescribe,
# para poder graficar la evolución. Los puntajes por categoría, el total
# (/100), el nivel y la preparación para competencia NO se almacenan: se
# calculan en core/evaluacion_mma.py a partir de los puntajes individuales.

class CategoriaMMA(models.Model):
    """Catálogo: Striking, Wrestling, Grappling... con su tope de puntos (suman 100)."""

    clave = models.SlugField(max_length=30, unique=True)
    nombre = models.CharField(max_length=60)
    puntos_maximos = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(100)]
    )
    orden = models.PositiveSmallIntegerField(default=0)
    activa = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Categoría MMA"
        verbose_name_plural = "Categorías MMA"
        ordering = ["orden", "id"]

    def __str__(self):
        return f"{self.nombre} ({self.puntos_maximos} pts)"


class HabilidadMMA(models.Model):
    """Catálogo: una habilidad concreta dentro de una categoría (ej. 'Jab')."""

    categoria = models.ForeignKey(
        CategoriaMMA, on_delete=models.CASCADE, related_name="habilidades"
    )
    nombre = models.CharField(max_length=80)
    orden = models.PositiveSmallIntegerField(default=0)
    activa = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Habilidad MMA"
        verbose_name_plural = "Habilidades MMA"
        ordering = ["categoria__orden", "orden", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["categoria", "nombre"], name="habilidad_mma_unica_por_categoria"
            )
        ]

    def __str__(self):
        return f"{self.categoria.nombre} · {self.nombre}"


class EvaluacionMMA(TimeStampedModel):
    class Estado(models.TextChoices):
        BORRADOR = "BORRADOR", "Borrador"
        FINALIZADA = "FINALIZADA", "Finalizada"

    alumno = models.ForeignKey(Alumno, on_delete=models.CASCADE, related_name="evaluaciones_mma")
    # Mismo criterio que Grado.otorgado_por / Asistencia.registrada_por: el
    # evaluador es un Maestro. Puede ser null si la captura un administrativo
    # que no está ligado a ningún maestro; `creado_por` guarda de todos modos
    # qué cuenta la registró (patrón de Aviso/Evento).
    evaluador = models.ForeignKey(
        Maestro,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="evaluaciones_mma",
    )
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="evaluaciones_mma_creadas",
    )
    fecha = models.DateField(default=timezone.localdate)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.FINALIZADA)
    notas = models.TextField(blank=True)

    class Meta:
        verbose_name = "Evaluación MMA"
        verbose_name_plural = "Evaluaciones MMA"
        ordering = ["-fecha", "-id"]
        indexes = [models.Index(fields=["alumno", "fecha"])]
        constraints = [
            # Dos evaluaciones del mismo alumno el mismo día son casi seguro
            # una captura duplicada. El serializer da un 400 con mensaje
            # claro; esto es la red de seguridad a nivel BD.
            models.UniqueConstraint(fields=["alumno", "fecha"], name="evaluacion_mma_unica_por_dia")
        ]

    def __str__(self):
        return f"Evaluación MMA de {self.alumno} ({self.fecha})"


class PuntajeHabilidadMMA(models.Model):
    """Calificación 1-5 de UNA habilidad dentro de UNA evaluación."""

    ESCALA = [
        (1, "No domina la técnica"),
        (2, "Ejecuta la técnica con instrucción"),
        (3, "Ejecuta correctamente sin ayuda"),
        (4, "Ejecuta contra resistencia"),
        (5, "Ejecuta efectivamente durante sparring"),
    ]
    PUNTAJE_MAXIMO = 5

    evaluacion = models.ForeignKey(
        EvaluacionMMA, on_delete=models.CASCADE, related_name="puntajes"
    )
    habilidad = models.ForeignKey(
        HabilidadMMA, on_delete=models.PROTECT, related_name="puntajes"
    )
    puntaje = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(PUNTAJE_MAXIMO)]
    )

    class Meta:
        verbose_name = "Puntaje de habilidad"
        verbose_name_plural = "Puntajes de habilidad"
        constraints = [
            models.UniqueConstraint(
                fields=["evaluacion", "habilidad"], name="puntaje_unico_por_habilidad"
            )
        ]

    def __str__(self):
        return f"{self.habilidad}: {self.puntaje}/5"
