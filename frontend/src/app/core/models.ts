/**
 * Interfaces espejo de los modelos del backend.
 * Los nombres de campo coinciden exactamente con lo que devuelve la API,
 * para no tener que mapear nada.
 */

export type Rol = 'ALUMNO' | 'MAESTRO' | 'ADMINISTRATIVO' | 'SIN_ROL';

export interface Usuario {
  id: number;
  username: string;
  email: string;
  nombre: string;
  rol: Rol;
  alumno_id: number | null;
  alumno?: Alumno;
  maestro_id: number | null;
  maestro?: Maestro;
}

export interface RespuestaLogin {
  token: string;
  usuario: Usuario;
}

/** Todas las listas del backend vienen paginadas. */
export interface Pagina<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Horario {
  id: number;
  hora_inicio: string;
  hora_fin: string;
  turno: string;
  turno_display?: string;
  dias: string[];
  /** Clase que se imparte en la franja, ej. "Striking" o "Jiu Jitsu Kids / Striking Kids". */
  nombre: string;
  total_alumnos?: number;
}

export interface Disciplina {
  id: number;
  nombre: string;
  descripcion: string;
  total_alumnos?: number;
}

export interface Membresia {
  id: number;
  nombre: string;
  duracion_dias: number;
  precio: string;
  /** Qué incluye el plan, ej. "2 disciplinas, horario fijo." */
  descripcion: string;
}

export interface MaestroDisciplina {
  id: number;
  maestro: number;
  disciplina: number;
  disciplina_nombre: string;
  fecha_inicio: string;
  es_titular: boolean;
}

export interface Maestro {
  id: number;
  nombre: string;
  edad: number | null;
  telefono: string;
  /** Correo de la cuenta ligada (maestro.usuario.email). Vacío si no tiene cuenta. */
  email: string;
  /** Usuario con el que entra a la app (maestro-<id>). Vacío si no tiene cuenta. */
  username: string;
  tiene_cuenta: boolean;
  foto: string | null;
  activo: boolean;
  codigo_qr: string;
  qr_imagen: string | null;
  asignaciones: MaestroDisciplina[];
  disciplinas_ids?: number[];
  /** Alcance: grupos (horarios) asignados y alumnos sueltos. Define qué alumnos ve. */
  horarios: { id: number; nombre: string }[];
  alumnos_asignados: { id: number; nombre_completo: string; apodo: string }[];
  /** Alumnos activos que ve en total (grupos + individuales, sin repetir). */
  total_alumnos: number;
  horarios_ids?: number[];
  alumnos_ids?: number[];
  /** Solo viene en la respuesta del alta (POST): contraseña con la que nace la cuenta. */
  password_inicial?: string;
}

/**
 * Cuenta del personal administrativo (staff/admin): es el User de Django con
 * is_staff. GET/POST/PATCH /api/usuarios/ (solo administrativos).
 */
export interface UsuarioAdministrativo {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  nombre: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  last_login: string | null;
  date_joined: string;
  /** Solo viene en la respuesta del alta (POST). */
  password_inicial?: string;
}

export interface AlumnoDisciplina {
  id: number;
  alumno: number;
  disciplina: number;
  disciplina_nombre: string;
  fecha_inicio: string;
}

export interface AlumnoInsignia {
  id: number;
  alumno: number;
  insignia: number;
  insignia_nombre: string;
  insignia_icono: string | null;
  fecha_obtencion: string;
}

/** Versión ligera que devuelve el listado. */
export interface AlumnoLista {
  id: number;
  nombres: string;
  apellidos: string;
  nombre_completo: string;
  apodo: string;
  foto: string | null;
  activo: boolean;
  puntos: number;
  record: string;
  horario: number | null;
  horario_display: string | null;
  membresia: number | null;
  membresia_nombre: string | null;
  al_corriente: boolean;
  dias_para_vencer: number | null;
}

/** Ficha técnica del alumno (una por alumno). La medición de habilidades vive en EvaluacionMMA. */
export interface Experiencia {
  id: number;
  alumno: number;
  bjj_cinturon: string;
  bjj_cinturon_display: string;
  numero_torneos: number;
  numero_sparrings: number;
  peleas_ganadas: number;
  peleas_perdidas: number;
  peleas_empatadas: number;
  total_peleas: number;
  metodo_victoria_favorito: string;
  peso_competencia: string | null;
  lesion_activa: boolean;
  detalle_lesion: string;
  notas_maestro: string;
  racha_asistencia: number;
  racha_maxima: number;
}

export interface Alumno {
  id: number;
  nombres: string;
  apellidos: string;
  nombre_completo: string;
  apodo: string;
  edad: number | null;
  peso_actual: string | null;
  /** En centímetros. */
  estatura: number | null;
  telefono: string;
  /** Correo de la cuenta ligada (alumno.usuario.email). Vacío si no tiene cuenta. */
  email: string;
  /** Usuario con el que entra a la app (alumno-<id>). Vacío si no tiene cuenta. */
  username: string;
  /** Independiente de 'email': puede tener cuenta con el correo borrado. */
  tiene_cuenta: boolean;
  foto: string | null;
  codigo_qr: string;
  qr_imagen: string | null;
  fecha_registro: string;
  horario: number | null;
  membresia: number | null;
  activo: boolean;
  puntos: number;
  experiencia: Experiencia | null;
  inscripciones: AlumnoDisciplina[];
  insignias_ganadas: AlumnoInsignia[];
  al_corriente: boolean;
  dias_para_vencer: number | null;
  fecha_vencimiento: string | null;
  record: string;
  total_asistencias: number;
  creado_en?: string;
  disciplinas_ids?: number[];
  /** Solo viene en la respuesta del alta (POST): contraseña con la que nace la cuenta. */
  password_inicial?: string;
}

export interface Pago {
  id: number;
  alumno: number;
  alumno_nombre: string;
  membresia: number | null;
  monto: string;
  metodo: string;
  fecha_pago: string;
  fecha_vencimiento: string | null;
  duracion: number | null;
  estatus: string;
  estatus_display: string;
  nota: string;
  comprobante_enviado_en: string | null;
}

// --- Pagos en línea (Stripe Checkout, /api/payments/) ----------------------
// El frontend solo dice QUÉ se compra (membresia_id); el precio, el cobro y la
// confirmación son del backend y de Stripe. Aquí nunca hay datos de tarjeta.

export type EstatusPagoStripe =
  | 'PENDIENTE'
  | 'PROCESANDO'
  | 'PAGADO'
  | 'FALLIDO'
  | 'CANCELADO'
  | 'REEMBOLSADO';

/** Intento de cobro en línea. Solo el webhook de Stripe lo mueve a PAGADO. */
export interface PagoStripe {
  id: number;
  referencia: string;
  alumno: number;
  alumno_nombre: string;
  membresia: number;
  membresia_nombre: string;
  monto: string;
  moneda: string;
  estatus: EstatusPagoStripe;
  estatus_display: string;
  checkout_url: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  /** Pago de membresía (core) que generó al confirmarse. */
  pago: number | null;
  pagado_en: string | null;
  detalle_error: string;
  creado_en: string;
  actualizado_en: string;
}

/** Respuesta de POST /payments/checkout/: a dónde mandar al usuario. */
export interface CheckoutStripe {
  id: number;
  referencia: string;
  checkout_url: string;
  monto: number | string;
  moneda: string;
}

/** Los totales del dashboard llegan como número (Decimal crudo en DRF). */
export interface SumaStripe {
  total: number | string;
  cantidad: number;
}

export interface DashboardStripe {
  /** Se manda tal cual a /cambios/?desde= para el tiempo real. */
  cursor: string;
  stripe: { configurado: boolean; webhook_configurado: boolean; modo: 'test' | 'live'; moneda: string };
  resumen: {
    periodo: string;
    cobrado_hoy: SumaStripe;
    cobrado_mes: SumaStripe;
    ticket_promedio_mes: number | string;
    reembolsado_mes: SumaStripe;
    pendientes: SumaStripe;
    por_estatus_mes: Record<EstatusPagoStripe, number>;
    tasa_conversion_mes: number;
  };
  serie_diaria: { dia: string; total: number | string; cantidad: number }[];
  por_membresia_mes: { membresia: number; membresia__nombre: string; total: number | string; cantidad: number }[];
  recientes: PagoStripe[];
  webhook: {
    ultimo_evento: { tipo: string; procesado_en: string } | null;
    eventos_24h: number;
  };
}

export interface CambiosStripe {
  cursor: string;
  hay_cambios: boolean;
  pagos: PagoStripe[];
}

export interface SaldoStripe {
  disponible: { moneda: string; monto: number | string }[];
  pendiente: { moneda: string; monto: number | string }[];
}

/**
 * Otro ingreso que no es membresía (inscripción, guantes, playera...).
 * Registro de caja aparte de Pago: no mueve vencimientos ni semáforo.
 */
export interface Venta {
  id: number;
  concepto: string;
  monto: string;
  metodo: string;
  metodo_display: string;
  fecha: string;
  alumno: number | null;
  alumno_nombre: string;
  nota: string;
  registrado_por: number | null;
  registrado_por_nombre: string;
  creado_en: string;
}

export interface ResumenVentas {
  periodo: string;
  total_vendido: number | string;
  numero_ventas: number;
  por_metodo: { metodo: string; total: string; cantidad: number }[];
  por_concepto: { concepto: string; total: string; cantidad: number }[];
}

export interface Asistencia {
  id: number;
  alumno: number;
  alumno_nombre: string;
  disciplina: number | null;
  disciplina_nombre: string | null;
  horario: number | null;
  registrada_por: number | null;
  fecha: string;
  hora_registro: string;
  metodo_registro: string;
  puntos_otorgados: number;
}

export interface Notificacion {
  id: number;
  alumno: number;
  alumno_nombre?: string;
  tipo: string;
  tipo_display: string;
  titulo: string;
  mensaje: string;
  fecha_envio: string;
  leida: boolean;
  canal: string;
  aviso: number | null;
  estado_correo: string;
  estado_correo_display: string;
  enviado_en: string | null;
  error_correo: string;
}

export type TipoDestinatario = 'INDIVIDUAL' | 'GRUPO' | 'TODOS';
export type EstadoAviso = 'PENDIENTE' | 'PROCESANDO' | 'ENVIADA' | 'FALLIDA' | 'CANCELADA';

export interface Aviso {
  id: number;
  titulo: string;
  mensaje: string;
  tipo_destinatario: TipoDestinatario;
  tipo_destinatario_display: string;
  alumno: number | null;
  alumno_nombre: string;
  horario: number | null;
  horario_display: string;
  creado_por: number | null;
  creado_por_username: string;
  estado: EstadoAviso;
  estado_display: string;
  total_destinatarios: number;
  total_enviadas: number;
  total_fallidas: number;
  creado_en: string;
  actualizado_en: string;
  procesado_en: string | null;
}

export interface Torneo {
  id: number;
  alumno: number;
  alumno_nombre: string;
  nombre_torneo: string;
  fecha: string;
  resultado: string;
  resultado_display: string;
  metodo: string;
  metodo_display: string;
  disciplina: number | null;
  /** Evento del que salió este resultado; null si se capturó a mano en la ficha. */
  evento: number | null;
  evento_titulo: string;
  notas: string;
}

/** Opciones de Torneo.Resultado y Torneo.Metodo (core.models.Torneo). */
export const RESULTADOS_TORNEO = [
  { valor: 'GANO', rotulo: 'Ganó' },
  { valor: 'PERDIO', rotulo: 'Perdió' },
  { valor: 'EMPATO', rotulo: 'Empató' },
] as const;

export const METODOS_TORNEO = [
  { valor: '', rotulo: 'Sin método' },
  { valor: 'KO', rotulo: 'KO/TKO' },
  { valor: 'SUMISION', rotulo: 'Sumisión' },
  { valor: 'DECISION', rotulo: 'Decisión' },
  { valor: 'DESCALIFICACION', rotulo: 'Descalificación' },
] as const;

export interface Grado {
  id: number;
  alumno: number;
  alumno_nombre: string;
  disciplina: number;
  disciplina_nombre: string;
  nombre_grado: string;
  fecha_obtencion: string;
  otorgado_por: number | null;
  otorgado_por_nombre: string | null;
  notas: string;
}

export type TipoEvento = 'TORNEO' | 'SEMINARIO' | 'EXAMEN' | 'OTRO';

export interface Evento {
  id: number;
  titulo: string;
  tipo: TipoEvento;
  tipo_display: string;
  fecha: string;
  lugar: string;
  descripcion: string;
  disciplina: number | null;
  disciplina_nombre: string;
  creado_por: number | null;
  creado_por_username: string;
  total_inscritos: number;
  /** null si quien consulta no es un alumno (admin/maestro). */
  inscrito: boolean | null;
  creado_en: string;
  actualizado_en: string;
}

export interface EventoInscripcion {
  id: number;
  evento: number;
  evento_titulo: string;
  alumno: number;
  alumno_nombre: string;
  fecha_inscripcion: string;
  asistio: boolean;
  /** Resultado del alumno en el evento (un Torneo ligado al evento); null si no se ha capturado. */
  torneo: Torneo | null;
}

export interface Insignia {
  id: number;
  nombre: string;
  descripcion: string;
  icono: string | null;
  criterio: { tipo?: string; valor?: number };
  puntos_bonus: number;
  activa: boolean;
  total_otorgadas?: number;
}

// ---------------------------------------------------------------------------
// Evaluación MMA (habilidades por categoría, con historial)
// Espejo de core/models.py (CategoriaMMA, HabilidadMMA, EvaluacionMMA,
// PuntajeHabilidadMMA) y de las cifras derivadas que agrega el serializer
// desde core/evaluacion_mma.py. Todo el cálculo vive en el backend.
// ---------------------------------------------------------------------------

export type EstadoEvaluacionMMA = 'BORRADOR' | 'FINALIZADA';
export type NivelMMA =
  | 'Inicial'
  | 'Principiante'
  | 'Básico'
  | 'Intermedio'
  | 'Avanzado'
  | 'Competitivo';

/** Escala 1-5 con la que se califica cada habilidad (PuntajeHabilidadMMA.ESCALA). */
export const ESCALA_MMA: { valor: number; texto: string }[] = [
  { valor: 1, texto: 'No domina la técnica' },
  { valor: 2, texto: 'Ejecuta la técnica con instrucción' },
  { valor: 3, texto: 'Ejecuta correctamente sin ayuda' },
  { valor: 4, texto: 'Ejecuta contra resistencia' },
  { valor: 5, texto: 'Ejecuta efectivamente durante sparring' },
];

export interface HabilidadMMA {
  id: number;
  categoria: number;
  nombre: string;
  orden: number;
  activa: boolean;
}

export interface CategoriaMMA {
  id: number;
  clave: string;
  nombre: string;
  puntos_maximos: number;
  orden: number;
  activa: boolean;
  habilidades: HabilidadMMA[];
}

export interface PuntajeHabilidadMMA {
  habilidad: number;
  habilidad_nombre?: string;
  categoria?: number;
  puntaje: number;
}

/** Desglose de una categoría dentro de una evaluación (calculado en el backend). */
export interface CategoriaCalculadaMMA {
  id: number;
  clave: string;
  nombre: string;
  puntaje: number;
  maximo: number;
  porcentaje: number;
  habilidades_evaluadas: number;
  habilidades_total: number;
  habilidades: { id: number; nombre: string; puntaje: number | null }[];
}

/** Indicador interno (0-100 cada componente). NO autoriza a competir. */
export interface PreparacionCompetencia {
  tecnica: number;
  fisica: number;
  defensa: number;
  tactica: number;
  disciplina: number;
  total: number;
}

export interface EvaluacionMMA {
  id: number;
  alumno: number;
  alumno_nombre: string;
  evaluador: number | null;
  evaluador_nombre: string;
  fecha: string;
  estado: EstadoEvaluacionMMA;
  estado_display: string;
  notas: string;
  puntajes: PuntajeHabilidadMMA[];
  creado_por: number | null;
  creado_por_username: string;
  creado_en: string;
  actualizado_en: string;
  // Derivado (solo lectura):
  categorias: CategoriaCalculadaMMA[];
  puntaje_total: number;
  puntaje_maximo: number;
  nivel: NivelMMA;
  preparacion: PreparacionCompetencia;
  completa: boolean;
}

/** GET /api/alumnos/{id}/evaluacion-resumen/ */
export interface ResumenEvaluacionMMA {
  alumno: number;
  total_evaluaciones: number;
  ultima: EvaluacionMMA | null;
  variacion: number | null;
  aviso_preparacion: string;
}

/** GET /api/alumnos/{id}/evaluacion-historial/ — un punto por evaluación finalizada, ascendente. */
export interface PuntoHistorialMMA {
  id: number;
  fecha: string;
  puntaje_total: number;
  puntaje_maximo: number;
  nivel: NivelMMA;
  preparacion_total: number;
  categorias: Record<string, number>;
}

/** Color del chip según la banda de nivel (mismo criterio en resumen, lista e historial). */
export function claseNivelMMA(nivel: NivelMMA | string): string {
  switch (nivel) {
    case 'Competitivo':
      return 'chip-rojo';
    case 'Avanzado':
      return 'chip-verde';
    case 'Intermedio':
    case 'Básico':
      return 'chip-amarillo';
    default:
      return 'chip-gris';
  }
}

/** Respuesta del endpoint de check-in por QR. */
export interface ResultadoCheckin {
  detail: string;
  alumno: {
    id: number;
    nombre: string;
    apodo: string;
    puntos: number;
    al_corriente: boolean;
    dias_para_vencer: number | null;
  };
  racha: number;
  puntos_otorgados: number;
  insignias_desbloqueadas: string[];
  asistencia_id: number;
  /** Fecha registrada (en manual puede ser pasada). */
  fecha?: string;
  metodo_registro?: 'QR' | 'MANUAL' | 'APP';
}

export interface Dashboard {
  alumnos: { total: number; activos: number; nuevos_mes: number; morosos: number };
  asistencias: { hoy: number; semana: number; mes: number };
  /** Cobrado en membresías este mes. */
  ingresos_mes: number | string;
  /** Otras ventas del mes (inscripciones, equipo...). */
  otros_ingresos_mes: number | string;
  por_disciplina: { id: number; nombre: string; alumnos_activos: number }[];
  por_horario: {
    id: number;
    turno: string;
    hora_inicio: string;
    hora_fin: string;
    alumnos_activos: number;
  }[];
  top_5: { id: number; nombres: string; apellidos: string; apodo: string; puntos: number }[];
  maestros_activos: number;
}

export interface PerfilAlumno {
  alumno: Alumno;
  estadisticas: {
    record: string;
    total_asistencias: number;
    asistencias_mes: number;
    racha_actual: number;
    racha_maxima: number;
    total_insignias: number;
    total_grados: number;
  };
  pago: {
    al_corriente: boolean;
    fecha_vencimiento: string | null;
    dias_para_vencer: number | null;
  };
}

export interface FilaRanking {
  posicion: number;
  id: number;
  nombre: string;
  apodo: string;
  puntos: number;
  foto: string | null;
}

export interface ResumenPagos {
  periodo: string;
  total_cobrado: number | string;
  numero_pagos: number;
  por_metodo: { metodo: string; total: string; cantidad: number }[];
  vencidos_historico: number;
}

/** Estado del semáforo de pago que pide la especificación. */
export type EstadoPago = 'AL_CORRIENTE' | 'POR_VENCER' | 'VENCIDO' | 'SIN_PAGOS';

export function estadoPago(
  alCorriente: boolean,
  diasParaVencer: number | null,
  umbral = 5,
): EstadoPago {
  if (diasParaVencer === null || diasParaVencer === undefined) return 'SIN_PAGOS';
  if (!alCorriente) return 'VENCIDO';
  return diasParaVencer <= umbral ? 'POR_VENCER' : 'AL_CORRIENTE';
}
