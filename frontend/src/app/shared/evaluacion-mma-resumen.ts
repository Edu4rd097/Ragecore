import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { ResumenEvaluacionMMA, claseNivelMMA } from '../core/models';
import { StatComponent, VacioComponent } from './ui';

/**
 * Resumen de la última evaluación MMA finalizada: score general (/100), nivel,
 * variación contra la anterior, las 7 categorías con cb-stat y la preparación
 * para competencia. Solo pinta: todas las cifras vienen calculadas del
 * backend (core/evaluacion_mma.py). Se usa igual en la ficha del admin, el
 * panel del maestro y "Mi progreso" del alumno.
 */
@Component({
  selector: 'cb-evaluacion-mma-resumen',
  standalone: true,
  imports: [CommonModule, StatComponent, VacioComponent],
  template: `
    @if (ultima(); as e) {
      <div class="resumen">
        <div class="marcador">
          <span class="etiqueta">Score general</span>
          <div class="total mono">
            {{ e.puntaje_total }}<span class="de">/{{ e.puntaje_maximo }}</span>
          </div>
          <span class="chip nivel" [class]="claseNivel(e.nivel)">{{ e.nivel }}</span>
          @if (variacion() !== null) {
            <span
              class="variacion mono"
              [class.sube]="variacion()! > 0"
              [class.baja]="variacion()! < 0"
            >
              {{ variacion()! > 0 ? '▲ +' + variacion() : variacion()! < 0 ? '▼ ' + variacion() : '= sin cambio' }}
              <span class="mini tenue">vs. anterior</span>
            </span>
          }
          <span class="mini tenue">
            Evaluado el <span class="mono">{{ e.fecha }}</span>
            @if (e.evaluador_nombre) {
              · {{ e.evaluador_nombre }}
            }
          </span>
        </div>

        <div class="categorias">
          @for (c of e.categorias; track c.id) {
            <cb-stat [nombre]="c.nombre" [valor]="c.puntaje" [max]="c.maximo" />
          }
        </div>
      </div>

      <div class="preparacion">
        <div class="fila-entre envuelve">
          <h3 class="titulo-seccion" style="margin:0">Preparación para competencia</h3>
          <span class="total-prep mono">{{ e.preparacion.total }}<span class="de">/100</span></span>
        </div>
        <div class="grid grid-3 componentes">
          <cb-stat nombre="Técnica" [valor]="e.preparacion.tecnica" [max]="100" />
          <cb-stat nombre="Física" [valor]="e.preparacion.fisica" [max]="100" />
          <cb-stat nombre="Defensa" [valor]="e.preparacion.defensa" [max]="100" />
          <cb-stat nombre="Táctica" [valor]="e.preparacion.tactica" [max]="100" />
          <cb-stat nombre="Disciplina" [valor]="e.preparacion.disciplina" [max]="100" />
        </div>
        <p class="mini tenue aviso-prep">{{ aviso() }}</p>
      </div>
    } @else {
      <cb-vacio
        icono="📋"
        titulo="Sin evaluación MMA"
        detalle="Cuando se finalice la primera evaluación aparecerá aquí el score por categoría."
      />
    }
  `,
  styles: [
    `
      .resumen {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
        align-items: flex-start;
      }
      .marcador {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        min-width: 170px;
        padding: 14px 18px;
        background: rgba(0, 0, 0, 0.42);
        border: 1px solid var(--borde);
        border-radius: var(--r);
      }
      .total {
        font-family: 'Oswald', sans-serif;
        font-size: 2.6rem;
        font-weight: 700;
        line-height: 1;
        color: var(--rojo-claro);
      }
      .de {
        color: var(--texto-tenue);
        font-size: 0.9rem;
        font-weight: 400;
      }
      .nivel {
        font-family: 'Oswald', sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .variacion {
        font-size: 0.9rem;
        color: var(--texto-suave);
      }
      .variacion.sube {
        color: #4ade80;
      }
      .variacion.baja {
        color: var(--rojo-claro);
      }
      .categorias {
        flex: 1;
        min-width: 220px;
        display: flex;
        flex-direction: column;
        gap: 11px;
      }
      .preparacion {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--borde-suave);
      }
      .total-prep {
        font-family: 'Oswald', sans-serif;
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--texto);
      }
      .componentes {
        margin-top: 12px;
      }
      .aviso-prep {
        margin: 12px 0 0;
        font-style: italic;
      }
    `,
  ],
})
export class EvaluacionMMAResumen {
  resumen = input.required<ResumenEvaluacionMMA | null>();

  ultima = computed(() => this.resumen()?.ultima ?? null);
  variacion = computed(() => this.resumen()?.variacion ?? null);
  aviso = computed(
    () =>
      this.resumen()?.aviso_preparacion ??
      'Indicador interno de preparación: no autoriza automáticamente a competir.',
  );

  claseNivel = claseNivelMMA;
}
