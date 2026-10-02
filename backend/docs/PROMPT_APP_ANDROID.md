# Prompt: app Android nativa de Casa Brava (Android Studio + Kotlin + Gradle)

> Copia todo lo que está debajo de la línea y pégalo en tu agente de código (Claude Code, Gemini en Android Studio, Copilot, etc.) dentro de un proyecto nuevo de Android Studio.

---

Eres un ingeniero Android senior. Construye una **app Android nativa** para **Casa Brava**, una academia de MMA, box y deportes de contacto. La app consume **la misma API REST de Django** que ya usa el frontend web en Angular. Usa **exactamente los mismos endpoints, campos JSON, reglas de roles y flujos**. **No inventes endpoints ni campos.** Si algo no está en este documento, no existe en el backend: resuélvelo en el cliente o déjalo como un `TODO` explícito.

## 1. Stack obligatorio

- **IDE y build:** Android Studio (versión estable más reciente), Gradle con **Kotlin DSL** (`build.gradle.kts`) y **version catalog** (`gradle/libs.versions.toml`). Kotlin 2.x con el compilador de Compose.
- **SDK:** `minSdk 26`, `targetSdk` y `compileSdk` en la versión estable más reciente.
- **UI:** Jetpack Compose + Material 3, Navigation Compose, tema claro y oscuro.
- **Arquitectura:** MVVM con capas `data` / `domain` / `ui`, repositorios, `UiState` inmutable con `StateFlow`, un único `NavHost`.
- **Inyección de dependencias:** Hilt.
- **Red:** Retrofit + OkHttp + `kotlinx.serialization` (`ignoreUnknownKeys = true`, `explicitNulls = false`), interceptor de autenticación, `HttpLoggingInterceptor` solo en debug.
- **Asincronía:** Coroutines + Flow. Listas largas con **Paging 3**.
- **Persistencia local:** DataStore para preferencias. El token se guarda **cifrado con Android Keystore** (por ejemplo DataStore + Tink AEAD). Room es opcional, como caché de notificaciones.
- **Imágenes:** Coil 3.
- **Escaneo QR:** CameraX + ML Kit Barcode Scanning.
- **Tareas en segundo plano:** WorkManager.
- **Gráficas:** Vico (Compose).
- **Pagos:** Chrome Custom Tabs (`androidx.browser`). **No** uses el SDK de Stripe ni ninguna llave de Stripe en la app.
- **Pruebas:** JUnit, MockK, Turbine, MockWebServer y pruebas de UI con Compose.

## 2. Conexión con el backend

- **URL base por build type**, definida en `BuildConfig.API_BASE_URL`:
  - `debug` en emulador: `http://10.0.2.2:8001/api/`
  - `debug` en celular físico: `http://<IP-LAN-de-la-PC>:8001/api/`. Hazla configurable con una propiedad de Gradle, por ejemplo `-PapiUrl=`.
  - `release`: `https://api.casabrava.mx/api/` (placeholder).
- **`network_security_config.xml`**: permite tráfico HTTP sin cifrar **solo en debug** y solo para `10.0.2.2` y la IP de la LAN. En release, HTTPS obligatorio.
- **Autenticación:** encabezado `Authorization: Token <token>`. **Es `Token`, no `Bearer`.** No hay cookies, CSRF ni refresh token.
- **Error 401** en cualquier llamada autenticada: borra el token y navega al login.
- **Paginación estándar:** `{"count": Int, "next": String?, "previous": String?, "results": [...]}` con `?page=N&page_size=M` (25 por defecto, máximo 500). Crea un `PagingSource` genérico.
- **Endpoints que devuelven un arreglo plano, sin paginar:**
  - `/alumnos/ranking/`, `/alumnos/por-vencer/`, `/alumnos/morosos/`
  - `/alumnos/{id}/asistencias/`, `/alumnos/{id}/insignias/`, `/alumnos/{id}/pagos/`, `/alumnos/{id}/evaluacion-historial/`
  - `/asistencias/hoy/`, `/horarios/{id}/alumnos/`, `/categorias-peso/`
- **Dinero:** en los recursos llega como string (`"800.00"`), pero en resúmenes y dashboards llega como número (`41100.0`). Escribe un `KSerializer<BigDecimal>` que acepte los dos formatos. **Nunca uses `Float` ni `Double` para dinero.** Formato de pantalla `$1,234.00 MXN` con locale `es-MX`.
- **Fechas:**
  - Fecha: `"YYYY-MM-DD"` → `LocalDate`.
  - Fecha y hora: ISO-8601 con zona (`2026-09-09T11:46:18.772557-06:00`) → `OffsetDateTime`.
  - Hora: `"HH:MM:SS"` → `LocalTime`.
  - Zona de negocio: `America/Mexico_City`.
- **Imágenes:** `foto`, `qr_imagen` e `icono` llegan como **ruta relativa** (`/media/alumnos/qr/ALU-XXXX.png`). Antepón el origen del servidor, que es la URL base **sin** `/api/`. Si ya empiezan con `http`, úsalas tal cual.
- **Formato de errores de DRF:** `{"detail": "mensaje"}` o, en validaciones, `{"campo": ["mensaje", ...], "non_field_errors": [...]}`. Muestra cada error de campo bajo su input y `detail` en un Snackbar.
- **Códigos de estado:**

  | Código | Significado |
  |---|---|
  | 200 / 201 | Correcto / creado |
  | 202 | Aceptado, se confirma después (reembolso de Stripe) |
  | 204 | Borrado |
  | 400 | Datos inválidos |
  | 401 | Sin sesión |
  | 403 | Sin permiso o fuera de alcance |
  | 404 | No existe o no es visible para el rol |
  | 409 | Check-in duplicado |
  | 429 | Demasiados intentos de pago |
  | 502 | Stripe no respondió |
  | 503 | Pagos en línea sin configurar |

## 3. Autenticación y roles

**Login:** `POST auth/login/` con `{"username": "...", "password": "..."}`. El campo `username` acepta usuario **o** correo.

```json
200 {"token": "…", "usuario": {"id": 19, "username": "alumno-55", "email": "…", "nombre": "…",
     "rol": "ALUMNO", "alumno_id": 55, "maestro_id": null, "alumno": { …AlumnoDetalle… }}}
401 {"detail": "Usuario o contraseña incorrectos."}      403 cuenta desactivada
```

- **Valores de `rol`:** `ADMINISTRATIVO` | `MAESTRO` | `ALUMNO` | `SIN_ROL`. Con `SIN_ROL`, muestra "Tu cuenta no tiene acceso" y un botón de cerrar sesión.
- El objeto `usuario` trae `alumno` si el rol es ALUMNO y `maestro` si es MAESTRO.
- **Al abrir la app** con token guardado: `GET auth/yo/` (misma forma que `usuario`) para rehidratar la sesión y el rol.
- **Cerrar sesión:** `POST auth/logout/`. Después borra el token.
- **Cambiar contraseña:** `POST auth/cambiar-password/` con `{"actual", "nueva"}` (mínimo 8 caracteres). Responde `{"detail", "token"}`: **reemplaza el token guardado** con el nuevo.
- Las cuentas de alumno y maestro nacen como `alumno-<id>` / `maestro-<id>` con una contraseña inicial. Sugiere cambiarla en el primer ingreso.

**Qué puede hacer cada rol.** El backend ya filtra: la app solo oculta lo que el rol no puede usar.

| Rol | Alcance |
|---|---|
| ADMINISTRATIVO (`is_staff`) | Todo. |
| MAESTRO | Solo sus **alumnos a cargo** (sus grupos más alumnos sueltos). Ve alumnos, edita su ficha técnica y su Evaluación MMA, crea eventos, inscribe alumnos, pasa lista, captura resultados y manda avisos individuales o a sus grupos (**nunca a "todos"**). **No** ve pagos, ventas ni el dashboard. |
| ALUMNO | Solo lo suyo. Edita sus datos personales, hace check-in desde la app, se inscribe o cancela en eventos y paga su membresía en línea. |

## 4. Modelos (DTOs `@Serializable`)

Modela **exactamente** estos campos. Los enums van como `String` con un mapeo tolerante a valores desconocidos.

- **AlumnoLista:** `id, nombres, apellidos, nombre_completo, apodo, foto?, activo, puntos, record ("G-P-E"), horario?, horario_display, membresia?, membresia_nombre?, al_corriente, dias_para_vencer?`
- **AlumnoDetalle:** `id, nombres, apellidos, nombre_completo, apodo, edad?, peso_actual? (string decimal), estatura? (int, cm), telefono, tiene_cuenta, foto?, codigo_qr, qr_imagen, fecha_registro, horario?, membresia?, activo, puntos, experiencia{Experiencia}, inscripciones[{id, alumno, disciplina, disciplina_nombre, fecha_inicio}], insignias_ganadas[{id, alumno, insignia, insignia_nombre, insignia_icono?, fecha_obtencion}], al_corriente, dias_para_vencer?, fecha_vencimiento?, record, total_asistencias, creado_en, email, username`
- **Perfil** (`alumnos/{id}/perfil/`): `{alumno: AlumnoDetalle, estadisticas{record, total_asistencias, asistencias_mes, racha_actual, racha_maxima, total_insignias, total_grados}, pago{al_corriente, fecha_vencimiento?, dias_para_vencer?}}`
- **Experiencia:** `id, alumno, bjj_cinturon (BLANCO|AZUL|PURPURA|MARRON|NEGRO), bjj_cinturon_display, numero_torneos, numero_sparrings, peleas_ganadas, peleas_perdidas, peleas_empatadas, total_peleas, metodo_victoria_favorito (""|KO|SUMISION|DECISION), peso_competencia?, lesion_activa, detalle_lesion, notas_maestro, racha_asistencia, racha_maxima`
- **Maestro:** `id, nombre, edad?, telefono, tiene_cuenta, foto?, activo, codigo_qr, qr_imagen, asignaciones[{id, maestro, disciplina, disciplina_nombre, fecha_inicio, es_titular}], horarios[{id, nombre}], alumnos_asignados[], total_alumnos, email, username`
  - Escritura: `nombre, edad, telefono, email, foto, activo, disciplinas_ids[], horarios_ids[], alumnos_ids[]`
- **UsuarioAdmin:** `id, username, first_name, last_name, nombre, email, is_active, is_superuser, last_login?, date_joined`
- **Horario:** `id, hora_inicio, hora_fin, turno (MATUTINO|VESPERTINO|NOCTURNO|MIXTO), turno_display, dias ["lunes", …, "domingo"], nombre, total_alumnos`
- **Disciplina:** `id, nombre, descripcion, total_alumnos`
- **Membresia:** `id, nombre, duracion_dias, precio, descripcion`
- **CategoriaPeso:** `id, nombre, nombre_en, limite_lb?, limite_kg?, organismo, activa`
- **Pago (caja):** `id, alumno, alumno_nombre, membresia?, monto, metodo (EFECTIVO|TARJETA|TRANSFERENCIA), fecha_pago, fecha_vencimiento?, duracion?, estatus (PAGADO|VENCIDO|PENDIENTE), estatus_display, nota, comprobante_enviado_en?`
- **Venta:** `id, concepto, monto, metodo, metodo_display, fecha, alumno?, alumno_nombre, nota, registrado_por?, registrado_por_nombre, creado_en`
- **Asistencia:** `id, alumno, alumno_nombre, disciplina?, disciplina_nombre?, horario?, registrada_por?, fecha, hora_registro, metodo_registro (QR|MANUAL|APP), puntos_otorgados`
- **Notificacion:** `id, alumno, alumno_nombre, tipo (PAGO_POR_VENCER|PAGO_VENCIDO|RECORDATORIO_CLASE|INSIGNIA|GRADO|MANUAL), tipo_display, titulo, mensaje, fecha_envio, leida, canal (EMAIL|PUSH|SMS), aviso?, estado_correo (PENDIENTE|ENVIADO|FALLIDO), estado_correo_display, enviado_en?, error_correo`
- **Aviso:** `id, titulo, mensaje, tipo_destinatario (INDIVIDUAL|GRUPO|TODOS), tipo_destinatario_display, alumno?, alumno_nombre, horario?, horario_display, creado_por, creado_por_username, estado (PENDIENTE|PROCESANDO|ENVIADA|FALLIDA|CANCELADA), estado_display, total_destinatarios, total_enviadas, total_fallidas, creado_en, actualizado_en, procesado_en?`
- **Torneo:** `id, alumno, alumno_nombre, nombre_torneo, fecha, resultado (GANO|PERDIO|EMPATO), resultado_display, metodo (KO|SUMISION|DECISION|DESCALIFICACION), metodo_display, disciplina?, evento?, evento_titulo?, notas`
- **Grado:** `id, alumno, disciplina, nombre_grado, fecha_obtencion, otorgado_por?, notas`, más los campos `_nombre` de solo lectura que lleguen.
- **Insignia:** `id, nombre, descripcion, icono?, criterio{tipo, valor?}, puntos_bonus, activa, total_otorgadas`
- **Evento:** `id, titulo, tipo (TORNEO|SEMINARIO|EXAMEN|OTRO), tipo_display, fecha, lugar, descripcion, disciplina?, disciplina_nombre, creado_por, creado_por_username, total_inscritos, inscrito?, creado_en, actualizado_en`
  - `inscrito`: para el alumno indica su propia inscripción; `null` si no está inscrito.
- **EventoInscripcion:** `id, evento, evento_titulo, alumno, alumno_nombre, fecha_inscripcion, asistio, torneo? (Torneo)`
- **CategoriaMMA:** `id, clave, nombre, puntos_maximos, orden, activa, habilidades[{id, categoria, nombre, orden, activa}]`
- **EvaluacionMMA:** `id, alumno, alumno_nombre, evaluador?, evaluador_nombre, fecha, estado (BORRADOR|FINALIZADA), estado_display, notas, puntajes[{habilidad, habilidad_nombre, categoria, puntaje 1-5}], creado_por, creado_por_username, creado_en, actualizado_en, categorias[{id, clave, nombre, puntaje, maximo, porcentaje, habilidades_evaluadas, habilidades_total, habilidades[{id, nombre, puntaje}]}], puntaje_total, puntaje_maximo (100), nivel, preparacion{tecnica, fisica, defensa, tactica, disciplina, total}, completa`
- **EvaluacionResumen:** `{alumno, total_evaluaciones, ultima: EvaluacionMMA?, variacion: Double?, aviso_preparacion: String}`
- **EvaluacionHistorial** (arreglo): `[{id, fecha, puntaje_total, puntaje_maximo, nivel, preparacion_total, categorias{striking, wrestling, grappling, integracion, acondicionamiento, defensa, disciplina}}]`
- **PagoStripe:** `id, referencia (uuid), alumno, alumno_nombre, membresia, membresia_nombre, monto, moneda, estatus (PENDIENTE|PROCESANDO|PAGADO|FALLIDO|CANCELADO|REEMBOLSADO), estatus_display, checkout_url, stripe_checkout_session_id?, stripe_payment_intent_id?, pago?, pagado_en?, detalle_error, creado_en, actualizado_en`
- **DashboardGeneral:** `{alumnos{total, activos, nuevos_mes, morosos}, asistencias{hoy, semana, mes}, ingresos_mes, otros_ingresos_mes, por_disciplina[{id, nombre, alumnos_activos}], por_horario[{id, turno, hora_inicio, hora_fin, alumnos_activos}], top_5[{id, nombres, apellidos, apodo, puntos}], maestros_activos}`
- **Ranking** (arreglo): `[{posicion, id, nombre, apodo, puntos, foto?}]`
- **ResumenPagos:** `{periodo, total_cobrado, numero_pagos, por_metodo[{metodo, total, cantidad}], vencidos_historico}`
- **ResumenVentas:** `{periodo, total_vendido, numero_ventas, por_metodo[…], por_concepto[{concepto, total, cantidad}]}`

## 5. Endpoints

Todas las rutas son relativas a la URL base `…/api/`. **Colección** = `GET` (lista) y `POST` (alta). **Detalle** `{id}` = `GET`, `PUT`, `PATCH` y `DELETE`, salvo que se indique otra cosa.

### Autenticación
`auth/login/` · `auth/logout/` · `auth/yo/` · `auth/cambiar-password/` (ver sección 3).

### Alumnos
- `alumnos/`
  - Filtros: `activo`, `horario`, `membresia`, `disciplinas`.
  - Búsqueda: `?search=`
  - Orden: `?ordering=-puntos`
  - El alta la hace el admin (multipart si lleva `foto`) y la respuesta trae `username` y `password_inicial` **una sola vez**: muéstralos en un diálogo para copiar o compartir.
- `alumnos/{id}/` — detalle (AlumnoDetalle).
- `alumnos/{id}/perfil/` — tarjeta de peleador.
- `alumnos/{id}/qr/` — `{codigo_qr, qr_imagen}`.
- `alumnos/{id}/asistencias/` · `alumnos/{id}/insignias/` · `alumnos/{id}/pagos/` (admin o el propio alumno).
- `alumnos/{id}/evaluacion-resumen/` · `alumnos/{id}/evaluacion-historial/`
- `alumnos/{id}/ficha/` (HTML) · `alumnos/{id}/ficha-pdf/` (PDF de la ficha técnica). Descarga el PDF con el token y ábrelo con `FileProvider` + `ACTION_VIEW`.
- `POST alumnos/{id}/evaluar-insignias/` (admin) · `POST alumnos/{id}/restablecer-password/` (admin).
- `alumnos/ranking/?limite=20` · `alumnos/por-vencer/?dias=5` (admin) · `alumnos/morosos/` (admin).
- `alumnos/yo/`: `GET` el propio perfil; `PATCH` **solo** con `nombres, apellidos, apodo, telefono, email, peso_actual, estatura, foto` (multipart si hay foto). La respuesta puede traer `_ignorados`.

### Maestros y cuentas administrativas
- `maestros/` (lectura: admin y maestro; escritura: admin) · `maestros/{id}/restablecer-password/`
- `usuarios/` (admin, **solo** GET, POST y PATCH) · `usuarios/{id}/restablecer-password/`

### Catálogos
Lectura para cualquier usuario autenticado; escritura solo admin.
- `horarios/` (filtro `turno`) · `horarios/{id}/alumnos/` (admin y maestro, con alcance)
- `disciplinas/` · `membresias/` · `categorias-peso/` · `insignias/` (filtro `activa`)
- `POST insignias/{id}/otorgar/` con `{"alumno_id": 3}` (admin) · `categorias-mma/`

### Caja (solo admin; el alumno lee sus pagos)
- `pagos/`
  - Filtros: `alumno`, `estatus`, `metodo`, `fecha_pago`, `fecha_pago__gte`, `fecha_pago__lte`
  - `?search=`
  - Alta: `{alumno, membresia?, monto, metodo, fecha_pago?, duracion?, nota}`. El `estatus` lo calcula el servidor.
- `pagos/resumen/`
- `pagos/{id}/comprobante/`: HTML; `?formato=pdf` para PDF; `?enviar=1` lo reenvía por correo.
- `ventas/` — filtros `alumno`, `metodo`, `fecha`, `fecha__gte`, `fecha__lte`. Alta: `{concepto, monto, metodo, fecha?, alumno?, nota}`.
- `ventas/resumen/`

### Asistencias
- `asistencias/` — filtros `alumno`, `disciplina`, `horario`, `fecha`, `metodo_registro`.
- `asistencias/hoy/` (admin).
- `POST asistencias/checkin/`: **público, sin token**; modo tablet de recepción. Body: `{"codigo_qr": "ALU-…", "disciplina_id": 1, "horario_id"?: 2, "maestro_id"?: 3}`.
- `POST asistencias/manual/` (admin): `{"alumno_id", "disciplina_id"?, "horario_id"?, "fecha"? (no futura)}`.
- `POST asistencias/mi-checkin/` (alumno): `{"disciplina_id"?}`. Solo disciplinas en las que el alumno está inscrito; la fecha siempre es hoy.

Respuesta de los tres registros de asistencia:

```json
201 {"detail": "Asistencia registrada para Ana Ruiz.",
     "alumno": {"id": 13, "nombre": "Ana Ruiz", "apodo": "…", "puntos": 30, "al_corriente": false, "dias_para_vencer": null},
     "racha": 1, "puntos_otorgados": 10, "insignias_desbloqueadas": ["Primer paso"], "asistencia_id": 150}
400 QR desconocido · 403 alumno dado de baja · 409 ya registró esa clase hoy
```

### Ficha deportiva y evaluación
- `experiencias/` — filtros `alumno`, `bjj_cinturon`, `lesion_activa`. `PATCH experiencias/{id}/` (admin y maestro). `POST experiencias/{id}/sincronizar-record/`.
- `torneos/` — filtros `alumno`, `disciplina`, `resultado`, `evento`. Escritura solo admin.
- `grados/` — filtros `alumno`, `disciplina`, `otorgado_por`. Escritura solo admin.
- `evaluaciones-mma/` — filtros `alumno`, `estado`, `evaluador`.
  - Alta o edición (admin y maestro): `{"alumno", "fecha"?, "estado": "BORRADOR"|"FINALIZADA", "notas", "puntajes": [{"habilidad": 1, "puntaje": 1-5}, …]}`.
  - Una evaluación por alumno y día. El alumno solo ve las FINALIZADAS.
  - Al editar, `puntajes` **reemplaza** la lista completa.

### Eventos
- `eventos/` — filtros `tipo`, `disciplina`; `?search=`. Lectura para todos; escritura admin y maestro (el maestro solo edita sus propios eventos). Body: `{titulo, tipo, fecha, lugar, descripcion, disciplina?}`.
- `inscripciones-evento/` — filtros `evento`, `alumno`, `asistio`.
  - Alumno: `POST {"evento": id}` para inscribirse a sí mismo; `DELETE inscripciones-evento/{id}/` para cancelar.
  - Admin y maestro: `POST {"evento", "alumno"}`; `PATCH {"asistio": true}` para pasar lista.
- `inscripciones-evento/{id}/resultado/`: `POST {"resultado": "GANO", "metodo": "KO", "notas": ""}` · `DELETE` (admin y maestro).

### Notificaciones y avisos
- `notificaciones/` — filtros `alumno`, `tipo`, `leida`, `canal`, `aviso`.
  - Alumno: solo las suyas.
  - Maestro: solo las generadas por sus avisos (drill-down de destinatarios).
- `POST notificaciones/{id}/marcar-leida/` (solo el dueño).
- `avisos/` (admin y maestro) — filtros `tipo_destinatario`, `estado`, `horario`, `alumno`; `?search=`.
  - Alta: `{"titulo", "mensaje", "tipo_destinatario": "INDIVIDUAL"|"GRUPO"|"TODOS", "alumno"? (INDIVIDUAL), "horario"? (GRUPO)}`.
  - `TODOS` es **solo admin**: al maestro ni se le muestra la opción.
  - Se edita solo mientras esté PENDIENTE.
- `POST avisos/{id}/cancelar/`

### Dashboard (admin)
`dashboard/` (DashboardGeneral).

### Pagos en línea con Stripe (`payments/`)
- `POST payments/checkout/`
  - Alumno: `{"membresia_id"?}`; sin él usa su membresía asignada.
  - Admin: `{"alumno_id", "membresia_id"?}`.
  - Respuesta `201` o `200` (si reutiliza una liga vigente): `{"id", "referencia", "checkout_url", "monto", "moneda"}`.
  - **Nunca envíes el precio**: el backend lo toma de la membresía.
- `GET payments/` — filtros `alumno`, `estatus`, `membresia`, `creado_en__gte`, `creado_en__lte`. `GET payments/{id}/`
- `GET payments/sesion/?session_id=cs_…`
- `POST payments/{id}/reembolsar/` (admin) → `202`. El estatus cambia después, vía webhook.
- `GET payments/saldo/` (admin): `{"disponible": [{"moneda", "monto"}], "pendiente": [...]}`
- `GET payments/dashboard/` (admin):

```json
{"cursor": "ISO", "stripe": {"configurado", "webhook_configurado", "modo": "test|live", "moneda"},
 "resumen": {"periodo", "cobrado_hoy": {"total", "cantidad"}, "cobrado_mes": {…}, "ticket_promedio_mes",
   "reembolsado_mes": {…}, "pendientes": {…}, "por_estatus_mes": {"PENDIENTE": n, …}, "tasa_conversion_mes"},
 "serie_diaria": [{"dia", "total", "cantidad"}], "por_membresia_mes": [{"membresia", "membresia__nombre", "total", "cantidad"}],
 "recientes": [PagoStripe…], "webhook": {"ultimo_evento": {"tipo", "procesado_en"}?, "eventos_24h"}}
```

- `GET payments/cambios/?desde=<cursor>` (admin) → `{"cursor", "hay_cambios", "pagos": [PagoStripe…]}`. Manda el cursor URL-encoded: el `+` de la zona horaria va como `%2B`, y Retrofit `@Query` lo hace solo.

## 6. Pantallas por rol

Replica el **comportamiento** del frontend web. Si tienes acceso al repositorio de Angular, iguala nombres de pantallas, textos, orden de campos y colores de estatus. Identidad visual: negro `#111111`, rojo `#C0202C`, texto "CASA BRAVA · Academia de combate". Semáforo de pago: verde si `al_corriente` y `dias_para_vencer > 5`, ámbar si `dias_para_vencer` va de 0 a 5, rojo si no está al corriente.

**Alumno** (barra inferior: Inicio · Mi QR · Eventos · Notificaciones · Perfil)
- **Inicio:** tarjeta de peleador (`/alumnos/{id}/perfil/`) con foto, apodo, récord, puntos, racha actual y máxima, insignias, semáforo de pago, días para vencer y botón **"Registrar asistencia"** (`mi-checkin` con selector de disciplina tomado de `inscripciones`; maneja 409).
- **Mi QR:** imagen `qr_imagen` a pantalla completa con brillo al máximo y `codigo_qr` en texto.
- **Pagos:** historial de caja (`/alumnos/{id}/pagos/`) y pagos en línea (`/payments/`), comprobante en PDF y botón **"Pagar membresía"** (flujo de la sección 8).
- **Mi progreso:** Evaluación MMA (resumen, variación, gráfica de historial, detalle por categoría y habilidad), asistencias, torneos y grados.
- **Eventos:** cartelera; inscribirse o cancelar usando `inscrito`.
- **Ranking.**
- **Notificaciones** (sección 7).
- **Perfil:** editar con `PATCH /alumnos/yo/` (foto desde cámara o galería), cambiar contraseña, descargar ficha técnica en PDF, cerrar sesión.

**Maestro** (Mis alumnos · Grupos · Eventos · Avisos · Perfil)
- **Mis alumnos:** lista paginada con búsqueda y filtros. En el detalle: perfil, edición de ficha técnica y Evaluación MMA.
- **Evaluación MMA:** crear o editar. Carga `categorias-mma/`, muestra un slider de 1 a 5 por habilidad agrupado por categoría, guarda como BORRADOR o FINALIZADA y calcula una vista previa en el cliente (el total oficial lo da la respuesta).
- **Grupos:** `horarios/{id}/alumnos/`.
- **Eventos:** crear y editar los suyos, inscribir alumnos, pasar lista (`asistio`) y capturar o quitar resultados.
- **Avisos:** crear (INDIVIDUAL o GRUPO), lista con estado y totales, cancelar, y drill-down de destinatarios (`notificaciones/?aviso=<id>`).

**Administrativo** (menú lateral)
- **Dashboard general.**
- **Alumnos:** CRUD, morosos, por vencer, restablecer contraseña, otorgar insignia y reevaluar insignias.
- **Maestros y Usuarios.**
- **Catálogos:** horarios, disciplinas, membresías, categorías de peso, insignias y categorías MMA.
- **Caja:** registrar pago, cortes del mes, comprobantes y ventas.
- **Asistencias:** del día, manual e historial.
- **Avisos** (incluye TODOS) y **Eventos.**
- **Pagos en línea:** dashboard en tiempo real, generar liga de pago para un alumno (compartirla con el share sheet de Android), reembolsar y consultar el saldo.

**Modo recepción (kiosco).** Es una entrada separada desde el login ("Modo recepción"). Funciona sin sesión o con la del admin, pero la llamada va **sin token**.
- Selector de disciplina y, opcionalmente, horario.
- Escáner continuo con CameraX + ML Kit que hace `POST asistencias/checkin/` por cada QR.
- Resultado grande durante 3 segundos: verde (registrado, con racha, puntos e insignias), ámbar (registrado pero `al_corriente = false`: "Pago pendiente"), rojo (400, 403 o 409 con el mensaje de `detail`).
- Evita lecturas dobles del mismo código en menos de 5 segundos.

## 7. Notificaciones (TODAS)

**El backend no tiene push (FCM) ni registro de dispositivos.** Las notificaciones viven en `/notificaciones/`, y para el admin los pagos en línea están en `/payments/cambios/`. Implementa este esquema, y deja la fuente de datos detrás de una interfaz `NotificationSource` para poder conectar FCM más adelante sin tocar la UI.

1. **Bandeja in-app** (todos los roles que tengan notificaciones):
   - Lista paginada de `notificaciones/`, las no leídas primero y en negritas.
   - Filtro por `tipo`, pull-to-refresh y swipe para marcar como leída (`POST notificaciones/{id}/marcar-leida/`).
   - Badge de no leídas con `GET notificaciones/?leida=false&page_size=1` (usa `count`), en la barra inferior y en el ícono de la app.
2. **Notificaciones del sistema Android:**
   - Pide `POST_NOTIFICATIONS` en Android 13 o superior, con una pantalla que explique para qué.
   - **Canales** (uno por `tipo`, con importancia adecuada):

     | Canal | Tipo |
     |---|---|
     | Pagos por vencer | `PAGO_POR_VENCER` |
     | Pago vencido | `PAGO_VENCIDO`, importancia alta |
     | Recordatorio de clase | `RECORDATORIO_CLASE` |
     | Insignias | `INSIGNIA` |
     | Grados | `GRADO` |
     | Avisos de la academia | `MANUAL` |
     | Pagos en línea (solo admin) | — |
     | Estado de mi pago (alumno) | — |

   - **Sincronización:**
     - `PeriodicWorkRequest` de WorkManager cada 15 minutos (el mínimo de Android), con restricción de red.
     - Mientras la app está en primer plano, consulta cada 30 segundos con un `repeatOnLifecycle(STARTED)`.
     - Al abrir la app, sincroniza de inmediato.
   - **Detección de nuevas:** guarda en DataStore el **id máximo ya notificado** por usuario. Consulta `notificaciones/?leida=false&page_size=50`, filtra `id > ultimo_id`, publica una notificación por cada una (o un resumen `InboxStyle` si son más de 3) y actualiza `ultimo_id`. **Nunca repitas una notificación.**
   - **Tap:** deep link a la notificación dentro de la app, que la marca como leída y navega al contenido relacionado:

     | Tipo | Destino |
     |---|---|
     | `PAGO_*` | Pagos |
     | `INSIGNIA` | Perfil / insignias |
     | `GRADO` | Progreso |
     | `MANUAL` | Detalle del aviso |

   - Acción rápida "Marcar como leída" desde la notificación, con un `BroadcastReceiver` y una llamada en background.
3. **Admin: pagos en línea "en vivo":**
   - En la pantalla del dashboard: `payments/dashboard/` y después `payments/cambios/?desde=<cursor>` cada 4 segundos mientras esté visible.
   - Haz **upsert por `id`**: pueden llegar duplicados porque el cursor tiene un solape de 5 segundos. Si `hay_cambios`, recarga los totales.
   - En background, el mismo worker de 15 minutos consulta `cambios` con el cursor guardado y publica "Pago recibido: <alumno> · $<monto> · <membresía>" por cada `PAGADO` nuevo, y "Reembolso confirmado" por cada `REEMBOLSADO`.
   - Muestra una alerta si `webhook.ultimo_evento` tiene más de 24 horas y `stripe.configurado` es true.
4. **Alumno: estado de su pago en línea.** Tras volver de Stripe (sección 8), avisa con una notificación local si el pago terminó PAGADO, FALLIDO o CANCELADO mientras la app estaba en background (lo consulta un `OneTimeWorkRequest` con backoff).
5. **Maestro y admin: avisos enviados.** En la lista de avisos, refresca el `estado` de los que siguen en PENDIENTE o PROCESANDO cada 10 segundos mientras la pantalla esté visible.
6. **Limpieza:** al cerrar sesión, cancela los workers, borra los cursores e ids guardados y quita las notificaciones publicadas.
7. `TODO(FCM)`: documenta en `NotificationSource` qué necesitaría el backend (un endpoint para registrar el token FCM del dispositivo y el envío al crear cada `Notificacion`). **No lo implementes contra endpoints inexistentes.**

## 8. Pago de membresía con Stripe (alumno y admin)

1. El alumno elige una membresía (`membresias/`; por defecto la suya) y toca **"Pagar $X"**.
2. `POST payments/checkout/` y guarda el `id` recibido en DataStore como "pago en curso".
3. Abre `checkout_url` en **Chrome Custom Tabs**. **No** uses WebView.
4. Al volver a la app (`onResume`), consulta `GET payments/{id}/` cada 2 segundos, hasta 60 segundos, hasta que el estatus sea terminal:

   | Estatus | Pantalla |
   |---|---|
   | `PAGADO` | Éxito con confeti; refresca el perfil (`al_corriente`, `fecha_vencimiento`). |
   | `PROCESANDO` | "Pago en proceso (OXXO o transferencia). Te avisaremos." y se programa el worker del punto 7.4. |
   | `FALLIDO` / `CANCELADO` | Mensaje con `detalle_error` si viene. |
   | Sigue `PENDIENTE` | "Aún no recibimos la confirmación" con botones "Reintentar pago" (reusa `checkout_url`) y "Ver más tarde". |

5. **La confirmación viene SOLO del backend** (webhook de Stripe). La app nunca marca nada como pagado por su cuenta.
6. Maneja 429 ("Demasiados intentos, espera un minuto"), 503 ("Pagos en línea no disponibles") y 502.
7. Admin: "Generar liga de pago" desde el detalle del alumno manda `POST {alumno_id, membresia_id}` y comparte el `checkout_url` con `Intent.ACTION_SEND` (WhatsApp, correo…).

## 9. Calidad y entregables

- Estructura por feature: `feature/auth`, `feature/alumnos`, `feature/pagos`, `feature/notificaciones`, `feature/eventos`, `feature/evaluacion`, `feature/kiosco`, `feature/admin`, y `core/network`, `core/data`, `core/ui`, `core/notifications`.
- Un `ApiService` de Retrofit por módulo, con **todas** las rutas de la sección 5 tipadas.
- Estados de carga, vacío y error en **todas** las pantallas. Reintento. Soporte offline de solo lectura con la última respuesta en caché para perfil y notificaciones.
- Accesibilidad: `contentDescription`, tamaños táctiles de 48 dp o más, contraste AA.
- Textos en español (`strings.xml`), formato `es-MX`.
- **Sin secretos en el código.** La app solo guarda su token de sesión.
- Pruebas mínimas:
  - Serialización de cada DTO con los JSON de este documento.
  - `BigDecimal` en formato string y número.
  - Interceptor 401.
  - Lógica de "nuevas notificaciones" (sin duplicados).
  - Polling de `payments/{id}` hasta estado terminal.
  - Kiosco: manejo de 201, 400, 403 y 409.
- `README.md` con cómo configurar la URL base (emulador o celular), las cuentas de prueba (`alumno-<id>` / contraseña inicial del backend; `maestro-<id>`; un admin) y cómo probar Stripe en modo test: la tarjeta `4242 4242 4242 4242` y `stripe listen` corriendo en la PC del backend.
- **Entrega por fases**, compilando y con pruebas pasando en cada una:
  1. Red y autenticación.
  2. Alumno.
  3. Notificaciones.
  4. Pagos con Stripe.
  5. Maestro.
  6. Admin.
  7. Kiosco.

  Al terminar cada fase, lista qué endpoints quedaron cubiertos.
