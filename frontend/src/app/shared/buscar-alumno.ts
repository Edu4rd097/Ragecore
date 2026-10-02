import { Component, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AlumnoLista } from '../core/models';

/**
 * Buscador de UN alumno por nombre o apodo con autocompletado (el backend
 * también lo encuentra por teléfono o código QR). El elegido queda como chip
 * con su membresía y semáforo; ✕ vuelve al buscador.
 *
 *   <label for="np-alumno">Alumno</label>
 *   <cb-buscar-alumno [(alumno)]="elegido" inputId="np-alumno" />
 */
@Component({
  selector: 'cb-buscar-alumno',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (alumno(); as a) {
      <div class="fila envuelve">
        <button type="button" class="chip chip-rojo" (click)="quitar()" title="Cambiar de alumno">
          {{ a.nombre_completo }} ✕
        </button>
        <span class="mini tenue">
          {{ a.membresia_nombre ?? 'Sin membresía' }} ·
          {{ a.al_corriente ? 'Al corriente' : 'Pago pendiente' }}
        </span>
      </div>
    } @else {
      <input
        [id]="inputId()"
        [(ngModel)]="busqueda"
        (ngModelChange)="buscar($event)"
        [placeholder]="placeholder()"
        autocomplete="off"
      />
      @if (resultados().length) {
        <ul class="lista-alumnos">
          @for (a of resultados(); track a.id) {
            <li (click)="elegir(a)">
              <strong>{{ a.nombre_completo }}</strong>
              <span class="mini tenue">
                @if (a.apodo) { "{{ a.apodo }}" · }
                {{ a.membresia_nombre ?? 'Sin membresía' }} ·
                {{ a.al_corriente ? 'Al corriente' : 'Pago pendiente' }}
              </span>
            </li>
          }
        </ul>
      } @else if (busqueda && buscado()) {
        <span class="mini tenue">Ningún alumno activo coincide.</span>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      button.chip {
        cursor: pointer;
        font-family: inherit;
      }
      .lista-alumnos {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        border: 1px solid var(--borde);
        border-radius: var(--r-sm);
        overflow: hidden;
      }
      .lista-alumnos li {
        display: flex;
        flex-direction: column;
        padding: 10px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--borde-suave);
        gap: 2px;
      }
      .lista-alumnos li:last-child {
        border-bottom: none;
      }
      .lista-alumnos li:hover {
        background: var(--negro-700);
        color: var(--rojo-claro);
      }
    `,
  ],
})
export class BuscarAlumno {
  private api = inject(ApiService);

  /** Alumno elegido (two-way: [(alumno)]). */
  alumno = model<AlumnoLista | null>(null);
  placeholder = input('Buscar por nombre o apodo');
  /** id del <input>, para poder apuntarle con un <label for>. */
  inputId = input('buscar-alumno');

  busqueda = '';
  resultados = signal<AlumnoLista[]>([]);
  buscado = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  buscar(texto: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.buscado.set(false);
    if (!texto.trim()) {
      this.resultados.set([]);
      return;
    }
    this.timer = setTimeout(() => {
      this.api.alumnos({ search: texto.trim(), page_size: 8, activo: true }).subscribe((p) => {
        this.resultados.set(p.results);
        this.buscado.set(true);
      });
    }, 300);
  }

  elegir(a: AlumnoLista): void {
    this.alumno.set(a);
    this.busqueda = '';
    this.resultados.set([]);
  }

  quitar(): void {
    if (this.timer) clearTimeout(this.timer);
    this.alumno.set(null);
    this.busqueda = '';
    this.resultados.set([]);
    this.buscado.set(false);
  }
}
