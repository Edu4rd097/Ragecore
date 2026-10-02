import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  AlumnoLista,
  Disciplina,
  Evento,
  EventoInscripcion,
  METODOS_TORNEO,
  RESULTADOS_TORNEO,
  TipoEvento,
} from '../core/models';
import {
  CargandoComponent,
  ModalComponent,
  PaginadorComponent,
  VacioComponent,
} from '../shared/ui';

/**
 * Alta y gestión de Eventos (torneos/seminarios/exámenes) con lista de
 * inscritos, asistencia y —en los torneos— resultado por alumno. Este mismo
 * componente se monta en dos rutas (/admin/eventos y /maestro/eventos, ver
 * app.routes.ts): admin y maestro pueden darlos de alta por igual (permiso
 * EsPersonalOSoloLectura en el backend), así que no hace falta un componente
 * distinto para cada uno. El maestro solo puede borrar los eventos que él
 * creó (el backend lo exige; aquí solo se esconde el botón en los ajenos).
 *
 * Desde el detalle el personal agrega alumnos (el buscador usa api.alumnos(),
 * que el backend ya acota a los alumnos a cargo del maestro; la lista de
 * inscritos también) y captura si ganó, perdió o empató y por qué método. El
 * resultado es un Torneo ligado al evento (POST
 * /inscripciones-evento/{id}/resultado/), así que el récord del alumno y su
 * línea de tiempo en "Mi progreso" se actualizan solos.
 */
@Component({
  selector: 'cb-eventos',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, PaginadorComponent, ModalComponent],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <h1 style="margin:0">Eventos</h1>
        <button class="btn btn-rojo" (click)="abrir()">+ Nuevo evento</button>
      </div>

      <section class="tarjeta filtros">
        <div class="campo crece">
          <label for="busca">Buscar</label>
          <input
            id="busca"
            [(ngModel)]="busqueda"
            (ngModelChange)="teclea$.next($event)"
            placeholder="Título o lugar"
          />
        </div>
        <div class="campo">
          <label for="ft">Tipo</label>
          <select id="ft" [(ngModel)]="fTipo" (ngModelChange)="recargar(1)">
            <option [ngValue]="null">Todos</option>
            <option value="TORNEO">Torneo</option>
            <option value="SEMINARIO">Seminario</option>
            <option value="EXAMEN">Examen de grado</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
      </section>

      @if (cargando()) {
        <cb-cargando />
      } @else if (lista().length) {
        <div class="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Tipo</th>
                <th>Fecha</th>
                <th>Lugar</th>
                <th>Inscritos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (e of lista(); track e.id) {
                <tr class="clicable" (click)="abrirDetalle(e)">
                  <td>{{ e.titulo }}</td>
                  <td class="mini">{{ e.tipo_display }}</td>
                  <td class="mono">{{ e.fecha }}</td>
                  <td class="mini">{{ e.lugar || '—' }}</td>
                  <td class="mono">{{ e.total_inscritos }}</td>
                  <td (click)="$event.stopPropagation()">
                    @if (puedeBorrar(e)) {
                      <button class="btn btn-mini btn-fantasma" (click)="borrar(e)" aria-label="Eliminar evento">✕</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="recargar($event)" />
      } @else {
        <cb-vacio icono="📅" titulo="Sin eventos" detalle="Da de alta un torneo, seminario o examen." />
      }
    </div>

    <!-- ===== MODAL CREAR ===== -->
    @if (modal()) {
      <cb-modal titulo="Nuevo evento" (cerrar)="modal.set(false)">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }

        <div class="campo"><label>Título *</label><input [(ngModel)]="f.titulo" /></div>
        <div class="grid grid-2">
          <div class="campo">
            <label>Tipo</label>
            <select [(ngModel)]="f.tipo">
              <option value="TORNEO">Torneo</option>
              <option value="SEMINARIO">Seminario</option>
              <option value="EXAMEN">Examen de grado</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>
          <div class="campo"><label>Fecha *</label><input type="date" [(ngModel)]="f.fecha" /></div>
        </div>
        <div class="campo"><label>Lugar</label><input [(ngModel)]="f.lugar" /></div>
        <div class="campo">
          <label>Disciplina</label>
          <select [(ngModel)]="f.disciplina">
            <option [ngValue]="null">—</option>
            @for (d of disciplinas(); track d.id) {
              <option [ngValue]="d.id">{{ d.nombre }}</option>
            }
          </select>
        </div>
        <div class="campo">
          <label>Descripción</label>
          <textarea [(ngModel)]="f.descripcion" rows="3"></textarea>
        </div>

        <div pie>
          <button class="btn" (click)="modal.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Guardando...' : 'Crear' }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== MODAL DETALLE / INSCRITOS / RESULTADOS ===== -->
    @if (detalle(); as d) {
      <cb-modal [titulo]="d.titulo" [amplio]="true" (cerrar)="cerrarDetalle()">
        <div class="grid grid-2" style="margin-bottom:16px">
          <div><span class="mini tenue">Tipo</span><br />{{ d.tipo_display }}</div>
          <div><span class="mini tenue">Fecha</span><br />{{ d.fecha }}</div>
          <div><span class="mini tenue">Lugar</span><br />{{ d.lugar || '—' }}</div>
          <div><span class="mini tenue">Dado de alta por</span><br />{{ d.creado_por_username || '—' }}</div>
        </div>
        @if (d.descripcion) {
          <p class="mini tenue" style="margin-top:0">{{ d.descripcion }}</p>
        }

        @if (errorDetalle()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ errorDetalle() }}</div>
        }

        <!-- Agregar alumno (mismo buscador que avisos/insignias) -->
        <div class="campo">
          <label for="agrega">Agregar alumno</label>
          <input
            id="agrega"
            [(ngModel)]="busquedaAlumno"
            (ngModelChange)="buscarAlumno($event)"
            placeholder="Nombre o apodo"
            autocomplete="off"
          />
          @if (resultadosBusqueda().length) {
            <ul class="lista-alumnos">
              @for (a of resultadosBusqueda(); track a.id) {
                <li (click)="agregarAlumno(a)">
                  <strong>{{ a.nombre_completo }}</strong>
                  @if (a.apodo) {
                    <span class="mini tenue">"{{ a.apodo }}"</span>
                  }
                </li>
              }
            </ul>
          }
        </div>

        <h3 class="titulo-seccion">Inscritos ({{ inscritos().length }})</h3>
        @if (cargandoInscritos()) {
          <cb-cargando texto="Cargando inscritos" />
        } @else if (inscritos().length) {
          <div class="tabla-scroll">
            <table class="inscritos">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Inscrito</th>
                  <th>Asistió</th>
                  @if (d.tipo === 'TORNEO') {
                    <th>Resultado</th>
                  }
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (i of inscritos(); track i.id) {
                  <tr>
                    <td>{{ i.alumno_nombre }}</td>
                    <td class="mini">{{ i.fecha_inscripcion | date: 'dd/MM/yyyy' }}</td>
                    <td>
                      <button
                        type="button"
                        class="chip"
                        [class.chip-verde]="i.asistio"
                        [class.chip-gris]="!i.asistio"
                        (click)="marcarAsistencia(i)"
                      >
                        {{ i.asistio ? 'Sí' : 'No' }}
                      </button>
                    </td>
                    @if (d.tipo === 'TORNEO') {
                      <td class="resultado">
                        @if (editandoResultado() === i.id) {
                          <div class="fila envuelve captura">
                            <select [(ngModel)]="fr.resultado" aria-label="Resultado">
                              @for (r of resultados; track r.valor) {
                                <option [value]="r.valor">{{ r.rotulo }}</option>
                              }
                            </select>
                            <select [(ngModel)]="fr.metodo" aria-label="Método">
                              @for (m of metodos; track m.valor) {
                                <option [value]="m.valor">{{ m.rotulo }}</option>
                              }
                            </select>
                            <button
                              type="button"
                              class="btn btn-mini btn-rojo"
                              [disabled]="guardandoResultado()"
                              (click)="guardarResultado(i)"
                            >
                              {{ guardandoResultado() ? 'Guardando...' : 'Guardar' }}
                            </button>
                            <button type="button" class="btn btn-mini" (click)="editandoResultado.set(null)">
                              Cancelar
                            </button>
                          </div>
                        } @else {
                          @if (i.torneo; as t) {
                            <span class="chip" [class]="claseResultado(t.resultado)">{{ t.resultado_display }}</span>
                            @if (t.metodo) {
                              <span class="mini tenue">por {{ t.metodo_display }}</span>
                            }
                            <button type="button" class="btn btn-mini btn-fantasma" (click)="editarResultado(i)">
                              Editar
                            </button>
                            <button
                              type="button"
                              class="btn btn-mini btn-fantasma"
                              (click)="quitarResultado(i)"
                              aria-label="Quitar resultado"
                            >
                              ✕
                            </button>
                          } @else {
                            <button type="button" class="btn btn-mini" (click)="editarResultado(i)">Registrar</button>
                          }
                        }
                      </td>
                    }
                    <td>
                      <button
                        type="button"
                        class="btn btn-mini btn-fantasma"
                        (click)="quitarInscripcion(i)"
                        aria-label="Quitar de la lista"
                        title="Quitar de la lista"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="mini tenue">Nadie se ha inscrito todavía. Busca un alumno arriba para agregarlo.</p>
        }

        @if (d.tipo === 'TORNEO') {
          <p class="mini tenue" style="margin:10px 0 0">
            Al registrar un resultado se marca la asistencia y el récord del peleador se recalcula solo.
          </p>
        }

        <div pie>
          <button class="btn" (click)="cerrarDetalle()">Cerrar</button>
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
      button.chip {
        cursor: pointer;
        font-family: inherit;
        border: none;
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
      .resultado {
        white-space: nowrap;
      }
      .resultado .chip + .mini {
        margin-left: 6px;
      }
      .resultado .btn {
        margin-left: 6px;
      }
      .captura {
        gap: 6px;
        align-items: center;
      }
      .captura select {
        min-width: 120px;
        padding: 6px 8px;
      }
      .captura .btn {
        margin-left: 0;
      }
    `,
  ],
})
export class Eventos {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  lista = signal<Evento[]>([]);
  disciplinas = signal<Disciplina[]>([]);

  cargando = signal(true);
  guardando = signal(false);

  pagina = signal(1);
  total = signal(0);

  busqueda = '';
  fTipo: TipoEvento | null = null;
  teclea$ = new Subject<string>();

  modal = signal(false);
  error = signal('');

  detalle = signal<Evento | null>(null);
  inscritos = signal<EventoInscripcion[]>([]);
  cargandoInscritos = signal(false);
  errorDetalle = signal('');

  // Buscador para agregar alumnos (mismo patrón que admin/avisos.ts).
  busquedaAlumno = '';
  resultadosBusqueda = signal<AlumnoLista[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;

  // Captura de resultado en la fila del inscrito.
  editandoResultado = signal<number | null>(null);
  guardandoResultado = signal(false);
  fr = { resultado: 'GANO', metodo: '' };
  resultados = RESULTADOS_TORNEO;
  metodos = METODOS_TORNEO;

  f = this.vacio();

  private vacio() {
    return {
      titulo: '',
      tipo: 'OTRO' as TipoEvento,
      fecha: this.hoy(),
      lugar: '',
      disciplina: null as number | null,
      descripcion: '',
    };
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  abrir(): void {
    this.error.set('');
    this.f = this.vacio();
    this.modal.set(true);
  }

  guardar(): void {
    if (!this.f.titulo.trim() || !this.f.fecha) {
      this.error.set('Título y fecha son obligatorios.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    this.api.crearEvento(this.f as never).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(false);
        this.recargar(1);
      },
      error: (e) => {
        this.guardando.set(false);
        const d = e?.error;
        this.error.set(
          typeof d === 'object' ? Object.values(d).flat().join(' ') : 'No se pudo crear el evento.',
        );
      },
    });
  }

  /** Admin: cualquiera. Maestro: solo los eventos que él dio de alta. */
  puedeBorrar(e: Evento): boolean {
    return this.auth.esAdmin() || e.creado_por === this.auth.usuario()?.id;
  }

  borrar(e: Evento): void {
    if (!confirm(`¿Eliminar el evento "${e.titulo}"?`)) return;
    this.api.borrarEvento(e.id).subscribe({
      next: () => this.recargar(this.pagina()),
      error: () => alert('No se pudo eliminar el evento.'),
    });
  }

  abrirDetalle(e: Evento): void {
    this.detalle.set(e);
    this.inscritos.set([]);
    this.errorDetalle.set('');
    this.editandoResultado.set(null);
    this.busquedaAlumno = '';
    this.resultadosBusqueda.set([]);
    this.cargandoInscritos.set(true);
    this.api.inscripcionesEvento({ evento: e.id, page_size: 200 }).subscribe({
      next: (p) => {
        this.inscritos.set(p.results);
        this.cargandoInscritos.set(false);
      },
      error: () => this.cargandoInscritos.set(false),
    });
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
    this.editandoResultado.set(null);
    this.resultadosBusqueda.set([]);
  }

  marcarAsistencia(i: EventoInscripcion): void {
    this.api.marcarAsistencia(i.id, !i.asistio).subscribe({
      next: (actualizada) => this.reemplazar(actualizada),
      error: () => this.errorDetalle.set('No se pudo actualizar la asistencia.'),
    });
  }

  // --- Agregar / quitar alumnos --------------------------------------------

  buscarAlumno(texto: string): void {
    if (this.timer) clearTimeout(this.timer);
    if (!texto) {
      this.resultadosBusqueda.set([]);
      return;
    }
    this.timer = setTimeout(() => {
      this.api.alumnos({ search: texto, page_size: 8 }).subscribe((p) => {
        // Los que ya están en la lista no se vuelven a ofrecer.
        const inscritos = new Set(this.inscritos().map((i) => i.alumno));
        this.resultadosBusqueda.set(p.results.filter((a) => !inscritos.has(a.id)));
      });
    }, 300);
  }

  agregarAlumno(a: AlumnoLista): void {
    const d = this.detalle();
    if (!d) return;
    this.errorDetalle.set('');
    this.api.inscribirAlumnoEvento(d.id, a.id).subscribe({
      next: (nueva) => {
        this.inscritos.set([nueva, ...this.inscritos()]);
        this.busquedaAlumno = '';
        this.resultadosBusqueda.set([]);
        this.ajustarTotal(d.id, 1);
      },
      error: (e) => this.errorDetalle.set(this.mensaje(e, 'No se pudo inscribir al alumno.')),
    });
  }

  quitarInscripcion(i: EventoInscripcion): void {
    if (!confirm(`¿Quitar a ${i.alumno_nombre} de la lista de inscritos?`)) return;
    this.api.cancelarInscripcion(i.id).subscribe({
      next: () => {
        this.inscritos.set(this.inscritos().filter((x) => x.id !== i.id));
        this.ajustarTotal(i.evento, -1);
      },
      error: () => this.errorDetalle.set('No se pudo quitar la inscripción.'),
    });
  }

  // --- Resultado (ganó / perdió / empató + método) --------------------------

  editarResultado(i: EventoInscripcion): void {
    this.fr = { resultado: i.torneo?.resultado ?? 'GANO', metodo: i.torneo?.metodo ?? '' };
    this.errorDetalle.set('');
    this.editandoResultado.set(i.id);
  }

  guardarResultado(i: EventoInscripcion): void {
    this.guardandoResultado.set(true);
    this.errorDetalle.set('');
    this.api.registrarResultadoEvento(i.id, { ...this.fr }).subscribe({
      next: (actualizada) => {
        this.reemplazar(actualizada);
        this.editandoResultado.set(null);
        this.guardandoResultado.set(false);
      },
      error: (e) => {
        this.guardandoResultado.set(false);
        this.errorDetalle.set(this.mensaje(e, 'No se pudo guardar el resultado.'));
      },
    });
  }

  quitarResultado(i: EventoInscripcion): void {
    if (!confirm(`¿Quitar el resultado de ${i.alumno_nombre}? Su récord se recalcula.`)) return;
    this.api.quitarResultadoEvento(i.id).subscribe({
      next: (actualizada) => this.reemplazar(actualizada),
      error: () => this.errorDetalle.set('No se pudo quitar el resultado.'),
    });
  }

  claseResultado(resultado: string): string {
    if (resultado === 'GANO') return 'chip-verde';
    if (resultado === 'PERDIO') return 'chip-rojo';
    return 'chip-gris';
  }

  private reemplazar(actualizada: EventoInscripcion): void {
    this.inscritos.set(this.inscritos().map((x) => (x.id === actualizada.id ? actualizada : x)));
  }

  /** Mantiene el conteo de inscritos de la tabla y del detalle sin recargar la página. */
  private ajustarTotal(eventoId: number, delta: number): void {
    this.lista.set(
      this.lista().map((e) =>
        e.id === eventoId ? { ...e, total_inscritos: e.total_inscritos + delta } : e,
      ),
    );
    const d = this.detalle();
    if (d && d.id === eventoId) this.detalle.set({ ...d, total_inscritos: d.total_inscritos + delta });
  }

  private mensaje(e: unknown, porDefecto: string): string {
    const cuerpo = (e as { error?: unknown })?.error;
    if (cuerpo && typeof cuerpo === 'object') {
      const textos = Object.values(cuerpo as Record<string, unknown>).flat();
      if (textos.length) return textos.join(' ');
    }
    return porDefecto;
  }

  recargar(pagina = 1): void {
    this.cargando.set(true);
    this.pagina.set(pagina);
    this.api
      .eventos({ page: pagina, search: this.busqueda || undefined, tipo: this.fTipo ?? undefined })
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
    this.api.disciplinas({ page_size: 100 }).subscribe((p) => this.disciplinas.set(p.results));
    this.teclea$.pipe(debounceTime(350)).subscribe(() => this.recargar(1));
    this.recargar(1);
  }
}
