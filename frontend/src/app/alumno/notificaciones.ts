import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Notificacion } from '../core/models';
import { fechaRelativa, iconoNotificacion } from '../shared/panel-notificaciones';
import { CargandoComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-mis-notificaciones',
  standalone: true,
  imports: [CommonModule, CargandoComponent, VacioComponent],
  template: `
    <div class="pila">
      <div class="fila-entre">
        <h1 style="margin:0">Notificaciones</h1>
        @if (sinLeer() > 0) {
          <button class="btn btn-mini" (click)="marcarTodas()">Marcar todas como leídas</button>
        }
      </div>

      @if (cargando()) {
        <cb-cargando />
      } @else if (lista().length) {
        <div class="pila" style="gap:10px">
          @for (n of lista(); track n.id) {
            <article class="tarjeta noti" [class.nueva]="!n.leida" (click)="abrir(n)">
              <div class="icono">{{ icono(n.tipo) }}</div>
              <div class="crece">
                <div class="fila-entre">
                  <strong>{{ n.titulo || n.tipo_display }}</strong>
                  <span class="mini tenue mono">{{ fecha(n.fecha_envio) }}</span>
                </div>
                <p>{{ n.mensaje }}</p>
              </div>
              @if (!n.leida) {
                <span class="punto" aria-label="No leída"></span>
              }
            </article>
          }
        </div>
      } @else {
        <cb-vacio icono="🔔" titulo="Bandeja vacía" detalle="Aquí llegarán los avisos de la academia." />
      }
    </div>
  `,
  styles: [
    `
      .noti {
        display: flex;
        gap: 13px;
        align-items: flex-start;
        cursor: pointer;
        transition: border-color 0.15s;
      }
      .noti:hover {
        border-color: var(--texto-tenue);
      }
      .noti.nueva {
        border-left: 3px solid var(--rojo);
        background: rgba(0, 149, 255, 0.05);
      }
      .icono {
        font-size: 1.25rem;
        line-height: 1.3;
      }
      .noti p {
        margin: 4px 0 0;
        color: var(--texto-suave);
        font-size: 0.9rem;
      }
      .punto {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--rojo);
        flex: none;
        margin-top: 6px;
      }
    `,
  ],
})
export class MisNotificaciones {
  private api = inject(ApiService);

  lista = signal<Notificacion[]>([]);
  cargando = signal(true);
  sinLeer = computed(() => this.lista().filter((n) => !n.leida).length);

  icono = iconoNotificacion;
  fecha = fechaRelativa;

  abrir(n: Notificacion): void {
    if (n.leida) return;
    // Optimista: la marcamos ya y si falla la petición se revierte.
    this.actualizar(n.id, true);
    this.api.marcarLeida(n.id).subscribe({ error: () => this.actualizar(n.id, false) });
  }

  marcarTodas(): void {
    for (const n of this.lista().filter((x) => !x.leida)) {
      this.actualizar(n.id, true);
      this.api.marcarLeida(n.id).subscribe({ error: () => this.actualizar(n.id, false) });
    }
  }

  private actualizar(id: number, leida: boolean): void {
    this.lista.update((ns) => ns.map((n) => (n.id === id ? { ...n, leida } : n)));
  }

  constructor() {
    this.api.notificaciones({ page_size: 100 }).subscribe({
      next: (p) => {
        this.lista.set(p.results);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
