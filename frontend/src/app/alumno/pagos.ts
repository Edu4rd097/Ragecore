import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Alumno, Membresia, Pagina, Pago, PagoStripe, estadoPago } from '../core/models';
import { ComprobantePago } from '../shared/comprobante-pago';
import { BotonPagoStripe, claseEstatusStripe } from '../shared/pago-stripe';
import { CargandoComponent, ModalComponent, SemaforoComponent, VacioComponent } from '../shared/ui';

@Component({
  selector: 'cb-mis-pagos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SemaforoComponent,
    CargandoComponent,
    VacioComponent,
    ModalComponent,
    BotonPagoStripe,
    ComprobantePago,
  ],
  template: `
    @if (cargando()) {
      <cb-cargando />
    } @else if (alumno(); as a) {
      <div class="pila">
        <h1>Mis pagos</h1>

        <!-- Estado de cuenta -->
        <section class="tarjeta estado" [class.urgente]="semaforo() !== 'AL_CORRIENTE'">
          <span class="etiqueta">Estado de mi membresía</span>
          <cb-semaforo [estado]="semaforo()" [dias]="a.dias_para_vencer" />

          @if (a.fecha_vencimiento) {
            <p class="venc mono">
              Vence el <strong>{{ a.fecha_vencimiento }}</strong>
            </p>
          } @else {
            <p class="mini tenue">Todavía no tienes pagos registrados.</p>
          }

          @if (semaforo() !== 'AL_CORRIENTE') {
            <button class="btn btn-rojo btn-bloque" (click)="pagar.set(true)">Pagar ahora</button>
          } @else {
            <button class="btn btn-fantasma btn-bloque" (click)="pagar.set(true)">
              Adelantar mi próximo pago
            </button>
          }
        </section>

        <!-- Pagos en línea: el estatus lo pone el webhook de Stripe, no esta pantalla -->
        @if (pagosEnLinea().length) {
          <section class="tarjeta">
            <h2 class="titulo-seccion">Pagos en línea</h2>
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Membresía</th>
                    <th>Monto</th>
                    <th>Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of pagosEnLinea(); track p.id) {
                    <tr>
                      <td class="mono">{{ p.creado_en | date: 'yyyy-MM-dd' }}</td>
                      <td>{{ p.membresia_nombre }}</td>
                      <td class="mono">{{ +p.monto | currency: p.moneda : 'symbol-narrow' }} {{ p.moneda }}</td>
                      <td>
                        <span class="chip" [class]="claseStripe(p.estatus)">
                          {{ p.estatus_display }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (hayProcesando()) {
              <p class="mini tenue" style="margin-top:12px">
                Los pagos en proceso (OXXO, transferencia) se confirman solos cuando el banco los
                acredita; no los repitas.
              </p>
            }
          </section>
        }

        <!-- Historial -->
        <section class="tarjeta">
          <h2 class="titulo-seccion">Historial de pagos</h2>

          @if (pagos().length) {
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Monto</th>
                    <th>Método</th>
                    <th>Cubre hasta</th>
                    <th>Estatus</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of pagos(); track p.id) {
                    <tr>
                      <td class="mono">{{ p.fecha_pago }}</td>
                      <td class="mono">{{ +p.monto | currency: 'MXN' : 'symbol-narrow' }}</td>
                      <td>{{ p.metodo | titlecase }}</td>
                      <td class="mono">{{ p.fecha_vencimiento ?? '—' }}</td>
                      <td>
                        <span class="chip" [class]="claseEstatus(p.estatus)">
                          {{ p.estatus_display }}
                        </span>
                      </td>
                      <td>
                        <button class="btn btn-mini btn-fantasma" (click)="comprobante.set(p)">
                          Comprobante
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="mini tenue" style="margin-top:12px">
              Total pagado: <strong class="mono">{{ total() | currency: 'MXN' : 'symbol-narrow' }}</strong> en
              {{ pagos().length }} movimiento(s).
            </p>
          } @else {
            <cb-vacio icono="💳" titulo="Sin pagos registrados" />
          }
        </section>
      </div>

      <!-- Pago en línea: la tarjeta se captura en la página de Stripe, nunca aquí -->
      @if (pagar()) {
        <cb-modal titulo="Pagar mi membresía" (cerrar)="pagar.set(false)">
          @if (membresias().length) {
            <div class="pila" style="gap:12px">
              <div class="campo">
                <label for="pm-membresia">Membresía a pagar</label>
                <select
                  id="pm-membresia"
                  [ngModel]="membresiaId()"
                  (ngModelChange)="membresiaId.set($event)"
                >
                  @for (m of membresias(); track m.id) {
                    <option [ngValue]="m.id">{{ m.nombre }}</option>
                  }
                </select>
              </div>

              @if (membresiaElegida(); as m) {
                <div class="plan">
                  <div class="fila-entre">
                    <strong>{{ m.nombre }}</strong>
                    <span class="precio mono">\${{ m.precio }} MXN</span>
                  </div>
                  <span class="mini tenue">
                    {{ m.duracion_dias }} días{{ m.descripcion ? ' · ' + m.descripcion : '' }}
                  </span>
                </div>
                <!-- Solo manda el id: el importe real lo decide el backend -->
                <cb-boton-pago-stripe [membresiaId]="m.id" [texto]="'Pagar $' + m.precio + ' MXN'" />
              }

              <p class="mini tenue">
                Te llevamos a la página segura de Stripe para capturar tu tarjeta; la app nunca ve
                sus datos. Tu membresía se renueva en cuanto Stripe confirma el cobro. También
                puedes pagar en recepción.
              </p>
            </div>
          } @else {
            <p>
              No hay membresías disponibles para pagar en línea. Puedes liquidar en recepción
              (efectivo, tarjeta o transferencia).
            </p>
          }
          <div pie>
            <button class="btn" (click)="pagar.set(false)">Cerrar</button>
          </div>
        </cb-modal>
      }

      <!-- Comprobante: mismo diseño que el correo y el PDF -->
      @if (comprobante(); as c) {
        <cb-comprobante-pago [pagoId]="c.id" (cerrar)="comprobante.set(null)" />
      }
    }
  `,
  styles: [
    `
      .estado {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        border-left: 3px solid var(--verde);
      }
      .estado.urgente {
        border-left-color: var(--rojo);
      }
      .venc {
        margin: 0;
      }
      .plan {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 14px;
        border: 1px solid var(--borde);
        border-left: 3px solid var(--rojo);
        border-radius: var(--r-sm);
        background: var(--negro-900);
      }
      .precio {
        color: var(--rojo-claro);
        font-weight: 700;
      }
    `,
  ],
})
export class MisPagos {
  private api = inject(ApiService);

  alumno = signal<Alumno | null>(null);
  pagos = signal<Pago[]>([]);
  cargando = signal(true);
  pagar = signal(false);
  comprobante = signal<Pago | null>(null);
  pagosEnLinea = signal<PagoStripe[]>([]);
  membresias = signal<Membresia[]>([]);
  membresiaId = signal<number | null>(null);

  membresiaElegida = computed(
    () => this.membresias().find((m) => m.id === this.membresiaId()) ?? null,
  );
  hayProcesando = computed(() => this.pagosEnLinea().some((p) => p.estatus === 'PROCESANDO'));

  claseStripe = claseEstatusStripe;

  semaforo = computed(() =>
    estadoPago(this.alumno()?.al_corriente ?? false, this.alumno()?.dias_para_vencer ?? null),
  );

  total = computed(() => this.pagos().reduce((s, p) => s + parseFloat(p.monto || '0'), 0));

  claseEstatus(estatus: string): string {
    if (estatus === 'PAGADO') return 'chip-verde';
    if (estatus === 'VENCIDO') return 'chip-rojo';
    return 'chip-amarillo';
  }

  constructor() {
    // Pagos en línea y catálogo son accesorios: si fallan, la pantalla sigue.
    const vacia = <T>() => of<Pagina<T>>({ count: 0, next: null, previous: null, results: [] });
    forkJoin({
      alumno: this.api.yo(),
      pagos: this.api.pagos({ page_size: 100 }),
      enLinea: this.api.pagosStripe({ page_size: 20 }).pipe(catchError(() => vacia<PagoStripe>())),
      membresias: this.api.membresias({ page_size: 50 }).pipe(catchError(() => vacia<Membresia>())),
    }).subscribe({
      next: (r) => {
        this.alumno.set(r.alumno);
        this.pagos.set(r.pagos.results);
        this.pagosEnLinea.set(r.enLinea.results);
        const cobrables = r.membresias.results.filter((m) => parseFloat(m.precio) > 0);
        this.membresias.set(cobrables);
        // Por defecto la que ya tiene; si no tiene (o no es cobrable), la primera.
        const propia = cobrables.find((m) => m.id === r.alumno.membresia);
        this.membresiaId.set(propia?.id ?? cobrables[0]?.id ?? null);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
