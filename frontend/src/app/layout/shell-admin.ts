import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LogoComponent } from '../shared/ui';

/**
 * Marco del área administrativa.
 * Barra lateral en escritorio (que es donde se hace la gestión de verdad),
 * cajón deslizante en móvil para cuando se consulta algo desde el celular.
 */
@Component({
  selector: 'cb-shell-admin',
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
          @for (grupo of menu; track grupo.titulo) {
            <span class="etiqueta grupo">{{ grupo.titulo }}</span>
            @for (item of grupo.items; track item.ruta) {
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
          }
        </nav>

        <div class="lateral-pie">
          <a routerLink="/mi" class="mini">Ver la app como alumno →</a>
        </div>
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
      .lateral-pie {
        padding: 14px;
        border-top: 1px solid var(--borde);
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
export class ShellAdmin {
  auth = inject(AuthService);
  abierto = signal(false);

  menu = [
    {
      titulo: 'Operación',
      items: [
        { ruta: '/admin/inicio', icono: '📊', rotulo: 'Panel', exacto: true },
        { ruta: '/admin/asistencia', icono: '📷', rotulo: 'Pasar lista' },
        { ruta: '/admin/alumnos', icono: '🥊', rotulo: 'Alumnos' },
        { ruta: '/admin/pagos', icono: '💳', rotulo: 'Pagos' },
        { ruta: '/admin/pagos-en-linea', icono: '🌐', rotulo: 'Pagos en línea' },
        { ruta: '/admin/avisos', icono: '📣', rotulo: 'Avisos' },
        { ruta: '/admin/eventos', icono: '📅', rotulo: 'Eventos' },
      ],
    },
    {
      titulo: 'Catálogos',
      items: [
        { ruta: '/admin/maestros', icono: '👤', rotulo: 'Maestros' },
        { ruta: '/admin/horarios', icono: '🕐', rotulo: 'Horarios y disciplinas' },
        { ruta: '/admin/membresias', icono: '📋', rotulo: 'Membresías' },
        { ruta: '/admin/insignias', icono: '🏅', rotulo: 'Insignias' },
      ],
    },
    {
      titulo: 'Análisis',
      items: [{ ruta: '/admin/reportes', icono: '📈', rotulo: 'Reportes' }],
    },
    {
      titulo: 'Sistema',
      items: [
        { ruta: '/admin/usuarios', icono: '👥', rotulo: 'Usuarios' },
        { ruta: '/admin/perfil', icono: '🔐', rotulo: 'Mi perfil' },
      ],
    },
  ];
}
