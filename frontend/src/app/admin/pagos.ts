import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AlumnoLista, Membresia, Pago, ResumenPagos, ResumenVentas, Venta } from '../core/models';
import { BuscarAlumno } from '../shared/buscar-alumno';
import { ComprobantePago } from '../shared/comprobante-pago';
import {
  CargandoComponent,
  KpiComponent,
  ModalComponent,
  PaginadorComponent,
  VacioComponent,
} from '../shared/ui';

type Vista = 'pagos' | 'ventas';

/**
 * Caja de la academia con DOS registros independientes:
 *  - Pagos de membresía (Pago): mueven vencimiento y semáforo del alumno.
 *  - Otras ventas (Venta): inscripción, equipo, bebidas... con su propio
 *    concepto; no tocan la membresía de nadie.
 */
@Component({
  selector: 'cb-admin-pagos',
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
    ComprobantePago,
  ],
  template: `
    <div class="pila">
      <div class="fila-entre envuelve">
        <h1 style="margin:0">Pagos</h1>
        <div class="fila envuelve" style="gap:8px">
          <button class="btn" (click)="abrirModalVenta()">+ Registrar venta</button>
          <button class="btn btn-rojo" (click)="abrirModalPago()">+ Pago de membresía</button>
        </div>
      </div>

      <!-- ===== RESUMEN DEL MES ===== -->
      @if (resumen(); as r) {
        <div class="grid grid-4">
          <cb-kpi
            etiqueta="Membresías este mes"
            [valor]="'$' + moneda(r.total_cobrado)"
            [pie]="r.numero_pagos + ' pagos'"
          />
          <cb-kpi
            etiqueta="Otras ventas este mes"
            [valor]="'$' + moneda(resumenVentas()?.total_vendido ?? 0)"
            [pie]="(resumenVentas()?.numero_ventas ?? 0) + ' ventas'"
          />
          <cb-kpi
            etiqueta="Total en caja"
            [valor]="'$' + moneda(totalCaja())"
            pie="Membresías + otras ventas"
          />
          <cb-kpi
            etiqueta="Historial vencidos"
            [valor]="r.vencidos_historico"
            [alerta]="r.vencidos_historico > 0"
          />
        </div>
      }

      <!-- ===== ALERTAS RÁPIDAS ===== -->
      <div class="grid grid-2">
        <a routerLink="/admin/alumnos" [queryParams]="{pago:'vencido'}" class="tarjeta alerta-card">
          <span class="chip chip-rojo">Pago vencido</span>
          <span class="mini">Ver lista de morosos →</span>
        </a>
        <a routerLink="/admin/alumnos" [queryParams]="{pago:'por-vencer'}" class="tarjeta alerta-card">
          <span class="chip chip-amarillo">Por vencer</span>
          <span class="mini">Ver alumnos a punto de vencer →</span>
        </a>
      </div>

      <!-- ===== PESTAÑAS: dos registros ===== -->
      <div class="pestanas" role="tablist">
        <button
          type="button"
          role="tab"
          [class.activa]="vista() === 'pagos'"
          [attr.aria-selected]="vista() === 'pagos'"
          (click)="cambiarVista('pagos')"
        >
          💳 Membresías
        </button>
        <button
          type="button"
          role="tab"
          [class.activa]="vista() === 'ventas'"
          [attr.aria-selected]="vista() === 'ventas'"
          (click)="cambiarVista('ventas')"
        >
          🛒 Otras ventas
        </button>
      </div>

      <!-- ===== FILTROS ===== -->
      <section class="tarjeta filtros">
        <div class="campo crece">
          <label for="falumno">{{ vista() === 'pagos' ? 'Alumno' : 'Concepto o alumno' }}</label>
          <input
            id="falumno"
            [(ngModel)]="fBusqueda"
            [placeholder]="vista() === 'pagos' ? 'Nombre del alumno' : 'Ej. inscripción, guantes, o el alumno'"
            (change)="recargar(1)"
            (keyup.enter)="recargar(1)"
          />
        </div>
        @if (vista() === 'pagos') {
          <div class="campo">
            <label for="festatus">Estatus</label>
            <select id="festatus" [(ngModel)]="fEstatus" (ngModelChange)="recargar(1)">
              <option value="">Todos</option>
              <option value="PAGADO">Pagado</option>
              <option value="VENCIDO">Vencido</option>
              <option value="PENDIENTE">Pendiente</option>
            </select>
          </div>
        }
        <div class="campo">
          <label for="fmetodo">Método</label>
          <select id="fmetodo" [(ngModel)]="fMetodo" (ngModelChange)="recargar(1)">
            <option value="">Todos</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TARJETA">Tarjeta</option>
            <option value="TRANSFERENCIA">Transferencia</option>
          </select>
        </div>
        <div class="campo">
          <label for="fdesde">Desde</label>
          <input id="fdesde" type="date" [(ngModel)]="fDesde" (change)="recargar(1)" />
        </div>
        <div class="campo">
          <label for="fhasta">Hasta</label>
          <input id="fhasta" type="date" [(ngModel)]="fHasta" (change)="recargar(1)" />
        </div>
        <button class="btn btn-mini btn-fantasma" (click)="limpiarFiltros()">Limpiar</button>
      </section>

      <!-- Desglose del mes por método (del registro activo) -->
      @if (porMetodo().length) {
        <div class="fila envuelve desglose">
          <span class="etiqueta">Este mes por método:</span>
          @for (m of porMetodo(); track m.metodo) {
            <span class="chip chip-gris">{{ m.metodo | titlecase }} · \${{ moneda(m.total) }} ({{ m.cantidad }})</span>
          }
        </div>
      }
      @if (vista() === 'ventas' && (resumenVentas()?.por_concepto?.length ?? 0) > 0) {
        <div class="fila envuelve desglose">
          <span class="etiqueta">Este mes por concepto:</span>
          @for (c of resumenVentas()!.por_concepto; track c.concepto) {
            <span class="chip chip-gris">{{ c.concepto }} · \${{ moneda(c.total) }} ({{ c.cantidad }})</span>
          }
        </div>
      }

      <!-- ===== TABLA ===== -->
      @if (cargando()) {
        <cb-cargando />
      } @else if (vista() === 'pagos') {
        @if (pagos().length) {
          <div class="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Membresía</th>
                  <th>Monto</th>
                  <th>Método</th>
                  <th>Fecha pago</th>
                  <th>Vence</th>
                  <th>Días restantes</th>
                  <th>Estatus</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (p of pagos(); track p.id) {
                  <tr>
                    <td>
                      <a [routerLink]="['/admin/alumnos', p.alumno]">{{ p.alumno_nombre }}</a>
                    </td>
                    <td class="mini">{{ nombreMembresia(p.membresia) }}</td>
                    <td class="mono">{{ +p.monto | currency: 'MXN' : 'symbol-narrow' }}</td>
                    <td class="mini">{{ p.metodo }}</td>
                    <td class="mono mini">{{ p.fecha_pago }}</td>
                    <td class="mono mini">{{ p.fecha_vencimiento ?? '—' }}</td>
                    <td class="mono">{{ diasRestantes(p) }}</td>
                    <td>
                      <span class="chip" [class]="claseEstatus(p.estatus)">
                        {{ p.estatus_display }}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-mini btn-fantasma" (click)="comprobante.set(p.id)">
                        Comprobante
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="recargar($event)" />
        } @else {
          <cb-vacio icono="💳" titulo="Sin pagos de membresía que coincidan" />
        }
      } @else {
        @if (ventas().length) {
          <div class="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Alumno</th>
                  <th>Monto</th>
                  <th>Método</th>
                  <th>Fecha</th>
                  <th>Registró</th>
                  <th>Nota</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (v of ventas(); track v.id) {
                  <tr>
                    <td><strong>{{ v.concepto }}</strong></td>
                    <td>
                      @if (v.alumno) {
                        <a [routerLink]="['/admin/alumnos', v.alumno]">{{ v.alumno_nombre }}</a>
                      } @else {
                        <span class="mini tenue">Externo</span>
                      }
                    </td>
                    <td class="mono">\${{ v.monto }}</td>
                    <td class="mini">{{ v.metodo_display }}</td>
                    <td class="mono mini">{{ v.fecha }}</td>
                    <td class="mini tenue">{{ v.registrado_por_nombre || '—' }}</td>
                    <td class="mini tenue">{{ v.nota || '—' }}</td>
                    <td>
                      <button class="btn btn-mini btn-fantasma" (click)="borrarVenta(v)" title="Eliminar venta">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="recargar($event)" />
        } @else {
          <cb-vacio
            icono="🛒"
            titulo="Sin otras ventas que coincidan"
            detalle="Aquí van inscripciones, equipo y todo lo que no sea membresía."
          />
        }
      }
    </div>

    <!-- ===== MODAL: PAGO DE MEMBRESÍA ===== -->
    @if (modalPago()) {
      <cb-modal titulo="Pago de membresía" (cerrar)="modalPago.set(false)">
        @if (errorModal()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ errorModal() }}</div>
        }

        <div class="campo">
          <label for="np-alumno">Alumno *</label>
          <cb-buscar-alumno [(alumno)]="alumnoPago" inputId="np-alumno" />
        </div>
        <div class="grid grid-2">
          <div class="campo">
            <label for="np-monto">Monto *</label>
            <input id="np-monto" type="number" step="0.01" [(ngModel)]="np.monto" />
          </div>
          <div class="campo">
            <label for="np-metodo">Método</label>
            <select id="np-metodo" [(ngModel)]="np.metodo">
              <option value="EFECTIVO">Efectivo</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
          </div>
          <div class="campo">
            <label for="np-fecha">Fecha del pago</label>
            <input id="np-fecha" type="date" [(ngModel)]="np.fecha_pago" />
          </div>
          <div class="campo">
            <label for="np-membresia">Membresía</label>
            <select id="np-membresia" [(ngModel)]="np.membresia" (ngModelChange)="sugerirMonto($event)">
              <option [ngValue]="null">La del alumno</option>
              @for (m of membresias(); track m.id) {
                <option [ngValue]="m.id">{{ m.nombre }} — \${{ m.precio }} · {{ m.duracion_dias }} días</option>
              }
            </select>
          </div>
        </div>
        <div class="campo">
          <label for="np-nota">Nota interna</label>
          <input id="np-nota" [(ngModel)]="np.nota" placeholder="Ej. abona 50%, resto a fin de mes" />
        </div>
        <p class="mini tenue">La fecha de vencimiento se calcula sola a partir de la membresía.</p>

        <div pie>
          <button class="btn" (click)="modalPago.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardarPago()">
            {{ guardando() ? 'Guardando...' : 'Registrar pago' }}
          </button>
        </div>
      </cb-modal>
    }

    <!-- ===== MODAL: OTRA VENTA ===== -->
    @if (modalVenta()) {
      <cb-modal titulo="Registrar venta" (cerrar)="modalVenta.set(false)">
        @if (errorModal()) {
          <div class="aviso aviso-error" style="margin-bottom:12px">{{ errorModal() }}</div>
        }
        <p class="mini tenue" style="margin-top:0">
          Para todo lo que no es membresía: inscripción, equipo, bebidas… No afecta el vencimiento del alumno.
        </p>

        <div class="campo">
          <label for="nv-concepto">Concepto *</label>
          <input
            id="nv-concepto"
            list="conceptos-venta"
            [(ngModel)]="nv.concepto"
            placeholder="Ej. Inscripción, Guantes 12 oz"
            autocomplete="off"
          />
          <datalist id="conceptos-venta">
            @for (c of conceptosSugeridos; track c) {
              <option [value]="c"></option>
            }
          </datalist>
        </div>
        <div class="grid grid-2">
          <div class="campo">
            <label for="nv-monto">Monto *</label>
            <input id="nv-monto" type="number" step="0.01" [(ngModel)]="nv.monto" />
          </div>
          <div class="campo">
            <label for="nv-metodo">Método</label>
            <select id="nv-metodo" [(ngModel)]="nv.metodo">
              <option value="EFECTIVO">Efectivo</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
          </div>
          <div class="campo">
            <label for="nv-fecha">Fecha</label>
            <input id="nv-fecha" type="date" [(ngModel)]="nv.fecha" />
          </div>
        </div>
        <div class="campo">
          <label for="nv-alumno">Alumno (opcional)</label>
          <cb-buscar-alumno
            [(alumno)]="alumnoVenta"
            inputId="nv-alumno"
            placeholder="Déjalo vacío si fue a un externo"
          />
        </div>
        <div class="campo">
          <label for="nv-nota">Nota</label>
          <input id="nv-nota" [(ngModel)]="nv.nota" placeholder="Ej. talla M, promo del mes" />
        </div>

        <div pie>
          <button class="btn" (click)="modalVenta.set(false)">Cancelar</button>
          <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardarVenta()">
            {{ guardando() ? 'Guardando...' : 'Registrar venta' }}
          </button>
        </div>
      </cb-modal>
    }

    @if (comprobante(); as id) {
      <cb-comprobante-pago [pagoId]="id" (cerrar)="comprobante.set(null)" />
    }
  `,
  styles: [
    `
      .filtros {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: flex-end;
      }
      .filtros .campo {
        margin: 0;
        min-width: 130px;
      }
      .filtros .campo.crece {
        flex: 1;
        min-width: 200px;
      }
      .alerta-card {
        display: flex;
        flex-direction: column;
        gap: 7px;
        text-decoration: none;
        color: var(--texto);
        transition: border-color 0.15s, background 0.15s;
        cursor: pointer;
      }
      .alerta-card:hover {
        border-color: var(--rojo);
        background: var(--negro-700);
      }
      a {
        color: var(--rojo-claro);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .pestanas {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--borde);
      }
      .pestanas button {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        color: var(--texto-suave);
        padding: 10px 14px;
        font-family: 'Oswald', sans-serif;
        font-size: 0.95rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        cursor: pointer;
      }
      .pestanas button:hover {
        color: var(--texto);
      }
      .pestanas button.activa {
        color: var(--texto);
        border-bottom-color: var(--rojo);
      }
      .desglose {
        gap: 6px;
        align-items: center;
      }
    `,
  ],
})
export class AdminPagos {
  private api = inject(ApiService);

  vista = signal<Vista>('pagos');
  pagos = signal<Pago[]>([]);
  ventas = signal<Venta[]>([]);
  membresias = signal<Membresia[]>([]);
  /** Id del pago cuyo comprobante está abierto. */
  comprobante = signal<number | null>(null);
  resumen = signal<ResumenPagos | null>(null);
  resumenVentas = signal<ResumenVentas | null>(null);

  cargando = signal(true);
  guardando = signal(false);
  modalPago = signal(false);
  modalVenta = signal(false);
  errorModal = signal('');

  pagina = signal(1);
  total = signal(0);

  fBusqueda = '';
  fEstatus = '';
  fMetodo = '';
  fDesde = '';
  fHasta = '';

  /** Alumno elegido en cada modal (lo llena <cb-buscar-alumno>). */
  alumnoPago = signal<AlumnoLista | null>(null);
  alumnoVenta = signal<AlumnoLista | null>(null);

  np = this.pagoVacio();
  nv = this.ventaVacia();

  /** Sugerencias del datalist; el concepto sigue siendo texto libre. */
  conceptosSugeridos = [
    'Inscripción',
    'Guantes',
    'Vendas',
    'Protector bucal',
    'Espinilleras',
    'Playera',
    'Gi / Kimono',
    'Bebida',
  ];

  totalCaja = computed(
    () =>
      Number(this.resumen()?.total_cobrado ?? 0) +
      Number(this.resumenVentas()?.total_vendido ?? 0),
  );

  /** Desglose por método del registro que se está viendo. */
  porMetodo = computed(
    () =>
      (this.vista() === 'pagos'
        ? this.resumen()?.por_metodo
        : this.resumenVentas()?.por_metodo) ?? [],
  );

  private pagoVacio() {
    return {
      monto: null as number | null,
      metodo: 'EFECTIVO',
      fecha_pago: new Date().toISOString().slice(0, 10),
      membresia: null as number | null,
      nota: '',
    };
  }

  private ventaVacia() {
    return {
      concepto: '',
      monto: null as number | null,
      metodo: 'EFECTIVO',
      fecha: new Date().toISOString().slice(0, 10),
      nota: '',
    };
  }

  claseEstatus(e: string): string {
    if (e === 'PAGADO') return 'chip-verde';
    if (e === 'VENCIDO') return 'chip-rojo';
    return 'chip-amarillo';
  }

  diasRestantes(p: Pago): string {
    if (!p.fecha_vencimiento) return '—';
    const dias = Math.ceil(
      (new Date(p.fecha_vencimiento).getTime() - Date.now()) / 86400000,
    );
    if (dias < 0) return `${Math.abs(dias)}d vencido`;
    return `${dias}d`;
  }

  moneda(v: number | string): string {
    return Number(v || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
  }

  nombreMembresia(id: number | null): string {
    if (id === null) return '—';
    return this.membresias().find((m) => m.id === id)?.nombre ?? '—';
  }

  /**
   * Al elegir una membresía, el monto toma su precio. Antes solo se llenaba si
   * estaba vacío: al cambiar de membresía se quedaba el precio de la anterior
   * (ej. "Clase" de 1 día con $2100 de un trimestral). Sigue siendo editable
   * para registrar abonos.
   */
  sugerirMonto(id: number | null): void {
    const m = this.membresias().find((x) => x.id === id);
    if (m) this.np.monto = parseFloat(m.precio);
  }

  cambiarVista(v: Vista): void {
    if (this.vista() === v) return;
    this.vista.set(v);
    this.fEstatus = '';
    this.recargar(1);
  }

  recargar(pag = 1): void {
    this.cargando.set(true);
    this.pagina.set(pag);
    const comunes = {
      page: pag,
      search: this.fBusqueda || undefined,
      metodo: this.fMetodo || undefined,
    };
    if (this.vista() === 'pagos') {
      this.api
        .pagos({
          ...comunes,
          estatus: this.fEstatus || undefined,
          fecha_pago__gte: this.fDesde || undefined,
          fecha_pago__lte: this.fHasta || undefined,
        })
        .subscribe({
          next: (p) => {
            this.pagos.set(p.results);
            this.total.set(p.count);
            this.cargando.set(false);
          },
          error: () => this.cargando.set(false),
        });
    } else {
      this.api
        .ventas({
          ...comunes,
          fecha__gte: this.fDesde || undefined,
          fecha__lte: this.fHasta || undefined,
        })
        .subscribe({
          next: (p) => {
            this.ventas.set(p.results);
            this.total.set(p.count);
            this.cargando.set(false);
          },
          error: () => this.cargando.set(false),
        });
    }
  }

  limpiarFiltros(): void {
    this.fBusqueda = '';
    this.fEstatus = '';
    this.fMetodo = '';
    this.fDesde = '';
    this.fHasta = '';
    this.recargar(1);
  }

  private refrescarResumenes(): void {
    forkJoin({
      pagos: this.api.resumenPagos(),
      ventas: this.api.resumenVentas(),
    }).subscribe((r) => {
      this.resumen.set(r.pagos);
      this.resumenVentas.set(r.ventas);
    });
  }

  // --- Pago de membresía ----------------------------------------------------

  abrirModalPago(): void {
    this.np = this.pagoVacio();
    this.alumnoPago.set(null);
    this.errorModal.set('');
    this.modalPago.set(true);
  }

  guardarPago(): void {
    const alumno = this.alumnoPago();
    if (!alumno || !this.np.monto) {
      this.errorModal.set('Alumno y monto son obligatorios.');
      return;
    }

    this.guardando.set(true);
    this.api
      .crearPago({
        alumno: alumno.id,
        monto: String(this.np.monto),
        metodo: this.np.metodo,
        fecha_pago: this.np.fecha_pago,
        membresia: this.np.membresia ?? undefined,
        nota: this.np.nota,
      } as never)
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.modalPago.set(false);
          this.vista.set('pagos');
          this.recargar(1);
          this.refrescarResumenes();
        },
        error: (e) => {
          this.guardando.set(false);
          this.errorModal.set(e?.error?.detail ?? 'No se pudo registrar el pago.');
        },
      });
  }

  // --- Otra venta -----------------------------------------------------------

  abrirModalVenta(): void {
    this.nv = this.ventaVacia();
    this.alumnoVenta.set(null);
    this.errorModal.set('');
    this.modalVenta.set(true);
  }

  guardarVenta(): void {
    const concepto = this.nv.concepto.trim();
    if (!concepto || !this.nv.monto || this.nv.monto <= 0) {
      this.errorModal.set('Concepto y monto (mayor a cero) son obligatorios.');
      return;
    }

    this.guardando.set(true);
    this.api
      .crearVenta({
        concepto,
        monto: String(this.nv.monto),
        metodo: this.nv.metodo,
        fecha: this.nv.fecha,
        alumno: this.alumnoVenta()?.id ?? null,
        nota: this.nv.nota,
      })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.modalVenta.set(false);
          this.vista.set('ventas');
          this.fEstatus = '';
          this.recargar(1);
          this.refrescarResumenes();
        },
        error: (e) => {
          this.guardando.set(false);
          const d = e?.error;
          this.errorModal.set(
            typeof d === 'object' && d
              ? Object.values(d).flat().join(' ')
              : 'No se pudo registrar la venta.',
          );
        },
      });
  }

  borrarVenta(v: Venta): void {
    if (!confirm(`¿Eliminar la venta "${v.concepto}" por $${v.monto}?`)) return;
    this.api.borrarVenta(v.id).subscribe({
      next: () => {
        this.recargar(this.pagina());
        this.refrescarResumenes();
      },
      error: () => alert('No se pudo eliminar la venta.'),
    });
  }

  constructor() {
    this.api.membresias({ page_size: 100 }).subscribe((p) => this.membresias.set(p.results));
    forkJoin({
      pagos: this.api.pagos({ page_size: 25 }),
      resumen: this.api.resumenPagos(),
      resumenVentas: this.api.resumenVentas(),
    }).subscribe({
      next: (r) => {
        this.pagos.set(r.pagos.results);
        this.total.set(r.pagos.count);
        this.resumen.set(r.resumen);
        this.resumenVentas.set(r.resumenVentas);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
