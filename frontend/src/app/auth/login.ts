import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LogoComponent } from '../shared/ui';

@Component({
  selector: 'cb-login',
  standalone: true,
  imports: [CommonModule, FormsModule, LogoComponent],
  template: `
    <div class="pantalla">
      <!-- Fondo: octágono gigante apenas visible -->
      <svg class="fondo" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M20 3 L44 3 L61 20 L61 44 L44 61 L20 61 L3 44 L3 20 Z"
          stroke="var(--rojo)"
          stroke-width="0.4"
          fill="none"
        />
      </svg>

      <div class="caja">
        <div class="marca">
          <cb-logo [tam]="72" [compacto]="true" />
          <h1>RageCore</h1>
          <p class="bajada">Academia de combate</p>
        </div>

        <form class="tarjeta" (ngSubmit)="entrar()">
          @if (error()) {
            <div class="aviso aviso-error" role="alert">{{ error() }}</div>
          }

          <div class="campo">
            <label for="usuario">Usuario o correo</label>
            <input
              id="usuario"
              name="usuario"
              [(ngModel)]="usuario"
              autocomplete="username"
              autocapitalize="none"
              required
              [disabled]="cargando()"
            />
          </div>

          <div class="campo">
            <label for="clave">Contraseña</label>
            <div class="con-boton">
              <input
                id="clave"
                name="clave"
                [type]="verClave() ? 'text' : 'password'"
                [(ngModel)]="clave"
                autocomplete="current-password"
                required
                [disabled]="cargando()"
              />
              <button
                type="button"
                class="ojo"
                (click)="verClave.set(!verClave())"
                [attr.aria-label]="verClave() ? 'Ocultar contraseña' : 'Mostrar contraseña'"
              >
                {{ verClave() ? 'Ocultar' : 'Ver' }}
              </button>
            </div>
          </div>

          <button
            type="submit"
            class="btn btn-rojo btn-bloque"
            [disabled]="cargando() || !usuario || !clave"
          >
            {{ cargando() ? 'Entrando...' : 'Entrar' }}
          </button>

          <div class="pie">
            <button type="button" class="enlace" (click)="mostrarAyuda.set(!mostrarAyuda())">
              Olvidé mi contraseña
            </button>
          </div>

          @if (mostrarAyuda()) {
            <p class="mini tenue ayuda">
              Las cuentas las genera la academia. Pide en recepción que restablezcan tu
              contraseña; el administrador lo hace desde el panel.
            </p>
          }
        </form>

        <p class="mini tenue centro nota">
          ¿Aún no tienes cuenta? La academia te la crea al inscribirte.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      .pantalla {
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 24px 16px;
        position: relative;
        overflow: hidden;
      }
      .fondo {
        position: absolute;
        width: min(150vw, 900px);
        height: min(150vw, 900px);
        opacity: 0.5;
        pointer-events: none;
      }
      .caja {
        width: 100%;
        max-width: 380px;
        position: relative;
        z-index: 1;
      }
      .marca {
        text-align: center;
        margin-bottom: 26px;
      }
      .marca h1 {
        margin: 14px 0 0;
        font-size: 2rem;
        letter-spacing: 0.18em;
      }
      .bajada {
        margin: 2px 0 0;
        font-size: 0.68rem;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: var(--rojo);
      }
      .tarjeta {
        border-top: 3px solid var(--rojo);
      }
      .con-boton {
        position: relative;
        display: flex;
        align-items: center;
      }
      .con-boton input {
        padding-right: 68px;
      }
      .ojo {
        position: absolute;
        right: 6px;
        background: none;
        border: none;
        color: var(--texto-suave);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        cursor: pointer;
        padding: 6px 8px;
      }
      .ojo:hover {
        color: var(--rojo-claro);
      }
      .pie {
        text-align: center;
        margin-top: 14px;
      }
      .enlace {
        background: none;
        border: none;
        color: var(--texto-suave);
        font-size: 0.82rem;
        cursor: pointer;
        text-decoration: underline;
      }
      .enlace:hover {
        color: var(--rojo-claro);
      }
      .ayuda {
        margin: 12px 0 0;
        padding: 10px;
        background: var(--negro-900);
        border-radius: var(--r-sm);
        border: 1px solid var(--borde);
      }
      .nota {
        margin-top: 18px;
      }
      .aviso {
        margin-bottom: 14px;
      }
    `,
  ],
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  usuario = '';
  clave = '';
  verClave = signal(false);
  cargando = signal(false);
  error = signal('');
  mostrarAyuda = signal(false);

  entrar(): void {
    if (!this.usuario || !this.clave) return;
    this.cargando.set(true);
    this.error.set('');

    this.auth.login(this.usuario.trim(), this.clave).subscribe({
      next: () => {
        this.cargando.set(false);
        const rol = this.auth.rol();
        if (rol === 'SIN_ROL') {
          // Cuenta válida pero sin alumno ligado ni permisos de staff.
          this.auth.limpiar();
          this.error.set(
            'Tu cuenta existe pero no está ligada a un alumno. Pide en recepción que la vinculen.',
          );
          return;
        }
        this.router.navigate([this.auth.rutaInicio()]);
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.error?.detail ?? 'No se pudo conectar con la academia. Revisa tu red.');
      },
    });
  }
}
