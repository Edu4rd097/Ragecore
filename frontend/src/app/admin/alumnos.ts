import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AlumnoLista, Disciplina, Horario, Membresia, estadoPago } from '../core/models';
import {
  AvatarComponent,
  CargandoComponent,
  ModalComponent,
  PaginadorComponent,
  SemaforoComponent,
  VacioComponent,
} from '../shared/ui';

@Component({
  selector: 'cb-admin-alumnos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AvatarComponent,
    SemaforoComponent,
    CargandoComponent,
    VacioComponent,
    PaginadorComponent,
    ModalComponent,
  ],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <h1 style="margin:0">Alumnos</h1>
        <button class="btn btn-rojo" (click)="abrirAlta()">+ Nuevo alumno</button>
      </div>

      <!-- ===== FILTROS ===== -->
      <section class="tarjeta filtros">
        <div class="campo crece">
          <label for="busca">Buscar</label>
          <input
            id="busca"
            [(ngModel)]="busqueda"
            (ngModelChange)="teclea$.next($event)"
            placeholder="Nombre, apodo o teléfono"
          />
        </div>
        <div class="campo">
          <label for="fd">Disciplina</label>
          <select id="fd" [(ngModel)]="fDisciplina" (ngModelChange)="recargar(1)">
            <option [ngValue]="null">Todas</option>
            @for (d of disciplinas(); track d.id) {
              <option [ngValue]="d.id">{{ d.nombre }}</option>
            }
          </select>
        </div>
        <div class="campo">
          <label for="fh">Horario</label>
          <select id="fh" [(ngModel)]="fHorario" (ngModelChange)="recargar(1)">
            <option [ngValue]="null">Todos</option>
            @for (h of horarios(); track h.id) {
              <option [ngValue]="h.id">{{ h.turno }} {{ h.hora_inicio.slice(0, 5) }}</option>
            }
          </select>
        </div>
        <div class="campo">
          <label for="fa">Estatus</label>
          <select id="fa" [(ngModel)]="fActivo" (ngModelChange)="recargar(1)">
            <option [ngValue]="null">Todos</option>
            <option [ngValue]="true">Activos</option>
            <option [ngValue]="false">Inactivos</option>
          </select>
        </div>
        <div class="campo">
          <label for="fp">Pago</label>
          <select id="fp" [(ngModel)]="fPago" (ngModelChange)="recargar(1)">
            <option value="">Cualquiera</option>
            <option value="corriente">Al corriente</option>
            <option value="vencido">Vencido</option>
          </select>
        </div>
      </section>

      <!-- ===== TABLA ===== -->
      @if (cargando()) {
        <cb-cargando />
      } @else if (visibles().length) {
        <div class="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Horario</th>
                <th>Membresía</th>
                <th>Récord</th>
                <th>Puntos</th>
                <th>Pago</th>
                <th>Estatus</th>
              </tr>
            </thead>
            <tbody>
              @for (a of visibles(); track a.id) {
                <tr class="clicable" (click)="abrir(a.id)">
                  <td>
                    <div class="fila">
                      <cb-avatar [foto]="a.foto" [nombre]="a.nombre_completo" [tam]="34" />
                      <div>
                        <div>{{ a.nombre_completo }}</div>
                        @if (a.apodo) {
                          <span class="mini tenue">"{{ a.apodo }}"</span>
                        }
                      </div>
                    </div>
                  </td>
                  <td class="mini">{{ a.horario_display ?? '—' }}</td>
                  <td class="mini">{{ a.membresia_nombre ?? '—' }}</td>
                  <td class="mono">{{ a.record }}</td>
                  <td class="mono">{{ a.puntos }}</td>
                  <td>
                    <cb-semaforo
                      [estado]="estado(a)"
                      [dias]="a.dias_para_vencer"
                    />
                  </td>
                  <td>
                    <span class="chip" [class]="a.activo ? 'chip-verde' : 'chip-gris'">
                      {{ a.activo ? 'Activo' : 'Baja' }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="recargar($event)" />
      } @else {
        <cb-vacio
          icono="🔍"
          titulo="Sin resultados"
          detalle="Prueba con otros filtros o da de alta un alumno."
        />
      }
    </div>

    <!-- ===== ALTA ===== -->
    @if (alta()) {
      <cb-modal titulo="Nuevo alumno" (cerrar)="alta.set(false)">
        @if (errorAlta()) {
          <div class="aviso aviso-error" style="margin-bottom:14px">{{ errorAlta() }}</div>
        }

        <div class="grid grid-2">
          <div class="campo">
            <label for="n">Nombres *</label>
            <input id="n" [(ngModel)]="nuevo.nombres" />
          </div>
          <div class="campo">
            <label for="ap">Apellidos *</label>
            <input id="ap" [(ngModel)]="nuevo.apellidos" />
          </div>
          <div class="campo">
            <label for="apo">Apodo</label>
            <input id="apo" [(ngModel)]="nuevo.apodo" />
          </div>
          <div class="campo">
            <label for="ed">Edad</label>
            <input id="ed" type="number" [(ngModel)]="nuevo.edad" />
          </div>
          <div class="campo">
            <label for="te">Teléfono</label>
            <input id="te" [(ngModel)]="nuevo.telefono" />
          </div>
          <div class="campo">
            <label for="em">Correo electrónico</label>
            <input id="em" type="email" [(ngModel)]="nuevo.email" placeholder="Para avisos y recordatorios" />
          </div>
          <div class="campo">
            <label for="pe">Peso (kg)</label>
            <input id="pe" type="number" step="0.1" [(ngModel)]="nuevo.peso_actual" />
          </div>
          <div class="campo">
            <label for="es">Estatura (cm)</label>
            <input id="es" type="number" min="80" max="250" [(ngModel)]="nuevo.estatura" />
          </div>
          <div class="campo">
            <label for="ho">Horario</label>
            <select id="ho" [(ngModel)]="nuevo.horario">
              <option [ngValue]="null">Sin asignar</option>
              @for (h of horarios(); track h.id) {
                <option [ngValue]="h.id">{{ h.turno }} {{ h.hora_inicio.slice(0, 5) }}</option>
              }
            </select>
          </div>
          <div class="campo">
            <label for="me">Membresía</label>
            <select id="me" [(ngModel)]="nuevo.membresia">
              <option [ngValue]="null">Sin asignar</option>
              @for (m of membresias(); track m.id) {
                <option [ngValue]="m.id">{{ m.nombre }} — \${{ m.precio }}</option>
              }
            </select>
          </div>
        </div>

        <div class="campo">
          <label>Disciplinas</label>
          <div class="fila envuelve">
            @for (d of disciplinas(); track d.id) {
              <button
                type="button"
                class="chip"
                [class.chip-rojo]="nuevo.disciplinas_ids.includes(d.id)"
                [class.chip-gris]="!nuevo.disciplinas_ids.includes(d.id)"
                (click)="alternarDisciplina(d.id)"
              >
                {{ d.nombre }}
              </button>
            }
          </div>
        </div>

        <p class="mini tenue">
          El código QR y la cuenta de acceso (usuario y contraseña inicial) se generan solos al guardar.
        </p>

        <div pie>
          <button class="btn" (click)="alta.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Guardando...' : 'Dar de alta' }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== CREDENCIALES DE LA CUENTA NUEVA (una sola vez) ===== -->
    @if (credenciales(); as c) {
      <cb-modal titulo="Alumno dado de alta" (cerrar)="irAFicha()">
        <p>
          Comunícale estas credenciales al alumno. La contraseña no se vuelve a mostrar; él la
          cambia en Mi perfil → Seguridad.
        </p>
        <dl class="credenciales">
          <dt class="etiqueta">Usuario</dt>
          <dd class="mono">{{ c.username }}</dd>
          <dt class="etiqueta">Contraseña inicial</dt>
          <dd class="mono">{{ c.password }}</dd>
        </dl>
        <div pie>
          <button class="btn btn-rojo" (click)="irAFicha()">Abrir ficha</button>
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
        min-width: 140px;
      }
      .filtros .campo.crece {
        flex: 1;
        min-width: 200px;
      }
      button.chip {
        cursor: pointer;
        font-family: inherit;
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
export class AdminAlumnos {
  private api = inject(ApiService);
  private router = inject(Router);

  lista = signal<AlumnoLista[]>([]);
  visibles = signal<AlumnoLista[]>([]);
  disciplinas = signal<Disciplina[]>([]);
  horarios = signal<Horario[]>([]);
  membresias = signal<Membresia[]>([]);

  cargando = signal(true);
  guardando = signal(false);
  alta = signal(false);
  errorAlta = signal('');
  /** Credenciales del alumno recién creado; al cerrar se abre su ficha. */
  credenciales = signal<{ id: number; username: string; password: string } | null>(null);

  pagina = signal(1);
  total = signal(0);

  busqueda = '';
  fDisciplina: number | null = null;
  fHorario: number | null = null;
  fActivo: boolean | null = null;
  fPago = '';

  teclea$ = new Subject<string>();

  nuevo = this.formularioVacio();

  private formularioVacio() {
    return {
      nombres: '',
      apellidos: '',
      apodo: '',
      edad: null as number | null,
      telefono: '',
      email: '',
      peso_actual: null as number | null,
      estatura: null as number | null,
      horario: null as number | null,
      membresia: null as number | null,
      disciplinas_ids: [] as number[],
    };
  }

  estado(a: AlumnoLista) {
    return estadoPago(a.al_corriente, a.dias_para_vencer);
  }

  abrir(id: number): void {
    this.router.navigate(['/admin/alumnos', id]);
  }

  abrirAlta(): void {
    this.nuevo = this.formularioVacio();
    this.errorAlta.set('');
    this.alta.set(true);
  }

  alternarDisciplina(id: number): void {
    const ids = this.nuevo.disciplinas_ids;
    this.nuevo.disciplinas_ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  recargar(pagina = 1): void {
    this.cargando.set(true);
    this.pagina.set(pagina);

    this.api
      .alumnos({
        page: pagina,
        search: this.busqueda || undefined,
        disciplinas: this.fDisciplina ?? undefined,
        horario: this.fHorario ?? undefined,
        activo: this.fActivo ?? undefined,
      })
      .subscribe({
        next: (p) => {
          this.lista.set(p.results);
          this.total.set(p.count);
          this.aplicarFiltroPago();
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
  }

  /**
   * El estatus de pago se calcula en el backend por alumno, no es un campo
   * filtrable en la query, así que este filtro se aplica sobre la página actual.
   */
  private aplicarFiltroPago(): void {
    const base = this.lista();
    if (!this.fPago) {
      this.visibles.set(base);
      return;
    }
    this.visibles.set(
      base.filter((a) => (this.fPago === 'corriente' ? a.al_corriente : !a.al_corriente)),
    );
  }

  guardar(): void {
    if (!this.nuevo.nombres || !this.nuevo.apellidos) {
      this.errorAlta.set('Nombres y apellidos son obligatorios.');
      return;
    }
    this.guardando.set(true);

    this.api.crearAlumno(this.nuevo as never).subscribe({
      next: (a) => {
        this.guardando.set(false);
        this.alta.set(false);
        if (a.password_inicial) {
          // La cuenta nació con el alta: se muestran las credenciales una vez.
          this.credenciales.set({ id: a.id, username: a.username, password: a.password_inicial });
        } else {
          this.router.navigate(['/admin/alumnos', a.id]);
        }
      },
      error: (e) => {
        this.guardando.set(false);
        const d = e?.error;
        this.errorAlta.set(
          typeof d === 'object' ? Object.values(d).flat().join(' ') : 'No se pudo guardar.',
        );
      },
    });
  }

  irAFicha(): void {
    const c = this.credenciales();
    this.credenciales.set(null);
    if (c) this.router.navigate(['/admin/alumnos', c.id]);
  }

  constructor() {
    this.api.disciplinas({ page_size: 100 }).subscribe((p) => this.disciplinas.set(p.results));
    this.api.horarios({ page_size: 100 }).subscribe((p) => this.horarios.set(p.results));
    this.api.membresias({ page_size: 100 }).subscribe((p) => this.membresias.set(p.results));

    // Se espera a que el usuario deje de teclear para no disparar una petición por letra.
    this.teclea$.pipe(debounceTime(350)).subscribe(() => this.recargar(1));

    this.recargar(1);
  }
}
