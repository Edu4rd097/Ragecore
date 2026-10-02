import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Notificacion } from '../core/models';

/** Emoji por tipo de notificación (mismo criterio en el panel y en la página). */
export function iconoNotificacion(tipo: string): string {
  const mapa: Record<string, string> = {
    PAGO_POR_VENCER: '⏳',
    PAGO_VENCIDO: '⚠️',
    RECORDATORIO_CLASE: '📅',
    INSIGNIA: '🏅',
    GRADO: '🥋',
    MANUAL: '📣',
  };
  return mapa[tipo] ?? '🔔';
}

/** "Hoy", "Ayer", "Hace 3 días" o la fecha corta. */
export function fechaRelativa(iso: string): string {
  const d = new Date(iso);
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias < 7) return `Hace ${dias} días`;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

/**
 * Panel desplegable de la campanita: las notificaciones más recientes.
 * Lo abre/cierra el shell (la campana alterna). Tocar una la marca leída.
 */
@Component({
  selector: 'cb-panel-notificaciones',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="panel" role="dialog" aria-label="Notificaciones">
      <div class="cabeza">
        <strong>Notificaciones</strong>
        @if (sinLeer() > 0) {
          <button type="button" class="enlace" (click)="marcarTodas()">Marcar todas como leídas</button>
        }
      </div>

      <div class="lista" aria-live="polite">
        @if (cargando()) {
          <p class="vacio">Cargando...</p>
        } @else if (error()) {
          <p class="vacio">No se pudieron cargar. Intenta de nuevo.</p>
        } @else if (lista().length) {
          @for (n of lista(); track n.id) {
            <button type="button" class="noti" [class.nueva]="!n.leida" (click)="abrir(n)">
              <span class="icono" aria-hidden="true">{{ icono(n.tipo) }}</span>
              <span class="texto">
                <span class="fila-entre">
                  <strong>{{ n.titulo || n.tipo_display }}</strong>
                  <span class="cuando">{{ fecha(n.fecha_envio) }}</span>
                </span>
                <span class="mensaje">{{ n.mensaje }}</span>
              </span>
              @if (!n.leida) {
                <span class="punto" aria-label="No leída"></span>
              }
            </button>
          }
        } @else {
          <p class="vacio">🔔 Bandeja vacía. Aquí llegarán los avisos de la academia.</p>
        }
      </div>

      <a class="pie" routerLink="/mi/notificaciones" (click)="cerrar.emit()">Ver todas →</a>
    </div>
  `,
  styles: [
    `
      .panel {
        width: min(380px, calc(100vw - 24px));
        max-height: min(70dvh, 520px);
        display: flex;
        flex-direction: column;
        background: var(--negro-800);
        border: 1px solid var(--borde);
        border-top: 3px solid var(--rojo);
        border-radius: var(--r);
        box-shadow: var(--sombra);
        overflow: hidden;
      }
      .cabeza {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--borde);
        font-family: 'Oswald', sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .enlace {
        background: none;
        border: none;
        color: var(--rojo-claro);
        font-size: 0.75rem;
        cursor: pointer;
        font-family: inherit;
        text-transform: none;
        letter-spacing: 0;
      }
      .lista {
        overflow-y: auto;
      }
      .noti {
        display: flex;
        gap: 11px;
        width: 100%;
        padding: 12px 14px;
        background: none;
        border: none;
        border-bottom: 1px solid var(--borde-suave);
        color: var(--texto);
        text-align: left;
        font-family: inherit;
        cursor: pointer;
      }
      .noti:hover {
        background: var(--negro-700);
      }
      .noti.nueva {
        background: rgba(0, 149, 255, 0.06);
        box-shadow: inset 3px 0 0 var(--rojo);
      }
      .icono {
        font-size: 1.1rem;
        line-height: 1.3;
      }
      .texto {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .texto strong {
        font-size: 0.86rem;
      }
      .cuando {
        font-size: 0.7rem;
        color: var(--texto-tenue);
        white-space: nowrap;
      }
      .mensaje {
        font-size: 0.8rem;
        color: var(--texto-suave);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .punto {
        flex: none;
        width: 8px;
        height: 8px;
        margin-top: 6px;
        border-radius: 50%;
        background: var(--rojo);
      }
      .vacio {
        margin: 0;
        padding: 22px 16px;
        color: var(--texto-tenue);
        font-size: 0.85rem;
        text-align: center;
      }
      .pie {
        display: block;
        padding: 11px 14px;
        text-align: center;
        font-size: 0.8rem;
        border-top: 1px solid var(--borde);
      }
      .pie:hover {
        background: var(--negro-700);
      }
    `,
  ],
})
export class PanelNotificaciones implements OnInit {
  private api = inject(ApiService);

  /** Diferencia en las no leídas (-1 al leer una), para el globo de la campana. */
  sinLeerCambio = output<number>();
  cerrar = output<void>();

  lista = signal<Notificacion[]>([]);
  cargando = signal(true);
  error = signal(false);
  sinLeer = computed(() => this.lista().filter((n) => !n.leida).length);

  icono = iconoNotificacion;
  fecha = fechaRelativa;

  ngOnInit(): void {
    this.api.notificaciones({ page_size: 10 }).subscribe({
      next: (p) => {
        this.lista.set(p.results);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set(true);
        this.cargando.set(false);
      },
    });
  }

  abrir(n: Notificacion): void {
    if (n.leida) return;
    this.actualizar(n.id, true);
    this.api.marcarLeida(n.id).subscribe({ error: () => this.actualizar(n.id, false) });
  }

  marcarTodas(): void {
    for (const n of this.lista().filter((x) => !x.leida)) this.abrir(n);
  }

  private actualizar(id: number, leida: boolean): void {
    const antes = this.sinLeer();
    this.lista.update((ns) => ns.map((n) => (n.id === id ? { ...n, leida } : n)));
    // Solo se informa la diferencia: puede haber más sin leer fuera de estas 10.
    this.sinLeerCambio.emit(this.sinLeer() - antes);
  }
}
