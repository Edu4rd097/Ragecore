/**
 * Datos de prueba para los specs de la Evaluación MMA. Reflejan la forma
 * exacta que devuelve el backend (core/serializers.py + core/evaluacion_mma.py).
 */
import {
  CategoriaCalculadaMMA,
  CategoriaMMA,
  EvaluacionMMA,
  NivelMMA,
  PuntoHistorialMMA,
  ResumenEvaluacionMMA,
} from '../core/models';

/** Catálogo reducido: 2 categorías, 3 habilidades en total. */
export const CATALOGO_MOCK: CategoriaMMA[] = [
  {
    id: 1,
    clave: 'striking',
    nombre: 'Striking',
    puntos_maximos: 20,
    orden: 1,
    activa: true,
    habilidades: [
      { id: 11, categoria: 1, nombre: 'Guardia', orden: 1, activa: true },
      { id: 12, categoria: 1, nombre: 'Jab', orden: 2, activa: true },
    ],
  },
  {
    id: 2,
    clave: 'disciplina',
    nombre: 'Disciplina',
    puntos_maximos: 5,
    orden: 2,
    activa: true,
    habilidades: [{ id: 21, categoria: 2, nombre: 'Asistencia', orden: 1, activa: true }],
  },
];

export function categoriaCalculada(
  base: Partial<CategoriaCalculadaMMA> = {},
): CategoriaCalculadaMMA {
  return {
    id: 1,
    clave: 'striking',
    nombre: 'Striking',
    puntaje: 12,
    maximo: 20,
    porcentaje: 60,
    habilidades_evaluadas: 2,
    habilidades_total: 2,
    habilidades: [
      { id: 11, nombre: 'Guardia', puntaje: 3 },
      { id: 12, nombre: 'Jab', puntaje: 3 },
    ],
    ...base,
  };
}

export function evaluacionMock(base: Partial<EvaluacionMMA> = {}): EvaluacionMMA {
  return {
    id: 5,
    alumno: 7,
    alumno_nombre: 'Ana Prueba',
    evaluador: 2,
    evaluador_nombre: 'Coach BJJ',
    fecha: '2026-08-01',
    estado: 'FINALIZADA',
    estado_display: 'Finalizada',
    notas: 'Buen avance',
    puntajes: [
      { habilidad: 11, puntaje: 3 },
      { habilidad: 12, puntaje: 3 },
      { habilidad: 21, puntaje: 3 },
    ],
    creado_por: 1,
    creado_por_username: 'admin',
    creado_en: '2026-08-01T10:00:00Z',
    actualizado_en: '2026-08-01T10:00:00Z',
    categorias: [
      categoriaCalculada(),
      categoriaCalculada({
        id: 2,
        clave: 'disciplina',
        nombre: 'Disciplina',
        puntaje: 3,
        maximo: 5,
        habilidades_evaluadas: 1,
        habilidades_total: 1,
        habilidades: [{ id: 21, nombre: 'Asistencia', puntaje: 3 }],
      }),
    ],
    puntaje_total: 60,
    puntaje_maximo: 100,
    nivel: 'Intermedio',
    preparacion: { tecnica: 60, fisica: 60, defensa: 60, tactica: 60, disciplina: 60, total: 60 },
    completa: true,
    ...base,
  };
}

export function resumenMock(base: Partial<ResumenEvaluacionMMA> = {}): ResumenEvaluacionMMA {
  return {
    alumno: 7,
    total_evaluaciones: 2,
    ultima: evaluacionMock(),
    variacion: 8.5,
    aviso_preparacion: 'Indicador interno. No autoriza a competir.',
    ...base,
  };
}

export function puntoHistorial(
  id: number,
  fecha: string,
  puntaje_total: number,
  nivel: NivelMMA,
): PuntoHistorialMMA {
  return {
    id,
    fecha,
    puntaje_total,
    puntaje_maximo: 100,
    nivel,
    preparacion_total: Math.round(puntaje_total),
    categorias: { striking: puntaje_total / 5 },
  };
}

export const HISTORIAL_MOCK: PuntoHistorialMMA[] = [
  puntoHistorial(1, '2026-03-10', 52, 'Básico'),
  puntoHistorial(2, '2026-05-10', 61, 'Intermedio'),
  puntoHistorial(3, '2026-08-01', 74, 'Intermedio'),
];
