import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { EstatusPagoStripe, PagoStripe } from '../core/models';
import { LogoComponent } from '../shared/ui';

/** Reintentos mientras el webhook de Stripe llega al backend: 5 consultas, cada 2 s. */
export const MAX_CONSULTAS = 5;
export const INTERVALO_MS = 2000;

const ESTILOS_RESULTADO = `
  .resultado {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    position: relative;
    z-index: 1;
  }
  .caja {
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 28px 22px;
    border-top: 3px solid var(--rojo);
  }
  h1 {
    margin: 0;
    font-size: 1.45rem;
  }
  p {
    margin: 0;
  }
  .icono {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.8rem;
    margin-top: 8px;
    border: 2px solid var(--borde);
    color: var(--texto-suave);
  }
  .icono.ok {
    border-color: var(--verde);
    color: var(--verde);
    box-shadow: 0 0 22px rgba(22, 163, 74, 0.3);
  }
  .icono.espera {
    border-color: var(--amarillo);
  }
  .icono.mal {
    border-color: var(--rojo-alerta);
    color: var(--rojo-alerta);
  }
  .icono.giro {
    border-color: var(--rojo);
    color: var(--rojo-claro);
    box-shadow: 0 0 22px var(--rojo-glow);
  }
  .giro {
    animation: girar 1.1s linear infinite;
  }
  @keyframes girar {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .giro {
      animation: none;
    }
  }
  .btn-bloque {
    margin-top: 8px;
  }
`;

type Vista = 'verificando' | 'sin-sesion' | 'no-encontrado' | 'error' | EstatusPagoStripe;

/**
 * A donde regresa Stripe tras el cobro: /payment/success?session_id=cs_...
 *
 * Llegar aquí NO significa que se pagó (cualquiera puede escribir la URL):
 * la página solo le PREGUNTA al backend el estatus, que únicamente cambia
 * con el webhook firmado de Stripe. Nada se activa desde el frontend.
 */
@Component({
  selector: 'cb-pago-exitoso',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  template: `
    <main class="resultado">
      <section class="tarjeta caja" aria-live="polite" [attr.aria-busy]="vista() === 'verificando'">
        <cb-logo [tam]="40" />

        @switch (vista()) {
          @case ('verificando') {
            <div class="icono giro" aria-hidden="true">⟳</div>
            <h1>Verificando pago...</h1>
            <p class="tenue">Estamos confirmando tu pago con Stripe. No cierres esta ventana.</p>
          }
          @case ('PAGADO') {
            <div class="icono ok" aria-hidden="true">✓</div>
            <h1>Pago confirmado</h1>
            @if (pago(); as p) {
              <p>
                Tu membresía <strong>{{ p.membresia_nombre }}</strong> está activa.
              </p>
              <p class="mini tenue mono">
                \${{ p.monto }} {{ p.moneda }} · Ref. {{ referenciaCorta() }}
              </p>
            }
            <p class="mini tenue">Te enviamos el comprobante por correo.</p>
          }
          @case ('PROCESANDO') {
            <div class="icono espera" aria-hidden="true">⏳</div>
            <h1>Pago en proceso</h1>
            <p>
              Stripe recibió tu pago, pero el banco aún no lo confirma (pasa con OXXO o
              transferencia). Tu membresía se activa en cuanto llegue la confirmación.
            </p>
          }
          @case ('PENDIENTE') {
            <div class="icono espera" aria-hidden="true">⏳</div>
            <h1>Pago pendiente</h1>
            <p>
              Todavía no recibimos la confirmación de Stripe. Suele tardar unos segundos; revisa
              <strong>Mis pagos</strong> en un momento.
            </p>
            <button type="button" class="btn" (click)="consultar()">Volver a verificar</button>
          }
          @case ('FALLIDO') {
            <div class="icono mal" aria-hidden="true">✕</div>
            <h1>El pago no se completó</h1>
            <p>No se realizó ningún cargo a tu membresía. Puedes intentarlo de nuevo.</p>
          }
          @case ('CANCELADO') {
            <div class="icono mal" aria-hidden="true">✕</div>
            <h1>Pago cancelado</h1>
            <p>Esta sesión de pago se canceló o expiró. No se realizó ningún cargo.</p>
          }
          @case ('REEMBOLSADO') {
            <div class="icono" aria-hidden="true">↩</div>
            <h1>Pago reembolsado</h1>
            <p>Este pago se reembolsó. El dinero regresa a tu método de pago según tu banco.</p>
          }
          @case ('sin-sesion') {
            <div class="icono mal" aria-hidden="true">?</div>
            <h1>Sin sesión de pago</h1>
            <p role="alert">No encontramos una sesión de pago válida.</p>
          }
          @case ('no-encontrado') {
            <div class="icono mal" aria-hidden="true">?</div>
            <h1>Sin sesión de pago</h1>
            <p role="alert">No encontramos una sesión de pago válida para tu cuenta.</p>
          }
          @default {
            <div class="icono mal" aria-hidden="true">!</div>
            <h1>No pudimos verificar</h1>
            <p role="alert">
              No fue posible consultar el estado del pago. Si ya pagaste, no lo repitas: revisa
              <strong>Mis pagos</strong> en unos minutos.
            </p>
            <button type="button" class="btn" (click)="consultar()">Reintentar</button>
          }
        }

        <a class="btn btn-rojo btn-bloque" [routerLink]="rutaPagos()">{{ rotuloPagos() }}</a>
      </section>
    </main>
  `,
  styles: [ESTILOS_RESULTADO],
})
export class PagoExitoso {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private sessionId = inject(ActivatedRoute).snapshot.queryParamMap.get('session_id');

  vista = signal<Vista>('verificando');
  pago = signal<PagoStripe | null>(null);
  referenciaCorta = computed(() => this.pago()?.referencia.slice(0, 8).toUpperCase() ?? '');

  rutaPagos = computed(() => rutaPagos(this.auth.esAdmin()));
  rotuloPagos = computed(() => (this.auth.esAdmin() ? 'Ir a pagos en línea' : 'Ir a mis pagos'));

  private sondeo: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.sondeo?.unsubscribe());
    this.consultar();
  }

  /** Consulta el estatus; mientras siga PENDIENTE reintenta hasta MAX_CONSULTAS. Nunca en bucle infinito. */
  consultar(): void {
    this.sondeo?.unsubscribe();
    if (!this.sessionId) {
      this.vista.set('sin-sesion');
      return;
    }
    this.vista.set('verificando');
    let intento = 0;

    const pedir = () => {
      intento++;
      this.sondeo = this.api.pagoStripePorSesion(this.sessionId!).subscribe({
        next: (p) => {
          this.pago.set(p);
          if (p.estatus === 'PENDIENTE' && intento < MAX_CONSULTAS) {
            this.sondeo = timer(INTERVALO_MS).subscribe(pedir);
          } else {
            this.vista.set(p.estatus);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.vista.set(err.status === 404 || err.status === 400 ? 'no-encontrado' : 'error');
        },
      });
    };
    pedir();
  }
}

/**
 * A donde regresa Stripe si el usuario abandona el Checkout.
 * No toca nada: la sesión simplemente expira en Stripe sin cobrar.
 */
@Component({
  selector: 'cb-pago-cancelado',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  template: `
    <main class="resultado">
      <section class="tarjeta caja">
        <cb-logo [tam]="40" />
        <div class="icono" aria-hidden="true">←</div>
        <h1>Pago cancelado</h1>
        <p>No se realizó ningún cargo. Puedes volver a intentarlo cuando quieras.</p>
        <a class="btn btn-rojo btn-bloque" [routerLink]="rutaPagos()">{{ rotulo() }}</a>
      </section>
    </main>
  `,
  styles: [ESTILOS_RESULTADO],
})
export class PagoCancelado {
  private auth = inject(AuthService);
  rutaPagos = computed(() => rutaPagos(this.auth.esAdmin()));
  rotulo = computed(() => (this.auth.esAdmin() ? 'Volver a pagos en línea' : 'Volver a mis pagos'));
}

function rutaPagos(esAdmin: boolean): string {
  return esAdmin ? '/admin/pagos-en-linea' : '/mi/pagos';
}
