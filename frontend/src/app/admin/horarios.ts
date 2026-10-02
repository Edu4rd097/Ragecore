import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Disciplina, Horario } from '../core/models';
import { CargandoComponent, ModalComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-admin-horarios',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, ModalComponent],
  template: `
    <div class="pila">
      <h1>Horarios y disciplinas</h1>

      <div class="grid grid-2">
        <!-- ===== HORARIOS ===== -->
        <section class="tarjeta">
          <div class="fila-entre" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">Horarios</h2>
            <button class="btn btn-mini btn-rojo" (click)="abrirHorario()">+ Nuevo</button>
          </div>

          @if (cargando()) {
            <cb-cargando />
          } @else if (horarios().length) {
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Turno</th><th>Hora</th><th>Clase</th><th>Días</th><th>Alumnos</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (h of horarios(); track h.id) {
                    <tr>
                      <td>
                        <span class="chip chip-gris">{{ h.turno_display ?? h.turno }}</span>
                      </td>
                      <td class="mono mini">{{ h.hora_inicio.slice(0,5) }}–{{ h.hora_fin.slice(0,5) }}</td>
                      <td><strong>{{ h.nombre || '—' }}</strong></td>
                      <td class="mini tenue">{{ diasCortos(h.dias) }}</td>
                      <td class="mono">{{ h.total_alumnos ?? 0 }}</td>
                      <td>
                        <div class="fila" style="gap:6px">
                          <button class="btn btn-mini" (click)="abrirHorario(h)">Ed.</button>
                          <button class="btn btn-mini btn-fantasma" (click)="borrarHorario(h)">✕</button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <cb-vacio icono="🕐" titulo="Sin horarios" />
          }
        </section>

        <!-- ===== DISCIPLINAS ===== -->
        <section class="tarjeta">
          <div class="fila-entre" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">Disciplinas</h2>
            <button class="btn btn-mini btn-rojo" (click)="abrirDisciplina()">+ Nueva</button>
          </div>

          @if (cargando()) {
            <cb-cargando />
          } @else if (disciplinas().length) {
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr><th>Nombre</th><th>Alumnos</th><th>Descripción</th><th></th></tr>
                </thead>
                <tbody>
                  @for (d of disciplinas(); track d.id) {
                    <tr>
                      <td><strong>{{ d.nombre }}</strong></td>
                      <td class="mono">{{ d.total_alumnos ?? 0 }}</td>
                      <td class="mini tenue">{{ d.descripcion | slice:0:50 }}{{ d.descripcion.length > 50 ? '…' : '' }}</td>
                      <td>
                        <div class="fila" style="gap:6px">
                          <button class="btn btn-mini" (click)="abrirDisciplina(d)">Ed.</button>
                          <button class="btn btn-mini btn-fantasma" (click)="borrarDisciplina(d)">✕</button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <cb-vacio icono="🥋" titulo="Sin disciplinas" />
          }
        </section>
      </div>
    </div>

    <!-- ===== MODAL HORARIO ===== -->
    @if (modalH()) {
      <cb-modal [titulo]="editH() ? 'Editar horario' : 'Nuevo horario'" (cerrar)="modalH.set(false)">
        @if (errorH()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ errorH() }}</div>
        }

        <div class="grid grid-2">
          <div class="campo">
            <label>Hora inicio *</label>
            <input type="time" [(ngModel)]="fh.hora_inicio" />
          </div>
          <div class="campo">
            <label>Hora fin *</label>
            <input type="time" [(ngModel)]="fh.hora_fin" />
          </div>
          <div class="campo">
            <label>Turno</label>
            <select [(ngModel)]="fh.turno">
              <option value="MATUTINO">Matutino</option>
              <option value="VESPERTINO">Vespertino</option>
              <option value="NOCTURNO">Nocturno</option>
              <option value="MIXTO">Mixto</option>
            </select>
          </div>
          <div class="campo">
            <label>Clase que se imparte</label>
            <input
              [(ngModel)]="fh.nombre"
              maxlength="80"
              placeholder="Ej. Striking, Jiu Jitsu Kids / Striking Kids"
            />
          </div>
        </div>

        <div class="campo">
          <label>Días</label>
          <div class="fila envuelve">
            @for (d of todosLosDias; track d) {
              <button
                type="button"
                class="chip"
                [class.chip-rojo]="fh.dias.includes(d)"
                [class.chip-gris]="!fh.dias.includes(d)"
                (click)="toggleDia(d)"
              >
                {{ d | slice:0:3 }}
              </button>
            }
          </div>
        </div>

        <div pie>
          <button class="btn" (click)="modalH.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardarH()">
            {{ guardando() ? '...' : (editH() ? 'Guardar' : 'Crear') }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== MODAL DISCIPLINA ===== -->
    @if (modalD()) {
      <cb-modal [titulo]="editD() ? 'Editar disciplina' : 'Nueva disciplina'" (cerrar)="modalD.set(false)">
        @if (errorD()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ errorD() }}</div>
        }

        <div class="campo"><label>Nombre *</label><input [(ngModel)]="fd.nombre" /></div>
        <div class="campo">
          <label>Descripción</label>
          <textarea [(ngModel)]="fd.descripcion" rows="3" placeholder="Breve descripción de la disciplina"></textarea>
        </div>

        <div pie>
          <button class="btn" (click)="modalD.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardarD()">
            {{ guardando() ? '...' : (editD() ? 'Guardar' : 'Crear') }}
          </button>
        </div>
      </cb-modal>
    }
  `,
})
export class AdminHorarios {
  private api = inject(ApiService);

  horarios = signal<Horario[]>([]);
  disciplinas = signal<Disciplina[]>([]);
  cargando = signal(true);
  guardando = signal(false);

  modalH = signal(false);
  modalD = signal(false);
  errorH = signal('');
  errorD = signal('');
  editHId = signal<number | null>(null);
  editDId = signal<number | null>(null);
  editH = () => this.editHId() !== null;
  editD = () => this.editDId() !== null;

  todosLosDias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

  fh = { hora_inicio: '', hora_fin: '', turno: 'MATUTINO', dias: [] as string[], nombre: '' };
  fd = { nombre: '', descripcion: '' };

  /** "lunes, martes, miercoles, jueves, viernes" → "L-V"; otros, abreviados. */
  diasCortos(dias: string[] | undefined): string {
    const d = dias ?? [];
    if (!d.length) return '—';
    const entreSemana = this.todosLosDias.slice(0, 5);
    if (d.length === 5 && entreSemana.every((x) => d.includes(x))) return 'Lun a Vie';
    return d.map((x) => x.slice(0, 3)).join(', ');
  }

  toggleDia(d: string): void {
    this.fh.dias = this.fh.dias.includes(d)
      ? this.fh.dias.filter((x) => x !== d)
      : [...this.fh.dias, d];
  }

  abrirHorario(h?: Horario): void {
    this.errorH.set('');
    this.editHId.set(h?.id ?? null);
    this.fh = {
      hora_inicio: h?.hora_inicio?.slice(0, 5) ?? '',
      hora_fin: h?.hora_fin?.slice(0, 5) ?? '',
      turno: h?.turno ?? 'MATUTINO',
      dias: [...(h?.dias ?? [])],
      nombre: h?.nombre ?? '',
    };
    this.modalH.set(true);
  }

  guardarH(): void {
    if (!this.fh.hora_inicio || !this.fh.hora_fin) {
      this.errorH.set('La hora de inicio y fin son obligatorias.');
      return;
    }
    this.guardando.set(true);
    const accion = this.editHId()
      ? this.api.editarHorario(this.editHId()!, this.fh as never)
      : this.api.crearHorario(this.fh as never);

    accion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.modalH.set(false);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        const d = e?.error;
        this.errorH.set(typeof d === 'object' ? Object.values(d).flat().join(' ') : 'Error al guardar.');
      },
    });
  }

  borrarHorario(h: Horario): void {
    if ((h.total_alumnos ?? 0) > 0) {
      alert(`Hay ${h.total_alumnos} alumno(s) asignados a este horario. Cámbiales el horario primero.`);
      return;
    }
    const etiqueta = h.nombre ? ` (${h.nombre})` : '';
    if (!confirm(`¿Eliminar el horario ${h.turno} ${h.hora_inicio?.slice(0, 5)}${etiqueta}?`)) return;
    this.api.borrarHorario(h.id).subscribe(() => this.cargar());
  }

  abrirDisciplina(d?: Disciplina): void {
    this.errorD.set('');
    this.editDId.set(d?.id ?? null);
    this.fd = { nombre: d?.nombre ?? '', descripcion: d?.descripcion ?? '' };
    this.modalD.set(true);
  }

  guardarD(): void {
    if (!this.fd.nombre) {
      this.errorD.set('El nombre es obligatorio.');
      return;
    }
    this.guardando.set(true);
    const accion = this.editDId()
      ? this.api.editarDisciplina(this.editDId()!, this.fd)
      : this.api.crearDisciplina(this.fd);

    accion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.modalD.set(false);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorD.set(e?.error?.detail ?? 'Error al guardar.');
      },
    });
  }

  borrarDisciplina(d: Disciplina): void {
    if ((d.total_alumnos ?? 0) > 0) {
      alert(`Hay ${d.total_alumnos} alumno(s) en esta disciplina. Reasígnalos primero.`);
      return;
    }
    if (!confirm(`¿Eliminar la disciplina "${d.nombre}"?`)) return;
    this.api.borrarDisciplina(d.id).subscribe(() => this.cargar());
  }

  private cargar(): void {
    this.cargando.set(true);
    this.api.horarios({ page_size: 100 }).subscribe((p) => this.horarios.set(p.results));
    this.api.disciplinas({ page_size: 100 }).subscribe({
      next: (p) => {
        this.disciplinas.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  constructor() {
    this.cargar();
  }
}
