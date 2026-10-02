import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Alumno, Insignia } from '../core/models';
import { CargandoComponent } from '../shared/ui';

@Component({
  selector: 'cb-mis-insignias',
  standalone: true,
  imports: [CommonModule, CargandoComponent],
  template: `
    @if (cargando()) {
      <cb-cargando />
    } @else {
      <div class="pila">
        <div class="fila-entre">
          <h1 style="margin:0">Insignias</h1>
          <span class="chip chip-rojo">{{ ganadas().size }} / {{ catalogo().length }}</span>
        </div>

        <div class="barra-pista" style="height:9px">
          <div class="barra-valor" [style.width.%]="progreso()"></div>
        </div>

        <div class="grid grid-3">
          @for (i of catalogo(); track i.id) {
            <article class="medalla tarjeta" [class.bloqueada]="!ganadas().has(i.id)">
              <div class="disco">{{ ganadas().has(i.id) ? '🏅' : '🔒' }}</div>
              <strong>{{ i.nombre }}</strong>
              <p class="mini tenue">{{ i.descripcion }}</p>

              @if (ganadas().has(i.id)) {
                <span class="chip chip-verde">Obtenida {{ ganadas().get(i.id) }}</span>
              } @else {
                <span class="chip chip-gris">{{ criterio(i) }}</span>
              }

              @if (i.puntos_bonus) {
                <span class="mini bono mono">+{{ i.puntos_bonus }} pts</span>
              }
            </article>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .medalla {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 7px;
      }
      .medalla p {
        margin: 0;
        min-height: 2.4em;
      }
      .medalla.bloqueada {
        opacity: 0.5;
      }
      .medalla.bloqueada .disco {
        border-color: var(--borde);
        box-shadow: none;
        filter: grayscale(1);
      }
      .disco {
        width: 62px;
        height: 62px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.7rem;
        background: radial-gradient(circle at 35% 30%, var(--negro-600), var(--negro-900));
        border: 2px solid var(--rojo);
        box-shadow: 0 0 16px rgba(0, 149, 255, 0.28);
      }
      .bono {
        color: var(--rojo-claro);
      }
    `,
  ],
})
export class MisInsignias {
  private api = inject(ApiService);

  catalogo = signal<Insignia[]>([]);
  alumno = signal<Alumno | null>(null);
  cargando = signal(true);

  /** id de insignia -> fecha en que se obtuvo. */
  ganadas = computed(
    () => new Map((this.alumno()?.insignias_ganadas ?? []).map((g) => [g.insignia, g.fecha_obtencion])),
  );

  progreso = computed(() => {
    const total = this.catalogo().length;
    return total ? (this.ganadas().size / total) * 100 : 0;
  });

  /** Traduce el JSON de criterio a algo legible. */
  criterio(i: Insignia): string {
    const c = i.criterio ?? {};
    const v = c.valor;
    switch (c.tipo) {
      case 'racha':
        return `Racha de ${v} clases`;
      case 'asistencias_totales':
        return `${v} clases en total`;
      case 'puntos':
        return `${v} puntos`;
      case 'sparrings':
        return `${v} sparring(s)`;
      case 'torneos':
        return `${v} torneo(s)`;
      case 'victorias':
        return `${v} victoria(s)`;
      case 'manual':
        return 'La otorga el maestro';
      default:
        return 'Por desbloquear';
    }
  }

  constructor() {
    forkJoin({
      catalogo: this.api.insignias({ activa: true, page_size: 100 }),
      alumno: this.api.yo(),
    }).subscribe({
      next: (r) => {
        this.catalogo.set(r.catalogo.results);
        this.alumno.set(r.alumno);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
