import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlumnoLista, Venta } from '../core/models';
import { AdminPagos } from './pagos';

function alumno(extra: Partial<AlumnoLista> = {}): AlumnoLista {
  return {
    id: 9,
    nombres: 'Pedro',
    apellidos: 'Solo',
    nombre_completo: 'Pedro Solo',
    apodo: 'Tanque',
    foto: null,
    activo: true,
    puntos: 0,
    record: '0-0-0',
    horario: null,
    horario_display: null,
    membresia: 1,
    membresia_nombre: 'Mensualidad Básica',
    al_corriente: false,
    dias_para_vencer: null,
    ...extra,
  };
}

function venta(extra: Partial<Venta> = {}): Venta {
  return {
    id: 3,
    concepto: 'Inscripción',
    monto: '200.00',
    metodo: 'EFECTIVO',
    metodo_display: 'Efectivo',
    fecha: '2026-09-09',
    alumno: 9,
    alumno_nombre: 'Pedro Solo',
    nota: '',
    registrado_por: 1,
    registrado_por_nombre: 'eduardo',
    creado_en: '2026-09-09T10:00:00Z',
    ...extra,
  };
}

function pagina<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

const resumenPagos = { periodo: '2026-09', total_cobrado: '800', numero_pagos: 1, por_metodo: [], vencidos_historico: 0 };
const resumenVentas = {
  periodo: '2026-09',
  total_vendido: '200',
  numero_ventas: 1,
  por_metodo: [{ metodo: 'EFECTIVO', total: '200', cantidad: 1 }],
  por_concepto: [{ concepto: 'Inscripción', total: '200', cantidad: 1 }],
};

describe('AdminPagos: dos registros de caja (membresías y otras ventas)', () => {
  let fixture: ComponentFixture<AdminPagos>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminPagos],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminPagos);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/membresias/')).flush(pagina([]));
    http.expectOne((r) => r.url.endsWith('/pagos/')).flush(pagina([]));
    http.expectOne((r) => r.url.endsWith('/pagos/resumen/')).flush(resumenPagos);
    http.expectOne((r) => r.url.endsWith('/ventas/resumen/')).flush(resumenVentas);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function flushResumenes() {
    http.expectOne((r) => r.url.endsWith('/pagos/resumen/')).flush(resumenPagos);
    http.expectOne((r) => r.url.endsWith('/ventas/resumen/')).flush(resumenVentas);
  }

  it('muestra membresías y otras ventas del mes por separado y su suma', () => {
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Membresías este mes');
    expect(texto).toContain('Otras ventas este mes');
    expect(texto).toContain('$1,000'); // total en caja = 800 + 200
  });

  it('al cambiar de membresía el monto toma el precio de la nueva (no se queda el anterior)', () => {
    const c = fixture.componentInstance;
    c.membresias.set([
      { id: 2, nombre: 'Trimestral', duracion_dias: 90, precio: '2100.00', descripcion: '' },
      { id: 11, nombre: 'Clase', duracion_dias: 1, precio: '150.00', descripcion: '' },
    ]);
    c.abrirModalPago();
    c.sugerirMonto(2);
    expect(c.np.monto).toBe(2100);
    c.sugerirMonto(11);
    expect(c.np.monto).toBe(150);
    // Un abono se sigue pudiendo capturar a mano.
    c.np.monto = 75;
    expect(c.np.monto).toBe(75);
  });

  it('no registra el pago sin alumno elegido', () => {
    const c = fixture.componentInstance;
    c.abrirModalPago();
    c.np.monto = 500;
    c.guardarPago();

    expect(c.errorModal()).toContain('Alumno y monto');
    http.expectNone((r) => r.method === 'POST');
  });

  it('al elegir un alumno manda su id en el POST del pago de membresía', async () => {
    const c = fixture.componentInstance;
    c.abrirModalPago();
    c.alumnoPago.set(alumno());
    c.np.monto = 500;
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('cb-modal .chip');
    expect(chip?.textContent).toContain('Pedro Solo');

    c.guardarPago();
    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/pagos/'));
    expect(req.request.body.alumno).toBe(9);
    expect(req.request.body.monto).toBe('500');
    req.flush({ id: 1 });

    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/pagos/')).flush(pagina([]));
    flushResumenes();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(c.modalPago()).toBe(false);
  });

  it('registra una venta con su propio concepto, sin alumno, y cambia a esa pestaña', async () => {
    const c = fixture.componentInstance;
    c.abrirModalVenta();
    c.nv.concepto = '  Guantes 12 oz ';
    c.nv.monto = 650;
    c.nv.metodo = 'TARJETA';
    c.guardarVenta();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/ventas/'));
    expect(req.request.body).toEqual(
      expect.objectContaining({ concepto: 'Guantes 12 oz', monto: '650', metodo: 'TARJETA', alumno: null }),
    );
    req.flush(venta({ id: 4, concepto: 'Guantes 12 oz', monto: '650.00', alumno: null, alumno_nombre: '' }));

    http
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/ventas/'))
      .flush(pagina([venta({ id: 4, concepto: 'Guantes 12 oz', monto: '650.00', alumno: null, alumno_nombre: '' })]));
    flushResumenes();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.vista()).toBe('ventas');
    expect(c.modalVenta()).toBe(false);
    const tabla = (fixture.nativeElement as HTMLElement).querySelector('table');
    expect(tabla?.textContent).toContain('Guantes 12 oz');
    expect(tabla?.textContent).toContain('Externo');
    http.expectNone((r) => r.url.endsWith('/pagos/') && r.method === 'POST');
  });

  it('rechaza la venta sin concepto o con monto cero', () => {
    const c = fixture.componentInstance;
    c.abrirModalVenta();
    c.nv.concepto = '';
    c.nv.monto = 100;
    c.guardarVenta();
    expect(c.errorModal()).toContain('Concepto y monto');
    c.nv.concepto = 'Vendas';
    c.nv.monto = 0;
    c.guardarVenta();
    expect(c.errorModal()).toContain('Concepto y monto');
    http.expectNone((r) => r.method === 'POST');
  });

  it('la pestaña Otras ventas consulta /ventas/ con su rango de fechas', async () => {
    const c = fixture.componentInstance;
    c.fDesde = '2026-09-01';
    c.cambiarVista('ventas');

    const req = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/ventas/'));
    expect(req.request.params.get('fecha__gte')).toBe('2026-09-01');
    expect(req.request.params.has('estatus')).toBe(false);
    req.flush(pagina([venta()]));
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Inscripción');
    expect(texto).toContain('Este mes por concepto');
  });
});
