import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComprobantePago } from './comprobante-pago';

describe('ComprobantePago: el comprobante del correo dentro de la app', () => {
  let fixture: ComponentFixture<ComprobantePago>;
  let http: HttpTestingController;
  let guardados: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComprobantePago],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ComprobantePago);
    guardados = [];
    fixture.componentInstance.guardar = (_pdf, nombre) => guardados.push(nombre);
    fixture.componentRef.setInput('pagoId', 55);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('muestra el HTML del backend en un iframe sin scripts y descarga el PDF', async () => {
    http.expectOne((r) => r.url.endsWith('/pagos/55/comprobante/')).flush('<p>TOTAL $2,100.00</p>');
    await fixture.whenStable();
    fixture.detectChanges();

    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('srcdoc')).toContain('$2,100.00');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');

    fixture.componentInstance.descargarPdf();
    http
      .expectOne((r) => r.url.includes('/pagos/55/comprobante/') && r.params.get('formato') === null && r.url.includes('formato=pdf'))
      .flush(new Blob(['%PDF'], { type: 'application/pdf' }));
    expect(guardados).toEqual(['comprobante-000055.pdf']);
  });

  it('si falla la carga lo dice', async () => {
    http.expectOne((r) => r.url.endsWith('/pagos/55/comprobante/')).flush('x', { status: 500, statusText: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('No se pudo cargar');
  });
});
