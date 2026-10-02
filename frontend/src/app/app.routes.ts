import { Routes } from '@angular/router';
import { guardAutenticado, guardInvitado, guardRol } from './core/auth.service';

/**
 * Dos áreas separadas por rol, cada una con su propio shell (navegación).
 * Todo carga en diferido: la PWA arranca con lo mínimo.
 */
export const routes: Routes = [
  {
    path: 'entrar',
    canActivate: [guardInvitado],
    loadComponent: () => import('./auth/login').then((m) => m.LoginPage),
  },

  // ------------------------------------------------- REGRESO DE STRIPE CHECKOUT
  // Las URLs las fija el backend (STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL).
  // Son solo UX: el pago lo confirma el webhook, no visitar estas páginas.
  {
    path: 'payment/success',
    title: 'Pago en línea',
    canActivate: [guardAutenticado],
    loadComponent: () => import('./pagos-en-linea/resultado-pago').then((m) => m.PagoExitoso),
  },
  {
    path: 'payment/cancel',
    title: 'Pago cancelado',
    loadComponent: () => import('./pagos-en-linea/resultado-pago').then((m) => m.PagoCancelado),
  },

  // ------------------------------------------------------- FICHA TÉCNICA
  // Alumno (la suya), maestro (sus alumnos) y admin (todos): el backend
  // aplica el alcance, por eso aquí basta con tener sesión.
  {
    path: 'ficha/:id',
    title: 'Ficha técnica',
    canActivate: [guardAutenticado],
    loadComponent: () => import('./shared/vista-ficha').then((m) => m.VistaFicha),
  },

  // ---------------------------------------------------------------- ALUMNO
  {
    path: 'mi',
    canActivate: [guardRol('ALUMNO', 'ADMINISTRATIVO')],
    loadComponent: () => import('./layout/shell-alumno').then((m) => m.ShellAlumno),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        title: 'Mi ficha',
        loadComponent: () => import('./alumno/dashboard').then((m) => m.DashboardAlumno),
      },
      {
        path: 'perfil',
        title: 'Mi perfil',
        loadComponent: () => import('./alumno/perfil').then((m) => m.MiPerfil),
      },
      {
        path: 'progreso',
        title: 'Mi progreso',
        loadComponent: () => import('./alumno/progreso').then((m) => m.MiProgreso),
      },
      {
        path: 'asistencia',
        title: 'Mi asistencia',
        loadComponent: () => import('./alumno/asistencia').then((m) => m.MiAsistencia),
      },
      {
        path: 'pagos',
        title: 'Mis pagos',
        loadComponent: () => import('./alumno/pagos').then((m) => m.MisPagos),
      },
      {
        path: 'notificaciones',
        title: 'Notificaciones',
        loadComponent: () => import('./alumno/notificaciones').then((m) => m.MisNotificaciones),
      },
      {
        path: 'insignias',
        title: 'Insignias',
        loadComponent: () => import('./alumno/insignias').then((m) => m.MisInsignias),
      },
      {
        path: 'eventos',
        title: 'Eventos',
        loadComponent: () => import('./alumno/eventos').then((m) => m.MisEventos),
      },
    ],
  },

  // -------------------------------------------------------------- MAESTRO
  {
    path: 'maestro',
    canActivate: [guardRol('MAESTRO')],
    loadComponent: () => import('./layout/shell-maestro').then((m) => m.ShellMaestro),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        title: 'Mis alumnos',
        loadComponent: () => import('./maestro/alumnos').then((m) => m.MaestroAlumnos),
      },
      {
        path: 'eventos',
        title: 'Eventos',
        loadComponent: () => import('./maestro/eventos').then((m) => m.Eventos),
      },
      {
        // Mismo componente que /admin/avisos: el backend acota al maestro a
        // sus alumnos y grupos (AvisoViewSet) y el componente esconde "todos".
        path: 'avisos',
        title: 'Notificaciones',
        loadComponent: () => import('./admin/avisos').then((m) => m.AdminAvisos),
      },
      {
        path: 'perfil',
        title: 'Mi perfil',
        loadComponent: () => import('./shared/mi-cuenta').then((m) => m.MiCuenta),
      },
    ],
  },

  // --------------------------------------------------------- ADMINISTRATIVO
  {
    path: 'admin',
    canActivate: [guardRol('ADMINISTRATIVO')],
    loadComponent: () => import('./layout/shell-admin').then((m) => m.ShellAdmin),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      {
        path: 'inicio',
        title: 'Panel',
        loadComponent: () => import('./admin/dashboard').then((m) => m.DashboardAdmin),
      },
      {
        path: 'alumnos',
        title: 'Alumnos',
        loadComponent: () => import('./admin/alumnos').then((m) => m.AdminAlumnos),
      },
      {
        path: 'alumnos/:id',
        title: 'Ficha de alumno',
        loadComponent: () => import('./admin/alumno-detalle').then((m) => m.AdminAlumnoDetalle),
      },
      {
        path: 'maestros',
        title: 'Maestros',
        loadComponent: () => import('./admin/maestros').then((m) => m.AdminMaestros),
      },
      {
        path: 'pagos',
        title: 'Pagos',
        loadComponent: () => import('./admin/pagos').then((m) => m.AdminPagos),
      },
      {
        path: 'pagos-en-linea',
        title: 'Pagos en línea',
        loadComponent: () => import('./pagos-en-linea/admin-pagos-en-linea').then((m) => m.AdminPagosEnLinea),
      },
      {
        path: 'asistencia',
        title: 'Control de asistencia',
        loadComponent: () => import('./admin/asistencia').then((m) => m.AdminAsistencia),
      },
      {
        path: 'horarios',
        title: 'Horarios y disciplinas',
        loadComponent: () => import('./admin/horarios').then((m) => m.AdminHorarios),
      },
      {
        path: 'membresias',
        title: 'Membresías',
        loadComponent: () => import('./admin/membresias').then((m) => m.AdminMembresias),
      },
      {
        path: 'insignias',
        title: 'Insignias',
        loadComponent: () => import('./admin/insignias').then((m) => m.AdminInsignias),
      },
      {
        path: 'avisos',
        title: 'Avisos',
        loadComponent: () => import('./admin/avisos').then((m) => m.AdminAvisos),
      },
      {
        path: 'eventos',
        title: 'Eventos',
        loadComponent: () => import('./maestro/eventos').then((m) => m.Eventos),
      },
      {
        path: 'reportes',
        title: 'Reportes',
        loadComponent: () => import('./admin/reportes').then((m) => m.AdminReportes),
      },
      {
        path: 'usuarios',
        title: 'Usuarios',
        loadComponent: () => import('./admin/usuarios').then((m) => m.AdminUsuarios),
      },
      {
        path: 'perfil',
        title: 'Mi perfil',
        loadComponent: () => import('./shared/mi-cuenta').then((m) => m.MiCuenta),
      },
    ],
  },

  // Redirección inicial: la resuelve un guard según el rol de la sesión.
  {
    path: '',
    pathMatch: 'full',
    canActivate: [guardAutenticado],
    loadComponent: () => import('./auth/redirigir').then((m) => m.Redirigir),
  },
  { path: '**', redirectTo: '' },
];
