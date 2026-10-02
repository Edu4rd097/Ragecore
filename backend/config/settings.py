"""Configuración de Django para el backend de la academia."""
from decimal import Decimal
from pathlib import Path

from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("SECRET_KEY", default="dev-inseguro-cambiar-en-produccion")
DEBUG = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="*", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Terceros
    "rest_framework",
    "rest_framework.authtoken",
    "django_filters",
    "corsheaders",
    # Propias
    "core",
    "payments",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Base de datos ---------------------------------------------------------
# Por defecto SQLite. Para PostgreSQL, define DB_ENGINE=postgresql en el .env

if config("DB_ENGINE", default="sqlite") == "postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": config("DB_NAME"),
            "USER": config("DB_USER"),
            "PASSWORD": config("DB_PASSWORD"),
            "HOST": config("DB_HOST", default="localhost"),
            "PORT": config("DB_PORT", default="5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Contraseña con la que nace toda cuenta creada por el sistema (alumno, maestro
# o usuario administrativo). Se guarda con el hash normal de Django; el dueño
# la cambia desde "Mi perfil → Seguridad" y el administrador puede
# restablecerla. Ver core.models.crear_cuenta_acceso.
PASSWORD_INICIAL = config("PASSWORD_INICIAL", default="rotoplas")

LANGUAGE_CODE = "es-mx"
TIME_ZONE = config("TIME_ZONE", default="America/Mexico_City")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Django REST Framework -------------------------------------------------

REST_FRAMEWORK = {
    # Solo Token: el frontend nunca usa cookies de sesión, y
    # SessionAuthentication exige CSRF incluso en peticiones anónimas
    # (AnonymousUser.is_active es True), lo que rompía /auth/login/.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.PaginacionEstandar",
    "PAGE_SIZE": 25,
    # Solo aplica a las vistas que declaran ScopedRateThrottle (checkout de Stripe).
    "DEFAULT_THROTTLE_RATES": {"checkout": config("THROTTLE_CHECKOUT", default="10/min")},
}

# --- CORS ------------------------------------------------------------------

CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default="", cast=Csv())

# Django exige que el Origin de las peticiones "no seguras" (POST, etc.) esté
# aquí, sin importar DEBUG — no solo en producción. El dev-server de Angular
# corre en otro puerto (4200), así que sin esto el login falla con
# "CSRF Failed: Origin checking failed".
CSRF_TRUSTED_ORIGINS = config(
    "CSRF_TRUSTED_ORIGINS", default="http://localhost:4200", cast=Csv()
)

# --- Email (notificaciones) ------------------------------------------------
# En DEBUG=True el backend de consola imprime los correos en la terminal;
# no hace falta configurar nada más para desarrollar.

EMAIL_BACKEND = config(
    "EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = config("EMAIL_HOST", default="")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
# EMAIL_USE_TLS (STARTTLS, típico puerto 587) y EMAIL_USE_SSL (TLS implícito,
# típico puerto 465) son mutuamente excluyentes — deja solo una en True.
# Algunas redes corporativas bloquean 587/STARTTLS mientras dejan pasar 465.
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", default=False, cast=bool)
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="no-responder@casabrava.local")
# Sin esto, un SMTP inalcanzable (red bloqueada, servidor caído) cuelga el
# hilo para siempre en vez de fallar y quedar registrado en Notificacion.error_correo.
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=15, cast=int)

# --- Frontend ----------------------------------------------------------------
# Para armar ligas ("Ver en la app", "Realizar pago") dentro de los correos.
FRONTEND_URL = config("FRONTEND_URL", default="http://localhost:4200")

# --- Stripe (pagos en línea) -------------------------------------------------
# Las llaves solo viven en el .env. Sin STRIPE_SECRET_KEY el checkout responde
# 503 y el resto del sistema funciona igual (pagos en caja).
STRIPE_SECRET_KEY = config("STRIPE_SECRET_KEY", default="")
STRIPE_WEBHOOK_SECRET = config("STRIPE_WEBHOOK_SECRET", default="")
STRIPE_CURRENCY = config("STRIPE_CURRENCY", default="mxn")
# Stripe rechaza sesiones por debajo de su mínimo por moneda ($10.00 MXN).
# Se valida antes de llamarle para dar un mensaje claro en vez de un 502.
STRIPE_MONTO_MINIMO = config("STRIPE_MONTO_MINIMO", default="10.00", cast=Decimal)
STRIPE_SUCCESS_URL = config("STRIPE_SUCCESS_URL", default=f"{FRONTEND_URL}/payment/success")
STRIPE_CANCEL_URL = config("STRIPE_CANCEL_URL", default=f"{FRONTEND_URL}/payment/cancel")

# Bitácora de pagos: solo ids y estatus, nunca llaves, tokens ni datos de tarjeta.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"payments": {"handlers": ["console"], "level": config("LOG_LEVEL_PAGOS", default="INFO")}},
}

# --- Seguridad en producción -----------------------------------------------
# Se activa sola al poner DEBUG=False en el .env. Requiere HTTPS en el servidor.

if not DEBUG:
    SECURE_SSL_REDIRECT = config("SECURE_SSL_REDIRECT", default=True, cast=bool)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000  # 1 año
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    # Necesario si corres detrás de Nginx o un load balancer que termina el TLS.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    # WhiteNoise sirve los estáticos sin depender de Nginx (requirements-prod.txt).
    try:
        import whitenoise  # noqa: F401

        MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")
        STORAGES = {
            "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {
                "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
            },
        }
    except ImportError:
        pass
