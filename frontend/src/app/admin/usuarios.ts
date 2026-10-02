import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { UsuarioAdministrativo } from '../core/models';
import { CargandoComponent, ModalComponent, VacioComponent } from '../shared/ui';

/**
 * Usuarios del sistema con acceso administrativo (staff/admin). Las cuentas
 * de alumnos y maestros se administran desde sus propias fichas (ahí también
 * se restablece su contraseña); aquí solo el personal administrativo.
 * Al dar de alta, la cuenta nace con la contraseña inicial y se muestra una
 * sola vez (mismo flujo que maestros.ts / alumnos.ts).
 */
@Component({
  selector: 'cb-admin-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule, CargandoComponent, VacioComponent, ModalComponent],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <h1 style="margin:0">Usuarios</h1>
        <button class="btn btn-rojo" (click)="abrir()">+ Nuevo usuario administrativo</button>
      </div>
      <p class="mini tenue" style="margin-top:-6px">
        Cuentas con acceso administrativo completo. Las cuentas de alumnos y maestros se
        administran desde sus fichas.
      </p>

      @if (mensaje()) {
        <div class="aviso" [class.aviso-ok]="!esError()" [class.aviso-error]="esError()">
          {{ mensaje() }}
        </div>
      }

      @if (cargando()) {
        <cb-cargando />
      } @else if (lista().length) {
        <div class="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Último acceso</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (u of lista(); track u.id) {
                <tr>
                  <td class="mono">
                    {{ u.username }}
                    @if (u.is_superuser) {
                      <span class="chip chip-rojo" style="margin-left:6px">Superusuario</span>
                    }
                    @if (esYo(u)) {
                      <span class="mini tenue" style="margin-left:6px">(tú)</span>
                    }
                  </td>
                  <td>{{ u.nombre }}</td>
                  <td class="mini">{{ u.email || '—' }}</td>
                  <td class="mini">{{ u.last_login ? (u.last_login | date: 'dd/MM/yyyy HH:mm') : 'Nunca' }}</td>
                  <td>
                    <span class="chip" [class]="u.is_active ? 'chip-verde' : 'chip-gris'">
                      {{ u.is_active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td>
                    <div class="fila envuelve">
                      @if (!esYo(u)) {
                        <button class="btn btn-mini" (click)="abrirRestablecer(u)">Restablecer contraseña</button>
                        <button class="btn btn-mini btn-fantasma" (click)="alternarActivo(u)">
                          {{ u.is_active ? 'Desactivar' : 'Activar' }}
                        </button>
                      } @else {
                        <span class="mini tenue">Tu contraseña: Mi perfil → Seguridad</span>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <cb-vacio icono="👥" titulo="Sin usuarios administrativos" />
      }
    </div>

    <!-- ===== ALTA ===== -->
    @if (modal()) {
      <cb-modal titulo="Nuevo usuario administrativo" (cerrar)="modal.set(false)">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }
        <div class="campo">
          <label>Usuario *</label>
          <input [(ngModel)]="f.username" autocapitalize="none" placeholder="p. ej. recepcion" />
        </div>
        <div class="grid grid-2">
          <div class="campo"><label>Nombre</label><input [(ngModel)]="f.first_name" /></div>
          <div class="campo"><label>Apellidos</label><input [(ngModel)]="f.last_name" /></div>
        </div>
        <div class="campo">
          <label>Correo electrónico</label>
          <input type="email" [(ngModel)]="f.email" />
        </div>
        <p class="mini tenue">
          La cuenta nace con la contraseña inicial de la academia; se muestra al guardar para que
          se la comuniques. La persona la cambia en Mi perfil → Seguridad.
        </p>
        <div pie>
          <button class="btn" (click)="modal.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
            {{ guardando() ? 'Guardando...' : 'Dar de alta' }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== CREDENCIALES (una sola vez) ===== -->
    @if (credenciales(); as c) {
      <cb-modal titulo="Cuenta creada" (cerrar)="credenciales.set(null)">
        <p>Comunícale estas credenciales a la persona. La contraseña no se vuelve a mostrar.</p>
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

    <!-- ===== RESTABLECER ===== -->
    @if (restableciendoA(); as u) {
      <cb-modal [titulo]="'Restablecer contraseña · ' + u.username" (cerrar)="restableciendoA.set(null)">
        @if (error()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
        }
        <div class="campo">
          <label>Nueva contraseña</label>
          <input [(ngModel)]="nuevaPassword" placeholder="Vacío = generar una automática" />
        </div>
        @if (passwordGenerada()) {
          <div class="aviso aviso-ok">
            Nueva contraseña: <strong class="mono">{{ passwordGenerada() }}</strong>
            — comunícasela, no se vuelve a mostrar. Sus sesiones abiertas se cerraron.
          </div>
        }
        <div pie>
          <button class="btn" (click)="restableciendoA.set(null)">Cerrar</button>
          <button class="btn btn-rojo" [disabled]="restableciendo()" (click)="restablecer()">
            {{ restableciendo() ? '...' : 'Restablecer' }}
          </button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
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
export class AdminUsuarios {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  lista = signal<UsuarioAdministrativo[]>([]);
  cargando = signal(true);
  guardando = signal(false);
  modal = signal(false);
  error = signal('');
  mensaje = signal('');
  esError = signal(false);

  credenciales = signal<{ username: string; password: string } | null>(null);

  restableciendoA = signal<UsuarioAdministrativo | null>(null);
  restableciendo = signal(false);
  nuevaPassword = '';
  passwordGenerada = signal('');

  f = this.vacio();

  private vacio() {
    return { username: '', first_name: '', last_name: '', email: '' };
  }

  esYo(u: UsuarioAdministrativo): boolean {
    return u.id === this.auth.usuario()?.id;
  }

  private avisar(texto: string, error = false): void {
    this.esError.set(error);
    this.mensaje.set(texto);
    setTimeout(() => this.mensaje.set(''), 4000);
  }

  private textoError(e: unknown, porDefecto: string): string {
    const d = (e as { error?: unknown })?.error;
    if (d && typeof d === 'object') {
      const textos = Object.values(d as Record<string, unknown>).flat();
      if (textos.length) return textos.join(' ');
    }
    return porDefecto;
  }

  abrir(): void {
    this.f = this.vacio();
    this.error.set('');
    this.modal.set(true);
  }

  guardar(): void {
    if (!this.f.username.trim()) {
      this.error.set('El usuario es obligatorio.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    this.api.crearUsuarioAdmin({ ...this.f, username: this.f.username.trim() }).subscribe({
      next: (u) => {
        this.guardando.set(false);
        this.modal.set(false);
        this.credenciales.set({ username: u.username, password: u.password_inicial ?? '' });
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(this.textoError(e, 'No se pudo crear el usuario.'));
      },
    });
  }

  alternarActivo(u: UsuarioAdministrativo): void {
    const accion = u.is_active ? 'desactivar' : 'activar';
    if (!confirm(`¿Seguro que quieres ${accion} la cuenta ${u.username}?`)) return;
    this.api.editarUsuarioAdmin(u.id, { is_active: !u.is_active }).subscribe({
      next: (actualizado) => {
        this.lista.set(this.lista().map((x) => (x.id === actualizado.id ? actualizado : x)));
        this.avisar(actualizado.is_active ? 'Cuenta activada.' : 'Cuenta desactivada.');
      },
      error: (e) => this.avisar(this.textoError(e, 'No se pudo cambiar el estado.'), true),
    });
  }

  abrirRestablecer(u: UsuarioAdministrativo): void {
    this.nuevaPassword = '';
    this.passwordGenerada.set('');
    this.error.set('');
    this.restableciendoA.set(u);
  }

  restablecer(): void {
    const u = this.restableciendoA();
    if (!u) return;
    this.restableciendo.set(true);
    this.passwordGenerada.set('');
    this.error.set('');
    this.api.restablecerPasswordUsuario(u.id, this.nuevaPassword.trim() || undefined).subscribe({
      next: (r) => {
        this.restableciendo.set(false);
        this.nuevaPassword = '';
        if (r.password_generada) this.passwordGenerada.set(r.password_generada);
        else this.avisar(r.detail);
        if (!r.password_generada) this.restableciendoA.set(null);
      },
      error: (e) => {
        this.restableciendo.set(false);
        this.error.set(e?.error?.detail ?? 'No se pudo restablecer la contraseña.');
      },
    });
  }

  private cargar(): void {
    this.api.usuariosAdmin({ page_size: 100 }).subscribe({
      next: (p) => {
        this.lista.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  constructor() {
    this.cargar();
  }
}
