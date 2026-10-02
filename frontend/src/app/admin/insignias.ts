import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AlumnoLista, Insignia } from '../core/models';
import { CargandoComponent, ModalComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-admin-insignias',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, ModalComponent],
  template: `
    <div class="pila">
      <div class="fila-entre">
        <h1 style="margin:0">Insignias</h1>
        <button class="btn btn-rojo" (click)="abrir()">+ Nueva insignia</button>
      </div>

      @if (cargando()) {
        <cb-cargando />
      } @else if (insignias().length) {
        <div class="grid grid-3">
          @for (i of insignias(); track i.id) {
            <article class="tarjeta insignia-card" [class.inactiva]="!i.activa">
              <div class="fila-entre">
                <div class="disco">🏅</div>
                <div class="acciones">
                  <button class="btn btn-mini" (click)="abrir(i)">Editar</button>
                  <button class="btn btn-mini" (click)="abrirOtorgar(i)">Otorgar</button>
                  <button class="btn btn-mini btn-fantasma" (click)="borrar(i)">✕</button>
                </div>
              </div>
              <strong>{{ i.nombre }}</strong>
              <p class="mini tenue">{{ i.descripcion }}</p>
              <div class="pie-ins">
                <span class="chip chip-gris">{{ criterioTexto(i) }}</span>
                @if (i.puntos_bonus) {
                  <span class="chip chip-rojo mono">+{{ i.puntos_bonus }} pts</span>
                }
                @if (!i.activa) {
                  <span class="chip chip-gris">Inactiva</span>
                }
              </div>
              <p class="mini tenue mono">{{ i.total_otorgadas ?? 0 }} alumno(s) la tienen</p>
            </article>
          }
        </div>
      } @else {
        <cb-vacio icono="🏅" titulo="Sin insignias en el catálogo" />
      }
    </div>

    <!-- ===== MODAL CRUD ===== -->
    @if (modal()) {
      <cb-modal [titulo]="editId() ? 'Editar insignia' : 'Nueva insignia'" (cerrar)="modal.set(false)">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }

        <div class="campo"><label>Nombre *</label><input [(ngModel)]="f.nombre" /></div>
        <div class="campo">
          <label>Descripción</label>
          <textarea [(ngModel)]="f.descripcion" rows="2"></textarea>
        </div>
        <div class="grid grid-2">
          <div class="campo">
            <label>Tipo de criterio</label>
            <select [(ngModel)]="f.tipo">
              <option value="manual">Manual (maestro otorga)</option>
              <option value="racha">Racha de asistencia</option>
              <option value="asistencias_totales">Total de clases</option>
              <option value="puntos">Puntos acumulados</option>
              <option value="sparrings">Sparrings</option>
              <option value="torneos">Torneos</option>
              <option value="victorias">Victorias</option>
            </select>
          </div>
          @if (f.tipo !== 'manual') {
            <div class="campo">
              <label>Valor objetivo</label>
              <input type="number" min="1" [(ngModel)]="f.valor" />
            </div>
          }
          <div class="campo">
            <label>Puntos bonus al obtenerla</label>
            <input type="number" min="0" [(ngModel)]="f.puntos_bonus" />
          </div>
          <div class="campo">
            <label>Estado</label>
            <select [(ngModel)]="f.activa">
              <option [ngValue]="true">Activa</option>
              <option [ngValue]="false">Inactiva</option>
            </select>
          </div>
        </div>

        <div pie>
          <button class="btn" (click)="modal.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? '...' : (editId() ? 'Guardar' : 'Crear') }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== MODAL OTORGAR ===== -->
    @if (modalOtorgar()) {
      <cb-modal [titulo]="'Otorgar: ' + insigniaSeleccionada()?.nombre" (cerrar)="modalOtorgar.set(false)">
        @if (errorOtorgar()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ errorOtorgar() }}</div>
        }
        @if (okOtorgar()) {
          <div class="aviso aviso-ok" style="margin-bottom:12px">{{ okOtorgar() }}</div>
        }

        <div class="campo">
          <label>Buscar alumno</label>
          <input [(ngModel)]="busquedaAlumno" (ngModelChange)="buscarAlumno($event)" placeholder="Nombre o apodo" />
        </div>

        @if (resultadosBusqueda().length) {
          <ul class="lista-alumnos">
            @for (a of resultadosBusqueda(); track a.id) {
              <li (click)="otorgar(a)">
                <strong>{{ a.nombre_completo }}</strong>
                @if (a.apodo) {
                  <span class="mini tenue">"{{ a.apodo }}"</span>
                }
              </li>
            }
          </ul>
        }

        <div pie>
          <button class="btn" (click)="modalOtorgar.set(false)">Cerrar</button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
      .insignia-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .insignia-card.inactiva {
        opacity: 0.55;
      }
      .disco {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.5rem;
        background: radial-gradient(circle at 35% 30%, var(--negro-600), var(--negro-900));
        border: 2px solid var(--rojo);
        box-shadow: 0 0 14px rgba(0, 149, 255,0.22);
        flex: none;
      }
      .insignia-card p {
        margin: 0;
      }
      .pie-ins {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .acciones {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .lista-alumnos {
        list-style: none;
        margin: 0;
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
        transition: background 0.12s;
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
export class AdminInsignias {
  private api = inject(ApiService);

  insignias = signal<Insignia[]>([]);
  cargando = signal(true);
  guardando = signal(false);

  modal = signal(false);
  editId = signal<number | null>(null);
  error = signal('');

  modalOtorgar = signal(false);
  insigniaSeleccionada = signal<Insignia | null>(null);
  busquedaAlumno = '';
  resultadosBusqueda = signal<AlumnoLista[]>([]);
  errorOtorgar = signal('');
  okOtorgar = signal('');

  private timer: ReturnType<typeof setTimeout> | null = null;

  f = this.vacio();

  private vacio() {
    return {
      nombre: '',
      descripcion: '',
      tipo: 'manual',
      valor: null as number | null,
      puntos_bonus: 0,
      activa: true,
    };
  }

  criterioTexto(i: Insignia): string {
    const c = i.criterio ?? {};
    const v = c.valor;
    switch (c.tipo) {
      case 'racha': return `Racha ${v}`;
      case 'asistencias_totales': return `${v} clases`;
      case 'puntos': return `${v} puntos`;
      case 'sparrings': return `${v} sparrings`;
      case 'torneos': return `${v} torneos`;
      case 'victorias': return `${v} victorias`;
      default: return 'Manual';
    }
  }

  abrir(i?: Insignia): void {
    this.error.set('');
    this.editId.set(i?.id ?? null);
    this.f = i
      ? {
          nombre: i.nombre,
          descripcion: i.descripcion,
          tipo: i.criterio?.tipo ?? 'manual',
          valor: i.criterio?.valor ?? null,
          puntos_bonus: i.puntos_bonus,
          activa: i.activa,
        }
      : this.vacio();
    this.modal.set(true);
  }

  guardar(): void {
    if (!this.f.nombre) {
      this.error.set('El nombre es obligatorio.');
      return;
    }
    this.guardando.set(true);

    const criterio: Record<string, unknown> = { tipo: this.f.tipo };
    if (this.f.tipo !== 'manual') criterio['valor'] = this.f.valor;

    const datos = {
      nombre: this.f.nombre,
      descripcion: this.f.descripcion,
      criterio,
      puntos_bonus: this.f.puntos_bonus,
      activa: this.f.activa,
    };

    const accion = this.editId()
      ? this.api.editarInsignia(this.editId()!, datos as never)
      : this.api.crearInsignia(datos as never);

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

  borrar(i: Insignia): void {
    if (!confirm(`¿Eliminar la insignia "${i.nombre}"?`)) return;
    this.api.borrarInsignia(i.id).subscribe(() => this.cargar());
  }

  abrirOtorgar(i: Insignia): void {
    this.insigniaSeleccionada.set(i);
    this.busquedaAlumno = '';
    this.resultadosBusqueda.set([]);
    this.errorOtorgar.set('');
    this.okOtorgar.set('');
    this.modalOtorgar.set(true);
  }

  buscarAlumno(texto: string): void {
    if (this.timer) clearTimeout(this.timer);
    if (!texto) {
      this.resultadosBusqueda.set([]);
      return;
    }
    this.timer = setTimeout(() => {
      this.api.alumnos({ search: texto, page_size: 8 }).subscribe((p) =>
        this.resultadosBusqueda.set(p.results),
      );
    }, 300);
  }

  otorgar(a: AlumnoLista): void {
    const ins = this.insigniaSeleccionada();
    if (!ins) return;
    this.errorOtorgar.set('');
    this.okOtorgar.set('');

    this.api.otorgarInsignia(ins.id, a.id).subscribe({
      next: () => {
        this.okOtorgar.set(`✅ Insignia otorgada a ${a.nombre_completo}.`);
        this.resultadosBusqueda.set([]);
        this.busquedaAlumno = '';
        this.cargar();
      },
      error: (e) => {
        this.errorOtorgar.set(
          e?.status === 409
            ? `${a.nombre_completo} ya tiene esta insignia.`
            : (e?.error?.detail ?? 'No se pudo otorgar.'),
        );
      },
    });
  }

  private cargar(): void {
    this.api.insignias({ page_size: 100 }).subscribe({
      next: (p) => {
        this.insignias.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  constructor() {
    this.cargar();
  }
}
