import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AlumnoLista, Disciplina, Horario, Maestro } from '../core/models';
import { AvatarComponent, CargandoComponent, ModalComponent, VacioComponent } from '../shared/ui';

type AlumnoElegido = { id: number; nombre_completo: string; apodo: string };

/**
 * Catálogo de maestros. Además de sus datos y disciplinas, aquí el
 * administrativo decide el ALCANCE del maestro: qué alumnos ve, evalúa,
 * inscribe y notifica. Se asigna por grupos completos (horarios) y/o por
 * alumnos sueltos; el backend (Maestro.alumnos_a_cargo) acota todo con eso.
 * La cuenta de acceso nace sola al dar de alta (usuario maestro-<id> y
 * contraseña inicial), y sus credenciales se muestran una sola vez.
 */
@Component({
  selector: 'cb-admin-maestros',
  standalone: true,
  imports: [CommonModule, FormsModule, AvatarComponent, CargandoComponent, VacioComponent, ModalComponent],
  template: `
    <div class="pila">
      <div class="fila-entre">
        <h1 style="margin:0">Maestros</h1>
        <button class="btn btn-rojo" (click)="abrir()">+ Nuevo maestro</button>
      </div>

      @if (cargando()) {
        <cb-cargando />
      } @else if (maestros().length) {
        <div class="grid grid-2">
          @for (m of maestros(); track m.id) {
            <article class="tarjeta tarjeta-maestro">
              <div class="fila" style="gap:14px;align-items:flex-start">
                <cb-avatar [foto]="m.foto" [nombre]="m.nombre" [tam]="58" [aro]="m.activo" />
                <div class="crece">
                  <div class="fila-entre">
                    <strong>{{ m.nombre }}</strong>
                    <span class="chip" [class]="m.activo ? 'chip-verde' : 'chip-gris'">
                      {{ m.activo ? 'Activo' : 'Baja' }}
                    </span>
                  </div>
                  @if (m.edad) {
                    <span class="mini tenue">{{ m.edad }} años</span>
                  }
                  @if (m.telefono) {
                    <span class="mini tenue">{{ m.telefono }}</span>
                  }
                  @if (m.username) {
                    <span class="mini tenue mono">{{ m.username }}</span>
                  }
                  <div class="disciplinas">
                    @for (a of m.asignaciones; track a.id) {
                      <span class="chip chip-gris">{{ a.disciplina_nombre }}</span>
                    }
                    @if (!m.asignaciones.length) {
                      <span class="mini tenue">Sin disciplinas asignadas</span>
                    }
                  </div>
                  <div class="alcance mini">
                    <span class="etiqueta">Ve a {{ m.total_alumnos }} alumno{{ m.total_alumnos === 1 ? '' : 's' }}</span>
                    @for (h of m.horarios; track h.id) {
                      <span class="chip chip-rojo">{{ h.nombre }}</span>
                    }
                    @if (m.alumnos_asignados.length) {
                      <span class="chip chip-gris">+{{ m.alumnos_asignados.length }} individual{{ m.alumnos_asignados.length === 1 ? '' : 'es' }}</span>
                    }
                    @if (!m.horarios.length && !m.alumnos_asignados.length) {
                      <span class="tenue">Sin grupos ni alumnos asignados: no verá a nadie.</span>
                    }
                  </div>
                </div>
              </div>
              <div class="acciones-maestro">
                <button class="btn btn-mini" (click)="abrir(m)">Editar</button>
                <button class="btn btn-mini btn-fantasma" (click)="borrar(m)">Eliminar</button>
              </div>
            </article>
          }
        </div>
      } @else {
        <cb-vacio icono="👤" titulo="Sin maestros registrados" />
      }
    </div>

    @if (modal()) {
      <cb-modal [titulo]="editando() ? 'Editar maestro' : 'Nuevo maestro'" [amplio]="true" (cerrar)="cerrar()">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }

        <div class="campo"><label>Nombre completo *</label><input [(ngModel)]="f.nombre" /></div>
        <div class="grid grid-2">
          <div class="campo"><label>Edad</label><input type="number" [(ngModel)]="f.edad" /></div>
          <div class="campo"><label>Teléfono</label><input [(ngModel)]="f.telefono" /></div>
        </div>
        <div class="campo">
          <label>Correo electrónico</label>
          <input type="email" [(ngModel)]="f.email" placeholder="Para avisos; también sirve para entrar" />
        </div>

        <div class="campo" style="margin-bottom:0">
          <label>Estado</label>
          <select [(ngModel)]="f.activo">
            <option [ngValue]="true">Activo</option>
            <option [ngValue]="false">Baja</option>
          </select>
        </div>

        <div class="campo" style="margin-top:14px">
          <label>Disciplinas que imparte</label>
          <div class="fila envuelve">
            @for (d of disciplinas(); track d.id) {
              <button
                type="button"
                class="chip"
                [class.chip-rojo]="f.disciplinas_ids.includes(d.id)"
                [class.chip-gris]="!f.disciplinas_ids.includes(d.id)"
                (click)="alternar(d.id)"
              >
                {{ d.nombre }}
              </button>
            }
          </div>
        </div>

        <h3 class="titulo-seccion" style="margin-top:18px">Alumnos que puede ver</h3>
        <p class="mini tenue" style="margin-top:-6px">
          El maestro solo verá, evaluará, inscribirá a eventos y notificará a estos alumnos.
        </p>

        <div class="campo">
          <label>Grupos (horarios) asignados</label>
          <div class="fila envuelve">
            @for (h of horarios(); track h.id) {
              <button
                type="button"
                class="chip"
                [class.chip-rojo]="f.horarios_ids.includes(h.id)"
                [class.chip-gris]="!f.horarios_ids.includes(h.id)"
                (click)="alternarHorario(h.id)"
              >
                {{ nombreHorario(h) }}
              </button>
            }
            @if (!horarios().length) {
              <span class="mini tenue">No hay horarios dados de alta.</span>
            }
          </div>
        </div>

        <div class="campo">
          <label for="agrega-alumno">Alumnos individuales adicionales</label>
          @if (alumnosElegidos().length) {
            <div class="fila envuelve" style="margin-bottom:8px">
              @for (a of alumnosElegidos(); track a.id) {
                <button type="button" class="chip chip-rojo" (click)="quitarAlumno(a.id)" [title]="'Quitar a ' + a.nombre_completo">
                  {{ a.nombre_completo }} ✕
                </button>
              }
            </div>
          }
          <input
            id="agrega-alumno"
            [(ngModel)]="busquedaAlumno"
            (ngModelChange)="buscarAlumno($event)"
            placeholder="Buscar por nombre o apodo para agregar"
            autocomplete="off"
          />
          @if (resultadosBusqueda().length) {
            <ul class="lista-alumnos">
              @for (a of resultadosBusqueda(); track a.id) {
                <li (click)="agregarAlumno(a)">
                  <strong>{{ a.nombre_completo }}</strong>
                  <span class="mini tenue">
                    @if (a.apodo) { "{{ a.apodo }}" · }
                    {{ a.horario_display ?? 'Sin horario' }}
                  </span>
                </li>
              }
            </ul>
          }
        </div>

        @if (editando()) {
          <h3 class="titulo-seccion" style="margin-top:18px">Acceso a la app</h3>
          @if (!editandoTieneCuenta()) {
            <p class="mini tenue">
              Todavía no tiene cuenta. Captura y guarda su correo arriba para crearle una.
            </p>
          } @else {
            <p class="mini tenue" style="margin-top:-6px">
              Usuario: <strong class="mono">{{ editandoUsername() }}</strong>
            </p>
            <div class="fila envuelve" style="align-items:flex-end">
              <div class="campo" style="margin-bottom:0; flex:1; min-width:220px">
                <label>Nueva contraseña</label>
                <input [(ngModel)]="nuevaPassword" placeholder="Vacío = generar una automática" />
              </div>
              <button
                type="button"
                class="btn btn-mini"
                [disabled]="restableciendo()"
                (click)="restablecerPassword()"
              >
                {{ restableciendo() ? '...' : 'Restablecer contraseña' }}
              </button>
            </div>
            @if (passwordGenerada()) {
              <div class="aviso aviso-ok" style="margin-top:10px">
                Nueva contraseña: <strong class="mono">{{ passwordGenerada() }}</strong>
                — comunícasela al maestro, no se vuelve a mostrar.
                <button type="button" class="btn btn-mini btn-fantasma" (click)="passwordGenerada.set('')">
                  Ocultar
                </button>
              </div>
            }
          }
        }

        <div pie>
          <button class="btn" (click)="cerrar()">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Guardando...' : (editando() ? 'Guardar cambios' : 'Dar de alta') }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- Credenciales de la cuenta recién creada: se muestran una sola vez. -->
    @if (credenciales(); as c) {
      <cb-modal titulo="Maestro dado de alta" (cerrar)="credenciales.set(null)">
        <p>Comunícale estas credenciales. La contraseña no se vuelve a mostrar; puede cambiarla en Mi perfil → Seguridad.</p>
        <dl class="credenciales">
          <dt class="etiqueta">Usuario</dt>
          <dd class="mono">{{ c.username }}</dd>
          <dt class="etiqueta">Contraseña inicial</dt>
          <dd class="mono">{{ c.password }}</dd>
        </dl>
        <div pie>
          <button class="btn btn-rojo" (click)="credenciales.set(null)">Listo</button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
      .tarjeta-maestro {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .disciplinas,
      .alcance {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 7px;
        align-items: center;
      }
      .acciones-maestro {
        display: flex;
        gap: 8px;
        border-top: 1px solid var(--borde-suave);
        padding-top: 10px;
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
      .credenciales {
        margin: 12px 0 0;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 16px;
        align-items: center;
      }
      .credenciales dd {
        margin: 0;
        font-size: 1.05rem;
      }
    `,
  ],
})
export class AdminMaestros {
  private api = inject(ApiService);

  maestros = signal<Maestro[]>([]);
  disciplinas = signal<Disciplina[]>([]);
  horarios = signal<Horario[]>([]);
  cargando = signal(true);
  guardando = signal(false);
  modal = signal(false);
  error = signal('');
  editandoId = signal<number | null>(null);
  editando = () => this.editandoId() !== null;
  editandoTieneCuenta = signal(false);
  editandoUsername = signal('');

  nuevaPassword = '';
  restableciendo = signal(false);
  passwordGenerada = signal('');

  credenciales = signal<{ username: string; password: string } | null>(null);

  // Buscador de alumnos individuales (mismo patrón que admin/avisos.ts).
  busquedaAlumno = '';
  resultadosBusqueda = signal<AlumnoLista[]>([]);
  alumnosElegidos = signal<AlumnoElegido[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;

  f = this.vacio();

  private vacio() {
    return {
      nombre: '', edad: null as number | null, telefono: '', email: '',
      activo: true, disciplinas_ids: [] as number[], horarios_ids: [] as number[],
    };
  }

  nombreHorario(h: Horario): string {
    return `${h.turno_display ?? h.turno} ${h.hora_inicio.slice(0, 5)}-${h.hora_fin.slice(0, 5)}`;
  }

  alternar(id: number): void {
    const ids = this.f.disciplinas_ids;
    this.f.disciplinas_ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  alternarHorario(id: number): void {
    const ids = this.f.horarios_ids;
    this.f.horarios_ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  buscarAlumno(texto: string): void {
    if (this.timer) clearTimeout(this.timer);
    if (!texto) {
      this.resultadosBusqueda.set([]);
      return;
    }
    this.timer = setTimeout(() => {
      this.api.alumnos({ search: texto, page_size: 8, activo: true }).subscribe((p) => {
        const elegidos = new Set(this.alumnosElegidos().map((a) => a.id));
        this.resultadosBusqueda.set(p.results.filter((a) => !elegidos.has(a.id)));
      });
    }, 300);
  }

  agregarAlumno(a: AlumnoLista): void {
    this.alumnosElegidos.set([
      ...this.alumnosElegidos(),
      { id: a.id, nombre_completo: a.nombre_completo, apodo: a.apodo },
    ]);
    this.busquedaAlumno = '';
    this.resultadosBusqueda.set([]);
  }

  quitarAlumno(id: number): void {
    this.alumnosElegidos.set(this.alumnosElegidos().filter((a) => a.id !== id));
  }

  abrir(m?: Maestro): void {
    this.error.set('');
    this.nuevaPassword = '';
    this.passwordGenerada.set('');
    this.busquedaAlumno = '';
    this.resultadosBusqueda.set([]);
    if (m) {
      this.editandoId.set(m.id);
      this.editandoTieneCuenta.set(m.tiene_cuenta);
      this.editandoUsername.set(m.username);
      this.f = {
        nombre: m.nombre,
        edad: m.edad,
        telefono: m.telefono,
        email: m.email,
        activo: m.activo,
        disciplinas_ids: m.asignaciones.map((a) => a.disciplina),
        horarios_ids: m.horarios.map((h) => h.id),
      };
      this.alumnosElegidos.set([...m.alumnos_asignados]);
    } else {
      this.editandoId.set(null);
      this.editandoTieneCuenta.set(false);
      this.editandoUsername.set('');
      this.f = this.vacio();
      this.alumnosElegidos.set([]);
    }
    this.modal.set(true);
  }

  restablecerPassword(): void {
    const id = this.editandoId();
    if (!id) return;
    this.restableciendo.set(true);
    this.passwordGenerada.set('');
    this.api.restablecerPasswordMaestro(id, this.nuevaPassword.trim() || undefined).subscribe({
      next: (r) => {
        this.restableciendo.set(false);
        this.nuevaPassword = '';
        if (r.password_generada) this.passwordGenerada.set(r.password_generada);
      },
      error: (e) => {
        this.restableciendo.set(false);
        this.error.set(e?.error?.detail ?? 'No se pudo restablecer la contraseña.');
      },
    });
  }

  cerrar(): void {
    this.modal.set(false);
  }

  guardar(): void {
    if (!this.f.nombre) {
      this.error.set('El nombre es obligatorio.');
      return;
    }
    this.guardando.set(true);
    const datos = { ...this.f, alumnos_ids: this.alumnosElegidos().map((a) => a.id) };
    const accion = this.editandoId()
      ? this.api.editarMaestro(this.editandoId()!, datos as never)
      : this.api.crearMaestro(datos as never);

    accion.subscribe({
      next: (m) => {
        this.guardando.set(false);
        this.modal.set(false);
        if (!this.editandoId() && m.password_inicial) {
          this.credenciales.set({ username: m.username, password: m.password_inicial });
        }
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        const d = e?.error;
        this.error.set(
          typeof d === 'object' && d ? Object.values(d).flat().join(' ') : 'No se pudo guardar.',
        );
      },
    });
  }

  borrar(m: Maestro): void {
    if (!confirm(`¿Eliminar a ${m.nombre}?`)) return;
    this.api.borrarMaestro(m.id).subscribe(() => this.cargar());
  }

  private cargar(): void {
    this.api.maestros({ page_size: 100 }).subscribe({
      next: (p) => {
        this.maestros.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  constructor() {
    this.api.disciplinas({ page_size: 100 }).subscribe((p) => this.disciplinas.set(p.results));
    this.api.horarios({ page_size: 100 }).subscribe((p) => this.horarios.set(p.results));
    this.cargar();
  }
}
