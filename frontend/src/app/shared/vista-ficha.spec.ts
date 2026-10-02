import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { VistaFicha } from './vista-ficha';

describe('VistaFicha: la plantilla HTML de la ficha en un iframe', () => {
  let fixture: ComponentFixture<VistaFicha>;
  let http: HttpTestingController;

  async function montar(id: string) {
    await TestBed.configureTestingModule({
      imports: [VistaFicha],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VistaFicha);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('pide el HTML del alumno y lo pinta en un iframe sin scripts', async () => {
    await montar('14');
    const req = http.expectOne((r) => r.url.endsWith('/alumnos/14/ficha/'));
    expect(req.request.responseType).toBe('text');
    req.flush('<!doctype html><h1>EDUARDO</h1>');
    await fixture.whenStable();
    fixture.detectChanges();

    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('srcdoc')).toContain('EDUARDO');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
    // Con la ficha cargada aparecen Imprimir y Descargar.
    expect(fixture.nativeElement.textContent).toContain('Descargar ficha');
    expect(fixture.nativeElement.textContent).toContain('Imprimir');
  });

  it('una ficha fuera de su alcance (404) se explica sin romper', async () => {
    await montar('99');
    http
      .expectOne((r) => r.url.endsWith('/alumnos/99/ficha/'))
      .flush('No encontrado', { status: 404, statusText: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
      'no tienes acceso',
    );
    expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Descargar ficha');
  });

  it('un id que no es número no llega al backend', async () => {
    await montar('abc');
    http.expectNone(() => true);
    expect(fixture.nativeElement.textContent).toContain('No encontramos esa ficha');
  });
});
