import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlumnoLista, ResultadoCheckin } from '../core/models';
import { AdminAsistencia } from './asistencia';

function alumno(extra: Partial<AlumnoLista> = {}): AlumnoLista {
  return {
    id: 9,
    nombres: 'Pedro',
    apellidos: 'Solo',
    nombre_completo: 'Pedro Solo',
    apodo: 'Tanque',
    foto: null,
    activo: true,
    puntos: 40,
    record: '0-0-0',
    horario: 2,
    horario_display: 'Matutino 06:00-07:00 · Striking',
    membresia: 1,
    membresia_nombre: 'Mensualidad Básica',
    al_corriente: true,
    dias_para_vencer: 12,
    ...extra,
  };
}

function resultado(extra: Partial<ResultadoCheckin> = {}): ResultadoCheckin {
  return {
    detail: 'Asistencia registrada para Pedro Solo.',
    alumno: { id: 9, nombre: 'Pedro Solo', apodo: 'Tanque', puntos: 50, al_corriente: true, dias_para_vencer: 12 },
    racha: 3,
    puntos_otorgados: 10,
    insignias_desbloqueadas: [],
    asistencia_id: 77,
    fecha: '2026-09-08',
    metodo_registro: 'MANUAL',
    ...extra,
  };
}

function pagina<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

describe('AdminAsistencia: registro manual por nombre', () => {
  let fixture: ComponentFixture<AdminAsistencia>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminAsistencia],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminAsistencia);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/disciplinas/')).flush(pagina([{ id: 1, nombre: 'Striking', descripcion: '' }]));
    http.expectOne((r) => r.url.endsWith('/horarios/')).flush(
      pagina([{ id: 2, hora_inicio: '06:00:00', hora_fin: '07:00:00', turno: 'MATUTINO', turno_display: 'Matutino', dias: [], nombre: 'Striking' }]),
    );
    await fixture.whenStable();
    fixture.componentInstance.modo.set('manual');
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('sin alumno elegido el botón está deshabilitado y no llama al backend', () => {
    const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('section .btn.btn-rojo');
    expect(boton?.disabled).toBe(true);
    fixture.componentInstance.registrarManual();
    http.expectNone((r) => r.method === 'POST');
  });

  it('manda alumno_id, fecha y disciplina a /asistencias/manual/ y confirma puntos y racha', async () => {
    const c = fixture.componentInstance;
    c.alumnoManual.set(alumno());
    c.manual.fecha = '2026-09-08';
    c.manual.disciplina_id = 1;
    c.registrarManual();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/asistencias/manual/'));
    expect(req.request.body).toEqual({ alumno_id: 9, disciplina_id: 1, horario_id: null, fecha: '2026-09-08' });
    http.expectNone((r) => r.url.endsWith('/asistencias/checkin/'));
    req.flush(resultado());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.errorManual()).toBe(false);
    expect(c.mensajeManual()).toContain('Pedro Solo');
    expect(c.mensajeManual()).toContain('+10 pts');
    expect(c.mensajeManual()).toContain('racha 3');
    expect(c.alumnoManual()).toBeNull(); // listo para el siguiente
    expect((fixture.nativeElement as HTMLElement).querySelector('.aviso-ok')?.textContent).toContain('Pedro Solo');
  });

  it('muestra el rechazo del backend cuando ya registró esa clase', async () => {
    const c = fixture.componentInstance;
    c.alumnoManual.set(alumno());
    c.registrarManual();

    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/asistencias/manual/'))
      .flush({ detail: 'Este alumno ya registró asistencia en esta clase hoy.' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.errorManual()).toBe(true);
    expect(c.mensajeManual()).toContain('ya registró asistencia');
    expect(c.alumnoManual()?.id).toBe(9); // se conserva para corregir y reintentar
  });

  it('el selector de horario muestra la clase de la franja', () => {
    const texto = (fixture.nativeElement as HTMLElement).querySelector('#manual-hora')?.textContent ?? '';
    expect(texto).toContain('06:00 Matutino · Striking');
  });
});
