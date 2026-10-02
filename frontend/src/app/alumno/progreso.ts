import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Alumno, Grado, Torneo } from '../core/models';
import { CargandoComponent, VacioComponent } from '../shared/ui';
import { EvaluacionMMAPanel } from '../shared/evaluacion-mma-panel';

@Component({
  selector: 'cb-mi-progreso',
  standalone: true,
  imports: [CommonModule, CargandoComponent, VacioComponent, EvaluacionMMAPanel],
  template: `
    @if (cargando()) {
      <cb-cargando />
    } @else if (alumno(); as a) {
      <div class="pila">
        <h1>Mi progreso</h1>

        <!-- ===== EVALUACIÓN MMA: score /100, nivel, preparación e historial (solo lectura) ===== -->
        <cb-evaluacion-mma-panel [alumnoId]="a.id" />

        <!-- ===== RÉCORD Y NÚMEROS ===== -->
        @if (exp(); as e) {
          <section class="tarjeta">
            <h2 class="titulo-seccion">Récord de competencia</h2>

            <div class="record-grande mono">
              <div><span class="n g">{{ e.peleas_ganadas }}</span><span class="etiqueta">Ganadas</span></div>
              <div><span class="n p">{{ e.peleas_perdidas }}</span><span class="etiqueta">Perdidas</span></div>
              <div><span class="n">{{ e.peleas_empatadas }}</span><span class="etiqueta">Empates</span></div>
            </div>

            <div class="grid grid-3 datos">
              <div><span class="etiqueta">Cinturón BJJ</span><strong>{{ e.bjj_cinturon_display }}</strong></div>
              <div><span class="etiqueta">Torneos</span><strong class="mono">{{ e.numero_torneos }}</strong></div>
              <div><span class="etiqueta">Sparrings</span><strong class="mono">{{ e.numero_sparrings }}</strong></div>
              <div>
                <span class="etiqueta">Victoria favorita</span>
                <strong>{{ e.metodo_victoria_favorito || '—' }}</strong>
              </div>
              <div>
                <span class="etiqueta">Peso de competencia</span>
                <strong class="mono">{{ e.peso_competencia ? e.peso_competencia + ' kg' : '—' }}</strong>
              </div>
              <div>
                <span class="etiqueta">Estado físico</span>
                @if (e.lesion_activa) {
                  <strong style="color:var(--rojo-claro)">Lesionado</strong>
                } @else {
                  <strong style="color:#4ade80">Sano</strong>
                }
              </div>
            </div>

            @if (e.lesion_activa && e.detalle_lesion) {
              <div class="aviso aviso-error" style="margin-top:14px">
                <strong>Lesión registrada:</strong> {{ e.detalle_lesion }}
              </div>
            }
          </section>

          <!-- ===== NOTAS DEL MAESTRO ===== -->
          @if (e.notas_maestro) {
            <section class="tarjeta notas">
              <h2 class="titulo-seccion">Notas del maestro</h2>
              <blockquote>{{ e.notas_maestro }}</blockquote>
            </section>
          }
        }

        <!-- ===== LÍNEA DE TIEMPO ===== -->
        <section class="tarjeta">
          <h2 class="titulo-seccion">Torneos y grados</h2>

          @if (linea().length) {
            <ol class="linea">
              @for (h of linea(); track h.clave) {
                <li [class.grado]="h.tipo === 'grado'">
                  <span class="punto"></span>
                  <div class="hito">
                    <div class="fila-entre">
                      <strong>{{ h.titulo }}</strong>
                      <span class="mini tenue mono">{{ h.fecha }}</span>
                    </div>
                    @if (h.detalle) {
                      <span class="mini tenue">{{ h.detalle }}</span>
                    }
                  </div>
                </li>
              }
            </ol>
          } @else {
            <cb-vacio
              icono="🏆"
              titulo="Sin historial todavía"
              detalle="Aquí aparecerán tus torneos y cambios de grado."
            />
          }
        </section>
      </div>
    }
  `,
  styles: [
    `
      .record-grande {
        display: flex;
        gap: 26px;
        margin-bottom: 18px;
        flex-wrap: wrap;
      }
      .record-grande div {
        display: flex;
        flex-direction: column;
      }
      .n {
        font-family: 'Oswald', sans-serif;
        font-size: 2.3rem;
        font-weight: 700;
        line-height: 1;
      }
      .n.g {
        color: #4ade80;
      }
      .n.p {
        color: var(--rojo-claro);
      }

      .datos div {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .notas blockquote {
        margin: 0 0 8px;
        padding: 12px 14px;
        border-left: 3px solid var(--rojo);
        background: var(--negro-900);
        border-radius: 0 var(--r-sm) var(--r-sm) 0;
        font-style: italic;
        color: var(--texto-suave);
      }

      .linea {
        list-style: none;
        margin: 0;
        padding: 0 0 0 20px;
        position: relative;
      }
      .linea::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 6px;
        bottom: 6px;
        width: 1px;
        background: var(--borde);
      }
      .linea li {
        position: relative;
        padding: 0 0 16px;
      }
      .linea li:last-child {
        padding-bottom: 0;
      }
      .punto {
        position: absolute;
        left: -20px;
        top: 6px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--rojo);
        box-shadow: 0 0 0 3px var(--negro-800);
      }
      .linea li.grado .punto {
        background: var(--amarillo);
      }
      .hito {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
    `,
  ],
})
export class MiProgreso {
  private api = inject(ApiService);

  alumno = signal<Alumno | null>(null);
  torneos = signal<Torneo[]>([]);
  grados = signal<Grado[]>([]);
  cargando = signal(true);

  exp = computed(() => this.alumno()?.experiencia ?? null);

  /** Torneos y grados fundidos en una sola línea de tiempo descendente. */
  linea = computed(() => {
    const hitos = [
      ...this.torneos().map((t) => ({
        clave: `t${t.id}`,
        tipo: 'torneo' as const,
        fecha: t.fecha,
        titulo: t.nombre_torneo,
        detalle: [t.resultado_display, t.metodo].filter(Boolean).join(' · '),
      })),
      ...this.grados().map((g) => ({
        clave: `g${g.id}`,
        tipo: 'grado' as const,
        fecha: g.fecha_obtencion,
        titulo: g.nombre_grado,
        detalle: [g.disciplina_nombre, g.otorgado_por_nombre].filter(Boolean).join(' · '),
      })),
    ];
    return hitos.sort((x, y) => y.fecha.localeCompare(x.fecha));
  });

  constructor() {
    forkJoin({
      alumno: this.api.yo(),
      torneos: this.api.torneos(),
      grados: this.api.grados(),
    }).subscribe({
      next: (r) => {
        this.alumno.set(r.alumno);
        this.torneos.set(r.torneos.results);
        this.grados.set(r.grados.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
