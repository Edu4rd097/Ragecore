import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { EstatusPagoStripe } from '../core/models';

/* ==========================================================================
   PAGOS EN LÍNEA — piezas compartidas (Stripe Checkout)
   El frontend solo pide "quiero pagar la membresía X": el backend pone el
   precio, crea la sesión y Stripe captura la tarjeta en su propia página.
   Nada de aquí activa una membresía; eso lo hace el webhook en el backend.
   ========================================================================== */

/**
 * Mensaje apto para mostrar al usuario. El backend ya responde en español y
 * sin detalles técnicos (detail o {campo: mensaje}); si no hay nada útil se
 * usa el genérico. Nunca se muestra el cuerpo crudo del error.
 */
export function mensajeErrorPago(
  err: unknown,
  generico = 'No fue posible iniciar el pago. Intenta nuevamente.',
): string {
  if (!(err instanceof HttpErrorResponse)) return generico;
  if (err.status === 0) return 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  if (err.status === 429) return 'Demasiados intentos seguidos. Espera un minuto e intenta de nuevo.';
  if (err.status >= 500 && err.status !== 502 && err.status !== 503) return generico;
  const cuerpo = err.error;
  if (cuerpo && typeof cuerpo === 'object') {
    if (typeof cuerpo.detail === 'string') return cuerpo.detail;
    for (const valor of Object.values(cuerpo)) {
      if (typeof valor === 'string') return valor;
      if (Array.isArray(valor) && typeof valor[0] === 'string') return valor[0];
    }
  }
  return generico;
}

export function esUrlSegura(url: string | null | undefined): boolean {
  try {
    return new URL(url ?? '').protocol === 'https:';
  } catch {
    return false;
  }
}

export function claseEstatusStripe(estatus: EstatusPagoStripe): string {
  switch (estatus) {
    case 'PAGADO':
      return 'chip-verde';
    case 'PENDIENTE':
    case 'PROCESANDO':
      return 'chip-amarillo';
    case 'FALLIDO':
      return 'chip-rojo';
    default:
      return 'chip-gris';
  }
}

type FaseBoton = 'listo' | 'conectando' | 'redirigiendo';

/**
 * Botón que manda al alumno a Stripe Checkout.
 *
 *   <cb-boton-pago-stripe />                        paga su membresía actual
 *   <cb-boton-pago-stripe [membresiaId]="m.id" />   paga otra membresía
 *
 * A propósito NO recibe un monto: el precio que se ve en pantalla es
 * informativo y el que se cobra sale de la BD.
 */
@Component({
  selector: 'cb-boton-pago-stripe',
  standalone: true,
  template: `
    <button
      type="button"
      class="btn btn-bloque"
      [class.btn-rojo]="principal()"
      [class.btn-fantasma]="!principal()"
      [disabled]="fase() !== 'listo'"
      [attr.aria-busy]="fase() !== 'listo'"
      (click)="pagar()"
    >
      @switch (fase()) {
        @case ('conectando') {
          Conectando con Stripe...
        }
        @case ('redirigiendo') {
          Redirigiendo...
        }
        @default {
          {{ texto() }}
        }
      }
    </button>
    <div aria-live="polite">
      @if (error(); as e) {
        <p class="aviso aviso-error" role="alert">{{ e }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
      .aviso {
        margin: 0;
      }
    `,
  ],
})
export class BotonPagoStripe {
  private api = inject(ApiService);

  /** Sin valor, el backend cobra la membresía que el alumno ya tiene. */
  membresiaId = input<number | null>(null);
  texto = input('Pagar en línea');
  /** Estilo del botón: principal (acento) o secundario (fantasma). */
  principal = input(true);

  fase = signal<FaseBoton>('listo');
  error = signal<string | null>(null);

  pagar(): void {
    // El disabled ya lo impide, pero un doble clic muy rápido puede colarse.
    if (this.fase() !== 'listo') return;
    this.fase.set('conectando');
    this.error.set(null);

    this.api.checkoutStripe({ membresia_id: this.membresiaId() }).subscribe({
      next: (r) => {
        // Solo se sale de la app hacia una página segura (la de Stripe).
        if (!esUrlSegura(r.checkout_url)) {
          this.fase.set('listo');
          this.error.set('No fue posible iniciar el pago. Intenta nuevamente.');
          return;
        }
        this.fase.set('redirigiendo');
        this.redirigir(r.checkout_url);
      },
      error: (err) => {
        this.fase.set('listo');
        this.error.set(mensajeErrorPago(err));
      },
    });
  }

  /** Aparte para poder sustituirlo en las pruebas (jsdom no navega). */
  redirigir(url: string): void {
    window.location.assign(url);
  }
}
