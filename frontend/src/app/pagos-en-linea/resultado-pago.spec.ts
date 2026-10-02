import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { PagoStripe } from '../core/models';
import { INTERVALO_MS, MAX_CONSULTAS, PagoExitoso } from './resultado-pago';

function pagoStripe(extra: Partial<PagoStripe> = {}): PagoStripe {
  return {
    id: 1,
    referencia: 'abcd1234-0000-0000-0000-000000000000',
    alumno: 9,
    alumno_nombre: 'Pedro Solo',
    membresia: 3,
    membresia_nombre: 'Mensualidad Básica',
    monto: '800.00',
    moneda: 'MXN',
    estatus: 'PENDIENTE',
    estatus_display: 'Pendiente',
    checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    stripe_checkout_session_id: 'cs_test_1',
    stripe_payment_intent_id: null,
    pago: null,
    pagado_en: null,
    detalle_error: '',
    creado_en: '2026-09-23T10:00:00Z',
    actualizado_en: '2026-09-23T10:00:00Z',
    ...extra,
  };
}

async function montar(sessionId: string | null) {
  await TestBed.configureTestingModule({
    imports: [PagoExitoso],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(sessionId ? { session_id: sessionId } : {}) },
        },
      },
    ],
  }).compileComponents();
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(PagoExitoso);
  fixture.detectChanges();
  return { fixture, http, texto: () => fixture.nativeElement.textContent as string };
}

const esSesion = (r: { url: string }) => r.url.endsWith('/payments/sesion/');

describe('PagoExitoso: /payment/success solo consulta, nunca activa', () => {
  afterEach(() => vi.useRealTimers());

  it('sin session_id no consulta nada y lo dice', async () => {
    const { fixture, http, texto } = await montar(null);
    fixture.detectChanges();
    http.expectNone(esSesion);
    expect(texto()).toContain('No encontramos una sesión de pago válida');
    http.verify();
  });

  it('muestra "Pago confirmado" solo cuando el backend dice PAGADO', async () => {
    const { fixture, http, texto } = await montar('cs_test_1');
    const req = http.expectOne(esSesion);
    expect(req.request.params.get('session_id')).toBe('cs_test_1');
    req.flush(pagoStripe({ estatus: 'PAGADO', estatus_display: 'Pagado' }));
    fixture.detectChanges();
    expect(texto()).toContain('Pago confirmado');
    expect(texto()).toContain('Mensualidad Básica');
    http.verify();
  });

  it('reintenta mientras siga PENDIENTE, con un tope de consultas', async () => {
    const { fixture, http, texto } = await montar('cs_test_1');
    vi.useFakeTimers();

    for (let i = 1; i < MAX_CONSULTAS; i++) {
      http.expectOne(esSesion).flush(pagoStripe());
      fixture.detectChanges();
      expect(texto()).toContain('Verificando pago');
      vi.advanceTimersByTime(INTERVALO_MS);
    }
    // La última consulta también sale PENDIENTE: ya no hay más reintentos.
    http.expectOne(esSesion).flush(pagoStripe());
    fixture.detectChanges();
    vi.advanceTimersByTime(INTERVALO_MS * 3);
    http.expectNone(esSesion);
    expect(texto()).toContain('Pago pendiente');
    http.verify();
  });

  it('deja de consultar en cuanto llega el webhook (PAGADO)', async () => {
    const { fixture, http, texto } = await montar('cs_test_1');
    vi.useFakeTimers();
    http.expectOne(esSesion).flush(pagoStripe());
    vi.advanceTimersByTime(INTERVALO_MS);
    http.expectOne(esSesion).flush(pagoStripe({ estatus: 'PAGADO' }));
    fixture.detectChanges();
    vi.advanceTimersByTime(INTERVALO_MS * 3);
    http.expectNone(esSesion);
    expect(texto()).toContain('Pago confirmado');
    http.verify();
  });

  it('una sesión ajena o inexistente (404) se trata como inválida', async () => {
    const { fixture, http, texto } = await montar('cs_de_otro');
    http.expectOne(esSesion).flush({ detail: 'No encontrado.' }, { status: 404, statusText: 'x' });
    fixture.detectChanges();
    expect(texto()).toContain('No encontramos una sesión de pago válida');
    http.verify();
  });
});
