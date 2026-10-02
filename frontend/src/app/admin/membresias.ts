import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Membresia } from '../core/models';
import { CargandoComponent, ModalComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-admin-membresias',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, ModalComponent],
  template: `
    <div class="pila">
      <div class="fila-entre">
        <h1 style="margin:0">Membresías</h1>
        <button class="btn btn-rojo" (click)="abrir()">+ Nueva membresía</button>
      </div>

      @if (cargando()) {
        <cb-cargando />
      } @else if (membresias().length) {
        <div class="grid grid-3">
          @for (m of membresias(); track m.id) {
            <article class="tarjeta mem">
              <div class="fila-entre">
                <h3 style="margin:0">{{ m.nombre }}</h3>
                <div class="fila" style="gap:6px">
                  <button class="btn btn-mini" (click)="abrir(m)">Editar</button>
                  <button class="btn btn-mini btn-fantasma" (click)="borrar(m)">✕</button>
                </div>
              </div>
              <div class="precio mono">\${{ m.precio }}</div>
              @if (m.descripcion) {
                <div class="incluye">{{ m.descripcion }}</div>
              }
              <div class="mini tenue">{{ vigencia(m) }}</div>
              @if (m.duracion_dias !== 30) {
                <div class="mini tenue">Equivale a \${{ precioMensual(m) }} / mes</div>
              }
            </article>
          }
        </div>

        <section class="tarjeta comparativa">
          <h2 class="titulo-seccion">Comparativa</h2>
          <div class="tabla-scroll">
            <table>
              <thead>
                <tr><th>Membresía</th><th>Vigencia</th><th>Precio</th><th>Costo / mes</th><th>Incluye</th></tr>
              </thead>
              <tbody>
                @for (m of membresias(); track m.id) {
                  <tr>
                    <td>{{ m.nombre }}</td>
                    <td class="mono">{{ m.duracion_dias }} d</td>
                    <td class="mono">\${{ m.precio }}</td>
                    <td class="mono">\${{ precioMensual(m) }}</td>
                    <td class="mini tenue">{{ m.descripcion || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      } @else {
        <cb-vacio icono="📋" titulo="Sin membresías" detalle="Crea al menos una para poder cobrar." />
      }
    </div>

    @if (modal()) {
      <cb-modal [titulo]="editId() ? 'Editar membresía' : 'Nueva membresía'" (cerrar)="modal.set(false)">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }

        <div class="campo"><label>Nombre *</label><input [(ngModel)]="f.nombre" placeholder="Mensualidad Básica" /></div>
        <div class="grid grid-2">
          <div class="campo">
            <label>Duración (días) *</label>
            <input type="number" min="1" [(ngModel)]="f.duracion_dias" />
          </div>
          <div class="campo">
            <label>Precio *</label>
            <input type="number" step="0.01" [(ngModel)]="f.precio" />
          </div>
        </div>
        <div class="campo">
          <label>Qué incluye</label>
          <textarea
            [(ngModel)]="f.descripcion"
            rows="2"
            placeholder="Ej. 2 disciplinas, horario fijo"
          ></textarea>
        </div>

        @if (f.precio && f.duracion_dias) {
          <p class="mini tenue">
            Precio equivalente: <strong>\${{ precioMensualPreview() }}</strong> / mes
          </p>
        }

        <div pie>
          <button class="btn" (click)="modal.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Guardando...' : (editId() ? 'Guardar' : 'Crear') }}
          </button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
      .mem {
        display: flex;
        flex-direction: column;
        gap: 7px;
        border-top: 3px solid var(--rojo);
      }
      .precio {
        font-family: 'Oswald', sans-serif;
        font-size: 1.8rem;
        font-weight: 600;
        color: var(--rojo-claro);
      }
      .incluye {
        color: var(--texto);
        font-weight: 600;
        font-size: 0.92rem;
      }
      .comparativa {
        overflow-x: auto;
      }
    `,
  ],
})
export class AdminMembresias {
  private api = inject(ApiService);

  membresias = signal<Membresia[]>([]);
  cargando = signal(true);
  guardando = signal(false);
  modal = signal(false);
  error = signal('');
  editId = signal<number | null>(null);

  f = this.vacio();

  private vacio() {
    return {
      nombre: '',
      duracion_dias: null as number | null,
      precio: null as number | null,
      descripcion: '',
    };
  }

  precioMensual(m: Membresia): string {
    const p = parseFloat(m.precio || '0');
    return ((p / m.duracion_dias) * 30).toFixed(2);
  }

  precioMensualPreview(): string {
    if (!this.f.precio || !this.f.duracion_dias) return '—';
    return ((this.f.precio / this.f.duracion_dias) * 30).toFixed(2);
  }

  vigencia(m: Membresia): string {
    if (m.duracion_dias === 1) return 'Vale por 1 día';
    if (m.duracion_dias === 7) return 'Vale por 1 semana';
    if (m.duracion_dias === 30) return 'Vale por 1 mes (30 días)';
    return `${m.duracion_dias} días de vigencia`;
  }

  abrir(m?: Membresia): void {
    this.error.set('');
    this.editId.set(m?.id ?? null);
    this.f = m
      ? {
          nombre: m.nombre,
          duracion_dias: m.duracion_dias,
          precio: parseFloat(m.precio),
          descripcion: m.descripcion ?? '',
        }
      : this.vacio();
    this.modal.set(true);
  }

  guardar(): void {
    if (!this.f.nombre || !this.f.duracion_dias || !this.f.precio) {
      this.error.set('Nombre, duración y precio son obligatorios.');
      return;
    }
    this.guardando.set(true);
    const datos = {
      nombre: this.f.nombre,
      duracion_dias: this.f.duracion_dias,
      precio: String(this.f.precio),
      descripcion: this.f.descripcion.trim(),
    };
    const accion = this.editId()
      ? this.api.editarMembresia(this.editId()!, datos)
      : this.api.crearMembresia(datos);

    accion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(false);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(e?.error?.detail ?? 'No se pudo guardar.');
      },
    });
  }

  borrar(m: Membresia): void {
    if (!confirm(`¿Eliminar la membresía "${m.nombre}"?`)) return;
    this.api.borrarMembresia(m.id).subscribe({
      next: () => this.cargar(),
      error: () => alert('No se pudo eliminar. Puede haber alumnos o pagos ligados a ella.'),
    });
  }

  private cargar(): void {
    this.api.membresias({ page_size: 100 }).subscribe({
      next: (p) => {
        this.membresias.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  constructor() {
    this.cargar();
  }
}
