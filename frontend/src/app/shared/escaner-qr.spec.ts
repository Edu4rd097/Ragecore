import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EscanerQr } from './escaner-qr';

describe('EscanerQr: lector de QR con la cámara', () => {
  let fixture: ComponentFixture<EscanerQr>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EscanerQr] }).compileComponents();
    fixture = TestBed.createComponent(EscanerQr);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('sin acceso a cámara (jsdom) avisa y ofrece teclear el código, sin romper', () => {
    const c = fixture.componentInstance;
    expect(c.estado()).toBe('sin-soporte');
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('cámara');
    expect(texto).toContain('teclea el código');
  });

  it('emite el código leído y descarta la relectura del mismo código durante la ventana antirrebote', () => {
    const c = fixture.componentInstance;
    const leidos: string[] = [];
    c.codigo.subscribe((v) => leidos.push(v));

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T10:00:00Z'));
    expect(c.procesar('  ALU-AAA111 ')).toBe(true);
    expect(c.procesar('ALU-AAA111')).toBe(false); // mismo QR, cuadro siguiente
    expect(c.procesar('ALU-BBB222')).toBe(true); // otro alumno sí pasa
    expect(c.procesar('   ')).toBe(false);

    vi.advanceTimersByTime(EscanerQr.ANTIRREBOTE_MS + 1);
    vi.setSystemTime(new Date('2026-09-09T10:00:03.001Z'));
    expect(c.procesar('ALU-BBB222')).toBe(true); // pasada la ventana, vuelve a valer
    vi.useRealTimers();

    expect(leidos).toEqual(['ALU-AAA111', 'ALU-BBB222', 'ALU-BBB222']);
  });

  it('detener() se puede llamar aunque no haya cámara', () => {
    expect(() => fixture.componentInstance.detener()).not.toThrow();
  });
});
