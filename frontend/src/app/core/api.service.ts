import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Alumno,
  AlumnoLista,
  Asistencia,
  Aviso,
  CambiosStripe,
  CategoriaMMA,
  CheckoutStripe,
  Dashboard,
  DashboardStripe,
  Disciplina,
  EvaluacionMMA,
  Evento,
  EventoInscripcion,
  Experiencia,
  FilaRanking,
  Grado,
  Horario,
  Insignia,
  Maestro,
  Membresia,
  Notificacion,
  Pagina,
  Pago,
  PagoStripe,
  PerfilAlumno,
  PuntoHistorialMMA,
  ResultadoCheckin,
  ResumenEvaluacionMMA,
  ResumenPagos,
  ResumenVentas,
  SaldoStripe,
  Torneo,
  UsuarioAdministrativo,
  Venta,
} from './models';

/** Se sobreescribe en el build de producción. Ver environments/. */
export const API_BASE = '/api';

type Filtros = Record<string, string | number | boolean | null | undefined>;

function aParams(filtros: Filtros = {}): HttpParams {
  let params = new HttpParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor !== null && valor !== undefined && valor !== '') {
      params = params.set(clave, String(valor));
    }
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // --- Genéricos -----------------------------------------------------------

  private lista<T>(recurso: string, filtros?: Filtros): Observable<Pagina<T>> {
    return this.http.get<Pagina<T>>(`${API_BASE}/${recurso}/`, { params: aParams(filtros) });
  }
  private uno<T>(recurso: string, id: number): Observable<T> {
    return this.http.get<T>(`${API_BASE}/${recurso}/${id}/`);
  }
  private crear<T>(recurso: string, datos: unknown): Observable<T> {
    return this.http.post<T>(`${API_BASE}/${recurso}/`, datos);
  }
  private editar<T>(recurso: string, id: number, datos: unknown): Observable<T> {
    return this.http.patch<T>(`${API_BASE}/${recurso}/${id}/`, datos);
  }
  private borrar(recurso: string, id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/${recurso}/${id}/`);
  }

  // --- Alumnos -------------------------------------------------------------

  alumnos(filtros?: Filtros) {
    return this.lista<AlumnoLista>('alumnos', filtros);
  }
  alumno(id: number) {
    return this.uno<Alumno>('alumnos', id);
  }
  crearAlumno(datos: Partial<Alumno>) {
    return this.crear<Alumno>('alumnos', datos);
  }
  editarAlumno(id: number, datos: Partial<Alumno>) {
    return this.editar<Alumno>('alumnos', id, datos);
  }
  borrarAlumno(id: number) {
    return this.borrar('alumnos', id);
  }

  /** Perfil del alumno autenticado. */
  yo() {
    return this.http.get<Alumno>(`${API_BASE}/alumnos/yo/`);
  }
  /** El alumno solo puede tocar sus datos personales; el backend ignora el resto. */
  editarmeYo(datos: Partial<Alumno> | FormData) {
    return this.http.patch<Alumno>(`${API_BASE}/alumnos/yo/`, datos);
  }

  perfil(id: number) {
    return this.http.get<PerfilAlumno>(`${API_BASE}/alumnos/${id}/perfil/`);
  }
  asistenciasDe(id: number) {
    return this.http.get<Asistencia[]>(`${API_BASE}/alumnos/${id}/asistencias/`);
  }
  /**
   * Ficha técnica del peleador en PDF. Por HttpClient (no un <a href>) para
   * que lleve el token; se pide la respuesta completa para leer el nombre
   * de archivo de Content-Disposition.
   */
  /** Ficha técnica en HTML autocontenido (fuentes e imágenes incrustadas), para un iframe srcdoc. */
  fichaHtml(id: number) {
    return this.http.get(`${API_BASE}/alumnos/${id}/ficha/`, { responseType: 'text' });
  }
  fichaPdf(id: number) {
    return this.http.get(`${API_BASE}/alumnos/${id}/ficha-pdf/`, {
      responseType: 'blob',
      observe: 'response',
    });
  }
  pagosDe(id: number) {
    return this.http.get<Pago[]>(`${API_BASE}/alumnos/${id}/pagos/`);
  }
  ranking(limite = 20) {
    return this.http.get<FilaRanking[]>(`${API_BASE}/alumnos/ranking/`, {
      params: aParams({ limite }),
    });
  }
  porVencer(dias = 5) {
    return this.http.get<AlumnoLista[]>(`${API_BASE}/alumnos/por-vencer/`, {
      params: aParams({ dias }),
    });
  }
  morosos() {
    return this.http.get<AlumnoLista[]>(`${API_BASE}/alumnos/morosos/`);
  }
  /** Solo admin. Sin 'password' genera una automática y la regresa en la respuesta. */
  restablecerPasswordAlumno(id: number, password?: string) {
    return this.http.post<{ detail: string; password_generada: string | null }>(
      `${API_BASE}/alumnos/${id}/restablecer-password/`,
      password ? { password } : {},
    );
  }

  // --- Experiencia ---------------------------------------------------------

  experiencias(filtros?: Filtros) {
    return this.lista<Experiencia>('experiencias', filtros);
  }
  editarExperiencia(id: number, datos: Partial<Experiencia>) {
    return this.editar<Experiencia>('experiencias', id, datos);
  }

  // --- Catálogos -----------------------------------------------------------

  disciplinas(filtros?: Filtros) {
    return this.lista<Disciplina>('disciplinas', filtros);
  }
  crearDisciplina(d: Partial<Disciplina>) {
    return this.crear<Disciplina>('disciplinas', d);
  }
  editarDisciplina(id: number, d: Partial<Disciplina>) {
    return this.editar<Disciplina>('disciplinas', id, d);
  }
  borrarDisciplina(id: number) {
    return this.borrar('disciplinas', id);
  }

  horarios(filtros?: Filtros) {
    return this.lista<Horario>('horarios', filtros);
  }
  crearHorario(h: Partial<Horario>) {
    return this.crear<Horario>('horarios', h);
  }
  editarHorario(id: number, h: Partial<Horario>) {
    return this.editar<Horario>('horarios', id, h);
  }
  borrarHorario(id: number) {
    return this.borrar('horarios', id);
  }

  membresias(filtros?: Filtros) {
    return this.lista<Membresia>('membresias', filtros);
  }
  crearMembresia(m: Partial<Membresia>) {
    return this.crear<Membresia>('membresias', m);
  }
  editarMembresia(id: number, m: Partial<Membresia>) {
    return this.editar<Membresia>('membresias', id, m);
  }
  borrarMembresia(id: number) {
    return this.borrar('membresias', id);
  }

  maestros(filtros?: Filtros) {
    return this.lista<Maestro>('maestros', filtros);
  }
  crearMaestro(m: Partial<Maestro>) {
    return this.crear<Maestro>('maestros', m);
  }
  editarMaestro(id: number, m: Partial<Maestro>) {
    return this.editar<Maestro>('maestros', id, m);
  }
  borrarMaestro(id: number) {
    return this.borrar('maestros', id);
  }
  /** Solo admin. Sin 'password' genera una automática y la regresa en la respuesta. */
  restablecerPasswordMaestro(id: number, password?: string) {
    return this.http.post<{ detail: string; password_generada: string | null }>(
      `${API_BASE}/maestros/${id}/restablecer-password/`,
      password ? { password } : {},
    );
  }

  // --- Usuarios administrativos (staff/admin) — solo administrativos --------

  usuariosAdmin(filtros?: Filtros) {
    return this.lista<UsuarioAdministrativo>('usuarios', filtros);
  }
  /** Nace con la contraseña inicial; la respuesta la trae una sola vez en `password_inicial`. */
  crearUsuarioAdmin(u: Partial<UsuarioAdministrativo>) {
    return this.crear<UsuarioAdministrativo>('usuarios', u);
  }
  editarUsuarioAdmin(id: number, u: Partial<UsuarioAdministrativo>) {
    return this.editar<UsuarioAdministrativo>('usuarios', id, u);
  }
  restablecerPasswordUsuario(id: number, password?: string) {
    return this.http.post<{ detail: string; password_generada: string | null }>(
      `${API_BASE}/usuarios/${id}/restablecer-password/`,
      password ? { password } : {},
    );
  }

  // --- Pagos ---------------------------------------------------------------

  pagos(filtros?: Filtros) {
    return this.lista<Pago>('pagos', filtros);
  }
  crearPago(p: Partial<Pago>) {
    return this.crear<Pago>('pagos', p);
  }
  borrarPago(id: number) {
    return this.borrar('pagos', id);
  }
  resumenPagos() {
    return this.http.get<ResumenPagos>(`${API_BASE}/pagos/resumen/`);
  }

  // --- Pagos en línea (Stripe Checkout) --------------------------------------
  // Nunca se manda un monto: el backend toma el precio de la membresía en BD.

  /**
   * Alumno: sin argumentos paga su membresía actual. Administrativo: debe
   * indicar alumno_id y obtiene la liga para mandársela al alumno.
   */
  checkoutStripe(datos: { membresia_id?: number | null; alumno_id?: number | null } = {}) {
    const cuerpo: Record<string, number> = {};
    if (datos.membresia_id) cuerpo['membresia_id'] = datos.membresia_id;
    if (datos.alumno_id) cuerpo['alumno_id'] = datos.alumno_id;
    return this.http.post<CheckoutStripe>(`${API_BASE}/payments/checkout/`, cuerpo);
  }
  /** Estado de un pago por el session_id con el que Stripe regresa a /payment/success. */
  pagoStripePorSesion(sessionId: string) {
    return this.http.get<PagoStripe>(`${API_BASE}/payments/sesion/`, {
      params: aParams({ session_id: sessionId }),
    });
  }
  pagosStripe(filtros?: Filtros) {
    return this.lista<PagoStripe>('payments', filtros);
  }
  reembolsarPagoStripe(id: number) {
    return this.http.post<{ detail: string }>(`${API_BASE}/payments/${id}/reembolsar/`, {});
  }
  dashboardStripe() {
    return this.http.get<DashboardStripe>(`${API_BASE}/payments/dashboard/`);
  }
  cambiosStripe(desde: string) {
    return this.http.get<CambiosStripe>(`${API_BASE}/payments/cambios/`, {
      params: aParams({ desde }),
    });
  }
  saldoStripe() {
    return this.http.get<SaldoStripe>(`${API_BASE}/payments/saldo/`);
  }

  // --- Ventas (otros ingresos, aparte de membresías) ------------------------

  ventas(filtros?: Filtros) {
    return this.lista<Venta>('ventas', filtros);
  }
  crearVenta(v: Partial<Venta>) {
    return this.crear<Venta>('ventas', v);
  }
  borrarVenta(id: number) {
    return this.borrar('ventas', id);
  }
  resumenVentas() {
    return this.http.get<ResumenVentas>(`${API_BASE}/ventas/resumen/`);
  }

  // --- Asistencia ----------------------------------------------------------

  asistencias(filtros?: Filtros) {
    return this.lista<Asistencia>('asistencias', filtros);
  }
  crearAsistencia(a: Partial<Asistencia>) {
    return this.crear<Asistencia>('asistencias', a);
  }
  borrarAsistencia(id: number) {
    return this.borrar('asistencias', id);
  }
  asistenciasHoy() {
    return this.http.get<Asistencia[]>(`${API_BASE}/asistencias/hoy/`);
  }

  /** Pasar lista escaneando el QR del alumno. */
  checkin(codigo_qr: string, disciplina_id?: number | null, horario_id?: number | null) {
    return this.http.post<ResultadoCheckin>(`${API_BASE}/asistencias/checkin/`, {
      codigo_qr,
      disciplina_id: disciplina_id ?? null,
      horario_id: horario_id ?? null,
    });
  }
  /** El alumno registra su propia asistencia de hoy desde Mi perfil (queda como APP). */
  miCheckin(disciplina_id?: number | null) {
    return this.http.post<ResultadoCheckin>(`${API_BASE}/asistencias/mi-checkin/`, {
      disciplina_id: disciplina_id ?? null,
    });
  }
  /**
   * Registro manual (solo admin): identifica al alumno por id, no por QR,
   * queda marcado como MANUAL y admite fecha pasada. Misma respuesta que checkin.
   */
  registrarAsistenciaManual(datos: {
    alumno_id: number;
    disciplina_id?: number | null;
    horario_id?: number | null;
    fecha?: string | null;
  }) {
    return this.http.post<ResultadoCheckin>(`${API_BASE}/asistencias/manual/`, {
      alumno_id: datos.alumno_id,
      disciplina_id: datos.disciplina_id ?? null,
      horario_id: datos.horario_id ?? null,
      fecha: datos.fecha || null,
    });
  }

  // --- Notificaciones ------------------------------------------------------

  notificaciones(filtros?: Filtros) {
    return this.lista<Notificacion>('notificaciones', filtros);
  }
  marcarLeida(id: number) {
    return this.http.post<Notificacion>(`${API_BASE}/notificaciones/${id}/marcar-leida/`, {});
  }
  crearNotificacion(n: Partial<Notificacion>) {
    return this.crear<Notificacion>('notificaciones', n);
  }

  // --- Avisos (notificaciones administrativas: individual/grupo/todos) -----

  avisos(filtros?: Filtros) {
    return this.lista<Aviso>('avisos', filtros);
  }
  aviso(id: number) {
    return this.uno<Aviso>('avisos', id);
  }
  crearAviso(a: Partial<Aviso>) {
    return this.crear<Aviso>('avisos', a);
  }
  editarAviso(id: number, a: Partial<Aviso>) {
    return this.editar<Aviso>('avisos', id, a);
  }
  borrarAviso(id: number) {
    return this.borrar('avisos', id);
  }
  cancelarAviso(id: number) {
    return this.http.post<Aviso>(`${API_BASE}/avisos/${id}/cancelar/`, {});
  }

  // --- Comprobante de pago ---------------------------------------------------
  // Van por HttpClient (no <a href>/window.open directo): solo las peticiones
  // de HttpClient pasan por el tokenInterceptor — un link directo a un
  // endpoint autenticado con TokenAuthentication no manda el header y da 401.

  comprobanteHtml(pagoId: number) {
    return this.http.get(`${API_BASE}/pagos/${pagoId}/comprobante/`, { responseType: 'text' });
  }
  comprobantePdf(pagoId: number) {
    return this.http.get(`${API_BASE}/pagos/${pagoId}/comprobante/?formato=pdf`, {
      responseType: 'blob',
    });
  }

  // --- Torneos y grados ----------------------------------------------------

  torneos(filtros?: Filtros) {
    return this.lista<Torneo>('torneos', filtros);
  }
  crearTorneo(t: Partial<Torneo>) {
    return this.crear<Torneo>('torneos', t);
  }
  borrarTorneo(id: number) {
    return this.borrar('torneos', id);
  }

  grados(filtros?: Filtros) {
    return this.lista<Grado>('grados', filtros);
  }
  crearGrado(g: Partial<Grado>) {
    return this.crear<Grado>('grados', g);
  }
  borrarGrado(id: number) {
    return this.borrar('grados', id);
  }

  // --- Insignias -----------------------------------------------------------

  insignias(filtros?: Filtros) {
    return this.lista<Insignia>('insignias', filtros);
  }
  crearInsignia(i: Partial<Insignia>) {
    return this.crear<Insignia>('insignias', i);
  }
  editarInsignia(id: number, i: Partial<Insignia>) {
    return this.editar<Insignia>('insignias', id, i);
  }
  borrarInsignia(id: number) {
    return this.borrar('insignias', id);
  }
  otorgarInsignia(id: number, alumno_id: number) {
    return this.http.post(`${API_BASE}/insignias/${id}/otorgar/`, { alumno_id });
  }

  // --- Eventos (torneos/seminarios/exámenes con registro de participantes) -

  eventos(filtros?: Filtros) {
    return this.lista<Evento>('eventos', filtros);
  }
  evento(id: number) {
    return this.uno<Evento>('eventos', id);
  }
  crearEvento(e: Partial<Evento>) {
    return this.crear<Evento>('eventos', e);
  }
  editarEvento(id: number, e: Partial<Evento>) {
    return this.editar<Evento>('eventos', id, e);
  }
  borrarEvento(id: number) {
    return this.borrar('eventos', id);
  }

  inscripcionesEvento(filtros?: Filtros) {
    return this.lista<EventoInscripcion>('inscripciones-evento', filtros);
  }
  inscribirseEvento(evento: number) {
    return this.crear<EventoInscripcion>('inscripciones-evento', { evento });
  }
  /** Personal (admin/maestro) inscribe a un alumno concreto; el alumno usa inscribirseEvento(). */
  inscribirAlumnoEvento(evento: number, alumno: number) {
    return this.crear<EventoInscripcion>('inscripciones-evento', { evento, alumno });
  }
  cancelarInscripcion(id: number) {
    return this.borrar('inscripciones-evento', id);
  }
  marcarAsistencia(id: number, asistio: boolean) {
    return this.editar<EventoInscripcion>('inscripciones-evento', id, { asistio });
  }
  /** Captura (o corrige) el resultado del alumno en el evento: crea/actualiza su Torneo. */
  registrarResultadoEvento(
    inscripcionId: number,
    datos: { resultado: string; metodo?: string; notas?: string },
  ) {
    return this.http.post<EventoInscripcion>(
      `${API_BASE}/inscripciones-evento/${inscripcionId}/resultado/`,
      datos,
    );
  }
  quitarResultadoEvento(inscripcionId: number) {
    return this.http.delete<EventoInscripcion>(
      `${API_BASE}/inscripciones-evento/${inscripcionId}/resultado/`,
    );
  }

  // --- Evaluación MMA (habilidades por categoría, con historial) -----------

  /** Catálogo completo (7 categorías con sus habilidades activas): lo que pinta el formulario. */
  categoriasMMA() {
    return this.lista<CategoriaMMA>('categorias-mma', { page_size: 50 });
  }
  evaluacionesMMA(filtros?: Filtros) {
    return this.lista<EvaluacionMMA>('evaluaciones-mma', filtros);
  }
  evaluacionMMA(id: number) {
    return this.uno<EvaluacionMMA>('evaluaciones-mma', id);
  }
  crearEvaluacionMMA(e: Partial<EvaluacionMMA>) {
    return this.crear<EvaluacionMMA>('evaluaciones-mma', e);
  }
  editarEvaluacionMMA(id: number, e: Partial<EvaluacionMMA>) {
    return this.editar<EvaluacionMMA>('evaluaciones-mma', id, e);
  }
  borrarEvaluacionMMA(id: number) {
    return this.borrar('evaluaciones-mma', id);
  }
  /** Última evaluación finalizada con su desglose y la variación contra la anterior. */
  resumenEvaluacionMMA(alumnoId: number) {
    return this.http.get<ResumenEvaluacionMMA>(
      `${API_BASE}/alumnos/${alumnoId}/evaluacion-resumen/`,
    );
  }
  /** Serie cronológica de totales, para la gráfica de evolución. */
  historialEvaluacionMMA(alumnoId: number) {
    return this.http.get<PuntoHistorialMMA[]>(
      `${API_BASE}/alumnos/${alumnoId}/evaluacion-historial/`,
    );
  }

  // --- Dashboard -----------------------------------------------------------

  dashboard() {
    return this.http.get<Dashboard>(`${API_BASE}/dashboard/`);
  }
}
