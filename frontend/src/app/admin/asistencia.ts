import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AlumnoLista, Asistencia, Disciplina, Horario, ResultadoCheckin } from '../core/models';
import { BuscarAlumno } from '../shared/buscar-alumno';
import { EscanerQr } from '../shared/escaner-qr';
import { CargandoComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-admin-asistencia',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, BuscarAlumno, EscanerQr],
  template: `
    <div class="pila">
      <h1>Control de asistencia</h1>

      <!-- ===== SELECTOR DE MODO ===== -->
      <div class="pestanas">
        <button [class.activa]="modo() === 'qr'" (click)="modo.set('qr')">
          Escanear QR
        </button>
        <button [class.activa]="modo() === 'manual'" (click)="modo.set('manual')">
          Registro manual
        </button>
        <button [class.activa]="modo() === 'hoy'" (click)="modo.set('hoy'); cargarHoy()">
          Lista de hoy
        </button>
      </div>

      <!-- ===== MODO ESCANEO ===== -->
      @if (modo() === 'qr') {
        <section class="tarjeta escaneo">
          <h2 class="titulo-seccion">Escanear código QR</h2>

          @if (resultado()) {
            <!-- Pantalla de confirmación -->
            <div class="confirmacion" [class.ok]="!resultadoError()" [class.ko]="resultadoError()">
              @if (!resultadoError()) {
                <div class="icono-grande">✅</div>
                <h3>{{ resultado()!.alumno.nombre }}</h3>
                @if (resultado()!.alumno.apodo) {
                  <span class="apodo">"{{ resultado()!.alumno.apodo }}"</span>
                }
                <div class="meta-checkin">
                  <span>+{{ resultado()!.puntos_otorgados }} pts</span>
                  <span>Racha: {{ resultado()!.racha }}</span>
                  @if (!resultado()!.alumno.al_corriente) {
                    <span class="chip chip-rojo">Pago vencido</span>
                  }
                </div>
                @if (resultado()!.insignias_desbloqueadas.length) {
                  <div class="insignias-nuevas">
                    @for (ins of resultado()!.insignias_desbloqueadas; track ins) {
                      <span class="chip chip-amarillo">🏅 {{ ins }}</span>
                    }
                  </div>
                }
              } @else {
                <div class="icono-grande">❌</div>
                <p>{{ errorCheckin() }}</p>
              }

              <button class="btn btn-rojo" (click)="limpiar()">
                Escanear siguiente
              </button>
              <span class="mini tenue">Se limpia solo en unos segundos.</span>
            </div>
          }

          <!-- La cámara se queda encendida entre alumnos; solo se pausa mientras se confirma. -->
          <div class="zona-qr" [hidden]="!!resultado()">
            <cb-escaner-qr (codigo)="checkin($event)" [pausado]="procesando() || !!resultado()" />

            <div class="separador"><span>o escribe el código a mano</span></div>

              <div class="fila">
                <input
                  class="crece"
                  [(ngModel)]="codigoManual"
                  placeholder="ALU-XXXXXXXXXXXX"
                  (keyup.enter)="checkin(codigoManual)"
                  [disabled]="procesando()"
                  autocapitalize="characters"
                  autocomplete="off"
                />
                <button
                  class="btn btn-rojo"
                  [disabled]="!codigoManual || procesando()"
                  (click)="checkin(codigoManual)"
                >
                  {{ procesando() ? '...' : 'Registrar' }}
                </button>
              </div>

              <div class="selectores">
                <div class="campo">
                  <label for="disc">Disciplina</label>
                  <select id="disc" [(ngModel)]="discId">
                    <option [ngValue]="null">Sin especificar</option>
                    @for (d of disciplinas(); track d.id) {
                      <option [ngValue]="d.id">{{ d.nombre }}</option>
                    }
                  </select>
                </div>
                <div class="campo">
                  <label for="hora">Horario</label>
                  <select id="hora" [(ngModel)]="horarioId">
                    <option [ngValue]="null">Sin especificar</option>
                    @for (h of horarios(); track h.id) {
                      <option [ngValue]="h.id">{{ etiquetaHorario(h) }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>
        </section>
      }

      <!-- ===== REGISTRO MANUAL ===== -->
      @if (modo() === 'manual') {
        <section class="tarjeta">
          <h2 class="titulo-seccion">Registrar asistencia manualmente</h2>

          @if (mensajeManual()) {
            <div class="aviso" [class.aviso-ok]="!errorManual()" [class.aviso-error]="errorManual()">
              {{ mensajeManual() }}
            </div>
          }

          <p class="mini tenue" style="margin-top:0">
            Para clases pasadas u olvidos. Busca al alumno por nombre o apodo; queda registrada como
            MANUAL y suma sus puntos igual que el escaneo.
          </p>

          <div class="campo">
            <label for="manual-alumno">Alumno *</label>
            <cb-buscar-alumno [(alumno)]="alumnoManual" inputId="manual-alumno" />
          </div>
          <div class="grid grid-3">
            <div class="campo">
              <label for="manual-fecha">Fecha</label>
              <input id="manual-fecha" type="date" [(ngModel)]="manual.fecha" [max]="hoyIso" />
            </div>
            <div class="campo">
              <label for="manual-disc">Disciplina</label>
              <select id="manual-disc" [(ngModel)]="manual.disciplina_id">
                <option [ngValue]="null">Sin especificar</option>
                @for (d of disciplinas(); track d.id) {
                  <option [ngValue]="d.id">{{ d.nombre }}</option>
                }
              </select>
            </div>
            <div class="campo">
              <label for="manual-hora">Horario</label>
              <select id="manual-hora" [(ngModel)]="manual.horario_id">
                <option [ngValue]="null">El del alumno</option>
                @for (h of horarios(); track h.id) {
                  <option [ngValue]="h.id">{{ etiquetaHorario(h) }}</option>
                }
              </select>
            </div>
          </div>

          <button
            class="btn btn-rojo"
            [disabled]="!alumnoManual() || procesando()"
            (click)="registrarManual()"
          >
            {{ procesando() ? '...' : 'Registrar asistencia' }}
          </button>
        </section>
      }

      <!-- ===== LISTA DEL DÍA ===== -->
      @if (modo() === 'hoy') {
        <section class="tarjeta">
          <div class="fila-entre">
            <h2 class="titulo-seccion" style="margin:0">
              Asistencias de hoy ({{ hoy() }})
            </h2>
            <span class="chip chip-rojo mono">{{ asistenciasHoy().length }}</span>
          </div>

          @if (cargandoHoy()) {
            <cb-cargando />
          } @else if (asistenciasHoy().length) {
            <div class="tabla-scroll" style="margin-top:14px">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Alumno</th>
                    <th>Disciplina</th>
                    <th>Hora</th>
                    <th>Registro</th>
                    <th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of asistenciasHoy(); track a.id; let i = $index) {
                    <tr>
                      <td class="mono tenue">{{ i + 1 }}</td>
                      <td>{{ a.alumno_nombre }}</td>
                      <td class="mini">{{ a.disciplina_nombre ?? '—' }}</td>
                      <td class="mono mini">{{ a.hora_registro.slice(11, 16) }}</td>
                      <td>
                        <span class="chip" [class]="claseMetodo(a.metodo_registro)" [title]="tituloMetodo(a.metodo_registro)">
                          {{ a.metodo_registro }}
                        </span>
                      </td>
                      <td class="mono">+{{ a.puntos_otorgados }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <cb-vacio icono="📅" titulo="Nadie ha registrado asistencia hoy" />
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .escaneo {
        max-width: 520px;
        margin: 0 auto;
      }
      .zona-qr {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .selectores {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .selectores .campo {
        margin: 0;
      }
      .separador {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--texto-tenue);
        font-size: 0.78rem;
      }
      .separador::before,
      .separador::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--borde);
      }

      .confirmacion {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 24px 0;
        text-align: center;
      }
      .confirmacion.ok {
        color: var(--texto);
      }
      .confirmacion.ko {
        color: var(--rojo-claro);
      }
      .icono-grande {
        font-size: 3.5rem;
        line-height: 1;
      }
      .confirmacion h3 {
        margin: 0;
        font-size: 1.4rem;
      }
      .apodo {
        font-family: 'Oswald', sans-serif;
        color: var(--rojo-claro);
        letter-spacing: 0.1em;
      }
      .meta-checkin {
        display: flex;
        gap: 12px;
        align-items: center;
        font-family: 'Oswald', sans-serif;
        font-size: 0.88rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--texto-suave);
      }
      .insignias-nuevas {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
    `,
  ],
})
export class AdminAsistencia {
  private api = inject(ApiService);

  modo = signal<'qr' | 'manual' | 'hoy'>('qr');

  disciplinas = signal<Disciplina[]>([]);
  horarios = signal<Horario[]>([]);
  asistenciasHoy = signal<Asistencia[]>([]);

  procesando = signal(false);
  cargandoHoy = signal(false);

  resultado = signal<ResultadoCheckin | null>(null);
  resultadoError = signal(false);
  errorCheckin = signal('');

  mensajeManual = signal('');
  errorManual = signal(false);

  codigoManual = '';
  discId: number | null = null;
  horarioId: number | null = null;

  hoyIso = new Date().toISOString().slice(0, 10);

  /** Registro manual: el alumno se elige por nombre (cb-buscar-alumno), no por QR. */
  alumnoManual = signal<AlumnoLista | null>(null);
  manual = {
    fecha: this.hoyIso,
    disciplina_id: null as number | null,
    horario_id: null as number | null,
  };

  hoy(): string {
    return new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  etiquetaHorario(h: Horario): string {
    const base = `${h.hora_inicio.slice(0, 5)} ${h.turno_display ?? h.turno}`;
    return h.nombre ? `${base} · ${h.nombre}` : base;
  }

  claseMetodo(metodo: string): string {
    if (metodo === 'QR') return 'chip-verde';
    if (metodo === 'APP') return 'chip-amarillo';
    return 'chip-gris';
  }

  tituloMetodo(metodo: string): string {
    if (metodo === 'QR') return 'Escaneado en recepción';
    if (metodo === 'APP') return 'El alumno se registró desde su app';
    return 'Registro manual de recepción';
  }

  /** Tras confirmar (o fallar) un escaneo, la pantalla vuelve sola a la cámara. */
  static readonly AUTOLIMPIEZA_MS = 5000;
  private timerLimpieza: ReturnType<typeof setTimeout> | null = null;

  /** Lo llama el escáner con el texto del QR, o el botón con el código tecleado. */
  checkin(codigo: string): void {
    if (!codigo || this.procesando()) return;
    this.procesando.set(true);
    this.api.checkin(codigo.trim().toUpperCase(), this.discId, this.horarioId).subscribe({
      next: (r) => {
        this.resultado.set(r);
        this.resultadoError.set(false);
        this.codigoManual = '';
        this.procesando.set(false);
        this.programarLimpieza();
      },
      error: (e) => {
        this.resultado.set(null);
        this.resultadoError.set(true);
        const d = e?.error;
        this.errorCheckin.set(d?.detail ?? d?.codigo_qr?.[0] ?? 'No se pudo registrar la asistencia.');
        this.resultado.set({ alumno: { nombre: '' } } as never);
        this.procesando.set(false);
        this.programarLimpieza();
      },
    });
  }

  limpiar(): void {
    if (this.timerLimpieza) {
      clearTimeout(this.timerLimpieza);
      this.timerLimpieza = null;
    }
    this.resultado.set(null);
    this.resultadoError.set(false);
  }

  private programarLimpieza(): void {
    if (this.timerLimpieza) clearTimeout(this.timerLimpieza);
    this.timerLimpieza = setTimeout(() => this.limpiar(), AdminAsistencia.AUTOLIMPIEZA_MS);
  }

  registrarManual(): void {
    const alumno = this.alumnoManual();
    if (!alumno) return;
    this.procesando.set(true);
    this.mensajeManual.set('');
    this.api
      .registrarAsistenciaManual({
        alumno_id: alumno.id,
        disciplina_id: this.manual.disciplina_id,
        horario_id: this.manual.horario_id,
        fecha: this.manual.fecha,
      })
      .subscribe({
        next: (r) => {
          const insignias = r.insignias_desbloqueadas.length
            ? ` · 🏅 ${r.insignias_desbloqueadas.join(', ')}`
            : '';
          this.mensajeManual.set(
            `Asistencia registrada para ${r.alumno.nombre} (${r.fecha ?? this.manual.fecha}). ` +
              `+${r.puntos_otorgados} pts · racha ${r.racha}${insignias}`,
          );
          this.errorManual.set(false);
          this.alumnoManual.set(null);
          this.procesando.set(false);
        },
        error: (e) => {
          const d = e?.error;
          const detalle =
            d?.detail ??
            (typeof d === 'object' && d ? Object.values(d).flat().join(' ') : 'Error al registrar.');
          this.mensajeManual.set(detalle);
          this.errorManual.set(true);
          this.procesando.set(false);
        },
      });
  }

  cargarHoy(): void {
    this.cargandoHoy.set(true);
    this.api.asistenciasHoy().subscribe({
      next: (r) => {
        this.asistenciasHoy.set(r);
        this.cargandoHoy.set(false);
      },
      error: () => this.cargandoHoy.set(false),
    });
  }

  constructor() {
    this.api.disciplinas({ page_size: 100 }).subscribe((p) => this.disciplinas.set(p.results));
    this.api.horarios({ page_size: 100 }).subscribe((p) => this.horarios.set(p.results));
  }
}
