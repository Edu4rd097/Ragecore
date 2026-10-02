# Casa Brava — Frontend Angular PWA

Angular 21 (LTS), PWA lista para instalar en el celular. Dos roles: Alumno y Administrativo, separados por guards y rutas lazy.

---

## Arrancar en desarrollo

```bash
npm install
ng serve
```

Abre en: http://localhost:4200

La app espera el backend de Django en `/api` y las imágenes (fotos, QR) en `/media`. `angular.json` ya aplica `proxy.conf.json`, que reenvía ambas rutas a `http://127.0.0.1:8000`, así que basta con `ng serve` teniendo `python manage.py runserver` corriendo.

### Probar desde el celular por WiFi

1. Arranca el frontend escuchando en toda la red: `npm run start:lan` (es `ng serve --host 0.0.0.0`). Django puede quedarse en `127.0.0.1:8000`; el dev-server le reenvía `/api` y `/media`.
2. Averigua la IP de la PC en la red (`ipconfig` → IPv4) y en el celular abre `http://<IP-de-la-PC>:4200`.
3. En el `.env` del backend, `CSRF_TRUSTED_ORIGINS` debe incluir ese origen (`http://<IP-de-la-PC>:4200`). Si el firewall de Windows pregunta, permite el puerto 4200 en redes privadas.

Las fotos y el QR llegan como rutas relativas (`/media/...`), así que el celular las pide al dev-server y este las trae de Django. Antes salían absolutas con `127.0.0.1:8000`, que desde otro dispositivo apunta a él mismo, y por eso no cargaban.

La **cámara** para escanear QR solo funciona en HTTPS o `localhost`: en la PC de recepción abre la app en `http://localhost:4200`; desde el celular por `http://<IP>` el navegador no da cámara, pero mostrar el QR y registrar asistencia sí funciona.

---

## Estructura (src/app)

```
core/
├── models.ts          Interfaces TypeScript espejo del backend
├── api.service.ts     Todos los endpoints tipados
└── auth.service.ts    Login, signals de sesión, interceptor, guards

shared/
├── ui.ts              Logo, Avatar, Stat, Semáforo, KPI, Modal, Paginador
└── pipes.ts           AbsPipe

auth/
├── login.ts           Pantalla de entrada (común a ambos roles)
└── redirigir.ts       Manda a /mi o /admin según el rol

layout/
├── shell-alumno.ts    Header + nav inferior tipo app
└── shell-admin.ts     Barra lateral colapsable

alumno/  (8 pantallas, carga diferida)
├── dashboard.ts       Ficha de peleador: foto, stats, récord, insignias
├── perfil.ts          Editar datos personales + QR
├── progreso.ts        Radar SVG + línea de tiempo de torneos y grados
├── asistencia.ts      Calendario heatmap + historial
├── pagos.ts           Estado de cuenta + comprobante imprimible
├── notificaciones.ts  Bandeja con marcado optimista
└── insignias.ts       Medallero con progreso

admin/  (10 pantallas, carga diferida)
├── dashboard.ts       KPIs + barras SVG + dona de horarios
├── alumnos.ts         Tabla filtrable + alta de nuevo alumno
├── alumno-detalle.ts  Ficha con pestañas (datos, exp., evaluación, pagos, asist., historial) y botón Marcar asistencia
├── maestros.ts        CRUD con modal
├── pagos.ts           Caja con dos registros: pagos de membresía y otras ventas (concepto libre)
├── asistencia.ts      Escaneo QR con la cámara + registro manual buscando al alumno por nombre + lista del día
├── horarios.ts        CRUD de horarios y disciplinas
├── membresias.ts      CRUD con comparativa de precios
├── insignias.ts       Medallero + otorgamiento manual
└── reportes.ts        Ingresos, asistencia, retención + exportación CSV
```

---

## Identidad visual

Marca inventada: **Casa Brava, academia de combate**.

- Logo: octágono (la jaula), malla insinuada, banda roja diagonal, monograma CB — SVG puro, escala sin perder nitidez.
- Fondo negro escalonado en cinco tonos: `--negro` (#0a0a0b) a `--negro-600` (#2a2d33).
- Acento rojo: `--rojo` (#e11d2a) con variante `--rojo-claro` (#ff3b47) para hovers.
- Tipografía: **Oswald** (condensada, tipo cartel) para títulos y monogramas; **Inter** para el cuerpo.
- Sin fotos de peleadores reales: tienen derechos. Los avatares son siluetas SVG de peleador en guardia, con el tono generado por hash del nombre para que cada alumno se distingue visualmente.

---

## Pantallas por rol

**Alumno:** Ficha de peleador · Mi perfil (datos personales, correo y Seguridad → Cambiar contraseña) · Mi progreso · Mi asistencia · Mis pagos · Notificaciones · Insignias · Eventos

**Maestro:** Mis alumnos (solo los de sus grupos asignados + individuales; Evaluación MMA y ficha técnica) · Eventos · Notificaciones (a sus alumnos/grupos) · Mi perfil (Seguridad)

**Staff/Admin:** Panel KPIs · Pasar lista · Alumnos · Ficha detalle · Pagos (membresías) y otras ventas · Avisos · Eventos · Maestros (con asignación de grupos y alumnos) · Horarios y disciplinas · Membresías · Insignias · Reportes · Usuarios (cuentas administrativas) · Mi perfil (Seguridad)

El menú se adapta al rol, pero la seguridad no depende de eso: cada endpoint del backend acota por sí mismo (ver `core/permissions.py` del backend).

### Cuentas y contraseñas

Al dar de alta un alumno, maestro o usuario administrativo, el backend crea su cuenta (usuario `alumno-<id>` / `maestro-<id>` / el que se capture) con la contraseña inicial de la academia, y la app la muestra **una sola vez**. Cada quien la cambia en *Mi perfil → Seguridad*; el administrador puede restablecerla desde la ficha del alumno, el modal del maestro o la pantalla Usuarios.

---

## Para producción

```bash
ng build --configuration production
```

El output va a `dist/academia-frontend/`. Sírvelo con Nginx, Firebase Hosting, Vercel o cualquier servidor estático.

Ajusta `API_BASE` en `src/app/core/api.service.ts` para apuntar al backend desplegado.

### Escaneo QR con la cámara

`shared/escaner-qr.ts` (`<cb-escaner-qr (codigo)="…" [pausado]="…">`) abre la webcam o la cámara trasera con `getUserMedia` y decodifica cada 150 ms: usa el `BarcodeDetector` nativo cuando el navegador lo tiene (Chrome, Edge, Android) y si no cae a la librería `jsqr` sobre un canvas. Evita dobles lecturas del mismo código durante 3 s, permite cambiar de cámara si hay varias y explica los errores de permiso. Pasar lista lo usa en el modo *Escanear QR*: la cámara queda encendida entre alumnos, se pausa mientras se muestra la confirmación y esta se limpia sola a los 5 s.

Los navegadores solo dan acceso a la cámara en **HTTPS o localhost**; en HTTP plano el componente lo avisa y queda el campo para teclear el código.

Además del escaneo, el alumno puede registrar su propia asistencia del día desde *Mi perfil → Mi código QR* (queda marcada como `APP`), y recepción puede hacerlo por nombre en *Registro manual* o con el botón de la ficha (`MANUAL`).
