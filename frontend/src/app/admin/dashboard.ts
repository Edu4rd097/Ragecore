import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Dashboard } from '../core/models';
import { CargandoComponent, KpiComponent } from '../shared/ui';

@Component({
  selector: 'cb-dashboard-admin',
  standalone: true,
  imports: [CommonModule, RouterLink, KpiComponent, CargandoComponent],
  template: `
    @if (cargando()) {
      <cb-cargando texto="Cargando el panel" />
    } @else if (d(); as datos) {
      <div class="pila">
        <div class="fila-entre envuelve">
          <h1 style="margin:0">Panel</h1>
          <a routerLink="/admin/asistencia" class="btn btn-rojo">Pasar lista</a>
        </div>

        <!-- ===== KPIs ===== -->
        <div class="grid grid-4">
          <cb-kpi
            etiqueta="Alumnos activos"
            [valor]="datos.alumnos.activos"
            [pie]="datos.alumnos.total + ' en total · ' + datos.alumnos.nuevos_mes + ' altas este mes'"
          />
          <cb-kpi
            etiqueta="Con pago vencido"
            [valor]="datos.alumnos.morosos"
            [alerta]="datos.alumnos.morosos > 0"
            pie="Requieren seguimiento"
          />
          <cb-kpi
            etiqueta="Asistencias hoy"
            [valor]="datos.asistencias.hoy"
            [pie]="datos.asistencias.semana + ' esta semana'"
          />
          <cb-kpi
            etiqueta="Membresías del mes"
            [valor]="'$' + moneda(datos.ingresos_mes)"
            [pie]="'+ $' + moneda(datos.otros_ingresos_mes) + ' en otras ventas'"
          />
        </div>

        <div class="grid grid-2">
          <!-- ===== BARRAS POR DISCIPLINA ===== -->
          <section class="tarjeta">
            <h2 class="titulo-seccion">Alumnos por disciplina</h2>

            @if (disciplinasOrdenadas().length) {
              <div class="barras">
                @for (dd of disciplinasOrdenadas(); track dd.id) {
                  <div class="fila-barra">
                    <span class="rotulo mini">{{ dd.nombre }}</span>
                    <div class="barra-pista crece">
                      <div class="barra-valor" [style.width.%]="pct(dd.alumnos_activos)"></div>
                    </div>
                    <span class="mono mini valor">{{ dd.alumnos_activos }}</span>
                  </div>
                }
              </div>
            } @else {
              <p class="mini tenue">Sin disciplinas registradas.</p>
            }
          </section>

          <!-- ===== DONA POR HORARIO ===== -->
          <section class="tarjeta">
            <h2 class="titulo-seccion">Ocupación por horario</h2>

            @if (totalHorarios() > 0) {
              <div class="dona-fila">
                <svg viewBox="0 0 42 42" class="dona" role="img" aria-label="Alumnos por horario">
                  @for (s of segmentos(); track s.id) {
                    <circle
                      cx="21"
                      cy="21"
                      r="15.9"
                      fill="transparent"
                      [attr.stroke]="s.color"
                      stroke-width="6"
                      [attr.stroke-dasharray]="s.dash"
                      [attr.stroke-dashoffset]="s.offset"
                    />
                  }
                  <text x="21" y="20.5" class="dona-num">{{ totalHorarios() }}</text>
                  <text x="21" y="24.5" class="dona-txt">alumnos</text>
                </svg>

                <ul class="leyenda">
                  @for (s of segmentos(); track s.id) {
                    <li>
                      <span class="punto" [style.background]="s.color"></span>
                      <span class="crece mini">{{ s.etiqueta }}</span>
                      <span class="mono mini">{{ s.valor }}</span>
                    </li>
                  }
                </ul>
              </div>
            } @else {
              <p class="mini tenue">Sin horarios con alumnos asignados.</p>
            }
          </section>
        </div>

        <!-- ===== TOP 5 ===== -->
        <section class="tarjeta">
          <div class="fila-entre" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">Ranking de puntos</h2>
            <a routerLink="/admin/alumnos" class="mini">Ver todos</a>
          </div>

          @if (datos.top_5.length) {
            <ol class="podio">
              @for (a of datos.top_5; track a.id; let i = $index) {
                <li>
                  <span class="pos" [class.oro]="i === 0">{{ i + 1 }}</span>
                  <a [routerLink]="['/admin/alumnos', a.id]" class="crece nombre">
                    {{ a.nombres }} {{ a.apellidos }}
                    @if (a.apodo) {
                      <span class="tenue mini">"{{ a.apodo }}"</span>
                    }
                  </a>
                  <span class="mono pts">{{ a.puntos }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="mini tenue">Aún no hay puntos acumulados.</p>
          }
        </section>

        <!-- ===== ACCESOS ===== -->
        <section>
          <h2 class="titulo-seccion">Accesos directos</h2>
          <div class="grid grid-4">
            @for (a of accesos; track a.ruta) {
              <a [routerLink]="a.ruta" class="tarjeta tarjeta-btn acceso">
                <span class="ico">{{ a.icono }}</span>
                <span class="rot">{{ a.rotulo }}</span>
              </a>
            }
          </div>
        </section>
      </div>
    }
  `,
  styles: [
    `
      .barras {
        display: flex;
        flex-direction: column;
        gap: 11px;
      }
      .fila-barra {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .rotulo {
        width: 110px;
        flex: none;
        color: var(--texto-suave);
      }
      .valor {
        width: 30px;
        text-align: right;
        color: var(--rojo-claro);
        font-weight: 600;
      }

      .dona-fila {
        display: flex;
        align-items: center;
        gap: 18px;
        flex-wrap: wrap;
      }
      .dona {
        width: 140px;
        flex: none;
        transform: rotate(-90deg);
      }
      .dona-num,
      .dona-txt {
        transform: rotate(90deg);
        transform-origin: 21px 21px;
        text-anchor: middle;
        font-family: 'Oswald', sans-serif;
      }
      .dona-num {
        font-size: 6px;
        fill: var(--texto);
        font-weight: 700;
      }
      .dona-txt {
        font-size: 2.4px;
        fill: var(--texto-tenue);
        letter-spacing: 0.16em;
      }
      .leyenda {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1;
        min-width: 160px;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .leyenda li {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .punto {
        width: 9px;
        height: 9px;
        border-radius: 2px;
        flex: none;
      }

      .podio {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .podio li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 6px;
        border-bottom: 1px solid var(--borde-suave);
      }
      .podio li:last-child {
        border-bottom: none;
      }
      .pos {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--negro-700);
        font-family: 'Oswald', sans-serif;
        font-size: 0.78rem;
        flex: none;
      }
      .pos.oro {
        background: var(--rojo);
        color: #fff;
      }
      .nombre {
        color: var(--texto);
        text-decoration: none;
      }
      .nombre:hover {
        color: var(--rojo-claro);
      }
      .pts {
        color: var(--rojo-claro);
        font-weight: 600;
      }

      .acceso {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        text-decoration: none;
        color: var(--texto);
        padding: 18px 10px;
      }
      .ico {
        font-size: 1.5rem;
      }
      .rot {
        font-family: 'Oswald', sans-serif;
        font-size: 0.76rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        text-align: center;
      }
    `,
  ],
})
export class DashboardAdmin {
  private api = inject(ApiService);

  d = signal<Dashboard | null>(null);
  cargando = signal(true);

  private paleta = ['#0095ff', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];

  accesos = [
    { ruta: '/admin/alumnos', icono: '🥊', rotulo: 'Alumnos' },
    { ruta: '/admin/pagos', icono: '💳', rotulo: 'Pagos' },
    { ruta: '/admin/maestros', icono: '👤', rotulo: 'Maestros' },
    { ruta: '/admin/reportes', icono: '📈', rotulo: 'Reportes' },
  ];

  disciplinasOrdenadas = computed(() =>
    [...(this.d()?.por_disciplina ?? [])].sort((a, b) => b.alumnos_activos - a.alumnos_activos),
  );

  private maxDisciplina = computed(() =>
    Math.max(1, ...this.disciplinasOrdenadas().map((x) => x.alumnos_activos)),
  );

  pct(v: number): number {
    return (v / this.maxDisciplina()) * 100;
  }

  totalHorarios = computed(() =>
    (this.d()?.por_horario ?? []).reduce((s, h) => s + h.alumnos_activos, 0),
  );

  /**
   * Segmentos de la dona. Cada círculo usa stroke-dasharray sobre una
   * circunferencia de 100 unidades, así el número es directamente el porcentaje.
   */
  segmentos = computed(() => {
    const total = this.totalHorarios();
    if (!total) return [];
    let acumulado = 0;
    return (this.d()?.por_horario ?? [])
      .filter((h) => h.alumnos_activos > 0)
      .map((h, i) => {
        const pct = (h.alumnos_activos / total) * 100;
        const seg = {
          id: h.id,
          etiqueta: `${h.turno} ${(h.hora_inicio ?? '').slice(0, 5)}`,
          valor: h.alumnos_activos,
          color: this.paleta[i % this.paleta.length],
          dash: `${pct} ${100 - pct}`,
          offset: 25 - acumulado,
        };
        acumulado += pct;
        return seg;
      });
  });

  moneda(v: number | string): string {
    return Number(v || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
  }

  constructor() {
    this.api.dashboard().subscribe({
      next: (r) => {
        this.d.set(r);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
