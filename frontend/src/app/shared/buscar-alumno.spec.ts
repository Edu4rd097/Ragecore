import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlumnoLista } from '../core/models';
import { BuscarAlumno } from './buscar-alumno';

function alumno(extra: Partial<AlumnoLista> = {}): AlumnoLista {
  return {
    id: 9,
    nombres: 'Pedro',
    apellidos: 'Solo',
    nombre_completo: 'Pedro Solo',
    apodo: 'Tanque',
    foto: null,
    activo: true,
    puntos: 0,
    record: '0-0-0',
    horario: null,
    horario_display: null,
    membresia: 1,
    membresia_nombre: 'Mensualidad Básica',
    al_corriente: false,
    dias_para_vencer: null,
    ...extra,
  };
}

function pagina<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

describe('BuscarAlumno: buscador por nombre o apodo', () => {
  let fixture: ComponentFixture<BuscarAlumno>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BuscarAlumno],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BuscarAlumno);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('busca alumnos activos tras el debounce y lista los resultados', async () => {
    const c = fixture.componentInstance;

    // El buscador espera 300 ms antes de pedir al backend.
    vi.useFakeTimers();
    c.buscar('tanq');
    vi.advanceTimersByTime(300);
    vi.useRealTimers();

    const req = http.expectOne((r) => r.url.endsWith('/alumnos/'));
    expect(req.request.params.get('search')).toBe('tanq');
    expect(req.request.params.get('activo')).toBe('true');
    req.flush(pagina([alumno()]));
    await fixture.whenStable();
    fixture.detectChanges();

    const lista = (fixture.nativeElement as HTMLElement).querySelector('.lista-alumnos');
    expect(lista?.textContent).toContain('Pedro Solo');
    expect(lista?.textContent).toContain('Tanque');
    expect(lista?.textContent).toContain('Pago pendiente');
  });

  it('con texto vacío no consulta al backend', () => {
    fixture.componentInstance.buscar('   ');
    http.expectNone((r) => r.url.endsWith('/alumnos/'));
  });

  it('al elegir expone el alumno como chip y al quitar vuelve al buscador', () => {
    const c = fixture.componentInstance;
    c.elegir(alumno());
    fixture.detectChanges();
    expect(c.alumno()?.id).toBe(9);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.chip')?.textContent).toContain('Pedro Solo');
    expect(host.querySelector('input')).toBeNull();

    c.quitar();
    fixture.detectChanges();
    expect(c.alumno()).toBeNull();
    expect(host.querySelector('input')).not.toBeNull();
  });
});
