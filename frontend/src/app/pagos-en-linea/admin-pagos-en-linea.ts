import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { ApiService } from '../core/api.service';
import {
  AlumnoLista,
  CheckoutStripe,
  DashboardStripe,
  EstatusPagoStripe,
  Membresia,
  PagoStripe,
  SaldoStripe,
} from '../core/models';
import { BuscarAlumno } from '../shared/buscar-alumno';
import { claseEstatusStripe, esUrlSegura, mensajeErrorPago } from '../shared/pago-stripe';
import {
  CargandoComponent,
  KpiComponent,
  ModalComponent,
  PaginadorComponent,
  VacioComponent,
} from '../shared/ui';

/** Cada cuánto se pregunta a /payments/cambios/ por pagos nuevos o actualizados. */
export const INTERVALO_TIEMPO_REAL_MS = 5000;

const ESTATUS: { valor: EstatusPagoStripe; rotulo: string }[] = [
  { valor: 'PAGADO', rotulo: 'Pagado' },
  { valor: 'PENDIENTE', rotulo: 'Pendiente' },
  { valor: 'PROCESANDO', rotulo: 'Procesando' },
  { valor: 'FALLIDO', rotulo: 'Fallido' },
  { valor: 'CANCELADO', rotulo: 'Cancelado' },
  { valor: 'REEMBOLSADO', rotulo: 'Reembolsado' },
];

/**
 * Tablero de pagos en línea (Stripe) para el personal administrativo.
 *
 * - Tiempo real: carga /dashboard/ una vez y después consulta /cambios/ con
 *   el cursor que regresa el backend; si hubo cambios, refresca cifras y tabla.
 * - Liga de pago: genera un Checkout para un alumno (el precio lo pone el
 *   backend) y la deja lista para copiar y mandársela.
 * - Reembolso: solo se PIDE a Stripe; el estatus cambia cuando llega su webhook.
 */
@Component({
  selector: 'cb-admin-pagos-en-linea',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    KpiComponent,
    CargandoComponent,
    VacioComponent,
    PaginadorComponent,
    ModalComponent,
    BuscarAlumno,
  ],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <div>
          <h1 style="margin:0">Pagos en línea</h1>
          <a routerLink="/admin/pagos" class="mini">← Caja (pagos en recepción)</a>
        </div>
        <button class="btn btn-rojo" (click)="abrirLiga()" [disabled]="!listo()">
          + Generar liga de pago
        </button>
      </div>

      @if (cargando()) {
        <cb-cargando />
      } @else if (errorCarga()) {
        <p class="aviso aviso-error" role="alert">{{ errorCarga() }}</p>
      } @else if (dash(); as d) {
        <!-- ===== ESTADO DE LA CONEXIÓN ===== -->
        <section class="tarjeta conexion" [class.apagada]="!listo()">
          <div class="fila envuelve" style="gap:8px">
            <span class="chip" [class]="d.stripe.configurado ? 'chip-verde' : 'chip-rojo'">
              {{ d.stripe.configurado ? 'Stripe conectado' : 'Stripe sin configurar' }}
            </span>
            @if (d.stripe.configurado) {
              <span class="chip" [class]="d.stripe.modo === 'live' ? 'chip-verde' : 'chip-amarillo'">
                {{ d.stripe.modo === 'live' ? 'Modo real' : 'Modo prueba' }}
              </span>
            }
            <span class="chip" [class]="d.stripe.webhook_configurado ? 'chip-verde' : 'chip-rojo'">
              {{ d.stripe.webhook_configurado ? 'Webhook activo' : 'Webhook sin configurar' }}
            </span>
            <span class="crece"></span>
            <span class="mini tenue en-vivo" [class.pausado]="!enVivo()">
              <span class="punto" aria-hidden="true"></span>
              {{ enVivo() ? 'En vivo' : 'En pausa' }}
            </span>
          </div>
          <p class="mini tenue" style="margin:8px 0 0">
            @if (d.webhook.ultimo_evento; as ev) {
              Último evento de Stripe: <span class="mono">{{ ev.tipo }}</span> ·
              {{ ev.procesado_en | date: 'dd/MM HH:mm' }} · {{ d.webhook.eventos_24h }} en 24 h
            } @else {
              Todavía no llega ningún evento de Stripe.
            }
          </p>
          @if (!listo()) {
            <p class="mini" style="margin:8px 0 0">
              Faltan las llaves de Stripe en el <span class="mono">.env</span> del backend; mientras
              tanto los alumnos solo pueden pagar en recepción.
            </p>
          }
        </section>

        <!-- ===== CIFRAS ===== -->
        <div class="grid grid-4">
          <cb-kpi
            etiqueta="Cobrado hoy"
            [valor]="'$' + moneda(d.resumen.cobrado_hoy.total)"
            [pie]="d.resumen.cobrado_hoy.cantidad + ' pagos'"
          />
          <cb-kpi
            etiqueta="Cobrado este mes"
            [valor]="'$' + moneda(d.resumen.cobrado_mes.total)"
            [pie]="'Ticket promedio $' + moneda(d.resumen.ticket_promedio_mes)"
          />
          <cb-kpi
            etiqueta="Pendientes"
            [valor]="d.resumen.pendientes.cantidad"
            [pie]="'$' + moneda(d.resumen.pendientes.total) + ' por confirmar'"
          />
          <cb-kpi
            etiqueta="Conversión del mes"
            [valor]="d.resumen.tasa_conversion_mes + '%'"
            [pie]="'Reembolsado $' + moneda(d.resumen.reembolsado_mes.total)"
            [alerta]="d.resumen.reembolsado_mes.cantidad > 0"
          />
        </div>

        <div class="grid grid-2">
          <!-- Ingresos por membresía -->
          <section class="tarjeta">
            <h2 class="titulo-seccion">Por membresía este mes</h2>
            @if (d.por_membresia_mes.length) {
              <div class="pila" style="gap:10px">
                @for (m of d.por_membresia_mes; track m.membresia) {
                  <div>
                    <div class="fila-entre mini">
                      <span>{{ m.membresia__nombre }} · {{ m.cantidad }}</span>
                      <span class="mono">\${{ moneda(m.total) }}</span>
                    </div>
                    <div class="barra-pista">
                      <div class="barra-valor" [style.width.%]="porcentaje(m.total)"></div>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="mini tenue">Sin cobros en línea este mes.</p>
            }
          </section>

          <!-- Saldo: se consulta a Stripe bajo demanda -->
          <section class="tarjeta">
            <div class="fila-entre">
              <h2 class="titulo-seccion" style="margin:0">Saldo en Stripe</h2>
              <button
                class="btn btn-mini"
                (click)="consultarSaldo()"
                [disabled]="!listo() || cargandoSaldo()"
              >
                {{ cargandoSaldo() ? 'Consultando...' : saldo() ? 'Actualizar' : 'Consultar' }}
              </button>
            </div>
            <div aria-live="polite" style="margin-top:12px">
              @if (errorSaldo()) {
                <p class="aviso aviso-error" role="alert">{{ errorSaldo() }}</p>
              } @else if (saldo(); as s) {
                <dl class="saldo">
                  @for (b of s.disponible; track b.moneda) {
                    <div><dt>Disponible</dt><dd class="mono">\${{ moneda(b.monto) }} {{ b.moneda }}</dd></div>
                  }
                  @for (b of s.pendiente; track b.moneda) {
                    <div><dt>En tránsito</dt><dd class="mono">\${{ moneda(b.monto) }} {{ b.moneda }}</dd></div>
                  }
                </dl>
              } @else {
                <p class="mini tenue">Se consulta en vivo a la cuenta de Stripe.</p>
              }
            </div>
          </section>
        </div>

        <!-- ===== MOVIMIENTOS ===== -->
        <section class="tarjeta">
          <div class="fila-entre envuelve" style="margin-bottom:12px">
            <h2 class="titulo-seccion" style="margin:0">Movimientos</h2>
            <div class="campo" style="margin:0">
              <label for="fe-estatus" class="sr">Estatus</label>
              <select id="fe-estatus" [ngModel]="fEstatus()" (ngModelChange)="filtrar($event)">
                <option value="">Todos los estatus</option>
                @for (e of estatus; track e.valor) {
                  <option [value]="e.valor">{{ e.rotulo }}</option>
                }
              </select>
            </div>
          </div>

          @if (mensaje(); as m) {
            <p class="aviso" [class.aviso-ok]="m.ok" [class.aviso-error]="!m.ok" role="status">
              {{ m.texto }}
            </p>
          }

          @if (pagos().length) {
            <div class="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Alumno</th>
                    <th>Membresía</th>
                    <th>Monto</th>
                    <th>Estatus</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of pagos(); track p.id) {
                    <tr [class.recien]="recientes().has(p.id)">
                      <td class="mono">{{ p.creado_en | date: 'dd/MM HH:mm' }}</td>
                      <td>
                        <a [routerLink]="['/admin/alumnos', p.alumno]">{{ p.alumno_nombre }}</a>
                      </td>
                      <td>{{ p.membresia_nombre }}</td>
                      <td class="mono">\${{ p.monto }} {{ p.moneda }}</td>
                      <td>
                        <span class="chip" [class]="claseEstatus(p.estatus)" [title]="p.detalle_error">
                          {{ p.estatus_display }}
                        </span>
                      </td>
                      <td class="acciones">
                        @if (p.estatus === 'PENDIENTE' && p.checkout_url) {
                          <button class="btn btn-mini btn-fantasma" (click)="copiar(p.checkout_url)">
                            Copiar liga
                          </button>
                        }
                        @if (puedeReembolsar(p)) {
                          <button class="btn btn-mini btn-fantasma" (click)="aReembolsar.set(p)">
                            Reembolsar
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="cargarPagos($event)" />
          } @else {
            <cb-vacio icono="💳" titulo="Sin pagos en línea" />
          }
        </section>
      }
    </div>

    <!-- ===== GENERAR LIGA ===== -->
    @if (ligaAbierta()) {
      <cb-modal titulo="Generar liga de pago" (cerrar)="cerrarLiga()">
        @if (liga(); as l) {
          <div class="pila" style="gap:12px">
            <p class="aviso aviso-ok" role="status">
              Liga lista por <strong class="mono">\${{ moneda(l.monto) }} {{ l.moneda }}</strong>.
              Mándasela al alumno; vence en 24 h.
            </p>
            <div class="campo">
              <label for="gl-url">Liga de pago</label>
              <input id="gl-url" [value]="l.checkout_url" readonly (focus)="$any($event.target).select()" />
            </div>
            <p class="mini tenue">
              La membresía se renueva sola en cuanto Stripe confirme el cobro.
            </p>
          </div>
        } @else {
          <div class="pila" style="gap:12px">
            <div class="campo">
              <label for="gl-alumno">Alumno</label>
              <cb-buscar-alumno
                [alumno]="ligaAlumno()"
                (alumnoChange)="elegirAlumno($event)"
                inputId="gl-alumno"
              />
            </div>
            <div class="campo">
              <label for="gl-membresia">Membresía</label>
              <select
                id="gl-membresia"
                [ngModel]="ligaMembresia()"
                (ngModelChange)="ligaMembresia.set($event)"
              >
                <option [ngValue]="null" disabled>Elige una membresía</option>
                @for (m of membresias(); track m.id) {
                  <option [ngValue]="m.id">{{ m.nombre }} · \${{ m.precio }}</option>
                }
              </select>
            </div>
            <p class="mini tenue">El importe lo toma el sistema del catálogo de membresías.</p>
            <div aria-live="polite">
              @if (errorLiga()) {
                <p class="aviso aviso-error" role="alert">{{ errorLiga() }}</p>
              }
            </div>
          </div>
        }
        <!-- Pie aparte: un @if con varios nodos no se proyecta en el slot [pie] -->
        @if (liga(); as l) {
          <div pie>
            <button class="btn" (click)="cerrarLiga()">Cerrar</button>
            <button class="btn btn-rojo" (click)="copiar(l.checkout_url)">
              {{ copiado() ? '¡Copiada!' : 'Copiar liga' }}
            </button>
          </div>
        } @else {
          <div pie>
            <button class="btn" (click)="cerrarLiga()">Cancelar</button>
            <button
              class="btn btn-rojo"
              [disabled]="!ligaAlumno() || !ligaMembresia() || generando()"
              [attr.aria-busy]="generando()"
              (click)="generarLiga()"
            >
              {{ generando() ? 'Generando...' : 'Generar liga' }}
            </button>
          </div>
        }
      </cb-modal>
    }

    <!-- ===== CONFIRMAR REEMBOLSO ===== -->
    @if (aReembolsar(); as p) {
      <cb-modal titulo="Reembolsar pago" (cerrar)="aReembolsar.set(null)">
        <p>
          Se pedirá a Stripe el reembolso total de <strong class="mono">\${{ p.monto }} {{ p.moneda }}</strong>
          a <strong>{{ p.alumno_nombre }}</strong> ({{ p.membresia_nombre }}).
        </p>
        <p class="mini tenue">
          Cuando Stripe lo confirme, el pago de membresía se elimina y el alumno pierde los días que
          cubría. No se puede deshacer.
        </p>
        <div pie>
          <button class="btn" (click)="aReembolsar.set(null)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="reembolsando()" (click)="reembolsar(p)">
            {{ reembolsando() ? 'Solicitando...' : 'Reembolsar' }}
          </button>
        </div>
      </cb-modal>
    }
  `,
  styles: [
    `
      .conexion {
        border-left: 3px solid var(--verde);
      }
      .conexion.apagada {
        border-left-color: var(--rojo-alerta);
      }
      .en-vivo {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .punto {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--verde);
        box-shadow: 0 0 8px var(--verde);
        animation: latido 1.6s ease-in-out infinite;
      }
      .pausado .punto {
        background: var(--texto-tenue);
        box-shadow: none;
        animation: none;
      }
      @keyframes latido {
        50% {
          opacity: 0.35;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .punto {
          animation: none;
        }
      }
      .saldo {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .saldo div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .saldo dt {
        color: var(--texto-suave);
        font-size: 0.85rem;
      }
      .saldo dd {
        margin: 0;
        font-weight: 600;
      }
      .acciones {
        white-space: nowrap;
        text-align: right;
      }
      .acciones .btn + .btn {
        margin-left: 6px;
      }
      tr.recien td {
        animation: resalte 2.4s ease-out;
      }
      @keyframes resalte {
        from {
          background: rgba(0, 149, 255, 0.18);
        }
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class AdminPagosEnLinea {
  private api = inject(ApiService);
  private documento = inject(DOCUMENT);
  private destroyRef = inject(DestroyRef);

  readonly estatus = ESTATUS;

  cargando = signal(true);
  errorCarga = signal<string | null>(null);
  dash = signal<DashboardStripe | null>(null);
  listo = computed(() => this.dash()?.stripe.configurado ?? false);

  pagos = signal<PagoStripe[]>([]);
  pagina = signal(1);
  total = signal(0);
  fEstatus = signal<EstatusPagoStripe | ''>('');
  /** Filas que acaban de cambiar (se resaltan un momento). */
  recientes = signal<Set<number>>(new Set());
  mensaje = signal<{ ok: boolean; texto: string } | null>(null);

  saldo = signal<SaldoStripe | null>(null);
  cargandoSaldo = signal(false);
  errorSaldo = signal<string | null>(null);

  membresias = signal<Membresia[]>([]);
  ligaAbierta = signal(false);
  ligaAlumno = signal<AlumnoLista | null>(null);
  ligaMembresia = signal<number | null>(null);
  liga = signal<CheckoutStripe | null>(null);
  generando = signal(false);
  errorLiga = signal<string | null>(null);
  copiado = signal(false);

  aReembolsar = signal<PagoStripe | null>(null);
  reembolsando = signal(false);

  /** Solo se consulta /cambios/ con la pestaña visible: nadie mira un tablero oculto. */
  private visible = signal(this.documento.visibilityState !== 'hidden');
  enVivo = computed(() => this.visible() && this.cursor() !== null);
  private cursor = signal<string | null>(null);
  private sondeo: Subscription | null = null;
  private consultando = false;

  private maxMembresia = computed(() =>
    Math.max(1, ...(this.dash()?.por_membresia_mes ?? []).map((m) => Number(m.total))),
  );

  claseEstatus = claseEstatusStripe;

  constructor() {
    const alCambiarVisibilidad = () => this.visible.set(this.documento.visibilityState !== 'hidden');
    this.documento.addEventListener('visibilitychange', alCambiarVisibilidad);

    // Arranca/para el sondeo según visibilidad; al volver se pone al día de inmediato.
    effect(() => {
      if (this.enVivo()) {
        if (!this.sondeo) {
          this.buscarCambios();
          this.sondeo = interval(INTERVALO_TIEMPO_REAL_MS).subscribe(() => this.buscarCambios());
        }
      } else {
        this.sondeo?.unsubscribe();
        this.sondeo = null;
      }
    });

    this.destroyRef.onDestroy(() => {
      this.documento.removeEventListener('visibilitychange', alCambiarVisibilidad);
      this.sondeo?.unsubscribe();
    });

    this.cargarDashboard(true);
    this.cargarPagos(1);
    this.api.membresias({ page_size: 50 }).subscribe({
      next: (p) => this.membresias.set(p.results.filter((m) => parseFloat(m.precio) > 0)),
      error: () => {},
    });
  }

  // --- Carga y tiempo real --------------------------------------------------

  cargarDashboard(inicial = false): void {
    this.api.dashboardStripe().subscribe({
      next: (d) => {
        this.dash.set(d);
        if (inicial) this.cursor.set(d.cursor);
        this.cargando.set(false);
      },
      error: (err) => {
        if (inicial) {
          this.errorCarga.set(mensajeErrorPago(err, 'No se pudo cargar el tablero de pagos en línea.'));
          this.cargando.set(false);
        }
      },
    });
  }

  cargarPagos(pag = 1): void {
    this.api
      .pagosStripe({ page: pag, estatus: this.fEstatus() })
      .subscribe({
        next: (p) => {
          this.pagos.set(p.results);
          this.total.set(p.count);
          this.pagina.set(pag);
        },
        error: () => this.mensaje.set({ ok: false, texto: 'No se pudieron cargar los movimientos.' }),
      });
  }

  filtrar(estatus: EstatusPagoStripe | ''): void {
    this.fEstatus.set(estatus);
    this.cargarPagos(1);
  }

  /** Una consulta a /cambios/. Si otra sigue en vuelo se salta, para no encimarlas. */
  buscarCambios(): void {
    const desde = this.cursor();
    if (!desde || this.consultando) return;
    this.consultando = true;
    this.api.cambiosStripe(desde).subscribe({
      next: (c) => {
        this.consultando = false;
        this.cursor.set(c.cursor);
        if (!c.hay_cambios) return;
        this.aplicarCambios(c.pagos);
        this.cargarDashboard();
      },
      error: () => (this.consultando = false),
    });
  }

  /**
   * Upsert por id sobre la página visible. Los pagos nuevos solo se insertan
   * arriba en la página 1 y si pasan el filtro; el resto se ve al paginar.
   * Por el solape del cursor pueden repetirse filas ya vistas: se ignoran.
   */
  private aplicarCambios(cambios: PagoStripe[]): void {
    const actuales = new Map(this.pagos().map((p) => [p.id, p]));
    const nuevos: PagoStripe[] = [];
    const tocados = new Set<number>();
    const filtro = this.fEstatus();

    for (const c of cambios) {
      const previo = actuales.get(c.id);
      if (previo) {
        if (previo.actualizado_en !== c.actualizado_en) tocados.add(c.id);
        actuales.set(c.id, c);
      } else if (this.pagina() === 1 && (!filtro || filtro === c.estatus)) {
        nuevos.push(c);
        tocados.add(c.id);
      }
    }
    if (!tocados.size) return;

    const lista = [...nuevos, ...actuales.values()]
      .filter((p) => !filtro || p.estatus === filtro)
      // Mismo orden que el backend (-creado_en, -id).
      .sort((a, b) => b.creado_en.localeCompare(a.creado_en) || b.id - a.id);
    this.pagos.set(lista.slice(0, 25));
    this.total.update((t) => t + nuevos.length);
    this.recientes.set(tocados);
  }

  // --- Saldo -------------------------------------------------------------------

  consultarSaldo(): void {
    this.cargandoSaldo.set(true);
    this.errorSaldo.set(null);
    this.api.saldoStripe().subscribe({
      next: (s) => {
        this.saldo.set(s);
        this.cargandoSaldo.set(false);
      },
      error: (err) => {
        this.errorSaldo.set(mensajeErrorPago(err, 'Stripe no respondió. Intenta de nuevo.'));
        this.cargandoSaldo.set(false);
      },
    });
  }

  // --- Liga de pago -------------------------------------------------------------

  abrirLiga(): void {
    this.ligaAlumno.set(null);
    this.ligaMembresia.set(null);
    this.liga.set(null);
    this.errorLiga.set(null);
    this.copiado.set(false);
    this.ligaAbierta.set(true);
  }

  cerrarLiga(): void {
    this.ligaAbierta.set(false);
  }

  /** Al elegir alumno se propone su membresía actual (si es cobrable). */
  elegirAlumno(a: AlumnoLista | null): void {
    this.ligaAlumno.set(a);
    this.errorLiga.set(null);
    if (a?.membresia && this.membresias().some((m) => m.id === a.membresia)) {
      this.ligaMembresia.set(a.membresia);
    }
  }

  generarLiga(): void {
    const alumno = this.ligaAlumno();
    const membresia = this.ligaMembresia();
    if (!alumno || !membresia || this.generando()) return;
    this.generando.set(true);
    this.errorLiga.set(null);

    this.api.checkoutStripe({ alumno_id: alumno.id, membresia_id: membresia }).subscribe({
      next: (r) => {
        this.generando.set(false);
        if (!esUrlSegura(r.checkout_url)) {
          this.errorLiga.set('No se pudo generar la liga. Intenta nuevamente.');
          return;
        }
        this.liga.set(r);
        this.buscarCambios();
      },
      error: (err) => {
        this.generando.set(false);
        this.errorLiga.set(mensajeErrorPago(err, 'No se pudo generar la liga. Intenta nuevamente.'));
      },
    });
  }

  copiar(url: string): void {
    const listo = () => {
      this.copiado.set(true);
      this.mensaje.set({ ok: true, texto: 'Liga copiada al portapapeles.' });
    };
    const portapapeles = this.documento.defaultView?.navigator.clipboard;
    if (portapapeles) {
      portapapeles.writeText(url).then(listo, () => this.mensaje.set({ ok: false, texto: url }));
    } else {
      // Sin HTTPS no hay Clipboard API: se muestra para copiarla a mano.
      this.mensaje.set({ ok: false, texto: url });
    }
  }

  // --- Reembolso ------------------------------------------------------------------

  puedeReembolsar(p: PagoStripe): boolean {
    return p.estatus === 'PAGADO' && !!p.stripe_payment_intent_id;
  }

  reembolsar(p: PagoStripe): void {
    if (this.reembolsando()) return;
    this.reembolsando.set(true);
    this.api.reembolsarPagoStripe(p.id).subscribe({
      next: (r) => {
        this.reembolsando.set(false);
        this.aReembolsar.set(null);
        this.mensaje.set({ ok: true, texto: r.detail });
      },
      error: (err) => {
        this.reembolsando.set(false);
        this.aReembolsar.set(null);
        this.mensaje.set({ ok: false, texto: mensajeErrorPago(err, 'Stripe rechazó el reembolso.') });
      },
    });
  }

  // --- Formato ----------------------------------------------------------------------

  moneda(v: number | string | null | undefined): string {
    return Number(v ?? 0).toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  porcentaje(total: number | string): number {
    return Math.round((Number(total) / this.maxMembresia()) * 100);
  }
}
