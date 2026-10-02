import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import {
  CategoriaMMA,
  ESCALA_MMA,
  EstadoEvaluacionMMA,
  EvaluacionMMA,
  Maestro,
} from '../core/models';
import { CargandoComponent } from './ui';

/**
 * Formulario de evaluación MMA: una calificación 1-5 por cada habilidad del
 * catálogo (api.categoriasMMA), agrupadas por categoría. Sirve para crear
 * (evaluacion = null) y para editar. Como cb-experiencia-form, el componente
 * hace su propia llamada de guardado y emite el resultado.
 *
 * Aquí solo hay validación de UX (fecha, habilidades faltantes); las reglas
 * de negocio y el cálculo del score los hace el backend, y sus mensajes de
 * error se muestran tal cual.
 */
@Component({
  selector: 'cb-evaluacion-mma-form',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent],
  template: `
    @if (cargandoCatalogo()) {
      <cb-cargando texto="Cargando catálogo de habilidades" />
    } @else {
      @if (error()) {
        <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
      }

      <div class="grid grid-2">
        <div class="campo">
          <label for="ev-fecha">Fecha de la evaluación *</label>
          <input id="ev-fecha" type="date" [max]="hoy" [(ngModel)]="fecha" />
        </div>
        @if (maestros().length) {
          <div class="campo">
            <label for="ev-evaluador">Evaluador</label>
            <select id="ev-evaluador" [(ngModel)]="evaluador">
              <option [ngValue]="null">—</option>
              @for (m of maestros(); track m.id) {
                <option [ngValue]="m.id">{{ m.nombre }}</option>
              }
            </select>
          </div>
        }
      </div>

      <details class="escala-ayuda">
        <summary class="mini">¿Qué significa cada número? (escala 1-5)</summary>
        <ol>
          @for (e of escala; track e.valor) {
            <li><strong class="mono">{{ e.valor }}</strong> {{ e.texto }}</li>
          }
        </ol>
      </details>

      <div class="progreso">
        <span class="mini tenue mono">
          {{ calificadas() }} / {{ totalHabilidades() }} habilidades calificadas
        </span>
        <div class="barra-pista">
          <div class="barra-valor" [style.width.%]="pctCalificadas()"></div>
        </div>
      </div>

      @for (c of categorias(); track c.id) {
        <section class="categoria">
          <div class="fila-entre">
            <h3>
              {{ c.nombre }}
              <span class="mini tenue pts">· {{ c.puntos_maximos }} pts</span>
            </h3>
            <span class="mini tenue mono">{{ calificadasEn(c) }}/{{ c.habilidades.length }}</span>
          </div>

          @for (h of c.habilidades; track h.id) {
            <div class="habilidad">
              <span class="nombre">{{ h.nombre }}</span>
              <div class="escala-btns" role="radiogroup" [attr.aria-label]="h.nombre">
                @for (e of escala; track e.valor) {
                  <button
                    type="button"
                    class="chip"
                    [class.chip-rojo]="puntajes()[h.id] === e.valor"
                    [class.chip-gris]="puntajes()[h.id] !== e.valor"
                    [title]="e.texto"
                    [attr.aria-pressed]="puntajes()[h.id] === e.valor"
                    (click)="calificar(h.id, e.valor)"
                  >
                    {{ e.valor }}
                  </button>
                }
              </div>
            </div>
          }
        </section>
      }

      <div class="campo">
        <label for="ev-notas">Notas del evaluador</label>
        <textarea id="ev-notas" rows="3" [(ngModel)]="notas"></textarea>
      </div>

      <div class="acciones">
        <button type="button" class="btn" (click)="cancelar.emit()">Cancelar</button>
        <span class="crece"></span>
        <button
          type="button"
          class="btn"
          [disabled]="guardando() || calificadas() === 0"
          (click)="guardar('BORRADOR')"
        >
          Guardar borrador
        </button>
        <button
          type="button"
          class="btn btn-rojo"
          [disabled]="guardando() || !completa()"
          [title]="completa() ? '' : 'Califica todas las habilidades para poder finalizar'"
          (click)="guardar('FINALIZADA')"
        >
          {{ guardando() ? 'Guardando...' : 'Finalizar evaluación' }}
        </button>
      </div>
      @if (!completa() && totalHabilidades() > 0) {
        <p class="mini tenue faltan">
          Faltan {{ totalHabilidades() - calificadas() }} habilidades para poder finalizar.
          Puedes guardar como borrador y terminar después.
        </p>
      }
    }
  `,
  styles: [
    `
      .escala-ayuda {
        margin: -4px 0 14px;
      }
      .escala-ayuda summary {
        cursor: pointer;
        color: var(--rojo-claro);
      }
      .escala-ayuda ol {
        margin: 8px 0 0;
        padding-left: 18px;
        color: var(--texto-suave);
        font-size: 0.85rem;
      }
      .escala-ayuda li strong {
        color: var(--rojo-claro);
        margin-right: 6px;
      }
      .progreso {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 16px;
      }
      .categoria {
        padding: 12px 0 6px;
        border-top: 1px solid var(--borde-suave);
      }
      .categoria h3 {
        margin: 0 0 8px;
        font-size: 0.95rem;
      }
      .pts {
        text-transform: none;
        letter-spacing: 0;
        font-family: 'Inter', sans-serif;
        font-weight: 400;
      }
      .habilidad {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
        flex-wrap: wrap;
      }
      .nombre {
        font-size: 0.88rem;
        flex: 1;
        min-width: 160px;
      }
      .escala-btns {
        display: flex;
        gap: 4px;
      }
      .escala-btns .chip {
        cursor: pointer;
        font-family: 'Oswald', sans-serif;
        font-size: 0.85rem;
        width: 34px;
        height: 30px;
        justify-content: center;
        padding: 0;
        border-radius: var(--r-sm);
        transition: all 0.1s;
      }
      .escala-btns .chip:hover {
        border-color: var(--rojo);
        color: var(--texto);
      }
      .acciones {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      .faltan {
        text-align: right;
        margin: 8px 0 0;
      }
    `,
  ],
})
export class EvaluacionMMAForm {
  private api = inject(ApiService);

  alumnoId = input.required<number>();
  /** null = nueva evaluación; con valor = editar esa evaluación. */
  evaluacion = input<EvaluacionMMA | null>(null);
  /** Solo el admin elige evaluador; al maestro el backend lo asigna solo. */
  maestros = input<Maestro[]>([]);

  guardado = output<EvaluacionMMA>();
  cancelar = output<void>();

  categorias = signal<CategoriaMMA[]>([]);
  cargandoCatalogo = signal(true);
  guardando = signal(false);
  error = signal('');
  /** habilidad.id -> puntaje 1-5 */
  puntajes = signal<Record<number, number>>({});

  escala = ESCALA_MMA;
  hoy = new Date().toISOString().slice(0, 10);

  fecha = this.hoy;
  notas = '';
  evaluador: number | null = null;

  totalHabilidades = computed(() =>
    this.categorias().reduce((s, c) => s + c.habilidades.length, 0),
  );
  calificadas = computed(() => {
    const p = this.puntajes();
    return this.categorias().reduce(
      (s, c) => s + c.habilidades.filter((h) => p[h.id] !== undefined).length,
      0,
    );
  });
  completa = computed(
    () => this.totalHabilidades() > 0 && this.calificadas() === this.totalHabilidades(),
  );
  pctCalificadas = computed(() =>
    this.totalHabilidades() ? (this.calificadas() / this.totalHabilidades()) * 100 : 0,
  );

  constructor() {
    this.api.categoriasMMA().subscribe({
      next: (p) => {
        this.categorias.set(p.results);
        this.cargandoCatalogo.set(false);
      },
      error: () => {
        this.cargandoCatalogo.set(false);
        this.error.set('No se pudo cargar el catálogo de habilidades.');
      },
    });

    // Al cambiar la evaluación a editar (o volver a "nueva") se vuelca el formulario.
    effect(() => {
      const e = this.evaluacion();
      this.error.set('');
      if (e) {
        this.fecha = e.fecha;
        this.notas = e.notas;
        this.evaluador = e.evaluador;
        this.puntajes.set(Object.fromEntries(e.puntajes.map((p) => [p.habilidad, p.puntaje])));
      } else {
        this.fecha = this.hoy;
        this.notas = '';
        this.evaluador = null;
        this.puntajes.set({});
      }
    });
  }

  calificadasEn(c: CategoriaMMA): number {
    const p = this.puntajes();
    return c.habilidades.filter((h) => p[h.id] !== undefined).length;
  }

  calificar(habilidadId: number, valor: number): void {
    this.puntajes.update((p) => ({ ...p, [habilidadId]: valor }));
  }

  guardar(estado: EstadoEvaluacionMMA): void {
    if (!this.fecha) {
      this.error.set('La fecha de la evaluación es obligatoria.');
      return;
    }
    if (this.fecha > this.hoy) {
      this.error.set('La fecha de la evaluación no puede ser futura.');
      return;
    }
    if (this.calificadas() === 0) {
      this.error.set('Califica al menos una habilidad.');
      return;
    }
    if (estado === 'FINALIZADA' && !this.completa()) {
      this.error.set(
        `Faltan ${this.totalHabilidades() - this.calificadas()} habilidades por calificar. ` +
          'Guarda como borrador si aún no terminas.',
      );
      return;
    }

    const payload: Partial<EvaluacionMMA> = {
      alumno: this.alumnoId(),
      fecha: this.fecha,
      notas: this.notas,
      evaluador: this.evaluador,
      estado,
      puntajes: Object.entries(this.puntajes()).map(([habilidad, puntaje]) => ({
        habilidad: +habilidad,
        puntaje,
      })),
    };

    this.guardando.set(true);
    this.error.set('');
    const actual = this.evaluacion();
    const peticion = actual
      ? this.api.editarEvaluacionMMA(actual.id, payload)
      : this.api.crearEvaluacionMMA(payload);

    peticion.subscribe({
      next: (ev) => {
        this.guardando.set(false);
        this.guardado.emit(ev);
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.mensajeError(e));
      },
    });
  }

  /** Aplana los errores de DRF ({campo: [msgs]} o {detail}) a una sola línea. */
  private mensajeError(e: { error?: unknown }): string {
    const d = e?.error;
    if (d && typeof d === 'object') {
      const textos = Object.values(d as Record<string, unknown>)
        .flat()
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
      if (textos.length) return textos.join(' ');
    }
    return 'No se pudo guardar la evaluación.';
  }
}
