import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { PanelNotificaciones } from '../shared/panel-notificaciones';
import { AvatarComponent, LogoComponent } from '../shared/ui';

/**
 * Marco de la zona del alumno.
 * Navegación inferior fija, como app nativa, porque la PWA se usa sobre todo
 * en el celular dentro del gimnasio.
 */
@Component({
  selector: 'cb-shell-alumno',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LogoComponent,
    AvatarComponent,
    PanelNotificaciones,
  ],
  template: `
    <header class="cabecera">
      <div class="contenedor fila-entre">
        <a routerLink="/mi/inicio" aria-label="Inicio"><cb-logo [tam]="32" /></a>

        <div class="fila">
          <!-- La campana ALTERNA el panel: un toque lo abre, otro lo cierra -->
          <button
            type="button"
            class="campana"
            [class.abierta]="notis()"
            aria-label="Notificaciones"
            aria-haspopup="dialog"
            [attr.aria-expanded]="notis()"
            (click)="alternarNotis()"
          >
            <span class="icono">🔔</span>
            @if (sinLeer() > 0) {
              <span class="badge">{{ sinLeer() > 9 ? '9+' : sinLeer() }}</span>
            }
          </button>
          <button class="perfil" (click)="alternarMenu()" aria-label="Menú de cuenta">
            <cb-avatar [foto]="foto()" [nombre]="nombre()" [tam]="32" />
          </button>
        </div>
      </div>

      @if (notis()) {
        <div class="menu-fondo" (click)="notis.set(false)">
          <div class="flotante" (click)="$event.stopPropagation()">
            <cb-panel-notificaciones
              (sinLeerCambio)="sinLeer.set(Math.max(0, sinLeer() + $event))"
              (cerrar)="notis.set(false)"
            />
          </div>
        </div>
      }

      @if (menu()) {
        <div class="menu-fondo" (click)="menu.set(false)">
          <div class="menu" (click)="$event.stopPropagation()">
            <div class="menu-cabeza">
              <strong>{{ nombre() }}</strong>
              <span class="mini tenue">{{ auth.usuario()?.username }}</span>
            </div>
            <a routerLink="/mi/perfil" (click)="menu.set(false)">Mi perfil</a>
            @if (auth.esAdmin()) {
              <a routerLink="/admin" (click)="menu.set(false)">Ir al panel administrativo</a>
            }
            <button (click)="auth.logout()">Cerrar sesión</button>
          </div>
        </div>
      }
    </header>

    <main class="contenido">
      <div class="contenedor">
        @if (!enInicio()) {
          <a routerLink="/mi/inicio" class="regresar">← Regresar al inicio</a>
        }
        <router-outlet />
      </div>
    </main>

    <nav class="nav-inferior" aria-label="Navegación principal">
      @for (item of navegacion; track item.ruta) {
        <a [routerLink]="item.ruta" routerLinkActive="activo">
          <span class="icono">{{ item.icono }}</span>
          <span class="rotulo">{{ item.rotulo }}</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        padding-bottom: calc(var(--nav-h) + 12px);
      }
      .cabecera {
        position: sticky;
        top: 0;
        z-index: 60;
        height: var(--header-h);
        display: flex;
        align-items: center;
        background: rgba(15, 16, 17, 0.94);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--borde);
      }
      .contenido {
        padding: 18px 0 24px;
      }
      .campana {
        position: relative;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        text-decoration: none;
      }
      .campana {
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
      }
      .campana:hover,
      .campana.abierta {
        background: var(--negro-700);
      }
      .flotante {
        position: absolute;
        top: calc(var(--header-h) - 6px);
        right: 12px;
      }
      .regresar {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
        padding: 6px 12px 6px 8px;
        border-radius: var(--r-sm);
        font-family: 'Oswald', sans-serif;
        font-size: 0.8rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--texto-suave);
        border: 1px solid var(--borde);
        background: var(--negro-800);
      }
      .regresar:hover {
        color: var(--rojo-claro);
        border-color: var(--rojo);
      }
      .icono {
        font-size: 1.05rem;
        line-height: 1;
      }
      .badge {
        position: absolute;
        top: 2px;
        right: 1px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 8px;
        background: var(--rojo);
        color: #fff;
        font-size: 0.62rem;
        font-weight: 700;
        display: grid;
        place-items: center;
        border: 2px solid var(--negro-900);
      }
      .perfil {
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        display: flex;
      }

      .menu-fondo {
        position: fixed;
        inset: 0;
        z-index: 70;
      }
      .menu {
        position: absolute;
        top: calc(var(--header-h) - 6px);
        right: 16px;
        min-width: 220px;
        background: var(--negro-800);
        border: 1px solid var(--borde);
        border-radius: var(--r);
        box-shadow: var(--sombra);
        overflow: hidden;
      }
      .menu-cabeza {
        display: flex;
        flex-direction: column;
        padding: 12px 14px;
        border-bottom: 1px solid var(--borde);
      }
      .menu a,
      .menu button {
        display: block;
        width: 100%;
        text-align: left;
        padding: 11px 14px;
        background: none;
        border: none;
        color: var(--texto);
        font-family: inherit;
        font-size: 0.88rem;
        cursor: pointer;
        text-decoration: none;
      }
      .menu a:hover,
      .menu button:hover {
        background: var(--negro-700);
        color: var(--rojo-claro);
      }

      .nav-inferior {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 60;
        height: var(--nav-h);
        display: flex;
        background: rgba(15, 16, 17, 0.97);
        backdrop-filter: blur(10px);
        border-top: 1px solid var(--borde);
      }
      .nav-inferior a {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        color: var(--texto-tenue);
        text-decoration: none;
        font-size: 0.62rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-family: 'Oswald', sans-serif;
        border-top: 2px solid transparent;
        transition: color 0.15s;
      }
      .nav-inferior a .icono {
        font-size: 1.15rem;
      }
      .nav-inferior a.activo {
        color: var(--rojo-claro);
        border-top-color: var(--rojo);
      }
      .nav-inferior a:hover {
        color: var(--texto);
      }

      @media (min-width: 780px) {
        :host {
          padding-bottom: 0;
        }
        .nav-inferior {
          position: sticky;
          top: var(--header-h);
          bottom: auto;
          height: 48px;
          justify-content: center;
          border-top: none;
          border-bottom: 1px solid var(--borde);
        }
        .nav-inferior a {
          flex: none;
          flex-direction: row;
          gap: 7px;
          padding: 0 18px;
          font-size: 0.74rem;
          border-top: none;
          border-bottom: 2px solid transparent;
        }
        .nav-inferior a.activo {
          border-bottom-color: var(--rojo);
        }
      }
    `,
  ],
})
export class ShellAlumno {
  auth = inject(AuthService);
  private api = inject(ApiService);

  private router = inject(Router);

  menu = signal(false);
  notis = signal(false);
  sinLeer = signal(0);
  protected readonly Math = Math;

  private url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** En la ficha (home) no hace falta "Regresar". */
  enInicio = computed(() => {
    const ruta = this.url().split(/[?#]/)[0];
    return ruta === '/mi' || ruta === '/mi/inicio';
  });

  nombre = () => this.auth.usuario()?.nombre ?? '';
  foto = () => this.auth.usuario()?.alumno?.foto ?? null;

  navegacion = [
    { ruta: '/mi/inicio', icono: '🥊', rotulo: 'Ficha' },
    { ruta: '/mi/progreso', icono: '📈', rotulo: 'Progreso' },
    { ruta: '/mi/asistencia', icono: '📅', rotulo: 'Asistencia' },
    { ruta: '/mi/pagos', icono: '💳', rotulo: 'Pagos' },
    { ruta: '/mi/insignias', icono: '🏅', rotulo: 'Logros' },
    { ruta: '/mi/eventos', icono: '📅', rotulo: 'Eventos' },
  ];

  alternarNotis(): void {
    this.menu.set(false);
    this.notis.update((v) => !v);
  }

  alternarMenu(): void {
    this.notis.set(false);
    this.menu.update((v) => !v);
  }

  @HostListener('document:keydown.escape')
  cerrarFlotantes(): void {
    this.notis.set(false);
    this.menu.set(false);
  }

  constructor() {
    // Al cambiar de pantalla se cierra lo que estuviera abierto.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.cerrarFlotantes());
    this.api.notificaciones({ leida: false, page_size: 1 }).subscribe({
      next: (p) => this.sinLeer.set(p.count),
      error: () => {},
    });
  }
}
