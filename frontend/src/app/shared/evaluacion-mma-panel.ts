import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import {
  EvaluacionMMA,
  Maestro,
  PuntoHistorialMMA,
  ResumenEvaluacionMMA,
  claseNivelMMA,
} from '../core/models';
import { EvaluacionMMAForm } from './evaluacion-mma-form';
import { EvaluacionMMAHistorial } from './evaluacion-mma-historial';
import { EvaluacionMMAResumen } from './evaluacion-mma-resumen';
import { CargandoComponent, ModalComponent } from './ui';

/**
 * Panel completo de Evaluación MMA de UN alumno: resumen (última evaluación),
 * evolución (historial) y lista de evaluaciones con detalle. Con
 * `editable` agrega alta/edición/borrado (admin y maestro); sin él es la vista
 * de solo lectura del alumno. Un solo componente para las tres pantallas —
 * la pestaña de admin/alumno-detalle.ts, el modal de maestro/alumnos.ts y
 * alumno/progreso.ts — para no repetir la carga ni los modales.
 */
@Component({
  selector: 'cb-evaluacion-mma-panel',
  standalone: true,
  imports: [
    CommonModule,
    CargandoComponent,
    ModalComponent,
    EvaluacionMMAResumen,
    EvaluacionMMAHistorial,
    EvaluacionMMAForm,
  ],
  template: `
    @if (cargando()) {
      <cb-cargando texto="Cargando evaluación MMA" />
    } @else if (errorCarga()) {
      <div class="aviso aviso-error fila-entre envuelve">
        <span>{{ errorCarga() }}</span>
        <button type="button" class="btn btn-mini btn-fantasma" (click)="cargar()">Reintentar</button>
      </div>
    } @else {
      <div class="pila">
        @if (mensaje()) {
          <div class="aviso" [class.aviso-ok]="!esError()" [class.aviso-error]="esError()">
            {{ mensaje() }}
          </div>
        }

        <section class="tarjeta">
          <div class="fila-entre envuelve" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">Evaluación MMA</h2>
            @if (editable()) {
              <button type="button" class="btn btn-rojo btn-mini" (click)="nueva()">
                + Nueva evaluación
              </button>
            }
          </div>
          <cb-evaluacion-mma-resumen [resumen]="resumen()" />
        </section>

        <section class="tarjeta">
          <h2 class="titulo-seccion">Evolución</h2>
          <cb-evaluacion-mma-historial [puntos]="historial()" />
        </section>

        <section class="tarjeta">
          <h2 class="titulo-seccion">Evaluaciones registradas ({{ lista().length }})</h2>
          @if (lista().length) {
            <div class="tabla-scroll">
              <table class="lista-evaluaciones">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Score</th>
                    <th>Nivel</th>
                    <th>Preparación</th>
                    <th>Evaluador</th>
                    @if (editable()) {
                      <th></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (e of lista(); track e.id) {
                    <tr class="clicable" (click)="detalle.set(e)">
                      <td class="mono">{{ e.fecha }}</td>
                      <td>
                        <span class="chip" [class]="e.estado === 'FINALIZADA' ? 'chip-verde' : 'chip-gris'">
                          {{ e.estado_display }}
                        </span>
                      </td>
                      <td class="mono">
                        {{ e.puntaje_total }}<span class="mini tenue">/{{ e.puntaje_maximo }}</span>
                      </td>
                      <td><span class="chip" [class]="claseNivel(e.nivel)">{{ e.nivel }}</span></td>
                      <td class="mono">{{ e.preparacion.total }}</td>
                      <td class="mini">{{ e.evaluador_nombre || '—' }}</td>
                      @if (editable()) {
                        <td class="acciones" (click)="$event.stopPropagation()">
                          <button type="button" class="btn btn-mini" (click)="editar(e)">Editar</button>
                          <button
                            type="button"
                            class="btn btn-mini btn-fantasma"
                            (click)="borrar(e)"
                            aria-label="Eliminar evaluación"
                          >
                            ✕
                          </button>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="mini tenue" style="margin:0">Todavía no hay evaluaciones registradas.</p>
          }
        </section>
      </div>
    }

    <!-- ===== MODAL: NUEVA / EDITAR ===== -->
    @if (modalForm()) {
      <cb-modal
        [titulo]="editando() ? 'Editar evaluación del ' + editando()!.fecha : 'Nueva evaluación MMA'"
        [amplio]="true"
        (cerrar)="cerrarForm()"
      >
        <cb-evaluacion-mma-form
          [alumnoId]="alumnoId()"
          [evaluacion]="editando()"
          [maestros]="maestros()"
          (guardado)="guardadoOk($event)"
          (cancelar)="cerrarForm()"
        />
      </cb-modal>
    }

    <!-- ===== MODAL: DETALLE ===== -->
    @if (detalle(); as d) {
      <cb-modal [titulo]="'Evaluación del ' + d.fecha" [amplio]="true" (cerrar)="detalle.set(null)">
        <div class="fila envuelve cabecera-detalle">
          <span class="chip" [class]="d.estado === 'FINALIZADA' ? 'chip-verde' : 'chip-gris'">
            {{ d.estado_display }}
          </span>
          <span class="chip" [class]="claseNivel(d.nivel)">{{ d.nivel }}</span>
          <span class="score mono">
            {{ d.puntaje_total }}<span class="mini tenue">/{{ d.puntaje_maximo }}</span>
          </span>
          <span class="mini tenue">Preparación {{ d.preparacion.total }}/100</span>
          @if (d.evaluador_nombre) {
            <span class="mini tenue">· {{ d.evaluador_nombre }}</span>
          }
        </div>

        <div class="grid grid-2">
          @for (c of d.categorias; track c.id) {
            <section class="cat-detalle">
              <div class="fila-entre">
                <strong>{{ c.nombre }}</strong>
                <span class="mono">{{ c.puntaje }}<span class="mini tenue">/{{ c.maximo }}</span></span>
              </div>
              <ul>
                @for (h of c.habilidades; track h.id) {
                  <li class="fila-entre">
                    <span class="mini">{{ h.nombre }}</span>
                    <span class="mono puntaje" [class.sin]="h.puntaje === null">
                      {{ h.puntaje ?? '—' }}<span class="tenue">/5</span>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        @if (d.notas) {
          <blockquote class="notas">{{ d.notas }}</blockquote>
        }

        <div pie>
          @if (editable()) {
            <button type="button" class="btn" (click)="editar(d); detalle.set(null)">Editar</button>
          }
          <button type="button" class="btn" (click)="detalle.set(null)">Cerrar</button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
      .acciones {
        white-space: nowrap;
      }
      .acciones .btn + .btn {
        margin-left: 6px;
      }
      .cabecera-detalle {
        margin-bottom: 16px;
      }
      .score {
        font-family: 'Oswald', sans-serif;
        font-size: 1.4rem;
        font-weight: 600;
        color: var(--rojo-claro);
      }
      .cat-detalle {
        background: var(--negro-900);
        border: 1px solid var(--borde-suave);
        border-radius: var(--r-sm);
        padding: 10px 12px;
      }
      .cat-detalle ul {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .puntaje {
        color: var(--rojo-claro);
        font-weight: 600;
      }
      .puntaje.sin {
        color: var(--texto-tenue);
        font-weight: 400;
      }
      .notas {
        margin: 16px 0 0;
        padding: 12px 14px;
        border-left: 3px solid var(--rojo);
        background: var(--negro-900);
        border-radius: 0 var(--r-sm) var(--r-sm) 0;
        font-style: italic;
        color: var(--texto-suave);
      }
    `,
  ],
})
export class EvaluacionMMAPanel {
  private api = inject(ApiService);

  alumnoId = input.required<number>();
  editable = input(false);
  /** Lista para que el admin elija evaluador; el maestro no la necesita. */
  maestros = input<Maestro[]>([]);

  cargando = signal(true);
  errorCarga = signal('');
  mensaje = signal('');
  esError = signal(false);

  resumen = signal<ResumenEvaluacionMMA | null>(null);
  historial = signal<PuntoHistorialMMA[]>([]);
  lista = signal<EvaluacionMMA[]>([]);

  modalForm = signal(false);
  editando = signal<EvaluacionMMA | null>(null);
  detalle = signal<EvaluacionMMA | null>(null);

  claseNivel = claseNivelMMA;

  constructor() {
    // Se recarga si el alumno cambia (ej. el maestro abre otro alumno).
    effect(() => {
      const id = this.alumnoId();
      untracked(() => this.cargar(id));
    });
  }

  cargar(id = this.alumnoId(), silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    this.errorCarga.set('');
    forkJoin({
      resumen: this.api.resumenEvaluacionMMA(id),
      historial: this.api.historialEvaluacionMMA(id),
      lista: this.api.evaluacionesMMA({ alumno: id, page_size: 100 }),
    }).subscribe({
      next: (r) => {
        this.resumen.set(r.resumen);
        this.historial.set(r.historial);
        this.lista.set(r.lista.results);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.errorCarga.set('No se pudo cargar la evaluación MMA.');
      },
    });
  }

  nueva(): void {
    this.editando.set(null);
    this.modalForm.set(true);
  }

  editar(e: EvaluacionMMA): void {
    this.editando.set(e);
    this.modalForm.set(true);
  }

  cerrarForm(): void {
    this.modalForm.set(false);
    this.editando.set(null);
  }

  guardadoOk(e: EvaluacionMMA): void {
    this.cerrarForm();
    this.avisar(e.estado === 'FINALIZADA' ? 'Evaluación finalizada.' : 'Borrador guardado.');
    this.cargar(this.alumnoId(), true);
  }

  borrar(e: EvaluacionMMA): void {
    if (!confirm(`¿Eliminar la evaluación del ${e.fecha}? Esta acción no se puede deshacer.`)) return;
    this.api.borrarEvaluacionMMA(e.id).subscribe({
      next: () => {
        this.avisar('Evaluación eliminada.');
        this.cargar(this.alumnoId(), true);
      },
      error: () => this.avisar('No se pudo eliminar la evaluación.', true),
    });
  }

  private avisar(texto: string, error = false): void {
    this.esError.set(error);
    this.mensaje.set(texto);
    setTimeout(() => this.mensaje.set(''), 4000);
  }
}
