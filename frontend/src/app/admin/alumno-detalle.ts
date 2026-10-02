import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Experiencia,
  Alumno,
  Asistencia,
  Disciplina,
  Grado,
  Horario,
  Maestro,
  Membresia,
  Pago,
  Torneo,
  estadoPago,
} from '../core/models';
import {
  AvatarComponent,
  CargandoComponent,
  ModalComponent,
  SemaforoComponent,
  VacioComponent,
} from '../shared/ui';
import { ComprobantePago } from '../shared/comprobante-pago';
import { DescargarFicha } from '../shared/descargar-ficha';
import { ExperienciaForm } from '../shared/experiencia-form';
import { EvaluacionMMAPanel } from '../shared/evaluacion-mma-panel';

type Pestana = 'datos' | 'experiencia' | 'evaluacion' | 'pagos' | 'asistencia' | 'historial';

@Component({
  selector: 'cb-admin-alumno-detalle',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AvatarComponent,
    SemaforoComponent,
    CargandoComponent,
    VacioComponent,
    ModalComponent,
    ExperienciaForm,
    EvaluacionMMAPanel,
    DescargarFicha,
    ComprobantePago,
  ],
  template: `
    @if (cargando()) {
      <cb-cargando />
    } @else if (alumno(); as a) {
      <div class="pila">
        <a routerLink="/admin/alumnos" class="mini">← Volver al listado</a>

        <!-- ===== CABECERA ===== -->
        <section class="tarjeta cabeza">
          <cb-avatar [foto]="a.foto" [nombre]="a.nombre_completo" [tam]="78" [aro]="true" [sinIniciales]="true" />
          <div class="crece">
            @if (a.apodo) {
              <span class="apodo">"{{ a.apodo }}"</span>
            }
            <h1>{{ a.nombre_completo }}</h1>
            <div class="fila envuelve">
              <cb-semaforo [estado]="semaforo()" [dias]="a.dias_para_vencer" />
              <span class="chip" [class]="a.activo ? 'chip-verde' : 'chip-gris'">
                {{ a.activo ? 'Activo' : 'Baja' }}
              </span>
              <span class="chip chip-gris mono">{{ a.puntos }} pts</span>
              <span class="chip chip-gris mono">{{ a.record }}</span>
            </div>
          </div>
          <div class="acciones">
            <button
              class="btn btn-mini btn-rojo"
              (click)="abrirAsistencia()"
              [disabled]="!a.activo"
              [title]="a.activo ? 'Registrar asistencia de hoy sin QR' : 'Reactiva al alumno para marcar asistencia'"
            >
              ✅ Marcar asistencia
            </button>
            <a class="btn btn-mini" [routerLink]="['/ficha', a.id]">👁 Ver ficha</a>
            <cb-descargar-ficha [alumnoId]="a.id" [mini]="true" />
            <button class="btn btn-mini" (click)="qr.set(true)">Ver QR</button>
            <button class="btn btn-mini" (click)="alternarBaja()">
              {{ a.activo ? 'Dar de baja' : 'Reactivar' }}
            </button>
          </div>
        </section>

        @if (mensaje()) {
          <div class="aviso" [class.aviso-ok]="!esError()" [class.aviso-error]="esError()">
            {{ mensaje() }}
          </div>
        }

        <!-- ===== PESTAÑAS ===== -->
        <div class="pestanas">
          @for (p of pestanas; track p.clave) {
            <button [class.activa]="tab() === p.clave" (click)="tab.set(p.clave)">
              {{ p.rotulo }}
            </button>
          }
        </div>

        <!-- ============ DATOS ============ -->
        @if (tab() === 'datos') {
          <section class="tarjeta">
            <h2 class="titulo-seccion">Datos generales</h2>

            <div class="grid grid-2">
              <div class="campo">
                <label>Nombres</label><input [(ngModel)]="fd.nombres" />
              </div>
              <div class="campo">
                <label>Apellidos</label><input [(ngModel)]="fd.apellidos" />
              </div>
              <div class="campo"><label>Apodo</label><input [(ngModel)]="fd.apodo" /></div>
              <div class="campo">
                <label>Edad</label><input type="number" [(ngModel)]="fd.edad" />
              </div>
              <div class="campo"><label>Teléfono</label><input [(ngModel)]="fd.telefono" /></div>
              <div class="campo">
                <label>Correo electrónico</label>
                <input type="email" [(ngModel)]="fd.email" placeholder="Para avisos y recordatorios" />
              </div>
              <div class="campo">
                <label>Peso actual (kg)</label>
                <input type="number" step="0.1" [(ngModel)]="fd.peso_actual" />
              </div>
              <div class="campo">
                <label>Estatura (cm)</label>
                <input type="number" min="80" max="250" [(ngModel)]="fd.estatura" />
              </div>
              <div class="campo">
                <label>Horario</label>
                <select [(ngModel)]="fd.horario">
                  <option [ngValue]="null">Sin asignar</option>
                  @for (h of horarios(); track h.id) {
                    <option [ngValue]="h.id">{{ h.turno }} {{ h.hora_inicio.slice(0, 5) }}</option>
                  }
                </select>
              </div>
              <div class="campo">
                <label>Membresía</label>
                <select [(ngModel)]="fd.membresia">
                  <option [ngValue]="null">Sin asignar</option>
                  @for (m of membresias(); track m.id) {
                    <option [ngValue]="m.id">{{ m.nombre }}</option>
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
                    [class.chip-rojo]="fd.disciplinas_ids.includes(d.id)"
                    [class.chip-gris]="!fd.disciplinas_ids.includes(d.id)"
                    (click)="alternarDisciplina(d.id)"
                  >
                    {{ d.nombre }}
                  </button>
                }
              </div>
            </div>

            <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardarDatos()">
              Guardar datos
            </button>

            <h3 class="titulo-seccion" style="margin-top:22px">Acceso a la app</h3>
            @if (!alumno()?.tiene_cuenta) {
              <p class="mini tenue">
                Todavía no tiene cuenta. Captura y guarda su correo arriba para crearle una.
              </p>
            } @else {
              <p class="mini tenue" style="margin-top:-6px">
                Usuario: <strong class="mono">{{ alumno()?.username }}</strong>
                @if (alumno()?.email) {
                  — también puede entrar con su correo.
                }
              </p>
              <div class="fila envuelve" style="align-items:flex-end">
                <div class="campo" style="margin-bottom:0; flex:1; min-width:220px">
                  <label>Nueva contraseña</label>
                  <input [(ngModel)]="nuevaPassword" placeholder="Vacío = generar una automática" />
                </div>
                <button class="btn btn-mini" [disabled]="restableciendo()" (click)="restablecerPassword()">
                  {{ restableciendo() ? '...' : 'Restablecer contraseña' }}
                </button>
              </div>
              @if (passwordGenerada()) {
                <div class="aviso aviso-ok" style="margin-top:10px">
                  Nueva contraseña: <strong class="mono">{{ passwordGenerada() }}</strong>
                  — comunícasela al alumno, no se vuelve a mostrar.
                  <button type="button" class="btn btn-mini btn-fantasma" (click)="passwordGenerada.set('')">
                    Ocultar
                  </button>
                </div>
              }
            }
          </section>
        }

        <!-- ============ EXPERIENCIA ============ -->
        @if (tab() === 'experiencia') {
          <section class="tarjeta">
            <h2 class="titulo-seccion">Evaluación técnica</h2>
            <cb-experiencia-form [experiencia]="a.experiencia" (guardado)="guardarExperienciaOk($event)" />
          </section>
        }

        <!-- ============ EVALUACIÓN MMA ============ -->
        @if (tab() === 'evaluacion') {
          <cb-evaluacion-mma-panel [alumnoId]="a.id" [editable]="true" [maestros]="maestros()" />
        }

        <!-- ============ PAGOS ============ -->
        @if (tab() === 'pagos') {
          <section class="tarjeta">
            <div class="fila-entre" style="margin-bottom:14px">
              <h2 class="titulo-seccion" style="margin:0">Pagos</h2>
              <button class="btn btn-rojo btn-mini" (click)="abrirPago()">+ Registrar pago</button>
            </div>

            @if (pagos().length) {
              <div class="tabla-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Monto</th><th>Método</th><th>Vence</th><th>Estatus</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of pagos(); track p.id) {
                      <tr>
                        <td class="mono">{{ p.fecha_pago }}</td>
                        <td class="mono">{{ +p.monto | currency: 'MXN' : 'symbol-narrow' }}</td>
                        <td class="mini">{{ p.metodo }}</td>
                        <td class="mono">{{ p.fecha_vencimiento ?? '—' }}</td>
                        <td>
                          <span class="chip" [class]="p.estatus === 'PAGADO' ? 'chip-verde' : 'chip-rojo'">
                            {{ p.estatus_display }}
                          </span>
                        </td>
                        <td>
                          <button class="btn btn-mini btn-fantasma" (click)="comprobante.set(p.id)">
                            Comprobante
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <cb-vacio icono="💳" titulo="Sin pagos" />
            }
          </section>
        }

        <!-- ============ ASISTENCIA ============ -->
        @if (tab() === 'asistencia') {
          <section class="tarjeta">
            <div class="fila-entre" style="margin-bottom:12px">
              <h2 class="titulo-seccion" style="margin:0">Asistencia</h2>
              <button class="btn btn-mini btn-rojo" (click)="abrirAsistencia()" [disabled]="!a.activo">
                + Marcar asistencia
              </button>
            </div>

            <div class="grid grid-3" style="margin-bottom:16px">
              <div><span class="etiqueta">Total</span><strong class="mono grande">{{ a.total_asistencias }}</strong></div>
              <div><span class="etiqueta">Racha</span><strong class="mono grande">{{ a.experiencia?.racha_asistencia ?? 0 }}</strong></div>
              <div><span class="etiqueta">Racha máxima</span><strong class="mono grande">{{ a.experiencia?.racha_maxima ?? 0 }}</strong></div>
            </div>

            @if (asistencias().length) {
              <div class="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Fecha</th><th>Disciplina</th><th>Registro</th><th>Puntos</th></tr>
                  </thead>
                  <tbody>
                    @for (s of asistencias().slice(0, 50); track s.id) {
                      <tr>
                        <td class="mono">{{ s.fecha }}</td>
                        <td>{{ s.disciplina_nombre ?? '—' }}</td>
                        <td class="mini">{{ s.metodo_registro }}</td>
                        <td class="mono">+{{ s.puntos_otorgados }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <cb-vacio icono="📅" titulo="Sin asistencias" />
            }
          </section>
        }

        <!-- ============ TORNEOS Y GRADOS ============ -->
        @if (tab() === 'historial') {
          <div class="grid grid-2">
            <section class="tarjeta">
              <div class="fila-entre" style="margin-bottom:12px">
                <h2 class="titulo-seccion" style="margin:0">Torneos</h2>
                <button class="btn btn-mini" (click)="modalTorneo.set(true)">+ Añadir</button>
              </div>

              @if (torneos().length) {
                <ul class="lista">
                  @for (t of torneos(); track t.id) {
                    <li>
                      <div class="crece">
                        <strong>{{ t.nombre_torneo }}</strong>
                        <div class="mini tenue">
                          {{ t.fecha }} · {{ t.resultado_display }}
                          @if (t.metodo) {
                            <span>por {{ t.metodo }}</span>
                          }
                        </div>
                      </div>
                      <button class="cerrar-x" (click)="borrarTorneo(t)" aria-label="Eliminar">&times;</button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mini tenue">Sin torneos registrados.</p>
              }
            </section>

            <section class="tarjeta">
              <div class="fila-entre" style="margin-bottom:12px">
                <h2 class="titulo-seccion" style="margin:0">Grados</h2>
                <button class="btn btn-mini" (click)="modalGrado.set(true)">+ Añadir</button>
              </div>

              @if (grados().length) {
                <ul class="lista">
                  @for (g of grados(); track g.id) {
                    <li>
                      <div class="crece">
                        <strong>{{ g.nombre_grado }}</strong>
                        <div class="mini tenue">
                          {{ g.fecha_obtencion }} · {{ g.disciplina_nombre }}
                        </div>
                      </div>
                      <button class="cerrar-x" (click)="borrarGrado(g)" aria-label="Eliminar">&times;</button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mini tenue">Sin grados registrados.</p>
              }
            </section>
          </div>
        }
      </div>

      <!-- ===== MODALES ===== -->
      @if (qr()) {
        <cb-modal titulo="Credencial del alumno" (cerrar)="qr.set(false)">
          <div class="centro">
            @if (a.qr_imagen) {
              <img [src]="a.qr_imagen" alt="QR" class="qr-xl" />
            }
            <p class="mono">{{ a.codigo_qr }}</p>
            <p class="mini tenue">Imprímelo o pídele que lo muestre desde su app.</p>
          </div>
        </cb-modal>
      }

      @if (modalAsistencia()) {
        <cb-modal titulo="Marcar asistencia" (cerrar)="modalAsistencia.set(false)">
          <p class="mini tenue" style="margin-top:0">
            Registro manual sin QR: suma sus puntos y alimenta la racha igual que el escaneo.
          </p>
          <div class="campo">
            <label for="na-fecha">Fecha</label>
            <input id="na-fecha" type="date" [(ngModel)]="na.fecha" [max]="fechaMaxima" />
          </div>
          <div class="campo">
            <label for="na-disc">Disciplina</label>
            <select id="na-disc" [(ngModel)]="na.disciplina_id">
              <option [ngValue]="null">Sin especificar</option>
              @for (d of disciplinas(); track d.id) {
                <option [ngValue]="d.id">{{ d.nombre }}</option>
              }
            </select>
          </div>
          <div class="campo">
            <label for="na-hora">Horario</label>
            <select id="na-hora" [(ngModel)]="na.horario_id">
              <option [ngValue]="null">El del alumno</option>
              @for (h of horarios(); track h.id) {
                <option [ngValue]="h.id">
                  {{ h.hora_inicio.slice(0,5) }} {{ h.turno_display ?? h.turno }}@if (h.nombre) { · {{ h.nombre }} }
                </option>
              }
            </select>
          </div>
          <div pie>
            <button class="btn" (click)="modalAsistencia.set(false)">Cancelar</button>
            <button class="btn btn-rojo" [disabled]="marcando()" (click)="marcarAsistencia()">
              {{ marcando() ? '...' : 'Registrar asistencia' }}
            </button>
          </div>
        </cb-modal>
      }

      @if (comprobante(); as id) {
        <cb-comprobante-pago [pagoId]="id" (cerrar)="comprobante.set(null)" />
      }

      @if (modalPago()) {
        <cb-modal titulo="Registrar pago" (cerrar)="modalPago.set(false)">
          <div class="campo">
            <label>Monto *</label>
            <input type="number" step="0.01" [(ngModel)]="np.monto" />
          </div>
          <div class="campo">
            <label>Método</label>
            <select [(ngModel)]="np.metodo">
              <option value="EFECTIVO">Efectivo</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
          </div>
          <div class="campo">
            <label>Fecha del pago</label>
            <input type="date" [(ngModel)]="np.fecha_pago" />
          </div>
          <div class="campo">
            <label>Membresía</label>
            <select [(ngModel)]="np.membresia" (ngModelChange)="sugerirMonto($event)">
              <option [ngValue]="null">La del alumno</option>
              @for (m of membresias(); track m.id) {
                <option [ngValue]="m.id">{{ m.nombre }} ({{ m.duracion_dias }} días)</option>
              }
            </select>
          </div>
          <p class="mini tenue">
            El monto toma el precio de la membresía (cámbialo si es un abono). El vencimiento se
            calcula solo y, si aún tiene días vigentes, se suman.
          </p>
          <div pie>
            <button class="btn" (click)="modalPago.set(false)">Cancelar</button>
            <button class="btn btn-rojo" (click)="guardarPago()">Registrar</button>
          </div>
        </cb-modal>
      }

      @if (modalTorneo()) {
        <cb-modal titulo="Registrar torneo" (cerrar)="modalTorneo.set(false)">
          <div class="campo"><label>Nombre *</label><input [(ngModel)]="nt.nombre_torneo" /></div>
          <div class="campo"><label>Fecha *</label><input type="date" [(ngModel)]="nt.fecha" /></div>
          <div class="campo">
            <label>Resultado</label>
            <select [(ngModel)]="nt.resultado">
              <option value="GANO">Ganó</option>
              <option value="PERDIO">Perdió</option>
              <option value="EMPATO">Empató</option>
            </select>
          </div>
          <div class="campo">
            <label>Método</label>
            <select [(ngModel)]="nt.metodo">
              <option value="">—</option>
              <option value="KO">KO/TKO</option>
              <option value="SUMISION">Sumisión</option>
              <option value="DECISION">Decisión</option>
              <option value="DESCALIFICACION">Descalificación</option>
            </select>
          </div>
          <div class="campo">
            <label>Disciplina</label>
            <select [(ngModel)]="nt.disciplina">
              <option [ngValue]="null">—</option>
              @for (d of disciplinas(); track d.id) {
                <option [ngValue]="d.id">{{ d.nombre }}</option>
              }
            </select>
          </div>
          <p class="mini tenue">Al guardar, el récord del peleador se recalcula solo.</p>
          <div pie>
            <button class="btn" (click)="modalTorneo.set(false)">Cancelar</button>
            <button class="btn btn-rojo" (click)="guardarTorneo()">Guardar</button>
          </div>
        </cb-modal>
      }

      @if (modalGrado()) {
        <cb-modal titulo="Otorgar grado" (cerrar)="modalGrado.set(false)">
          <div class="campo">
            <label>Nombre del grado *</label>
            <input [(ngModel)]="ng.nombre_grado" placeholder="Cinta Azul" />
          </div>
          <div class="campo">
            <label>Disciplina *</label>
            <select [(ngModel)]="ng.disciplina">
              <option [ngValue]="null">Selecciona</option>
              @for (d of disciplinas(); track d.id) {
                <option [ngValue]="d.id">{{ d.nombre }}</option>
              }
            </select>
          </div>
          <div class="campo">
            <label>Fecha</label><input type="date" [(ngModel)]="ng.fecha_obtencion" />
          </div>
          <div class="campo">
            <label>Otorgado por</label>
            <select [(ngModel)]="ng.otorgado_por">
              <option [ngValue]="null">—</option>
              @for (m of maestros(); track m.id) {
                <option [ngValue]="m.id">{{ m.nombre }}</option>
              }
            </select>
          </div>
          <div pie>
            <button class="btn" (click)="modalGrado.set(false)">Cancelar</button>
            <button class="btn btn-rojo" (click)="guardarGrado()">Otorgar</button>
          </div>
        </cb-modal>
      }
    }
  `,
  styles: [
    `
      .cabeza {
        display: flex;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
      }
      .cabeza h1 {
        margin: 2px 0 9px;
        font-size: 1.4rem;
      }
      .apodo {
        font-family: 'Oswald', sans-serif;
        color: var(--rojo-claro);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-size: 0.78rem;
      }
      .acciones {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .grande {
        font-family: 'Oswald', sans-serif;
        font-size: 1.5rem;
      }
      .grid > div {
        display: flex;
        flex-direction: column;
      }
      .lista {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .lista li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 0;
        border-bottom: 1px solid var(--borde-suave);
      }
      .lista li:last-child {
        border-bottom: none;
      }
      .qr-xl {
        width: min(250px, 65vw);
        background: #fff;
        padding: 12px;
        border-radius: var(--r);
      }
    `,
  ],
})
export class AdminAlumnoDetalle {
  /** Llega de la ruta /admin/alumnos/:id gracias a withComponentInputBinding(). */
  id = input.required<string>();

  private api = inject(ApiService);
  private router = inject(Router);

  alumno = signal<Alumno | null>(null);
  pagos = signal<Pago[]>([]);
  asistencias = signal<Asistencia[]>([]);
  torneos = signal<Torneo[]>([]);
  grados = signal<Grado[]>([]);
  disciplinas = signal<Disciplina[]>([]);
  horarios = signal<Horario[]>([]);
  membresias = signal<Membresia[]>([]);
  maestros = signal<Maestro[]>([]);

  cargando = signal(true);
  guardando = signal(false);
  mensaje = signal('');
  esError = signal(false);

  nuevaPassword = '';
  restableciendo = signal(false);
  passwordGenerada = signal('');

  tab = signal<Pestana>('datos');
  qr = signal(false);
  modalPago = signal(false);
  modalTorneo = signal(false);
  modalGrado = signal(false);
  modalAsistencia = signal(false);
  marcando = signal(false);

  pestanas: { clave: Pestana; rotulo: string }[] = [
    { clave: 'datos', rotulo: 'Datos generales' },
    { clave: 'experiencia', rotulo: 'Experiencia' },
    { clave: 'evaluacion', rotulo: 'Evaluación MMA' },
    { clave: 'pagos', rotulo: 'Pagos' },
    { clave: 'asistencia', rotulo: 'Asistencia' },
    { clave: 'historial', rotulo: 'Torneos y grados' },
  ];

  fd = {
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

  /** Id del pago cuyo comprobante está abierto. */
  comprobante = signal<number | null>(null);
  np = { monto: null as number | null, metodo: 'EFECTIVO', fecha_pago: this.hoy(), membresia: null as number | null };
  /** Registro manual de asistencia desde la ficha (sin QR). */
  na = { fecha: this.hoy(), disciplina_id: null as number | null, horario_id: null as number | null };
  fechaMaxima = this.hoy();
  nt = { nombre_torneo: '', fecha: this.hoy(), resultado: 'GANO', metodo: '', disciplina: null as number | null };
  ng = { nombre_grado: '', disciplina: null as number | null, fecha_obtencion: this.hoy(), otorgado_por: null as number | null };

  semaforo = computed(() =>
    estadoPago(this.alumno()?.al_corriente ?? false, this.alumno()?.dias_para_vencer ?? null),
  );

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private avisar(texto: string, error = false): void {
    this.esError.set(error);
    this.mensaje.set(texto);
    setTimeout(() => this.mensaje.set(''), 4000);
  }

  alternarDisciplina(id: number): void {
    const ids = this.fd.disciplinas_ids;
    this.fd.disciplinas_ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  // --- Guardados ------------------------------------------------------------

  guardarDatos(): void {
    this.guardando.set(true);
    this.api.editarAlumno(+this.id(), this.fd as never).subscribe({
      next: (a) => {
        this.alumno.set(a);
        this.guardando.set(false);
        this.avisar('Datos guardados.');
      },
      error: () => {
        this.guardando.set(false);
        this.avisar('No se pudieron guardar los datos.', true);
      },
    });
  }

  restablecerPassword(): void {
    this.restableciendo.set(true);
    this.passwordGenerada.set('');
    this.api.restablecerPasswordAlumno(+this.id(), this.nuevaPassword.trim() || undefined).subscribe({
      next: (r) => {
        this.restableciendo.set(false);
        this.nuevaPassword = '';
        if (r.password_generada) this.passwordGenerada.set(r.password_generada);
        this.avisar(r.detail);
      },
      error: (e) => {
        this.restableciendo.set(false);
        this.avisar(e?.error?.detail ?? 'No se pudo restablecer la contraseña.', true);
      },
    });
  }

  guardarExperienciaOk(exp: Experiencia): void {
    const a = this.alumno();
    if (a) this.alumno.set({ ...a, experiencia: exp });
    this.avisar('Evaluación guardada.');
  }

  abrirAsistencia(): void {
    const a = this.alumno();
    if (!a || !a.activo) return;
    // Si el alumno está inscrito a una sola disciplina, se propone; si a varias, que elija.
    const unica = a.inscripciones.length === 1 ? a.inscripciones[0].disciplina : null;
    this.na = { fecha: this.hoy(), disciplina_id: unica, horario_id: a.horario };
    this.modalAsistencia.set(true);
  }

  marcarAsistencia(): void {
    this.marcando.set(true);
    this.api
      .registrarAsistenciaManual({
        alumno_id: +this.id(),
        disciplina_id: this.na.disciplina_id,
        horario_id: this.na.horario_id,
        fecha: this.na.fecha,
      })
      .subscribe({
        next: (r) => {
          this.marcando.set(false);
          this.modalAsistencia.set(false);
          const insignias = r.insignias_desbloqueadas.length
            ? ` · 🏅 ${r.insignias_desbloqueadas.join(', ')}`
            : '';
          this.avisar(`Asistencia registrada: +${r.puntos_otorgados} pts · racha ${r.racha}${insignias}`);
          this.tab.set('asistencia');
          this.refrescar();
        },
        error: (e) => {
          this.marcando.set(false);
          const d = e?.error;
          this.avisar(
            d?.detail ??
              (typeof d === 'object' && d ? Object.values(d).flat().join(' ') : 'No se pudo registrar la asistencia.'),
            true,
          );
        },
      });
  }

  abrirPago(): void {
    const m = this.membresias().find((x) => x.id === this.alumno()?.membresia);
    this.np = {
      monto: m ? parseFloat(m.precio) : null,
      metodo: 'EFECTIVO',
      fecha_pago: this.hoy(),
      membresia: this.alumno()?.membresia ?? null,
    };
    this.modalPago.set(true);
  }

  /** Al cambiar de membresía el monto toma su precio ("La del alumno" = su membresía actual). */
  sugerirMonto(id: number | null): void {
    const m = this.membresias().find((x) => x.id === (id ?? this.alumno()?.membresia));
    if (m) this.np.monto = parseFloat(m.precio);
  }

  guardarPago(): void {
    if (!this.np.monto) {
      this.avisar('Captura el monto.', true);
      return;
    }
    this.api
      .crearPago({ ...this.np, alumno: +this.id() } as never)
      .subscribe({
        next: () => {
          this.modalPago.set(false);
          this.avisar('Pago registrado.');
          this.refrescar();
        },
        error: () => this.avisar('No se pudo registrar el pago.', true),
      });
  }

  guardarTorneo(): void {
    if (!this.nt.nombre_torneo || !this.nt.fecha) {
      this.avisar('Nombre y fecha son obligatorios.', true);
      return;
    }
    this.api.crearTorneo({ ...this.nt, alumno: +this.id() } as never).subscribe({
      next: () => {
        this.modalTorneo.set(false);
        this.nt = { nombre_torneo: '', fecha: this.hoy(), resultado: 'GANO', metodo: '', disciplina: null };
        this.avisar('Torneo registrado. El récord se actualizó.');
        this.refrescar();
      },
      error: () => this.avisar('No se pudo guardar el torneo.', true),
    });
  }

  borrarTorneo(t: Torneo): void {
    if (!confirm(`¿Eliminar "${t.nombre_torneo}"? El récord se recalculará.`)) return;
    this.api.borrarTorneo(t.id).subscribe(() => this.refrescar());
  }

  guardarGrado(): void {
    if (!this.ng.nombre_grado || !this.ng.disciplina) {
      this.avisar('Nombre y disciplina son obligatorios.', true);
      return;
    }
    this.api.crearGrado({ ...this.ng, alumno: +this.id() } as never).subscribe({
      next: () => {
        this.modalGrado.set(false);
        this.ng = { nombre_grado: '', disciplina: null, fecha_obtencion: this.hoy(), otorgado_por: null };
        this.avisar('Grado otorgado.');
        this.refrescar();
      },
      error: () => this.avisar('No se pudo otorgar el grado.', true),
    });
  }

  borrarGrado(g: Grado): void {
    if (!confirm(`¿Eliminar el grado "${g.nombre_grado}"?`)) return;
    this.api.borrarGrado(g.id).subscribe(() => this.refrescar());
  }

  alternarBaja(): void {
    const a = this.alumno();
    if (!a) return;
    const accion = a.activo ? 'dar de baja' : 'reactivar';
    if (!confirm(`¿Seguro que quieres ${accion} a ${a.nombre_completo}?`)) return;

    this.api.editarAlumno(a.id, { activo: !a.activo }).subscribe({
      next: (nuevo) => {
        this.alumno.set(nuevo);
        this.avisar(nuevo.activo ? 'Alumno reactivado.' : 'Alumno dado de baja.');
      },
      error: () => this.avisar('No se pudo cambiar el estatus.', true),
    });
  }

  // --- Carga ----------------------------------------------------------------

  private volcarFormularios(a: Alumno): void {
    this.fd = {
      nombres: a.nombres,
      apellidos: a.apellidos,
      apodo: a.apodo,
      edad: a.edad,
      telefono: a.telefono,
      email: a.email,
      peso_actual: a.peso_actual ? parseFloat(a.peso_actual) : null,
      estatura: a.estatura,
      horario: a.horario,
      membresia: a.membresia,
      disciplinas_ids: a.inscripciones.map((i) => i.disciplina),
    };
  }

  private refrescar(): void {
    const id = +this.id();
    forkJoin({
      alumno: this.api.alumno(id),
      pagos: this.api.pagosDe(id),
      asistencias: this.api.asistenciasDe(id),
      torneos: this.api.torneos({ alumno: id, page_size: 100 }),
      grados: this.api.grados({ alumno: id, page_size: 100 }),
    }).subscribe({
      next: (r) => {
        this.alumno.set(r.alumno);
        this.volcarFormularios(r.alumno);
        this.pagos.set(r.pagos);
        this.asistencias.set(r.asistencias);
        this.torneos.set(r.torneos.results);
        this.grados.set(r.grados.results);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.router.navigate(['/admin/alumnos']);
      },
    });
  }

  constructor() {
    this.api.disciplinas({ page_size: 100 }).subscribe((p) => this.disciplinas.set(p.results));
    this.api.horarios({ page_size: 100 }).subscribe((p) => this.horarios.set(p.results));
    this.api.membresias({ page_size: 100 }).subscribe((p) => this.membresias.set(p.results));
    this.api.maestros({ page_size: 100 }).subscribe((p) => this.maestros.set(p.results));

    queueMicrotask(() => this.refrescar());
  }
}
