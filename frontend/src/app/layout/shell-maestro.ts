import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LogoComponent } from '../shared/ui';

/**
 * Marco del área de Maestro: mismo layout que ShellAdmin (barra lateral en
 * escritorio, cajón deslizante en móvil) pero con un menú acotado a lo que
 * un maestro puede hacer — sus alumnos (calificaciones), eventos,
 * notificaciones y su perfil. Sin opciones administrativas. Es un archivo
 * aparte (no un ShellAdmin parametrizado) porque así ya conviven ShellAdmin
 * y ShellAlumno en este proyecto. Ocultar aquí no es seguridad: el backend
 * acota al maestro por su cuenta.
 */
@Component({
  selector: 'cb-shell-maestro',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, LogoComponent],
  template: `
    <header class="cabecera">
      <button class="hamburguesa" (click)="abierto.set(!abierto())" aria-label="Menú">☰</button>
      <cb-logo [tam]="30" />
      <span class="crece"></span>
      <span class="quien mini tenue">{{ auth.usuario()?.nombre }}</span>
      <button class="btn btn-mini btn-fantasma" (click)="auth.logout()">Salir</button>
    </header>

    <div class="marco">
      @if (abierto()) {
        <div class="velo" (click)="abierto.set(false)"></div>
      }

      <aside class="lateral" [class.abierta]="abierto()">
        <div class="lateral-cabeza">
          <cb-logo [tam]="34" />
        </div>

        <nav>
          <span class="etiqueta grupo">Maestro</span>
          @for (item of menu; track item.ruta) {
            <a
              [routerLink]="item.ruta"
              routerLinkActive="activo"
              [routerLinkActiveOptions]="{ exact: item.exacto ?? false }"
              (click)="abierto.set(false)"
            >
              <span class="icono">{{ item.icono }}</span>
              {{ item.rotulo }}
            </a>
          }
        </nav>
      </aside>

      <main>
        <div class="contenedor">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
      }
      .cabecera {
        position: sticky;
        top: 0;
        z-index: 60;
        height: var(--header-h);
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 14px;
        background: rgba(15, 16, 17, 0.94);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--borde);
      }
      .hamburguesa {
        background: none;
        border: none;
        color: var(--texto);
        font-size: 1.2rem;
        cursor: pointer;
        padding: 6px;
      }
      .quien {
        display: none;
      }

      .marco {
        display: flex;
        min-height: calc(100dvh - var(--header-h));
      }

      .velo {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        z-index: 70;
      }

      .lateral {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        width: var(--sidebar-w);
        z-index: 80;
        background: var(--negro-900);
        border-right: 1px solid var(--borde);
        transform: translateX(-100%);
        transition: transform 0.2s ease;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }
      .lateral.abierta {
        transform: none;
      }
      .lateral-cabeza {
        padding: 16px 14px;
        border-bottom: 1px solid var(--borde);
      }
      nav {
        flex: 1;
        padding: 10px 8px;
      }
      .grupo {
        display: block;
        padding: 12px 10px 5px;
      }
      nav a {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: var(--r-sm);
        color: var(--texto-suave);
        font-size: 0.88rem;
        text-decoration: none;
        border-left: 2px solid transparent;
        transition: all 0.12s;
      }
      nav a:hover {
        background: var(--negro-800);
        color: var(--texto);
      }
      nav a.activo {
        background: rgba(0, 149, 255, 0.11);
        color: var(--rojo-claro);
        border-left-color: var(--rojo);
      }
      .icono {
        font-size: 0.98rem;
        width: 20px;
        text-align: center;
      }
      main {
        flex: 1;
        min-width: 0;
        padding: 20px 0 40px;
      }

      @media (min-width: 1000px) {
        .hamburguesa {
          display: none;
        }
        .cabecera cb-logo {
          display: none;
        }
        .quien {
          display: inline;
        }
        .velo {
          display: none;
        }
        .lateral {
          position: sticky;
          top: 0;
          transform: none;
          height: 100dvh;
        }
        .marco {
          min-height: 100dvh;
        }
        .cabecera {
          padding-left: calc(var(--sidebar-w) + 14px);
        }
      }
    `,
  ],
})
export class ShellMaestro {
  auth = inject(AuthService);
  abierto = signal(false);

  menu = [
    { ruta: '/maestro/inicio', icono: '🥊', rotulo: 'Mis alumnos', exacto: true },
    { ruta: '/maestro/eventos', icono: '📅', rotulo: 'Eventos' },
    { ruta: '/maestro/avisos', icono: '📣', rotulo: 'Notificaciones' },
    { ruta: '/maestro/perfil', icono: '🔐', rotulo: 'Mi perfil' },
  ];
}
