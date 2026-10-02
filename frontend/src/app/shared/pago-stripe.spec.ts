import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BotonPagoStripe, esUrlSegura, mensajeErrorPago } from './pago-stripe';

describe('BotonPagoStripe: manda a Stripe Checkout sin decidir el precio', () => {
  let fixture: ComponentFixture<BotonPagoStripe>;
  let http: HttpTestingController;
  let redirigido: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BotonPagoStripe],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BotonPagoStripe);
    redirigido = [];
    fixture.componentInstance.redirigir = (url) => redirigido.push(url);
    fixture.componentRef.setInput('membresiaId', 3);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const boton = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  it('solo manda el id de la membresía (nunca un monto) y redirige a la URL del backend', async () => {
    boton().click();
    const req = http.expectOne((r) => r.url.endsWith('/payments/checkout/'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ membresia_id: 3 });

    req.flush({ id: 1, referencia: 'x', checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1', monto: 800, moneda: 'MXN' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(redirigido).toEqual(['https://checkout.stripe.com/c/pay/cs_test_1']);
    expect(boton().disabled).toBe(true);
    expect(boton().textContent).toContain('Redirigiendo');
  });

  it('el doble clic no crea dos sesiones', async () => {
    boton().click();
    fixture.componentInstance.pagar();
    expect(http.match((r) => r.url.endsWith('/payments/checkout/')).length).toBe(1);
  });

  it('muestra el error del backend y deja reintentar', async () => {
    boton().click();
    http
      .expectOne((r) => r.url.endsWith('/payments/checkout/'))
      .flush({ detail: 'Los pagos en línea no están configurados.' }, { status: 503, statusText: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
      'no están configurados',
    );
    expect(boton().disabled).toBe(false);
    expect(redirigido).toEqual([]);
  });

  it('no sale de la app hacia una URL que no sea https', async () => {
    boton().click();
    http
      .expectOne((r) => r.url.endsWith('/payments/checkout/'))
      .flush({ id: 1, referencia: 'x', checkout_url: 'javascript:alert(1)', monto: 1, moneda: 'MXN' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(redirigido).toEqual([]);
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
  });
});

describe('mensajeErrorPago', () => {
  const err = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

  it('usa el detail o el primer mensaje de campo del backend', () => {
    expect(mensajeErrorPago(err(400, { membresia_id: 'La membresía no existe.' }))).toBe(
      'La membresía no existe.',
    );
    expect(mensajeErrorPago(err(502, { detail: 'No se pudo iniciar el pago con Stripe.' }))).toBe(
      'No se pudo iniciar el pago con Stripe.',
    );
  });

  it('nunca muestra el cuerpo de un 500', () => {
    expect(mensajeErrorPago(err(500, { detail: 'Traceback... database connection' }))).toBe(
      'No fue posible iniciar el pago. Intenta nuevamente.',
    );
  });

  it('explica el límite de intentos', () => {
    expect(mensajeErrorPago(err(429, { detail: 'Request was throttled.' }))).toContain('Espera un minuto');
  });
});

describe('esUrlSegura', () => {
  it('solo acepta https', () => {
    expect(esUrlSegura('https://checkout.stripe.com/x')).toBe(true);
    expect(esUrlSegura('http://checkout.stripe.com/x')).toBe(false);
    expect(esUrlSegura('javascript:alert(1)')).toBe(false);
    expect(esUrlSegura('')).toBe(false);
  });
});
