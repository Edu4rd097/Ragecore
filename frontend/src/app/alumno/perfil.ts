import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Alumno, ResultadoCheckin } from '../core/models';
import { CambiarPassword } from '../shared/cambiar-password';
import { AvatarComponent, CargandoComponent, ModalComponent } from '../shared/ui';

/**
 * Perfil del alumno: edita solo sus datos personales permitidos (nombres,
 * apellidos, apodo, teléfono, correo, peso, foto — el backend ignora
 * cualquier otro campo en /alumnos/yo/), consulta lo que asigna la academia,
 * su QR, y cambia su contraseña en Seguridad.
 */
@Component({
  selector: 'cb-mi-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule, AvatarComponent, CargandoComponent, ModalComponent, CambiarPassword],
  template: `
    @if (cargando()) {
      <cb-cargando />
    } @else if (alumno(); as a) {
      <div class="pila">
        <h1>Mi perfil</h1>

        @if (mensaje()) {
          <div class="aviso" [class.aviso-ok]="!esError()" [class.aviso-error]="esError()">
            {{ mensaje() }}
          </div>
        }

        <!-- Foto -->
        <section class="tarjeta centro">
          <cb-avatar
            [foto]="previa() ?? a.foto"
            [nombre]="a.nombre_completo"
            [tam]="110"
            [aro]="true"
            [sinIniciales]="true"
          />
          <div style="margin-top:14px">
            <label class="btn btn-mini" for="foto">Cambiar foto</label>
            <input
              id="foto"
              type="file"
              accept="image/*"
              hidden
              (change)="elegirFoto($event)"
            />
          </div>
          @if (archivo()) {
            <p class="mini tenue" style="margin:8px 0 0">
              {{ archivo()!.name }} — se sube al guardar
            </p>
          }
        </section>

        <!-- Datos editables -->
        <section class="tarjeta">
          <h2 class="titulo-seccion">Datos personales</h2>

          <div class="grid grid-2">
            <div class="campo">
              <label for="nombres">Nombres</label>
              <input id="nombres" [(ngModel)]="form.nombres" />
            </div>
            <div class="campo">
              <label for="apellidos">Apellidos</label>
              <input id="apellidos" [(ngModel)]="form.apellidos" />
            </div>
            <div class="campo">
              <label for="apodo">Apodo de peleador</label>
              <input id="apodo" [(ngModel)]="form.apodo" placeholder="El Tanque" />
            </div>
            <div class="campo">
              <label for="tel">Teléfono</label>
              <input id="tel" [(ngModel)]="form.telefono" inputmode="tel" />
            </div>
            <div class="campo">
              <label for="correo">Correo electrónico</label>
              <input
                id="correo"
                type="email"
                [(ngModel)]="form.email"
                inputmode="email"
                autocapitalize="none"
                placeholder="Para avisos y comprobantes"
              />
            </div>
            <div class="campo">
              <label for="peso">Peso actual (kg)</label>
              <input id="peso" type="number" step="0.1" [(ngModel)]="form.peso_actual" />
            </div>
            <div class="campo">
              <label for="estatura">Estatura (cm)</label>
              <input id="estatura" type="number" min="80" max="250" [(ngModel)]="form.estatura" />
            </div>
          </div>

          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </section>

        <!-- Datos que controla la academia -->
        <section class="tarjeta">
          <h2 class="titulo-seccion">Asignado por la academia</h2>
          <p class="mini tenue" style="margin-top:-8px">
            Estos datos los cambia solo recepción. Si algo no cuadra, avísales.
          </p>

          <dl class="lista-datos">
            <div>
              <dt class="etiqueta">Usuario</dt>
              <dd class="mono">{{ a.username || '—' }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Grupo (horario)</dt>
              <dd>{{ a.horario ? 'Asignado' : 'Sin asignar' }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Disciplinas</dt>
              <dd>
                @if (a.inscripciones.length) {
                  @for (i of a.inscripciones; track i.id) {
                    <span class="chip chip-gris">{{ i.disciplina_nombre }}</span>
                  }
                } @else {
                  <span class="tenue">Sin asignar</span>
                }
              </dd>
            </div>
            <div>
              <dt class="etiqueta">Membresía</dt>
              <dd>{{ a.membresia ? 'Activa' : 'Sin membresía' }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Alta en la academia</dt>
              <dd class="mono">{{ a.fecha_registro }}</dd>
            </div>
          </dl>
        </section>

        <!-- QR -->
        <section class="tarjeta centro">
          <h2 class="titulo-seccion" style="justify-content:center">Mi código QR</h2>
          <p class="mini tenue">Muéstralo en la entrada para registrar tu asistencia.</p>

          <button class="qr-mini" (click)="qrGrande.set(true)" aria-label="Ampliar código QR">
            @if (a.qr_imagen) {
              <img [src]="a.qr_imagen" alt="Código QR" />
            } @else {
              <span class="tenue mini">QR no disponible</span>
            }
          </button>
          <p class="mono mini tenue">{{ a.codigo_qr }}</p>

          <!-- Autorregistro: cuando la tablet de recepción no está a la mano. -->
          <div class="autoregistro">
            <p class="mini tenue" style="margin:0">¿No hay quien te escanee? Regístrate tú mismo:</p>
            @if (a.inscripciones.length > 1) {
              <select [(ngModel)]="disciplinaCheckin" aria-label="Disciplina de la clase de hoy">
                @for (i of a.inscripciones; track i.id) {
                  <option [ngValue]="i.disciplina">{{ i.disciplina_nombre }}</option>
                }
              </select>
            }
            <button
              class="btn btn-rojo"
              [disabled]="registrando() || !a.activo"
              (click)="registrarAsistencia()"
            >
              {{ registrando() ? 'Registrando…' : '✅ Registrar mi asistencia de hoy' }}
            </button>
            @if (checkin(); as r) {
              <div class="aviso aviso-ok resultado-checkin">
                <strong>¡Listo, {{ r.alumno.apodo || r.alumno.nombre }}!</strong>
                +{{ r.puntos_otorgados }} pts · racha {{ r.racha }}
                @for (ins of r.insignias_desbloqueadas; track ins) {
                  <span class="chip chip-amarillo">🏅 {{ ins }}</span>
                }
              </div>
            }
            @if (errorCheckin()) {
              <div class="aviso aviso-error">{{ errorCheckin() }}</div>
            }
          </div>
        </section>

        <!-- Seguridad -->
        <cb-cambiar-password />
      </div>

      @if (qrGrande()) {
        <cb-modal titulo="Escanea en recepción" (cerrar)="qrGrande.set(false)">
          <div class="centro">
            @if (a.qr_imagen) {
              <img [src]="a.qr_imagen" alt="Código QR" class="qr-xl" />
            }
            <p class="mono">{{ a.codigo_qr }}</p>
          </div>
        </cb-modal>
      }
    }
  `,
  styles: [
    `
      .lista-datos {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .lista-datos div {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      dd {
        margin: 0;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .qr-mini {
        display: block;
        margin: 14px auto 8px;
        width: 170px;
        height: 170px;
        padding: 10px;
        background: #fff;
        border: none;
        border-radius: var(--r);
        cursor: pointer;
      }
      .qr-mini img {
        width: 100%;
        height: 100%;
        display: block;
      }
      .qr-xl {
        width: min(280px, 70vw);
        background: #fff;
        padding: 14px;
        border-radius: var(--r);
      }
      label.btn {
        cursor: pointer;
      }
      .autoregistro {
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid var(--borde-suave);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
      .autoregistro select {
        max-width: 260px;
      }
      .resultado-checkin {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px 10px;
        width: 100%;
      }
    `,
  ],
})
export class MiPerfil {
  private api = inject(ApiService);

  alumno = signal<Alumno | null>(null);
  cargando = signal(true);
  guardando = signal(false);
  mensaje = signal('');
  esError = signal(false);
  qrGrande = signal(false);

  archivo = signal<File | null>(null);
  previa = signal<string | null>(null);

  // Autorregistro de asistencia (POST /asistencias/mi-checkin/).
  registrando = signal(false);
  checkin = signal<ResultadoCheckin | null>(null);
  errorCheckin = signal('');
  disciplinaCheckin: number | null = null;

  form = {
    nombres: '',
    apellidos: '',
    apodo: '',
    telefono: '',
    email: '',
    peso_actual: '',
    estatura: '',
  };

  constructor() {
    this.api.yo().subscribe({
      next: (a) => {
        this.alumno.set(a);
        this.form = {
          nombres: a.nombres,
          apellidos: a.apellidos,
          apodo: a.apodo,
          telefono: a.telefono,
          email: a.email,
          peso_actual: a.peso_actual ?? '',
          estatura: a.estatura != null ? String(a.estatura) : '',
        };
        this.disciplinaCheckin = a.inscripciones[0]?.disciplina ?? null;
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  registrarAsistencia(): void {
    if (this.registrando()) return;
    this.registrando.set(true);
    this.checkin.set(null);
    this.errorCheckin.set('');
    this.api.miCheckin(this.disciplinaCheckin).subscribe({
      next: (r) => {
        this.registrando.set(false);
        this.checkin.set(r);
      },
      error: (e) => {
        this.registrando.set(false);
        const d = e?.error;
        this.errorCheckin.set(
          d?.detail ??
            (d && typeof d === 'object'
              ? Object.values(d as Record<string, unknown>).flat().join(' ')
              : 'No se pudo registrar tu asistencia. Pide en recepción que te escaneen.'),
        );
      },
    });
  }

  elegirFoto(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.archivo.set(f);
    const lector = new FileReader();
    lector.onload = () => this.previa.set(lector.result as string);
    lector.readAsDataURL(f);
  }

  guardar(): void {
    this.guardando.set(true);
    this.mensaje.set('');

    // Con foto va como multipart; sin foto, JSON plano.
    let cuerpo: FormData | Record<string, string>;
    if (this.archivo()) {
      const fd = new FormData();
      Object.entries(this.form).forEach(([k, v]) => fd.append(k, v ?? ''));
      fd.append('foto', this.archivo()!);
      cuerpo = fd;
    } else {
      cuerpo = { ...this.form };
    }

    this.api.editarmeYo(cuerpo as never).subscribe({
      next: (a) => {
        this.alumno.set(a);
        this.archivo.set(null);
        this.previa.set(null);
        this.guardando.set(false);
        this.esError.set(false);
        this.mensaje.set('Cambios guardados.');
      },
      error: (e) => {
        this.guardando.set(false);
        this.esError.set(true);
        const d = e?.error;
        this.mensaje.set(
          d && typeof d === 'object'
            ? Object.values(d as Record<string, unknown>).flat().join(' ')
            : 'No se pudieron guardar los cambios.',
        );
      },
    });
  }
}
