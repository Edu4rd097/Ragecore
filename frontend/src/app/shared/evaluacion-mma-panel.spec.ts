import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EvaluacionMMAPanel } from './evaluacion-mma-panel';
import { HISTORIAL_MOCK, evaluacionMock, resumenMock } from './evaluacion-mma.mocks';

describe('EvaluacionMMAPanel', () => {
  let fixture: ComponentFixture<EvaluacionMMAPanel>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvaluacionMMAPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EvaluacionMMAPanel);
    fixture.componentRef.setInput('alumnoId', 7);
  });

  afterEach(() => http.verify());

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Responde las tres llamadas que hace el panel al arrancar. */
  function responderCarga(lista = [evaluacionMock()]) {
    http.expectOne((r) => r.url.endsWith('/alumnos/7/evaluacion-resumen/')).flush(resumenMock());
    http.expectOne((r) => r.url.endsWith('/alumnos/7/evaluacion-historial/')).flush(HISTORIAL_MOCK);
    http
      .expectOne((r) => r.url.endsWith('/evaluaciones-mma/') && r.params.get('alumno') === '7')
      .flush({ count: lista.length, next: null, previous: null, results: lista });
  }

  it('carga resumen, historial y lista del alumno indicado', async () => {
    fixture.detectChanges(); // dispara el effect -> cargar(7)
    expect(el().querySelector('cb-cargando')).toBeTruthy();

    responderCarga();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().querySelector('cb-cargando')).toBeNull();
    expect(el().querySelector('cb-evaluacion-mma-resumen')).toBeTruthy();
    expect(el().querySelector('cb-evaluacion-mma-historial')).toBeTruthy();
    expect(el().textContent).toContain('Evaluaciones registradas (1)');
    expect(el().querySelectorAll('table.lista-evaluaciones tbody tr').length).toBe(1);
    expect(el().textContent).toContain('Intermedio');
  });

  it('en solo lectura no ofrece crear ni editar', async () => {
    fixture.detectChanges();
    responderCarga();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).not.toContain('Nueva evaluación');
    expect(el().textContent).not.toContain('Editar');
  });

  it('editable: muestra acciones y abre el formulario en un modal', async () => {
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    responderCarga();
    await fixture.whenStable();
    fixture.detectChanges();

    const nueva = Array.from(el().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Nueva evaluación'),
    ) as HTMLButtonElement;
    expect(nueva).toBeTruthy();
    nueva.click();
    fixture.detectChanges();

    expect(el().querySelector('cb-modal')).toBeTruthy();
    expect(el().querySelector('cb-evaluacion-mma-form')).toBeTruthy();
    // El formulario pide su catálogo al abrirse.
    http.expectOne((r) => r.url.endsWith('/categorias-mma/')).flush({ count: 0, results: [] });
  });

  it('al hacer clic en una fila abre el detalle con el desglose por habilidad', async () => {
    fixture.detectChanges();
    responderCarga();
    await fixture.whenStable();
    fixture.detectChanges();

    (el().querySelector('table.lista-evaluaciones tbody tr') as HTMLElement).click();
    fixture.detectChanges();

    const modal = el().querySelector('cb-modal') as HTMLElement;
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Evaluación del 2026-08-01');
    expect(modal.textContent).toContain('Guardia');
    expect(modal.textContent).toContain('Jab');
    expect(modal.textContent).toContain('Buen avance');
    expect(modal.querySelectorAll('.cat-detalle').length).toBe(2);
  });

  it('si falla la carga muestra el error y permite reintentar', async () => {
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/alumnos/7/evaluacion-resumen/'))
      .flush({ detail: 'x' }, { status: 500, statusText: 'Error' });
    // forkJoin cancela las otras dos en cuanto una falla: solo se descartan
    // (match las saca de la lista de pendientes para que verify() no proteste).
    expect(http.match(() => true).every((r) => r.cancelled)).toBe(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.errorCarga()).toContain('No se pudo cargar');
    const reintentar = el().querySelector('.aviso-error button') as HTMLButtonElement;
    expect(reintentar).toBeTruthy();

    reintentar.click();
    fixture.detectChanges();
    responderCarga([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.errorCarga()).toBe('');
    expect(el().textContent).toContain('Todavía no hay evaluaciones registradas');
  });

  it('tras guardar recarga los datos y avisa', async () => {
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    responderCarga();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.nueva();
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/categorias-mma/')).flush({ count: 0, results: [] });

    fixture.componentInstance.guardadoOk(evaluacionMock({ id: 6, estado: 'FINALIZADA' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.modalForm()).toBe(false);
    expect(fixture.componentInstance.mensaje()).toBe('Evaluación finalizada.');
    responderCarga([evaluacionMock({ id: 6 }), evaluacionMock()]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().textContent).toContain('Evaluaciones registradas (2)');
  });
});
