"""Panel de administración."""
from django.contrib import admin
from django.utils.html import format_html

from .evaluacion_mma import calcular_evaluacion
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
)

admin.site.site_header = "Academia — Panel de control"
admin.site.site_title = "Academia"
admin.site.index_title = "Administración"


class AlumnoDisciplinaInline(admin.TabularInline):
    model = AlumnoDisciplina
    extra = 1


class ExperienciaInline(admin.StackedInline):
    model = Experiencia
    can_delete = False
    extra = 0


class PagoInline(admin.TabularInline):
    model = Pago
    extra = 0
    fields = ["fecha_pago", "monto", "metodo", "fecha_vencimiento", "estatus"]
    readonly_fields = ["estatus"]


class GradoInline(admin.TabularInline):
    model = Grado
    extra = 0
    fk_name = "alumno"


@admin.register(Alumno)
class AlumnoAdmin(admin.ModelAdmin):
    list_display = [
        "nombre_completo", "apodo", "correo", "horario", "membresia",
        "puntos", "estado_pago", "activo",
    ]
    list_filter = ["activo", "horario", "membresia", "disciplinas"]
    search_fields = ["nombres", "apellidos", "apodo", "telefono", "codigo_qr", "usuario__email"]
    readonly_fields = ["codigo_qr", "vista_qr", "puntos", "creado_en", "actualizado_en", "correo"]
    inlines = [AlumnoDisciplinaInline, ExperienciaInline, PagoInline, GradoInline]
    list_per_page = 50
    fieldsets = (
        (
            "Cuenta de acceso",
            {
                "fields": ("usuario", "correo"),
                "description": (
                    "El correo vive en la cuenta (User) ligada aquí, no en el alumno. "
                    "Para capturarlo/editarlo o crear la cuenta automáticamente, hazlo "
                    "desde el panel de la app (Alumnos → abrir alumno → Datos generales) "
                    "— ahí también puedes restablecer la contraseña."
                ),
            },
        ),
        ("Identidad", {"fields": ("nombres", "apellidos", "apodo", "edad", "foto")}),
        ("Contacto", {"fields": ("telefono",)}),
        ("Físico", {"fields": ("peso_actual", "estatura")}),
        ("Academia", {"fields": ("horario", "membresia", "fecha_registro", "activo")}),
        ("Gamificación", {"fields": ("puntos",)}),
        ("Credencial QR", {"fields": ("codigo_qr", "vista_qr")}),
        ("Auditoría", {"fields": ("creado_en", "actualizado_en"), "classes": ("collapse",)}),
    )

    @admin.display(description="Pago", boolean=True)
    def estado_pago(self, obj):
        return obj.al_corriente

    @admin.display(description="Correo")
    def correo(self, obj):
        return obj.usuario.email if obj.usuario_id and obj.usuario.email else "—"

    @admin.display(description="QR")
    def vista_qr(self, obj):
        if obj.qr_imagen:
            return format_html('<img src="{}" width="140" height="140" />', obj.qr_imagen.url)
        return "—"


@admin.register(Maestro)
class MaestroAdmin(admin.ModelAdmin):
    list_display = ["nombre", "correo", "edad", "telefono", "activo"]
    list_filter = ["activo", "disciplinas", "horarios"]
    search_fields = ["nombre", "usuario__email"]
    readonly_fields = ["codigo_qr", "correo"]
    filter_horizontal = ["horarios", "alumnos_asignados"]
    inlines = [type("MaestroDisciplinaInline", (admin.TabularInline,), {"model": MaestroDisciplina, "extra": 1})]
    fieldsets = (
        (
            "Cuenta de acceso",
            {
                "fields": ("usuario", "correo"),
                "description": (
                    "El correo vive en la cuenta (User) ligada aquí, no en el maestro. "
                    "Para capturarlo/editarlo, hazlo desde el panel de la app "
                    "(Maestros → editar) — ahí también puedes restablecer la contraseña."
                ),
            },
        ),
        ("Identidad", {"fields": ("nombre", "edad", "telefono", "foto", "activo")}),
        (
            "Alcance (qué alumnos ve)",
            {
                "fields": ("horarios", "alumnos_asignados"),
                "description": (
                    "El maestro solo ve, evalúa, inscribe y notifica a los alumnos de "
                    "estos grupos (horarios) más los asignados individualmente."
                ),
            },
        ),
        ("Credencial QR", {"fields": ("codigo_qr",)}),
    )

    @admin.display(description="Correo")
    def correo(self, obj):
        return obj.usuario.email if obj.usuario_id and obj.usuario.email else "—"


@admin.register(Horario)
class HorarioAdmin(admin.ModelAdmin):
    list_display = ["__str__", "nombre", "turno", "dias", "total_alumnos"]
    list_filter = ["turno"]
    search_fields = ["nombre"]

    @admin.display(description="Alumnos")
    def total_alumnos(self, obj):
        return obj.alumnos.count()


@admin.register(Disciplina)
class DisciplinaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "total_alumnos"]
    search_fields = ["nombre"]

    @admin.display(description="Alumnos")
    def total_alumnos(self, obj):
        return obj.alumnos.count()


@admin.register(Membresia)
class MembresiaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "duracion_dias", "precio", "descripcion"]


@admin.register(CategoriaPeso)
class CategoriaPesoAdmin(admin.ModelAdmin):
    list_display = ["nombre", "nombre_en", "limite_lb", "limite_kg", "organismo", "activa"]
    list_editable = ["activa"]


@admin.register(Pago)
class PagoAdmin(admin.ModelAdmin):
    list_display = [
        "alumno", "monto", "metodo", "fecha_pago", "fecha_vencimiento", "estatus",
        "comprobante_enviado_en",
    ]
    list_filter = ["estatus", "metodo", "fecha_pago"]
    search_fields = ["alumno__nombres", "alumno__apellidos"]
    date_hierarchy = "fecha_pago"
    autocomplete_fields = ["alumno"]
    readonly_fields = ["comprobante_enviado_en"]


@admin.register(Venta)
class VentaAdmin(admin.ModelAdmin):
    list_display = ["concepto", "monto", "metodo", "fecha", "alumno", "registrado_por"]
    list_filter = ["metodo", "fecha"]
    search_fields = ["concepto", "alumno__nombres", "alumno__apellidos"]
    date_hierarchy = "fecha"
    autocomplete_fields = ["alumno"]
    readonly_fields = ["registrado_por"]

    def save_model(self, request, obj, form, change):
        if obj.registrado_por_id is None:
            obj.registrado_por = request.user
        super().save_model(request, obj, form, change)


@admin.register(Asistencia)
class AsistenciaAdmin(admin.ModelAdmin):
    list_display = ["alumno", "fecha", "disciplina", "horario", "metodo_registro", "puntos_otorgados"]
    list_filter = ["fecha", "disciplina", "metodo_registro"]
    search_fields = ["alumno__nombres", "alumno__apellidos"]
    date_hierarchy = "fecha"
    autocomplete_fields = ["alumno"]


@admin.register(Experiencia)
class ExperienciaAdmin(admin.ModelAdmin):
    list_display = ["alumno", "bjj_cinturon", "peleas_ganadas", "peleas_perdidas", "racha_asistencia"]
    list_filter = ["bjj_cinturon", "lesion_activa"]
    search_fields = ["alumno__nombres", "alumno__apellidos"]


@admin.register(Torneo)
class TorneoAdmin(admin.ModelAdmin):
    list_display = ["nombre_torneo", "alumno", "fecha", "resultado", "metodo", "evento"]
    list_filter = ["resultado", "disciplina", "fecha"]
    search_fields = ["nombre_torneo", "alumno__nombres"]
    autocomplete_fields = ["alumno", "evento"]


@admin.register(Grado)
class GradoAdmin(admin.ModelAdmin):
    list_display = ["alumno", "nombre_grado", "disciplina", "fecha_obtencion", "otorgado_por"]
    list_filter = ["disciplina", "fecha_obtencion"]
    autocomplete_fields = ["alumno"]


@admin.register(Insignia)
class InsigniaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "criterio", "puntos_bonus", "activa", "total_otorgadas"]
    list_filter = ["activa"]
    search_fields = ["nombre"]

    @admin.display(description="Otorgadas")
    def total_otorgadas(self, obj):
        return obj.otorgamientos.count()


@admin.register(AlumnoInsignia)
class AlumnoInsigniaAdmin(admin.ModelAdmin):
    list_display = ["alumno", "insignia", "fecha_obtencion"]
    list_filter = ["insignia", "fecha_obtencion"]
    autocomplete_fields = ["alumno"]


@admin.register(Notificacion)
class NotificacionAdmin(admin.ModelAdmin):
    list_display = ["alumno", "tipo", "titulo", "canal", "estado_correo", "fecha_envio", "leida"]
    list_filter = ["tipo", "canal", "estado_correo", "leida"]
    search_fields = ["alumno__nombres", "titulo", "mensaje"]
    autocomplete_fields = ["alumno"]
    readonly_fields = ["estado_correo", "enviado_en", "error_correo"]


@admin.register(Aviso)
class AvisoAdmin(admin.ModelAdmin):
    list_display = [
        "titulo", "tipo_destinatario", "estado", "total_destinatarios",
        "total_enviadas", "total_fallidas", "creado_por", "creado_en",
    ]
    list_filter = ["tipo_destinatario", "estado"]
    search_fields = ["titulo", "mensaje"]
    autocomplete_fields = ["alumno"]
    readonly_fields = [
        "creado_por", "estado", "total_destinatarios", "total_enviadas",
        "total_fallidas", "procesado_en", "creado_en", "actualizado_en",
    ]


class EventoInscripcionInline(admin.TabularInline):
    model = EventoInscripcion
    extra = 0
    autocomplete_fields = ["alumno"]


@admin.register(Evento)
class EventoAdmin(admin.ModelAdmin):
    list_display = ["titulo", "tipo", "fecha", "lugar", "disciplina", "creado_por"]
    list_filter = ["tipo", "disciplina", "fecha"]
    search_fields = ["titulo", "lugar"]
    readonly_fields = ["creado_por", "creado_en", "actualizado_en"]
    inlines = [EventoInscripcionInline]


# --- Evaluación MMA ----------------------------------------------------------

class HabilidadMMAInline(admin.TabularInline):
    model = HabilidadMMA
    extra = 1
    fields = ["nombre", "orden", "activa"]


@admin.register(CategoriaMMA)
class CategoriaMMAAdmin(admin.ModelAdmin):
    """Aquí se amplía el catálogo (habilidades nuevas) sin tocar código."""

    list_display = ["nombre", "clave", "puntos_maximos", "orden", "activa", "total_habilidades"]
    list_filter = ["activa"]
    search_fields = ["nombre", "clave"]
    inlines = [HabilidadMMAInline]

    @admin.display(description="Habilidades")
    def total_habilidades(self, obj):
        return obj.habilidades.filter(activa=True).count()


class PuntajeHabilidadMMAInline(admin.TabularInline):
    model = PuntajeHabilidadMMA
    extra = 0


@admin.register(EvaluacionMMA)
class EvaluacionMMAAdmin(admin.ModelAdmin):
    list_display = ["alumno", "fecha", "estado", "evaluador", "puntaje_total", "nivel"]
    list_filter = ["estado", "fecha", "evaluador"]
    search_fields = ["alumno__nombres", "alumno__apellidos", "alumno__apodo"]
    date_hierarchy = "fecha"
    autocomplete_fields = ["alumno", "evaluador"]
    readonly_fields = ["creado_por", "creado_en", "actualizado_en"]
    inlines = [PuntajeHabilidadMMAInline]
    list_select_related = ["alumno", "evaluador"]

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("puntajes")

    @admin.display(description="Total /100")
    def puntaje_total(self, obj):
        return calcular_evaluacion(obj)["puntaje_total"]

    @admin.display(description="Nivel")
    def nivel(self, obj):
        return calcular_evaluacion(obj)["nivel"]
