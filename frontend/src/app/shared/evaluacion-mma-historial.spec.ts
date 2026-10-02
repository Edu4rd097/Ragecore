import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EvaluacionMMAHistorial } from './evaluacion-mma-historial';
import { HISTORIAL_MOCK, puntoHistorial } from './evaluacion-mma.mocks';

describe('EvaluacionMMAHistorial', () => {
  let fixture: ComponentFixture<EvaluacionMMAHistorial>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EvaluacionMMAHistorial] }).compileComponents();
    fixture = TestBed.createComponent(EvaluacionMMAHistorial);
  });

  it('sin puntos muestra el estado vacío y ninguna gráfica', async () => {
    fixture.componentRef.setInput('puntos', []);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('cb-vacio')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('dibuja un punto por evaluación y la línea que los une', async () => {
    fixture.componentRef.setInput('puntos', HISTORIAL_MOCK);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('svg circle').length).toBe(3);
    expect(el.querySelector('svg polyline')).toBeTruthy();

    const coords = fixture.componentInstance.coords();
    // Más puntaje = más arriba (y menor). 74 > 61 > 52.
    expect(coords[2].y).toBeLessThan(coords[1].y);
    expect(coords[1].y).toBeLessThan(coords[0].y);
    // El eje x avanza en el tiempo.
    expect(coords[0].x).toBeLessThan(coords[2].x);
  });

  it('con un solo punto no dibuja línea pero sí el punto centrado', async () => {
    fixture.componentRef.setInput('puntos', [puntoHistorial(9, '2026-01-10', 30, 'Principiante')]);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('svg circle').length).toBe(1);
    expect(el.querySelector('svg polyline')).toBeNull();
  });

  it('la tabla va de lo más reciente a lo más viejo y calcula el cambio', async () => {
    fixture.componentRef.setInput('puntos', HISTORIAL_MOCK);
    await fixture.whenStable();
    fixture.detectChanges();

    const filas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ) as HTMLElement[];
    expect(filas.length).toBe(3);
    expect(filas[0].textContent).toContain('2026-08-01');
    expect(filas[0].textContent).toContain('+13'); // 74 - 61
    expect(filas[2].textContent).toContain('2026-03-10');
    expect(filas[2].textContent).toContain('—'); // la primera no tiene anterior

    const cambios = fixture.componentInstance.filas().map((f) => f.cambio);
    expect(cambios).toEqual([13, 9, null]);
  });
});
