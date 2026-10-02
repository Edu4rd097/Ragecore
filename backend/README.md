# Backend — App Academia MMA / Box / Deportes de Contacto

API REST en Django + Django REST Framework que implementa el modelo de datos del documento de diseño: alumnos, maestros, membresías, pagos, asistencia por QR y gamificación con puntos e insignias.

---

## Puesta en marcha

```bash
# 1. Entorno virtual
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Dependencias
pip install -r requirements.txt         # base
# pip install -r requirements-dev.txt   # base + herramientas de desarrollo

# 3. Variables de entorno
cp .env.example .env            # edita SECRET_KEY como mínimo

# 4. Base de datos
python manage.py migrate

# 5. Catálogos base: disciplinas, planes y horarios del cartel de la academia, 10 insignias
python manage.py seed

# 6. Usuario administrador
python manage.py createsuperuser

# 7. Arrancar
python manage.py runserver
```

- API: http://localhost:8000/api/
- Admin: http://localhost:8000/admin/

Para poblar con datos de prueba: `python manage.py seed --demo --alumnos 20`

Para generar una `SECRET_KEY` válida:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

### Los tres archivos de dependencias

| Archivo | Cuándo usarlo | Qué agrega |
|---|---|---|
| `requirements.txt` | Siempre | Django, DRF, filtros, CORS, decouple, qrcode, Pillow |
| `requirements-prod.txt` | Servidor | PostgreSQL, Gunicorn, WhiteNoise, dj-database-url |
| `requirements-dev.txt` | Tu máquina | shell_plus, Swagger, pytest, coverage, ruff |

Los dos últimos incluyen al base con `-r requirements.txt`, así que instalas uno solo, no ambos. Las versiones están fijadas a las que pasaron la suite de pruebas.

### PostgreSQL

En el `.env`, cambia `DB_ENGINE=postgresql` y completa `DB_NAME`, `DB_USER`, `DB_PASSWORD`. El driver viene en `requirements-prod.txt`.

---

## Estructura

```
academia_backend/
├── config/
│   ├── settings.py          Configuración (SQLite por defecto, DRF, CORS)
│   └── urls.py              Rutas raíz
├── core/
│   ├── models.py            Las 13 tablas del documento + MaestroDisciplina
│   ├── serializers.py       Serializers DRF con validaciones
│   ├── views.py             ViewSets + endpoints de negocio
│   ├── gamificacion.py      Motor de puntos, rachas e insignias
│   ├── signals.py           Efectos automáticos al guardar
│   ├── admin.py             Panel de administración en español
│   ├── tests.py             18 pruebas
│   └── management/commands/
│       ├── seed.py          Catálogos y datos demo
│       └── revisar_pagos.py Notificaciones de vencimiento (cron diario)
├── requirements.txt         Base, versiones fijadas
├── requirements-prod.txt    PostgreSQL, Gunicorn, WhiteNoise
└── requirements-dev.txt     Swagger, pytest, coverage, ruff
```

---

## Endpoints

Todos los recursos exponen el CRUD estándar en `/api/<recurso>/`:
`alumnos`, `maestros`, `usuarios` (cuentas staff/admin), `horarios`, `disciplinas`, `membresias`, `pagos`, `ventas` (otros ingresos), `experiencias`, `asistencias`, `notificaciones`, `avisos`, `torneos`, `grados`, `insignias`, `eventos`, `inscripciones-evento`, `categorias-mma`, `evaluaciones-mma`.

### Pagos y ventas: dos registros de caja

- **`pagos`** son pagos de **membresía**. Calculan `fecha_vencimiento` con la duración del plan, fijan el `estatus` y mueven el semáforo `al_corriente` del alumno; disparan comprobante por correo y recordatorios.
- **`ventas`** son **otros ingresos** (inscripción, guantes, playera, bebida…) con `concepto` libre, monto, método, fecha y alumno opcional (vacío si fue a un externo). No tocan membresías ni vencimientos. Solo administrativo; `registrado_por` se llena solo.

Cada registro tiene su corte del mes: `GET /api/pagos/resumen/` y `GET /api/ventas/resumen/` (total, por método y, en ventas, por concepto). El `dashboard` los reporta por separado en `ingresos_mes` y `otros_ingresos_mes`.

### Catálogos del cartel

`Horario` es una franja de una hora con `nombre` de la clase que se imparte ("Striking / Funcional", "Jiu Jitsu Kids (L-Mi-V) / Striking Kids (Ma-J)"); `Membresia` lleva `descripcion` con lo que incluye el plan ("2 disciplinas, horario fijo."). El `seed` carga los 10 horarios, 7 disciplinas y 7 planes del cartel (Básica $800, Plus $1300, Premium $1800, JR $1000, Kids $1300, Semana $300, Clase $100). La inscripción ($200) no es membresía: se cobra como venta con concepto "Inscripción".

### Roles y alcance

- **Staff/Admin** (`User.is_staff`): todo.
- **Maestro** (`Maestro.usuario`): solo los alumnos a su cargo — los de los grupos (`Maestro.horarios`) que le asignó el admin más los sueltos (`Maestro.alumnos_asignados`), ver `Maestro.alumnos_a_cargo()`. Con ellos puede verlos, evaluarlos (`experiencias`, `evaluaciones-mma`), inscribirlos a eventos y mandarles `avisos` (individual o a sus grupos; nunca "todos"). El acotamiento se aplica en el queryset de cada vista, no solo en el frontend.
- **Alumno** (`Alumno.usuario`): solo lo suyo; edita sus datos personales y correo en `/api/alumnos/yo/`.

### Cuentas

Todo alumno/maestro nuevo nace con cuenta (señal `core.signals.crear_cuenta`): usuario `alumno-<id>` / `maestro-<id>` y contraseña `PASSWORD_INICIAL` (por defecto `rotoplas`, configurable en `.env`), guardada con el hash de Django. El alta (`POST`) regresa `username` y `password_inicial` una sola vez. Cada usuario cambia la suya en `POST /api/auth/cambiar-password/`; el admin la restablece con `POST /api/<alumnos|maestros|usuarios>/{id}/restablecer-password/`.

### Check-in por QR

El endpoint central de la app. No requiere autenticación para que la tablet de recepción pueda escanear sin sesión.

```http
POST /api/asistencias/checkin/
{
  "codigo_qr": "ALU-364F1A7C0D6E",
  "disciplina_id": 1,
  "horario_id": 2,      // opcional, usa el del alumno si se omite
  "maestro_id": 3       // opcional
}
```

Respuesta:

```json
{
  "detail": "Asistencia registrada para Test Peleador.",
  "alumno": {
    "id": 13, "nombre": "Test Peleador", "apodo": "El Probador",
    "puntos": 30, "al_corriente": false, "dias_para_vencer": null
  },
  "racha": 1,
  "puntos_otorgados": 10,
  "insignias_desbloqueadas": ["Primer paso"],
  "asistencia_id": 150
}
```

Códigos: `201` registrada · `400` QR desconocido · `403` alumno dado de baja · `409` ya registró esa clase hoy.

Como la respuesta trae `al_corriente` y `dias_para_vencer`, recepción ve al instante si el alumno debe pagar.

Hay otras dos formas de registrar asistencia, con la misma respuesta y las mismas reglas (baja → 403, duplicado → 409), que se distinguen por `metodo_registro`:

| Endpoint | Quién | Cómo identifica al alumno | Queda como |
|---|---|---|---|
| `POST /api/asistencias/checkin/` | Público (tablet) | `codigo_qr` | `QR` |
| `POST /api/asistencias/manual/` | Administrativo | `alumno_id` (+ `fecha` opcional, no futura) | `MANUAL` |
| `POST /api/asistencias/mi-checkin/` | El propio alumno | Su cuenta (`disciplina_id` opcional, solo en las que está inscrito) | `APP` |

### Otros endpoints de negocio

| Endpoint | Qué devuelve |
|---|---|
| `GET /api/dashboard/` | Métricas generales: alumnos, asistencias, ingresos del mes, desglose por disciplina y horario, top 5 |
| `GET /api/alumnos/{id}/perfil/` | Tarjeta completa del peleador con estadísticas y estado de pago |
| `GET /api/alumnos/ranking/?limite=20` | Tabla de posiciones por puntos |
| `GET /api/alumnos/por-vencer/?dias=5` | Alumnos cuya membresía vence pronto |
| `GET /api/alumnos/morosos/` | Alumnos activos con pago vencido o sin pagos |
| `GET /api/alumnos/{id}/qr/` | Código y URL de la imagen QR |
| `GET /api/alumnos/{id}/asistencias/` | Historial de asistencias |
| `GET /api/asistencias/hoy/` | Asistencias del día |
| `GET /api/pagos/resumen/` | Corte de membresías del mes, desglosado por método |
| `GET /api/ventas/resumen/` | Corte de otras ventas del mes, por método y por concepto |
| `POST /api/insignias/{id}/otorgar/` | Otorga una insignia manualmente (`{"alumno_id": 3}`) |
| `POST /api/notificaciones/{id}/marcar-leida/` | Marca como leída |

### Pagos en línea (Stripe)

App `payments`, montada en `/api/payments/`. El alumno paga su membresía con Stripe Checkout; el precio sale siempre de `Membresia.precio` y **solo el webhook firmado** confirma el pago, crea el `Pago` de membresía (que mueve el vencimiento) y manda el comprobante.

| Endpoint | Quién | Qué hace |
|---|---|---|
| `POST /api/payments/checkout/` | Alumno (lo suyo) · Admin (`alumno_id`) | Crea la Checkout Session y devuelve `checkout_url` |
| `GET /api/payments/sesion/?session_id=` | Dueño · Admin | Estado del pago para la pantalla de éxito |
| `GET /api/payments/` | Alumno (lo suyo) · Admin | Historial de pagos en línea |
| `GET /api/payments/dashboard/` | Admin | Tablero: cobrado hoy/mes, pendientes, serie diaria, recientes, salud del webhook y `cursor` |
| `GET /api/payments/cambios/?desde=<cursor>` | Admin | Polling en tiempo real (cada 3–5 s): lo modificado desde el cursor |
| `GET /api/payments/saldo/` | Admin | Saldo de la cuenta de Stripe, en vivo |
| `POST /api/payments/{id}/reembolsar/` | Admin | Pide el reembolso a Stripe; se confirma por webhook |
| `POST /api/payments/webhook/stripe/` | Stripe (firma) | Eventos `checkout.session.*` y `charge.refunded` |

Configura `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en el `.env` (ver `.env.example`). En local:

```bash
stripe listen --forward-to localhost:8000/api/payments/webhook/stripe/   # imprime el whsec_
```

El detalle completo (flujo, estados, idempotencia, contrato del dashboard) está en `docs/Manual_Tecnico_Backend.pdf`, que se regenera con `python docs/generar_manual.py [--logo ruta/logo.png]`.

### Filtros y búsqueda

```
GET /api/alumnos/?activo=true&horario=2&disciplinas=1
GET /api/alumnos/?search=tanque
GET /api/alumnos/?ordering=-puntos
GET /api/pagos/?estatus=VENCIDO
GET /api/asistencias/?fecha=2026-09-04&disciplina=1
```

### Autenticación

Token de DRF. Todo requiere token salvo el login, el check-in por QR y el webhook de Stripe (que exige firma):

```bash
curl -X POST http://localhost:8000/api/auth/token/ \
  -d "username=admin&password=tu-password"
# → {"token": "abc123..."}

curl http://localhost:8000/api/alumnos/ -H "Authorization: Token abc123..."
```

---

## Automatismos

Estas cosas ocurren solas, sin que el cliente tenga que orquestarlas:

- **QR único** generado al crear cada alumno y maestro (código + imagen PNG).
- **Experiencia** se crea junto con el alumno, así el perfil nunca sale vacío.
- **Vencimiento del pago** calculado desde la duración de la membresía. Si no se especifica duración, se hereda de la membresía del alumno.
- **Puntos y racha** al registrar asistencia. Si se borra una asistencia mal capturada, los puntos se devuelven.
- **Insignias** evaluadas en cada asistencia; al otorgarse suman su bono y generan notificación.
- **Récord de peleas** (`G-P-E`) recalculado desde los torneos cada vez que se agrega o borra uno.
- **Doble check-in bloqueado**: un alumno no puede registrar dos veces la misma clase el mismo día, pero sí distintas disciplinas.

### Criterios de insignias

El campo `criterio` de cada insignia es un JSON que el motor evalúa automáticamente:

```json
{"tipo": "racha", "valor": 10}
{"tipo": "asistencias_totales", "valor": 50}
{"tipo": "puntos", "valor": 1000}
{"tipo": "sparrings", "valor": 1}
{"tipo": "torneos", "valor": 3}
{"tipo": "victorias", "valor": 5}
{"tipo": "manual"}
```

Puedes crear insignias nuevas desde el admin sin tocar código.

### Tarea programada

Actualiza estatus de pagos y genera avisos de vencimiento. Conviene correrla diario:

```bash
python manage.py revisar_pagos --dias 5

# crontab, todos los días a las 8am
0 8 * * * /ruta/venv/bin/python /ruta/manage.py revisar_pagos
```

---

## Decisiones de diseño

**Racha con tolerancia.** Contar solo días calendario consecutivos castigaría a quien entrena lunes, miércoles y viernes, que es el patrón normal. La racha permite huecos de hasta 3 días entre sesiones (`TOLERANCIA_RACHA_DIAS` en `gamificacion.py`).

**Duplicados de asistencia.** La restricción de unicidad en base de datos no basta por sí sola: en SQL dos `NULL` se consideran distintos, así que un alumno sin disciplina asignada podría duplicar su check-in. Hay además una validación en `Asistencia.save()` que trata los nulos como valores iguales.

**Puntos con `F()`.** Las sumas de puntos usan expresiones `F()` en vez de leer-modificar-escribir, para que dos escaneos simultáneos no se pisen.

**Récord derivado.** `peleas_ganadas` y compañía viven en `Experiencia` como el documento indica, pero se recalculan desde `Torneo` por señal, así no se desincronizan.

**Estatus de pago calculado, no capturado.** El campo `estatus` es de solo lectura en la API; se deriva de `fecha_vencimiento`. Solo `PENDIENTE` se respeta si se fija a mano.

**MaestroDisciplina explícita.** El documento la menciona sin detallar campos; se agregó `es_titular` y `fecha_inicio` por simetría con `AlumnoDisciplina`.

**Fotos y QR con ruta relativa.** `foto` y `qr_imagen` salen como `/media/...` (`ImagenRelativa` en `serializers.py`), no como URL absoluta. DRF arma la absoluta con el host que ve Django; detrás del proxy del dev-server de Angular ese host es `127.0.0.1:8000`, que desde un celular en la misma WiFi no existe. Con la ruta relativa el navegador pide la imagen al mismo origen desde el que abrió la app, y el proxy (en desarrollo) o el servidor web (en producción) la sirve. Si en producción media vive en S3, `storage.url()` ya devuelve la URL absoluta del bucket.

---

## Pruebas

```bash
python manage.py test
```

18 pruebas que cubren generación de QR, cálculo de vencimientos, puntos, rachas, otorgamiento de insignias, sincronización del récord y los endpoints de check-in y dashboard.

---

## Antes de producción

Las banderas de seguridad (HSTS, cookies seguras, redirección a HTTPS, `X-Frame-Options`) ya están configuradas en `settings.py` y **se activan solas** al poner `DEBUG=False`. Con eso, `python manage.py check --deploy` sale limpio.

Lo que sí queda de tu lado:

```bash
pip install -r requirements-prod.txt
```

- `DEBUG=False` y una `SECRET_KEY` real en el `.env`
- `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS` acotados a tus dominios
- `DB_ENGINE=postgresql` en vez de SQLite
- `python manage.py collectstatic` (WhiteNoise se enchufa solo si está instalado)
- Arrancar con `gunicorn config.wsgi:application --bind 0.0.0.0:8000`
- Servir media desde S3 o similar; los QR y fotos hoy van al disco local, que se pierde en cada redespliegue
- Cambiar el `EMAIL_BACKEND` de consola a uno real si vas a enviar notificaciones por correo
- Programar `revisar_pagos` en cron
- El endpoint de check-in es público por diseño; si la tablet no está en red cerrada, protégelo con un token de dispositivo
