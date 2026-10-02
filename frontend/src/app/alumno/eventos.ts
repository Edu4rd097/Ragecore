import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Evento } from '../core/models';
import { CargandoComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-mis-eventos',
  standalone: true,
  imports: [CommonModule, CargandoComponent, VacioComponent],
  template: `
    <div class="pila">
      <h1 style="margin:0">Eventos</h1>
      <p class="mini tenue" style="margin-top:-6px">Torneos, seminarios y exámenes próximos.</p>

      @if (cargando()) {
        <cb-cargando />
      } @else if (lista().length) {
        <div class="grid grid-2">
          @for (e of lista(); track e.id) {
            <article class="tarjeta evento">
              <div class="fila-entre">
                <span class="chip chip-rojo">{{ e.tipo_display }}</span>
                <span class="mono mini tenue">{{ e.fecha }}</span>
              </div>
              <strong>{{ e.titulo }}</strong>
              @if (e.lugar) {
                <span class="mini tenue">📍 {{ e.lugar }}</span>
              }
              @if (e.descripcion) {
                <p class="mini tenue">{{ e.descripcion }}</p>
              }
              <button
                class="btn btn-mini"
                [class.btn-rojo]="!e.inscrito"
                [disabled]="procesando() === e.id"
                (click)="alternarInscripcion(e)"
              >
                {{ e.inscrito ? 'Cancelar inscripción' : 'Inscribirme' }}
              </button>
            </article>
          }
        </div>
      } @else {
        <cb-vacio icono="📅" titulo="Sin eventos próximos" />
      }
    </div>
  `,
  styles: [
    `
      .evento {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .evento p {
        margin: 0;
      }
    `,
  ],
})
export class MisEventos {
  private api = inject(ApiService);

  lista = signal<Evento[]>([]);
  cargando = signal(true);
  procesando = signal<number | null>(null);

  alternarInscripcion(e: Evento): void {
    this.procesando.set(e.id);
    if (e.inscrito) {
      this.cancelar(e);
    } else {
      this.api.inscribirseEvento(e.id).subscribe({
        next: () => this.marcar(e.id, true),
        error: () => this.procesando.set(null),
      });
    }
  }

  private cancelar(e: Evento): void {
    this.api.inscripcionesEvento({ evento: e.id }).subscribe({
      next: (p) => {
        const mia = p.results[0];
        if (!mia) {
          this.procesando.set(null);
          return;
        }
        this.api.cancelarInscripcion(mia.id).subscribe({
          next: () => this.marcar(e.id, false),
          error: () => this.procesando.set(null),
        });
      },
      error: () => this.procesando.set(null),
    });
  }

  private marcar(eventoId: number, inscrito: boolean): void {
    this.lista.set(this.lista().map((x) => (x.id === eventoId ? { ...x, inscrito } : x)));
    this.procesando.set(null);
  }

  constructor() {
    this.api.eventos({ page_size: 100 }).subscribe({
      next: (p) => {
        this.lista.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
