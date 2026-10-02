import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EvaluacionMMAResumen } from './evaluacion-mma-resumen';
import { resumenMock } from './evaluacion-mma.mocks';

describe('EvaluacionMMAResumen', () => {
  let fixture: ComponentFixture<EvaluacionMMAResumen>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EvaluacionMMAResumen] }).compileComponents();
    fixture = TestBed.createComponent(EvaluacionMMAResumen);
  });

  function texto(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('muestra el estado vacío cuando no hay evaluación finalizada', async () => {
    fixture.componentRef.setInput('resumen', null);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('cb-vacio')).toBeTruthy();
    expect(texto()).toContain('Sin evaluación MMA');

    fixture.componentRef.setInput('resumen', resumenMock({ ultima: null, variacion: null }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('cb-vacio')).toBeTruthy();
  });

  it('pinta score, nivel, categorías y preparación tal como los calcula el backend', async () => {
    fixture.componentRef.setInput('resumen', resumenMock());
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.total')?.textContent?.replace(/\s/g, '')).toBe('60/100');

    const nivel = el.querySelector('.chip.nivel')!;
    expect(nivel.textContent?.trim()).toBe('Intermedio');
    expect(nivel.classList.contains('chip-amarillo')).toBe(true);

    // 2 categorías + 5 componentes de preparación = 7 barras
    expect(el.querySelectorAll('cb-stat').length).toBe(7);
    expect(texto()).toContain('Striking');
    expect(texto()).toContain('Disciplina');
    expect(el.querySelector('.total-prep')?.textContent?.replace(/\s/g, '')).toBe('60/100');
    expect(texto()).toContain('No autoriza a competir');
    expect(texto()).toContain('Coach BJJ');
  });

  it('muestra la variación con su signo', async () => {
    fixture.componentRef.setInput('resumen', resumenMock({ variacion: 8.5 }));
    await fixture.whenStable();
    fixture.detectChanges();
    const variacion = () => fixture.nativeElement.querySelector('.variacion') as HTMLElement;
    expect(variacion().textContent).toContain('▲ +8.5');
    expect(variacion().classList.contains('sube')).toBe(true);

    fixture.componentRef.setInput('resumen', resumenMock({ variacion: -3 }));
    fixture.detectChanges();
    expect(variacion().textContent).toContain('▼ -3');
    expect(variacion().classList.contains('baja')).toBe(true);

    fixture.componentRef.setInput('resumen', resumenMock({ variacion: null }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.variacion')).toBeNull();
  });
});
