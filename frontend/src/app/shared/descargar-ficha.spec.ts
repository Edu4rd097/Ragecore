import { HttpHeaders, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DescargarFicha, nombreDeArchivo } from './descargar-ficha';

describe('DescargarFicha: baja la ficha técnica en PDF', () => {
  let fixture: ComponentFixture<DescargarFicha>;
  let http: HttpTestingController;
  let guardados: { nombre: string; tipo: string }[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DescargarFicha],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DescargarFicha);
    guardados = [];
    fixture.componentInstance.guardar = (pdf, nombre) => guardados.push({ nombre, tipo: pdf.type });
    fixture.componentRef.setInput('alumnoId', 14);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const boton = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  it('pide el PDF del alumno y lo guarda con el nombre que manda el backend', async () => {
    boton().click();
    fixture.detectChanges();
    expect(boton().disabled).toBe(true);
    expect(boton().textContent).toContain('Generando ficha');

    const req = http.expectOne((r) => r.url.endsWith('/alumnos/14/ficha-pdf/'));
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), {
      headers: { 'Content-Disposition': 'attachment; filename="ficha-el-tanque-14.pdf"' },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(guardados).toEqual([{ nombre: 'ficha-el-tanque-14.pdf', tipo: 'application/pdf' }]);
    expect(boton().disabled).toBe(false);
  });

  it('el doble clic no genera dos PDFs', () => {
    boton().click();
    fixture.componentInstance.descargar();
    expect(http.match((r) => r.url.endsWith('/ficha-pdf/')).length).toBe(1);
  });

  it('si falla, avisa y deja reintentar', async () => {
    boton().click();
    http
      .expectOne((r) => r.url.endsWith('/ficha-pdf/'))
      .flush(new Blob(), { status: 404, statusText: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
      'No se pudo generar la ficha',
    );
    expect(boton().disabled).toBe(false);
    expect(guardados).toEqual([]);
  });
});

describe('nombreDeArchivo', () => {
  it('sin Content-Disposition usa un nombre genérico', () => {
    const r = new HttpResponse<Blob>({ body: new Blob(), headers: new HttpHeaders() });
    expect(nombreDeArchivo(r, 7)).toBe('ficha-7.pdf');
  });
});
