"""Rutas de la API."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import auth_views, views

router = DefaultRouter()
router.register("alumnos", views.AlumnoViewSet)
router.register("maestros", views.MaestroViewSet)
router.register("usuarios", views.UsuarioAdministrativoViewSet, basename="usuario")
router.register("horarios", views.HorarioViewSet)
router.register("disciplinas", views.DisciplinaViewSet)
router.register("membresias", views.MembresiaViewSet)
router.register("categorias-peso", views.CategoriaPesoViewSet)
router.register("pagos", views.PagoViewSet)
router.register("ventas", views.VentaViewSet)
router.register("experiencias", views.ExperienciaViewSet)
router.register("asistencias", views.AsistenciaViewSet)
router.register("notificaciones", views.NotificacionViewSet)
router.register("avisos", views.AvisoViewSet)
router.register("torneos", views.TorneoViewSet)
router.register("grados", views.GradoViewSet)
router.register("insignias", views.InsigniaViewSet)
router.register("eventos", views.EventoViewSet)
router.register("inscripciones-evento", views.EventoInscripcionViewSet)
router.register("categorias-mma", views.CategoriaMMAViewSet)
router.register("evaluaciones-mma", views.EvaluacionMMAViewSet)

urlpatterns = [
    # Autenticación y rol
    path("auth/login/", auth_views.login, name="login"),
    path("auth/logout/", auth_views.logout, name="logout"),
    path("auth/yo/", auth_views.yo, name="yo"),
    path("auth/cambiar-password/", auth_views.cambiar_password, name="cambiar-password"),

    path("dashboard/", views.dashboard, name="dashboard"),
    path("", include(router.urls)),
]
