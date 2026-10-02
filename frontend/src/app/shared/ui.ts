import { CommonModule } from '@angular/common';
import { Component, Input, computed, input, output } from '@angular/core';
import { EstadoPago } from '../core/models';

/* ==========================================================================
   LOGO — RageCore
   Octágono (la jaula) con el monograma RC y una banda azul diagonal.
   Es SVG puro: escala sin perder nitidez y hereda el color del contenedor.
   ========================================================================== */

@Component({
  selector: 'cb-logo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="logo" [class.compacto]="compacto()">
      <svg
        [attr.width]="tam()"
        [attr.height]="tam()"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <!-- Octágono exterior: la jaula -->
        <path
          d="M20 3 L44 3 L61 20 L61 44 L44 61 L20 61 L3 44 L3 20 Z"
          stroke="var(--rojo)"
          stroke-width="3"
          fill="var(--negro-900)"
        />
        <!-- Malla interior, insinuada -->
        <path
          d="M20 3 L44 61 M44 3 L20 61 M3 20 L61 44 M61 20 L3 44"
          stroke="var(--rojo)"
          stroke-width="0.5"
          opacity="0.18"
        />
        <!-- Banda diagonal -->
        <path d="M10 44 L44 10 L52 18 L18 52 Z" fill="var(--rojo)" opacity="0.9" />
        <!-- Monograma RC -->
        <text
          x="32"
          y="41"
          text-anchor="middle"
          font-family="Oswald, sans-serif"
          font-size="24"
          font-weight="700"
          fill="#fff"
          letter-spacing="-1"
        >
          RC
        </text>
      </svg>

      @if (!compacto()) {
        <div class="texto">
          <span class="marca">RAGECORE</span>
          <span class="bajada">Academia de combate</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .logo {
        display: flex;
        align-items: center;
        gap: 11px;
      }
      .texto {
        display: flex;
        flex-direction: column;
        line-height: 1.05;
      }
      .marca {
        font-family: 'Oswald', sans-serif;
        font-weight: 700;
        font-size: 1.08rem;
        letter-spacing: 0.16em;
        color: var(--texto);
      }
      .bajada {
        font-size: 0.62rem;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--rojo);
      }
    `,
  ],
})
export class LogoComponent {
  compacto = input(false);
  tam = input(38);
}

/* ==========================================================================
   AVATAR
   Si hay foto la muestra; si no, dibuja una silueta de peleador generada.
   El tono de la silueta se deriva del nombre, así cada alumno se distingue
   sin necesidad de subir foto.
   ========================================================================== */

@Component({
  selector: 'cb-avatar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="av" [style.width.px]="tam()" [style.height.px]="tam()" [class.aro]="aro()">
      @if (foto()) {
        <img [src]="foto()" [alt]="nombre()" />
      } @else {
        <svg viewBox="0 0 64 64" [style.background]="fondo()" aria-hidden="true">
          <!-- Silueta de peleador en guardia -->
          <g [attr.fill]="tinta()">
            <circle cx="32" cy="20" r="9" />
            <path
              d="M32 30c-9 0-15 5-16.5 13.5L13 58h38l-2.5-14.5C47 35 41 30 32 30z"
            />
            <!-- Guantes -->
            <circle cx="19" cy="36" r="5.5" opacity="0.85" />
            <circle cx="45" cy="36" r="5.5" opacity="0.85" />
          </g>
        </svg>
        @if (iniciales()) {
          <span class="ini">{{ iniciales() }}</span>
        }
      }
    </div>
  `,
  styles: [
    `
      .av {
        position: relative;
        border-radius: 50%;
        overflow: hidden;
        flex: none;
        background: var(--negro-700);
        display: grid;
        place-items: center;
      }
      .av.aro {
        box-shadow: 0 0 0 2px var(--rojo);
      }
      img,
      svg {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .ini {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-family: 'Oswald', sans-serif;
        font-weight: 700;
        font-size: 0.9rem;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.92);
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
      }
    `,
  ],
})
export class AvatarComponent {
  foto = input<string | null>(null);
  nombre = input('');
  tam = input(44);
  aro = input(false);
  /** Oculta las iniciales cuando el avatar es grande y ya hay nombre al lado. */
  sinIniciales = input(false);

  private hash = computed(() => {
    const s = this.nombre() || '?';
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  });

  fondo = computed(() => `linear-gradient(150deg, hsl(${this.hash()} 12% 14%), var(--negro-900))`);
  tinta = computed(() => `hsl(${this.hash()} 22% 30%)`);

  iniciales = computed(() => {
    if (this.sinIniciales() || this.tam() < 34) return '';
    return (this.nombre() || '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  });
}

/* ==========================================================================
   BARRA DE STAT — un valor sobre un máximo (5 por defecto); la usa la Evaluación MMA
   ========================================================================== */

@Component({
  selector: 'cb-stat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="stat">
      <div class="cabeza">
        <span class="etiqueta">{{ nombre() }}</span>
        <span class="valor mono">{{ valor() }}<span class="de">/{{ max() }}</span></span>
      </div>
      <div class="barra-pista">
        <div class="barra-valor" [style.width.%]="pct()"></div>
      </div>
    </div>
  `,
  styles: [
    `
      .stat {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .cabeza {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .valor {
        font-family: 'Oswald', sans-serif;
        font-weight: 600;
        font-size: 0.95rem;
        color: var(--rojo-claro);
      }
      .de {
        color: var(--texto-tenue);
        font-size: 0.72rem;
      }
    `,
  ],
})
export class StatComponent {
  nombre = input.required<string>();
  valor = input.required<number>();
  max = input(5);
  pct = computed(() => Math.min(100, (this.valor() / this.max()) * 100));
}

/* ==========================================================================
   SEMÁFORO DE PAGO — verde / amarillo / rojo
   ========================================================================== */

@Component({
  selector: 'cb-semaforo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="chip" [class]="clase()">
      <span class="punto"></span>
      {{ texto() }}
    </span>
  `,
  styles: [
    `
      .punto {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 8px currentColor;
      }
    `,
  ],
})
export class SemaforoComponent {
  estado = input.required<EstadoPago>();
  dias = input<number | null>(null);

  clase = computed(() => {
    switch (this.estado()) {
      case 'AL_CORRIENTE':
        return 'chip-verde';
      case 'POR_VENCER':
        return 'chip-amarillo';
      case 'VENCIDO':
        return 'chip-rojo';
      default:
        return 'chip-gris';
    }
  });

  texto = computed(() => {
    const d = this.dias();
    switch (this.estado()) {
      case 'AL_CORRIENTE':
        return d !== null ? `Al corriente · ${d} días` : 'Al corriente';
      case 'POR_VENCER':
        return d === 0 ? 'Vence hoy' : `Vence en ${d} días`;
      case 'VENCIDO':
        return d !== null ? `Vencido hace ${Math.abs(d)} días` : 'Vencido';
      default:
        return 'Sin pagos';
    }
  });
}

/* ==========================================================================
   TARJETA KPI — para los dashboards
   ========================================================================== */

@Component({
  selector: 'cb-kpi',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="kpi tarjeta" [class.alerta]="alerta()">
      <span class="etiqueta">{{ etiqueta() }}</span>
      <span class="numero mono">{{ valor() }}</span>
      @if (pie()) {
        <span class="pie mini tenue">{{ pie() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .kpi {
        display: flex;
        flex-direction: column;
        gap: 2px;
        border-left: 3px solid var(--rojo);
      }
      .kpi.alerta {
        border-left-color: var(--rojo-alerta);
        background: rgba(220, 38, 38, 0.07);
      }
      .numero {
        font-family: 'Oswald', sans-serif;
        font-size: 1.9rem;
        font-weight: 600;
        line-height: 1.1;
      }
    `,
  ],
})
export class KpiComponent {
  etiqueta = input.required<string>();
  valor = input.required<string | number>();
  pie = input<string>('');
  alerta = input(false);
}

/* ==========================================================================
   MODAL
   ========================================================================== */

@Component({
  selector: 'cb-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="modal-fondo" (click)="cerrar.emit()">
      <div
        class="modal-caja"
        [class.amplia]="amplio()"
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
      >
        <div class="modal-cabeza">
          <h3>{{ titulo() }}</h3>
          <button class="cerrar-x" type="button" (click)="cerrar.emit()" aria-label="Cerrar">
            &times;
          </button>
        </div>
        <div class="modal-cuerpo">
          <ng-content></ng-content>
        </div>
        <div class="modal-pie">
          <ng-content select="[pie]"></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class ModalComponent {
  titulo = input('');
  /** Caja ancha (formularios largos, como la evaluación MMA por habilidad). */
  amplio = input(false);
  cerrar = output<void>();
}

/* ==========================================================================
   ESTADOS: cargando, vacío, error
   ========================================================================== */

@Component({
  selector: 'cb-cargando',
  standalone: true,
  template: `
    <div class="carga">
      <div class="anillo"></div>
      <span class="mini tenue">{{ texto() }}</span>
    </div>
  `,
  styles: [
    `
      .carga {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 44px 16px;
      }
      .anillo {
        width: 30px;
        height: 30px;
        border: 3px solid var(--negro-600);
        border-top-color: var(--rojo);
        border-radius: 50%;
        animation: giro 0.8s linear infinite;
      }
      @keyframes giro {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class CargandoComponent {
  texto = input('Cargando');
}

@Component({
  selector: 'cb-vacio',
  standalone: true,
  template: `
    <div class="vacio">
      <div class="icono">{{ icono() }}</div>
      <p class="titulo">{{ titulo() }}</p>
      @if (detalle()) {
        <p class="mini tenue">{{ detalle() }}</p>
      }
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      .vacio {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 42px 16px;
        text-align: center;
      }
      .icono {
        font-size: 2rem;
        opacity: 0.4;
        margin-bottom: 4px;
      }
      .titulo {
        font-family: 'Oswald', sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--texto-suave);
        margin: 0;
      }
      p {
        margin: 0;
      }
    `,
  ],
})
export class VacioComponent {
  icono = input('—');
  titulo = input('Nada por aquí');
  detalle = input('');
}

/* ==========================================================================
   PAGINADOR
   ========================================================================== */

@Component({
  selector: 'cb-paginador',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (total() > porPagina()) {
      <div class="pag">
        <button class="btn btn-mini" [disabled]="pagina() <= 1" (click)="ir.emit(pagina() - 1)">
          Anterior
        </button>
        <span class="mini tenue mono">
          {{ pagina() }} de {{ totalPaginas() }} · {{ total() }} registros
        </span>
        <button
          class="btn btn-mini"
          [disabled]="pagina() >= totalPaginas()"
          (click)="ir.emit(pagina() + 1)"
        >
          Siguiente
        </button>
      </div>
    }
  `,
  styles: [
    `
      .pag {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 14px 0;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class PaginadorComponent {
  pagina = input(1);
  total = input(0);
  porPagina = input(25);
  ir = output<number>();
  totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / this.porPagina())));
}
