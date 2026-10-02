import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { PuntoHistorialMMA, claseNivelMMA } from '../core/models';
import { VacioComponent } from './ui';

/**
 * Evolución del score general (/100) a lo largo de las evaluaciones
 * finalizadas: gráfica de línea en SVG dibujada a mano (el proyecto no usa
 * librería de gráficas — mismo criterio que el radar de alumno/progreso.ts y
 * las barras de admin/reportes.ts) más la tabla con cada punto.
 */
@Component({
  selector: 'cb-evaluacion-mma-historial',
  standalone: true,
  imports: [CommonModule, VacioComponent],
  template: `
    @if (puntos().length) {
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        class="grafica"
        role="img"
        aria-label="Evolución del score general"
      >
        @for (g of rejilla; track g) {
          <line
            [attr.x1]="padL"
            [attr.x2]="W - padR"
            [attr.y1]="y(g)"
            [attr.y2]="y(g)"
            stroke="var(--negro-600)"
            stroke-width="1"
          />
          <text [attr.x]="padL - 6" [attr.y]="y(g) + 3" class="eje">{{ g }}</text>
        }

        @if (coords().length > 1) {
          <polygon [attr.points]="area()" fill="rgba(0, 149, 255, 0.14)" />
          <polyline
            [attr.points]="trazo()"
            fill="none"
            stroke="var(--rojo)"
            stroke-width="2"
            stroke-linejoin="round"
          />
        }

        @for (c of coords(); track c.punto.id) {
          <circle
            [attr.cx]="c.x"
            [attr.cy]="c.y"
            r="4"
            fill="var(--rojo)"
            stroke="var(--negro-900)"
            stroke-width="2"
          >
            <title>{{ c.punto.fecha }}: {{ c.punto.puntaje_total }} · {{ c.punto.nivel }}</title>
          </circle>
          <text [attr.x]="c.x" [attr.y]="c.y - 9" class="valor">{{ c.punto.puntaje_total }}</text>
          @if (c.etiqueta) {
            <text [attr.x]="c.x" [attr.y]="H - 6" class="eje fecha">{{ c.etiqueta }}</text>
          }
        }
      </svg>

      <div class="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Score</th>
              <th>Nivel</th>
              <th>Preparación</th>
              <th>Cambio</th>
            </tr>
          </thead>
          <tbody>
            @for (f of filas(); track f.punto.id) {
              <tr>
                <td class="mono">{{ f.punto.fecha }}</td>
                <td class="mono">
                  {{ f.punto.puntaje_total }}<span class="mini tenue">/{{ f.punto.puntaje_maximo }}</span>
                </td>
                <td><span class="chip" [class]="claseNivel(f.punto.nivel)">{{ f.punto.nivel }}</span></td>
                <td class="mono">{{ f.punto.preparacion_total }}</td>
                <td class="mono" [class.sube]="f.cambio! > 0" [class.baja]="f.cambio! < 0">
                  {{ f.cambio === null ? '—' : f.cambio > 0 ? '+' + f.cambio : f.cambio }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <cb-vacio
        icono="📈"
        titulo="Sin historial"
        detalle="Cada evaluación finalizada agrega un punto a la gráfica."
      />
    }
  `,
  styles: [
    `
      .grafica {
        width: 100%;
        max-width: 640px;
        display: block;
        margin: 0 auto 16px;
      }
      .eje {
        font-family: 'Oswald', sans-serif;
        font-size: 8px;
        fill: var(--texto-tenue);
        text-anchor: end;
      }
      .eje.fecha {
        text-anchor: middle;
        letter-spacing: 0.04em;
      }
      .valor {
        font-family: 'Oswald', sans-serif;
        font-size: 9px;
        font-weight: 600;
        fill: var(--texto);
        text-anchor: middle;
      }
      td.sube {
        color: #4ade80;
      }
      td.baja {
        color: var(--rojo-claro);
      }
    `,
  ],
})
export class EvaluacionMMAHistorial {
  puntos = input.required<PuntoHistorialMMA[]>();

  readonly W = 360;
  readonly H = 170;
  readonly padL = 30;
  readonly padR = 12;
  readonly padT = 18;
  readonly padB = 24;
  readonly rejilla = [0, 25, 50, 75, 100];

  claseNivel = claseNivelMMA;

  /** Coordenada vertical para un valor 0-100. */
  y(valor: number): number {
    const alto = this.H - this.padT - this.padB;
    return +(this.padT + alto - (Math.min(100, Math.max(0, valor)) / 100) * alto).toFixed(1);
  }

  coords = computed(() => {
    const pts = this.puntos();
    const n = pts.length;
    const ancho = this.W - this.padL - this.padR;
    const paso = n > 1 ? ancho / (n - 1) : 0;
    // Con muchas evaluaciones no caben todas las fechas: se rotula una de cada k.
    const cada = Math.max(1, Math.ceil(n / 6));
    return pts.map((p, i) => ({
      x: +(n > 1 ? this.padL + i * paso : this.padL + ancho / 2).toFixed(1),
      y: this.y((p.puntaje_total / (p.puntaje_maximo || 100)) * 100),
      punto: p,
      etiqueta: i % cada === 0 || i === n - 1 ? this.fechaCorta(p.fecha) : '',
    }));
  });

  trazo = computed(() => this.coords().map((c) => `${c.x},${c.y}`).join(' '));

  area = computed(() => {
    const cs = this.coords();
    if (cs.length < 2) return '';
    const base = this.y(0);
    return `${cs[0].x},${base} ${this.trazo()} ${cs[cs.length - 1].x},${base}`;
  });

  /** Tabla descendente (lo más reciente arriba) con el cambio respecto a la anterior. */
  filas = computed(() => {
    const pts = this.puntos();
    return pts
      .map((punto, i) => ({
        punto,
        cambio: i === 0 ? null : +(punto.puntaje_total - pts[i - 1].puntaje_total).toFixed(1),
      }))
      .reverse();
  });

  fechaCorta(fecha: string): string {
    return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
  }
}
