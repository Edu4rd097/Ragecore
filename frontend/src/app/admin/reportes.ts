import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AlumnoLista, Asistencia, Pago } from '../core/models';
import { CargandoComponent } from '../shared/ui';
import { AbsPipe } from '../shared/pipes';

@Component({
  selector: 'cb-admin-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, AbsPipe],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <h1 style="margin:0">Reportes</h1>
        <div class="fila">
          <div class="campo" style="margin:0">
            <label for="rdesde">Desde</label>
            <input id="rdesde" type="date" [(ngModel)]="desde" />
          </div>
          <div class="campo" style="margin:0">
            <label for="rhasta">Hasta</label>
            <input id="rhasta" type="date" [(ngModel)]="hasta" />
          </div>
          <button class="btn btn-rojo" [disabled]="cargando()" (click)="cargar()">
            Generar
          </button>
        </div>
      </div>

      @if (cargando()) {
        <cb-cargando texto="Generando reportes" />
      } @else if (generado()) {
        <!-- ===== INGRESOS ===== -->
        <section class="tarjeta">
          <div class="fila-entre">
            <h2 class="titulo-seccion" style="margin:0">Ingresos por método</h2>
            <button class="btn btn-mini" (click)="exportarCSV(csvPagos(), 'ingresos.csv')">
              ↓ CSV
            </button>
          </div>

          <div class="grid grid-3" style="margin:14px 0">
            @for (m of resumenMetodos(); track m.metodo) {
              <div class="tarjeta kpi-mini">
                <span class="etiqueta">{{ m.metodo | titlecase }}</span>
                <span class="n-kpi mono">\${{ moneda(m.total) }}</span>
                <span class="mini tenue">{{ m.count }} pagos</span>
              </div>
            }
            <div class="tarjeta kpi-mini total">
              <span class="etiqueta">Total del periodo</span>
              <span class="n-kpi mono">\${{ moneda(totalPeriodo()) }}</span>
              <span class="mini tenue">{{ pagos().length }} movimientos</span>
            </div>
          </div>

          <div class="tabla-scroll">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Alumno</th><th>Membresía</th><th>Método</th><th>Monto</th></tr>
              </thead>
              <tbody>
                @for (p of pagos(); track p.id) {
                  <tr>
                    <td class="mono mini">{{ p.fecha_pago }}</td>
                    <td>{{ p.alumno_nombre }}</td>
                    <td class="mini tenue">{{ p.duracion }} días</td>
                    <td class="mini">{{ p.metodo }}</td>
                    <td class="mono">\${{ p.monto }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- ===== ASISTENCIA ===== -->
        <section class="tarjeta">
          <div class="fila-entre">
            <h2 class="titulo-seccion" style="margin:0">Asistencia general</h2>
            <button class="btn btn-mini" (click)="exportarCSV(csvAsistencia(), 'asistencia.csv')">
              ↓ CSV
            </button>
          </div>

          <div class="grid grid-3" style="margin:14px 0">
            <div class="tarjeta kpi-mini">
              <span class="etiqueta">Total clases</span>
              <span class="n-kpi mono">{{ asistencias().length }}</span>
            </div>
            <div class="tarjeta kpi-mini">
              <span class="etiqueta">Alumnos distintos</span>
              <span class="n-kpi mono">{{ alumnosDistintos() }}</span>
            </div>
            <div class="tarjeta kpi-mini">
              <span class="etiqueta">Promedio diario</span>
              <span class="n-kpi mono">{{ promedioDiario() }}</span>
            </div>
          </div>

          <!-- Distribución por disciplina (barras SVG) -->
          @if (porDisciplina().length) {
            <div class="por-disciplina">
              @for (d of porDisciplina(); track d.nombre) {
                <div class="fila-barra">
                  <span class="rotulo mini">{{ d.nombre }}</span>
                  <div class="barra-pista crece">
                    <div class="barra-valor" [style.width.%]="d.pct"></div>
                  </div>
                  <span class="mono mini valor">{{ d.total }}</span>
                </div>
              }
            </div>
          }
        </section>

        <!-- ===== RETENCIÓN ===== -->
        <section class="tarjeta">
          <div class="fila-entre">
            <h2 class="titulo-seccion" style="margin:0">Retención / Deserción</h2>
            <button class="btn btn-mini" (click)="exportarCSV(csvRetencion(), 'retencion.csv')">
              ↓ CSV
            </button>
          </div>

          <div class="grid grid-3" style="margin:14px 0">
            <div class="tarjeta kpi-mini">
              <span class="etiqueta">Alumnos activos</span>
              <span class="n-kpi mono">{{ activos().length }}</span>
            </div>
            <div class="tarjeta kpi-mini">
              <span class="etiqueta">Alumnos inactivos</span>
              <span class="n-kpi mono">{{ inactivos().length }}</span>
            </div>
            <div class="tarjeta kpi-mini" [class.total]="retension() >= 80">
              <span class="etiqueta">Tasa de retención</span>
              <span class="n-kpi mono">{{ retension() }}%</span>
            </div>
          </div>

          <h3>Con pago vencido</h3>
          @if (morosos().length) {
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr><th>Alumno</th><th>Último pago</th><th>Días vencido</th><th>Membresía</th></tr>
                </thead>
                <tbody>
                  @for (a of morosos(); track a.id) {
                    <tr>
                      <td>{{ a.nombre_completo }}</td>
                      <td class="mono mini">{{ a.fecha_vencimiento_display }}</td>
                      <td class="mono" style="color:var(--rojo-claro)">
                        {{ a.dias | abs }}d
                      </td>
                      <td class="mini">{{ a.membresia_nombre ?? '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="mini tenue">¡Ningún alumno con pago vencido en el periodo!</p>
          }
        </section>
      } @else {
        <div class="hint tarjeta">
          <div class="icono-grande">📊</div>
          <p>Selecciona un rango de fechas y presiona <strong>Generar</strong> para ver los reportes.</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .kpi-mini {
        display: flex;
        flex-direction: column;
        gap: 2px;
        border-left: 3px solid var(--rojo);
      }
      .kpi-mini.total {
        border-left-color: #22c55e;
      }
      .n-kpi {
        font-family: 'Oswald', sans-serif;
        font-size: 1.6rem;
        font-weight: 600;
        color: var(--rojo-claro);
        line-height: 1.1;
      }
      .kpi-mini.total .n-kpi {
        color: #4ade80;
      }
      .por-disciplina {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 14px;
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
        width: 34px;
        text-align: right;
        color: var(--rojo-claro);
        font-weight: 600;
      }
      .hint {
        text-align: center;
        padding: 40px;
      }
      .icono-grande {
        font-size: 3rem;
        margin-bottom: 12px;
      }
    `,
  ],
})
export class AdminReportes {
  private api = inject(ApiService);

  pagos = signal<Pago[]>([]);
  asistencias = signal<Asistencia[]>([]);
  todosAlumnos = signal<AlumnoLista[]>([]);
  cargando = signal(false);
  generado = signal(false);

  desde = this.primeroDeMes();
  hasta = new Date().toISOString().slice(0, 10);

  private primeroDeMes(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  moneda(v: number | string): string {
    return Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // --- Ingresos ---

  totalPeriodo = computed(() =>
    this.pagos().reduce((s, p) => s + parseFloat(p.monto || '0'), 0),
  );

  resumenMetodos = computed(() => {
    const mapa = new Map<string, { total: number; count: number }>();
    for (const p of this.pagos()) {
      const v = mapa.get(p.metodo) ?? { total: 0, count: 0 };
      mapa.set(p.metodo, { total: v.total + parseFloat(p.monto), count: v.count + 1 });
    }
    return [...mapa.entries()].map(([metodo, v]) => ({ metodo, ...v }));
  });

  // --- Asistencia ---

  alumnosDistintos = computed(() => new Set(this.asistencias().map((a) => a.alumno)).size);

  promedioDiario = computed(() => {
    const dias = Math.max(
      1,
      Math.ceil((new Date(this.hasta).getTime() - new Date(this.desde).getTime()) / 86400000),
    );
    return (this.asistencias().length / dias).toFixed(1);
  });

  porDisciplina = computed(() => {
    const mapa = new Map<string, number>();
    for (const a of this.asistencias()) {
      const k = a.disciplina_nombre ?? 'Sin disciplina';
      mapa.set(k, (mapa.get(k) ?? 0) + 1);
    }
    const max = Math.max(1, ...[...mapa.values()]);
    return [...mapa.entries()]
      .map(([nombre, total]) => ({ nombre, total, pct: (total / max) * 100 }))
      .sort((a, b) => b.total - a.total);
  });

  // --- Retención ---

  activos = computed(() => this.todosAlumnos().filter((a) => a.activo));
  inactivos = computed(() => this.todosAlumnos().filter((a) => !a.activo));

  retension = computed(() => {
    const total = this.todosAlumnos().length;
    return total ? Math.round((this.activos().length / total) * 100) : 0;
  });

  morosos = computed(() => {
    return this.todosAlumnos()
      .filter((a) => a.activo && !a.al_corriente)
      .map((a) => ({
        ...a,
        dias: a.dias_para_vencer ?? 0,
        fecha_vencimiento_display: a.dias_para_vencer !== null
          ? new Date(Date.now() + a.dias_para_vencer! * 86400000).toLocaleDateString('es-MX')
          : '—',
      }))
      .sort((a, b) => a.dias - b.dias);
  });

  // --- Exportación CSV ---

  csvPagos(): string {
    const cab = 'Fecha,Alumno,Metodo,Monto,Vigencia_dias\n';
    return cab + this.pagos()
      .map((p) => `${p.fecha_pago},"${p.alumno_nombre}",${p.metodo},${p.monto},${p.duracion ?? ''}`)
      .join('\n');
  }

  csvAsistencia(): string {
    const cab = 'Fecha,Alumno,Disciplina,Metodo\n';
    return cab + this.asistencias()
      .map((a) => `${a.fecha},"${a.alumno_nombre}","${a.disciplina_nombre ?? ''}",${a.metodo_registro}`)
      .join('\n');
  }

  csvRetencion(): string {
    const cab = 'Alumno,Activo,Al_corriente,Dias_para_vencer,Membresia\n';
    return cab + this.todosAlumnos()
      .map((a) => `"${a.nombre_completo}",${a.activo},${a.al_corriente},${a.dias_para_vencer ?? ''},"${a.membresia_nombre ?? ''}"`)
      .join('\n');
  }

  exportarCSV(contenido: string, nombre: string): void {
    const blob = new Blob(['\uFEFF' + contenido], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  cargar(): void {
    this.cargando.set(true);
    forkJoin({
      pagos: this.api.pagos({ fecha_pago__gte: this.desde, fecha_pago__lte: this.hasta, page_size: 500 }),
      asistencias: this.api.asistencias({ fecha__gte: this.desde, fecha__lte: this.hasta, page_size: 1000 }),
      alumnos: this.api.alumnos({ page_size: 500 }),
    }).subscribe({
      next: (r) => {
        this.pagos.set(r.pagos.results);
        this.asistencias.set(r.asistencias.results);
        this.todosAlumnos.set(r.alumnos.results);
        this.cargando.set(false);
        this.generado.set(true);
      },
      error: () => this.cargando.set(false),
    });
  }
}
