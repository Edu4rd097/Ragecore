import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EvaluacionMMA } from '../core/models';
import { EvaluacionMMAForm } from './evaluacion-mma-form';
import { CATALOGO_MOCK, evaluacionMock } from './evaluacion-mma.mocks';

describe('EvaluacionMMAForm', () => {
  let fixture: ComponentFixture<EvaluacionMMAForm>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvaluacionMMAForm],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EvaluacionMMAForm);
    fixture.componentRef.setInput('alumnoId', 7);
  });

  afterEach(() => http.verify());

  /** Deja el formulario listo con el catálogo cargado. */
  async function conCatalogo(evaluacion: EvaluacionMMA | null = null) {
    fixture.componentRef.setInput('evaluacion', evaluacion);
    fixture.detectChanges();
    http
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/categorias-mma/'))
      .flush({ count: 2, next: null, previous: null, results: CATALOGO_MOCK });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function botonFinalizar(): HTMLButtonElement {
    return el().querySelector('.btn-rojo') as HTMLButtonElement;
  }

  it('carga el catálogo y pinta una fila con 5 botones por habilidad', async () => {
    await conCatalogo();
    expect(el().querySelectorAll('.habilidad').length).toBe(3);
    expect(el().querySelectorAll('.habilidad .chip').length).toBe(15);
    expect(el().textContent).toContain('0 / 3 habilidades calificadas');
    expect(botonFinalizar().disabled).toBe(true);
  });

  it('no deja finalizar hasta calificar todas las habilidades', async () => {
    await conCatalogo();
    const c = fixture.componentInstance;

    c.calificar(11, 4);
    fixture.detectChanges();
    expect(c.calificadas()).toBe(1);
    expect(c.completa()).toBe(false);
    expect(botonFinalizar().disabled).toBe(true);

    // Validación de UX: mensaje claro y ninguna llamada al backend.
    c.guardar('FINALIZADA');
    fixture.detectChanges();
    expect(c.error()).toContain('Faltan 2 habilidades');
    http.expectNone((r) => r.method === 'POST');

    c.calificar(12, 5);
    c.calificar(21, 2);
    fixture.detectChanges();
    expect(c.completa()).toBe(true);
    expect(botonFinalizar().disabled).toBe(false);
  });

  it('rechaza una fecha futura sin llamar al backend', async () => {
    await conCatalogo();
    const c = fixture.componentInstance;
    c.calificar(11, 3);
    c.fecha = '2999-01-01';
    c.guardar('BORRADOR');
    expect(c.error()).toContain('futura');
    http.expectNone((r) => r.method === 'POST');
  });

  it('manda la evaluación completa al backend y emite el resultado', async () => {
    await conCatalogo();
    const c = fixture.componentInstance;
    const emitida: EvaluacionMMA[] = [];
    c.guardado.subscribe((e) => emitida.push(e));

    c.fecha = '2026-08-01';
    c.notas = 'Sólido';
    // Simula los clics en los botones 1-5 de cada fila.
    const botones = el().querySelectorAll('.habilidad');
    (botones[0].querySelectorAll('.chip')[3] as HTMLButtonElement).click(); // Guardia = 4
    (botones[1].querySelectorAll('.chip')[4] as HTMLButtonElement).click(); // Jab = 5
    (botones[2].querySelectorAll('.chip')[1] as HTMLButtonElement).click(); // Asistencia = 2
    fixture.detectChanges();
    expect(el().textContent).toContain('3 / 3 habilidades calificadas');

    botonFinalizar().click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/evaluaciones-mma/'));
    expect(req.request.body).toEqual({
      alumno: 7,
      fecha: '2026-08-01',
      notas: 'Sólido',
      evaluador: null,
      estado: 'FINALIZADA',
      puntajes: [
        { habilidad: 11, puntaje: 4 },
        { habilidad: 12, puntaje: 5 },
        { habilidad: 21, puntaje: 2 },
      ],
    });

    const respuesta = evaluacionMock({ id: 99, puntaje_total: 73.5, nivel: 'Intermedio' });
    req.flush(respuesta);
    fixture.detectChanges();
    expect(emitida).toEqual([respuesta]);
    expect(c.guardando()).toBe(false);
  });

  it('guardar borrador permite una evaluación parcial', async () => {
    await conCatalogo();
    const c = fixture.componentInstance;
    c.calificar(11, 3);
    c.guardar('BORRADOR');
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body.estado).toBe('BORRADOR');
    expect(req.request.body.puntajes).toEqual([{ habilidad: 11, puntaje: 3 }]);
    req.flush(evaluacionMock({ estado: 'BORRADOR', completa: false }));
  });

  it('muestra el error del backend tal cual (validación de negocio en Django)', async () => {
    await conCatalogo();
    const c = fixture.componentInstance;
    c.calificar(11, 3);
    c.guardar('BORRADOR');
    http
      .expectOne((r) => r.method === 'POST')
      .flush(
        { fecha: ['Este alumno ya tiene una evaluación en esa fecha.'] },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();
    expect(c.error()).toBe('Este alumno ya tiene una evaluación en esa fecha.');
    expect(c.guardando()).toBe(false);
    expect(el().querySelector('.aviso-error')?.textContent).toContain('ya tiene una evaluación');
  });

  it('en modo edición precarga los puntajes y hace PATCH', async () => {
    await conCatalogo(evaluacionMock({ id: 5, notas: 'Original' }));
    const c = fixture.componentInstance;
    expect(c.puntajes()).toEqual({ 11: 3, 12: 3, 21: 3 });
    expect(c.notas).toBe('Original');
    expect(c.fecha).toBe('2026-08-01');
    expect(c.completa()).toBe(true);

    c.calificar(12, 5);
    c.guardar('FINALIZADA');
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/evaluaciones-mma/5/'));
    expect(req.request.body.puntajes).toContainEqual({ habilidad: 12, puntaje: 5 });
    req.flush(evaluacionMock({ id: 5 }));
  });

  it('avisa si el catálogo no carga', async () => {
    fixture.componentRef.setInput('evaluacion', null);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/categorias-mma/'))
      .flush({ detail: 'x' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toContain('catálogo');
    expect(el().querySelectorAll('.habilidad').length).toBe(0);
  });
});
