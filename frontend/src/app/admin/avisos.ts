import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { AlumnoLista, Aviso, Horario, Notificacion, TipoDestinatario } from '../core/models';
import {
  CargandoComponent,
  ModalComponent,
  PaginadorComponent,
  VacioComponent,
} from '../shared/ui';

const TITULO_MAX = 150;
const MENSAJE_MAX = 2000;

/**
 * Notificaciones (Avisos) a alumnos: individual, grupo (horario) o todos. Se
 * monta en /admin/avisos y en /maestro/avisos con el mismo componente: el
 * backend (AvisoViewSet) ya acota al maestro a sus alumnos y grupos y le
 * niega "todos", así que aquí solo se esconde lo que no aplica — el
 * buscador de alumnos usa api.alumnos(), que para el maestro devuelve
 * únicamente los alumnos a su cargo, y el select de grupos se limita a los
 * suyos. Un maestro solo ve los avisos que él mismo mandó.
 */
@Component({
  selector: 'cb-admin-avisos',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, PaginadorComponent, ModalComponent],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <h1 style="margin:0">{{ esMaestro() ? 'Notificaciones' : 'Avisos' }}</h1>
        <button class="btn btn-rojo" (click)="abrir()">+ Nueva notificación</button>
      </div>
      @if (esMaestro()) {
        <p class="mini tenue" style="margin-top:-6px">
          Puedes notificar a tus alumnos, uno por uno o a un grupo completo que tengas asignado.
        </p>
      }

      <!-- ===== FILTROS ===== -->
      <section class="tarjeta filtros">
        <div class="campo crece">
          <label for="busca">Buscar</label>
          <input
            id="busca"
            [(ngModel)]="busqueda"
            (ngModelChange)="teclea$.next($event)"
            placeholder="Título o mensaje"
          />
        </div>
        <div class="campo">
          <label for="ft">Tipo de destinatario</label>
          <select id="ft" [(ngModel)]="fTipo" (ngModelChange)="recargar(1)">
            <option [ngValue]="null">Todos</option>
            <option value="INDIVIDUAL">Alumno individual</option>
            <option value="GRUPO">Grupo</option>
            @if (!esMaestro()) {
              <option value="TODOS">Todos los alumnos</option>
            }
          </select>
        </div>
        <div class="campo">
          <label for="fe">Estado</label>
          <select id="fe" [(ngModel)]="fEstado" (ngModelChange)="recargar(1)">
            <option [ngValue]="null">Cualquiera</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="PROCESANDO">Procesando</option>
            <option value="ENVIADA">Enviada</option>
            <option value="FALLIDA">Fallida</option>
            <option value="CANCELADA">Cancelada</option>
          </select>
        </div>
      </section>

      <!-- ===== TABLA ===== -->
      @if (cargando()) {
        <cb-cargando />
      } @else if (lista().length) {
        <div class="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Destinatario</th>
                <th>Estado</th>
                <th>Enviadas</th>
                <th>Creado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (a of lista(); track a.id) {
                <tr class="clicable" (click)="abrirDetalle(a)">
                  <td>{{ a.titulo }}</td>
                  <td class="mini">{{ destinatarioTexto(a) }}</td>
                  <td>
                    <span class="chip" [class]="claseEstado(a.estado)">{{ a.estado_display }}</span>
                  </td>
                  <td class="mono">
                    {{ a.total_enviadas }}/{{ a.total_destinatarios }}
                    @if (a.total_fallidas) {
                      <span class="mini" style="color:var(--rojo-claro)"> ({{ a.total_fallidas }} fallidas)</span>
                    }
                  </td>
                  <td class="mini">{{ a.creado_en | date: 'dd/MM/yyyy HH:mm' }}</td>
                  <td (click)="$event.stopPropagation()">
                    <div class="fila">
                      @if (a.estado === 'PENDIENTE' || a.estado === 'PROCESANDO') {
                        <button class="btn btn-mini" (click)="cancelar(a)">Cancelar</button>
                      }
                      @if (a.estado === 'PENDIENTE' && a.total_enviadas === 0) {
                        <button class="btn btn-mini btn-fantasma" (click)="borrar(a)">✕</button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="recargar($event)" />
      } @else {
        <cb-vacio
          icono="📣"
          titulo="Sin avisos"
          [detalle]="esMaestro()
            ? 'Crea una notificación para uno de tus alumnos o para un grupo que tengas asignado.'
            : 'Crea una notificación para un alumno, un grupo o todos.'"
        />
      }
    </div>

    <!-- ===== MODAL CREAR ===== -->
    @if (modal()) {
      <cb-modal titulo="Nueva notificación" (cerrar)="modal.set(false)">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }

        <div class="campo">
          <label>Tipo de destinatario *</label>
          <select [(ngModel)]="f.tipo_destinatario">
            <option value="INDIVIDUAL">Alumno individual</option>
            <option value="GRUPO">Grupo (horario)</option>
            @if (!esMaestro()) {
              <option value="TODOS">Todos los alumnos</option>
            }
          </select>
        </div>

        @if (f.tipo_destinatario === 'INDIVIDUAL') {
          <div class="campo">
            <label>Alumno *</label>
            @if (alumnoSeleccionado()) {
              <div class="fila-entre alumno-elegido">
                <span>{{ alumnoSeleccionado()!.nombre_completo }}</span>
                <button type="button" class="btn btn-mini btn-fantasma" (click)="quitarAlumno()">
                  Cambiar
                </button>
              </div>
            } @else {
              <input
                [(ngModel)]="busquedaAlumno"
                (ngModelChange)="buscarAlumno($event)"
                placeholder="Nombre o apodo"
              />
              @if (resultadosBusqueda().length) {
                <ul class="lista-alumnos">
                  @for (a of resultadosBusqueda(); track a.id) {
                    <li (click)="elegirAlumno(a)">
                      <strong>{{ a.nombre_completo }}</strong>
                      @if (a.apodo) {
                        <span class="mini tenue">"{{ a.apodo }}"</span>
                      }
                    </li>
                  }
                </ul>
              }
            }
          </div>
        }

        @if (f.tipo_destinatario === 'GRUPO') {
          <div class="campo">
            <label>Grupo (horario) *</label>
            <select [(ngModel)]="f.horario">
              <option [ngValue]="null">Selecciona un horario</option>
              @for (h of horarios(); track h.id) {
                <option [ngValue]="h.id">{{ h.turno }} {{ h.hora_inicio.slice(0, 5) }}</option>
              }
            </select>
            @if (esMaestro() && !horarios().length) {
              <p class="mini tenue" style="margin:6px 0 0">
                No tienes grupos asignados. Pídele al administrador que te asigne uno.
              </p>
            }
          </div>
        }

        <div class="campo">
          <label>Título *</label>
          <input [(ngModel)]="f.titulo" [maxlength]="tituloMax" />
        </div>
        <div class="campo">
          <label>Mensaje *</label>
          <textarea [(ngModel)]="f.mensaje" rows="4" [maxlength]="mensajeMax"></textarea>
        </div>

        <div pie>
          <button class="btn" (click)="modal.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Enviando...' : 'Crear' }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== MODAL DETALLE ===== -->
    @if (detalle()) {
      <cb-modal [titulo]="detalle()!.titulo" (cerrar)="detalle.set(null)">
        <div class="pila detalle-cabeza">
          <p class="mini tenue" style="margin:0">{{ detalle()!.mensaje }}</p>
          <div class="grid grid-2">
            <div><span class="mini tenue">Tipo</span><br />{{ detalle()!.tipo_destinatario_display }}</div>
            <div><span class="mini tenue">Destinatario</span><br />{{ destinatarioTexto(detalle()!) }}</div>
            <div><span class="mini tenue">Creada</span><br />{{ detalle()!.creado_en | date: 'dd/MM/yyyy HH:mm' }}</div>
            <div><span class="mini tenue">Estado</span><br />{{ detalle()!.estado_display }}</div>
            <div><span class="mini tenue">Destinatarios</span><br />{{ detalle()!.total_destinatarios }}</div>
            <div><span class="mini tenue">Enviadas / Fallidas</span><br />{{ detalle()!.total_enviadas }} / {{ detalle()!.total_fallidas }}</div>
          </div>
        </div>

        @if (cargandoDetalle()) {
          <cb-cargando texto="Cargando destinatarios" />
        } @else if (destinatarios().length) {
          <div class="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Correo</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                @for (n of destinatarios(); track n.id) {
                  <tr>
                    <td>{{ n.alumno_nombre }}</td>
                    <td>
                      <span class="chip" [class]="claseEstadoCorreo(n.estado_correo)">
                        {{ n.estado_correo_display }}
                      </span>
                    </td>
                    <td class="mini tenue">{{ n.error_correo || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <div pie>
          <button class="btn" (click)="detalle.set(null)">Cerrar</button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
      .filtros {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: flex-end;
      }
      .filtros .campo {
        margin-bottom: 0;
        min-width: 160px;
      }
      .filtros .campo.crece {
        flex: 1;
        min-width: 200px;
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
      .alumno-elegido {
        padding: 8px 10px;
        border: 1px solid var(--borde);
        border-radius: var(--r-sm);
        background: var(--negro-800);
      }
      .detalle-cabeza {
        margin-bottom: 16px;
        gap: 10px;
      }
    `,
  ],
})
export class AdminAvisos {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  /** Modo maestro: sin "todos", solo sus grupos. El backend lo exige igual. */
  esMaestro = this.auth.esMaestro;

  lista = signal<Aviso[]>([]);
  horarios = signal<Horario[]>([]);

  cargando = signal(true);
  guardando = signal(false);

  pagina = signal(1);
  total = signal(0);

  busqueda = '';
  fTipo: TipoDestinatario | null = null;
  fEstado: string | null = null;

  teclea$ = new Subject<string>();

  modal = signal(false);
  error = signal('');

  busquedaAlumno = '';
  resultadosBusqueda = signal<AlumnoLista[]>([]);
  alumnoSeleccionado = signal<AlumnoLista | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  detalle = signal<Aviso | null>(null);
  destinatarios = signal<Notificacion[]>([]);
  cargandoDetalle = signal(false);

  readonly tituloMax = TITULO_MAX;
  readonly mensajeMax = MENSAJE_MAX;

  f = this.vacio();

  private vacio() {
    return {
      tipo_destinatario: 'INDIVIDUAL' as TipoDestinatario,
      horario: null as number | null,
      titulo: '',
      mensaje: '',
    };
  }

  destinatarioTexto(a: Aviso): string {
    if (a.tipo_destinatario === 'INDIVIDUAL') return a.alumno_nombre || '—';
    if (a.tipo_destinatario === 'GRUPO') return a.horario_display || '—';
    return 'Todos los alumnos';
  }

  claseEstado(estado: string): string {
    switch (estado) {
      case 'ENVIADA':
        return 'chip-verde';
      case 'FALLIDA':
        return 'chip-rojo';
      case 'CANCELADA':
        return 'chip-gris';
      default:
        return 'chip-amarillo';
    }
  }

  claseEstadoCorreo(estado: string): string {
    switch (estado) {
      case 'ENVIADO':
        return 'chip-verde';
      case 'FALLIDO':
        return 'chip-rojo';
      default:
        return 'chip-amarillo';
    }
  }

  abrir(): void {
    this.error.set('');
    this.f = this.vacio();
    this.busquedaAlumno = '';
    this.resultadosBusqueda.set([]);
    this.alumnoSeleccionado.set(null);
    this.modal.set(true);
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

  elegirAlumno(a: AlumnoLista): void {
    this.alumnoSeleccionado.set(a);
    this.resultadosBusqueda.set([]);
    this.busquedaAlumno = '';
  }

  quitarAlumno(): void {
    this.alumnoSeleccionado.set(null);
  }

  guardar(): void {
    if (!this.f.titulo.trim() || !this.f.mensaje.trim()) {
      this.error.set('Título y mensaje son obligatorios.');
      return;
    }
    if (this.f.tipo_destinatario === 'INDIVIDUAL' && !this.alumnoSeleccionado()) {
      this.error.set('Selecciona un alumno.');
      return;
    }
    if (this.f.tipo_destinatario === 'GRUPO' && !this.f.horario) {
      this.error.set('Selecciona un grupo (horario).');
      return;
    }

    this.guardando.set(true);
    this.error.set('');

    const datos: Record<string, unknown> = {
      titulo: this.f.titulo.trim(),
      mensaje: this.f.mensaje.trim(),
      tipo_destinatario: this.f.tipo_destinatario,
    };
    if (this.f.tipo_destinatario === 'INDIVIDUAL') datos['alumno'] = this.alumnoSeleccionado()!.id;
    if (this.f.tipo_destinatario === 'GRUPO') datos['horario'] = this.f.horario;

    this.api.crearAviso(datos).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(false);
        this.recargar(1);
      },
      error: (e) => {
        this.guardando.set(false);
        const d = e?.error;
        this.error.set(
          typeof d === 'object' ? Object.values(d).flat().join(' ') : 'No se pudo crear el aviso.',
        );
      },
    });
  }

  abrirDetalle(a: Aviso): void {
    this.detalle.set(a);
    this.destinatarios.set([]);
    this.cargandoDetalle.set(true);
    this.api.notificaciones({ aviso: a.id, page_size: 200 }).subscribe({
      next: (p) => {
        this.destinatarios.set(p.results);
        this.cargandoDetalle.set(false);
      },
      error: () => this.cargandoDetalle.set(false),
    });
  }

  cancelar(a: Aviso): void {
    if (!confirm(`¿Cancelar el aviso "${a.titulo}"? Lo que aún no se ha mandado no se enviará.`)) return;
    this.api.cancelarAviso(a.id).subscribe({
      next: () => this.recargar(this.pagina()),
      error: () => alert('No se pudo cancelar el aviso.'),
    });
  }

  borrar(a: Aviso): void {
    if (!confirm(`¿Eliminar el aviso "${a.titulo}"?`)) return;
    this.api.borrarAviso(a.id).subscribe({
      next: () => this.recargar(this.pagina()),
      error: () => alert('No se pudo eliminar. Puede que ya haya enviado algo.'),
    });
  }

  recargar(pagina = 1): void {
    this.cargando.set(true);
    this.pagina.set(pagina);
    this.api
      .avisos({
        page: pagina,
        search: this.busqueda || undefined,
        tipo_destinatario: this.fTipo ?? undefined,
        estado: this.fEstado ?? undefined,
      })
      .subscribe({
        next: (p) => {
          this.lista.set(p.results);
          this.total.set(p.count);
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
  }

  constructor() {
    this.api.horarios({ page_size: 100 }).subscribe((p) => {
      let lista = p.results;
      if (this.esMaestro()) {
        // Solo los grupos que el administrador le asignó (vienen en la sesión).
        const mios = new Set(this.auth.usuario()?.maestro?.horarios.map((h) => h.id) ?? []);
        lista = lista.filter((h) => mios.has(h.id));
      }
      this.horarios.set(lista);
    });
    this.teclea$.pipe(debounceTime(350)).subscribe(() => this.recargar(1));
    this.recargar(1);
  }
}
