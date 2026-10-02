import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Alumno, Asistencia } from '../core/models';
import { CargandoComponent, VacioComponent } from '../shared/ui';

interface Celda {
  fecha: string;
  dia: number;
  clases: number;
  delMes: boolean;
}

@Component({
  selector: 'cb-mi-asistencia',
  standalone: true,
  imports: [CommonModule, CargandoComponent, VacioComponent],
  template: `
    @if (cargando()) {
      <cb-cargando />
    } @else {
      <div class="pila">
        <h1>Mi asistencia</h1>

        <!-- Resumen -->
        <div class="grid grid-3">
          <div class="tarjeta destacado">
            <span class="etiqueta">Racha actual</span>
            <span class="grande mono">{{ racha() }}</span>
          </div>
          <div class="tarjeta destacado">
            <span class="etiqueta">Puntos</span>
            <span class="grande mono">{{ alumno()?.puntos ?? 0 }}</span>
          </div>
          <div class="tarjeta destacado">
            <span class="etiqueta">Clases este mes</span>
            <span class="grande mono">{{ delMes() }}</span>
          </div>
        </div>

        <!-- Calendario -->
        <section class="tarjeta">
          <div class="fila-entre" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">{{ etiquetaMes() }}</h2>
            <div class="fila">
              <button class="btn btn-mini" (click)="mover(-1)" aria-label="Mes anterior">‹</button>
              <button class="btn btn-mini" (click)="mover(1)" [disabled]="esMesActual()" aria-label="Mes siguiente">›</button>
            </div>
          </div>

          <div class="cal-cabeza">
            @for (d of diasSemana; track d) {
              <span class="etiqueta">{{ d }}</span>
            }
          </div>

          <div class="cal">
            @for (c of celdas(); track c.fecha) {
              <div
                class="celda"
                [class.fuera]="!c.delMes"
                [class.n1]="c.clases === 1"
                [class.n2]="c.clases >= 2"
                [title]="c.clases ? c.fecha + ': ' + c.clases + ' clase(s)' : c.fecha"
              >
                {{ c.dia }}
              </div>
            }
          </div>

          <div class="leyenda mini tenue">
            <span>Menos</span>
            <span class="muestra"></span>
            <span class="muestra n1"></span>
            <span class="muestra n2"></span>
            <span>Más</span>
          </div>
        </section>

        <!-- Historial -->
        <section class="tarjeta">
          <h2 class="titulo-seccion">Últimas clases</h2>

          @if (asistencias().length) {
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Disciplina</th>
                    <th>Registro</th>
                    <th>Puntos</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of asistencias().slice(0, 40); track a.id) {
                    <tr>
                      <td class="mono">{{ a.fecha }}</td>
                      <td>{{ a.disciplina_nombre ?? '—' }}</td>
                      <td>
                        <span class="chip chip-gris">
                          {{ a.metodo_registro === 'QR' ? 'QR' : 'Manual' }}
                        </span>
                      </td>
                      <td class="mono">+{{ a.puntos_otorgados }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <cb-vacio icono="📅" titulo="Sin asistencias" detalle="Tu primera clase aparecerá aquí." />
          }
        </section>
      </div>
    }
  `,
  styles: [
    `
      .destacado {
        display: flex;
        flex-direction: column;
      }
      .grande {
        font-family: 'Oswald', sans-serif;
        font-size: 2rem;
        font-weight: 600;
        color: var(--rojo-claro);
        line-height: 1.1;
      }
      .cal-cabeza,
      .cal {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 5px;
      }
      .cal-cabeza {
        margin-bottom: 6px;
        text-align: center;
      }
      .celda {
        aspect-ratio: 1;
        display: grid;
        place-items: center;
        border-radius: var(--r-sm);
        background: var(--negro-900);
        border: 1px solid var(--borde-suave);
        font-size: 0.76rem;
        color: var(--texto-tenue);
        font-variant-numeric: tabular-nums;
      }
      .celda.fuera {
        opacity: 0.25;
      }
      .celda.n1 {
        background: rgba(0, 149, 255, 0.35);
        border-color: rgba(0, 149, 255, 0.5);
        color: #fff;
      }
      .celda.n2 {
        background: var(--rojo);
        border-color: var(--rojo-claro);
        color: #fff;
        font-weight: 600;
      }
      .leyenda {
        display: flex;
        align-items: center;
        gap: 6px;
        justify-content: flex-end;
        margin-top: 12px;
      }
      .muestra {
        width: 13px;
        height: 13px;
        border-radius: 3px;
        background: var(--negro-900);
        border: 1px solid var(--borde);
      }
      .muestra.n1 {
        background: rgba(0, 149, 255, 0.35);
      }
      .muestra.n2 {
        background: var(--rojo);
      }
    `,
  ],
})
export class MiAsistencia {
  private api = inject(ApiService);

  alumno = signal<Alumno | null>(null);
  asistencias = signal<Asistencia[]>([]);
  cargando = signal(true);

  /** Mes que se está viendo, como Date del día 1. */
  mes = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  diasSemana = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  racha = computed(() => this.alumno()?.experiencia?.racha_asistencia ?? 0);

  private porFecha = computed(() => {
    const mapa = new Map<string, number>();
    for (const a of this.asistencias()) {
      mapa.set(a.fecha, (mapa.get(a.fecha) ?? 0) + 1);
    }
    return mapa;
  });

  delMes = computed(() => {
    const m = this.mes();
    const prefijo = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    return this.asistencias().filter((a) => a.fecha.startsWith(prefijo)).length;
  });

  etiquetaMes = computed(() =>
    this.mes()
      .toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
      .replace(/^\w/, (c) => c.toUpperCase()),
  );

  esMesActual = computed(() => {
    const hoy = new Date();
    return (
      this.mes().getMonth() === hoy.getMonth() && this.mes().getFullYear() === hoy.getFullYear()
    );
  });

  /** Rejilla de 6 semanas que empieza en lunes. */
  celdas = computed<Celda[]>(() => {
    const m = this.mes();
    const primero = new Date(m.getFullYear(), m.getMonth(), 1);
    // getDay() da 0=domingo; lo giramos para que la semana arranque en lunes.
    const desplazamiento = (primero.getDay() + 6) % 7;
    const inicio = new Date(primero);
    inicio.setDate(1 - desplazamiento);

    const salida: Celda[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
      salida.push({
        fecha: iso,
        dia: d.getDate(),
        clases: this.porFecha().get(iso) ?? 0,
        delMes: d.getMonth() === m.getMonth(),
      });
    }
    return salida;
  });

  mover(delta: number): void {
    const m = this.mes();
    this.mes.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  constructor() {
    forkJoin({
      alumno: this.api.yo(),
      asistencias: this.api.asistencias({ page_size: 200 }),
    }).subscribe({
      next: (r) => {
        this.alumno.set(r.alumno);
        this.asistencias.set(r.asistencias.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
