import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Alumno, ResultadoCheckin } from '../core/models';
import { MiPerfil } from './perfil';

function alumno(extra: Partial<Alumno> = {}): Alumno {
  return {
    id: 5,
    nombres: 'Ana',
    apellidos: 'Ruiz',
    nombre_completo: 'Ana Ruiz',
    apodo: 'La Pantera',
    edad: 24,
    peso_actual: '60.0',
    telefono: '',
    email: 'ana@correo.test',
    username: 'alumno-5',
    tiene_cuenta: true,
    foto: null,
    codigo_qr: 'ALU-ABC123',
    qr_imagen: null,
    fecha_registro: '2026-01-10',
    horario: 2,
    membresia: 1,
    activo: true,
    puntos: 120,
    experiencia: null,
    inscripciones: [
      { id: 1, alumno: 5, disciplina: 1, disciplina_nombre: 'Striking', fecha_inicio: '2026-01-10' },
      { id: 2, alumno: 5, disciplina: 2, disciplina_nombre: 'Jiu Jitsu', fecha_inicio: '2026-01-10' },
    ],
    insignias_ganadas: [],
    al_corriente: true,
    dias_para_vencer: 10,
    fecha_vencimiento: '2026-09-19',
    record: '0-0-0',
    total_asistencias: 12,
    ...extra,
  } as Alumno;
}

function resultado(extra: Partial<ResultadoCheckin> = {}): ResultadoCheckin {
  return {
    detail: 'Asistencia registrada para Ana Ruiz.',
    alumno: { id: 5, nombre: 'Ana Ruiz', apodo: 'La Pantera', puntos: 130, al_corriente: true, dias_para_vencer: 10 },
    racha: 4,
    puntos_otorgados: 10,
    insignias_desbloqueadas: ['Constante'],
    asistencia_id: 31,
    fecha: '2026-09-09',
    metodo_registro: 'APP',
    ...extra,
  };
}

describe('MiPerfil: registrar mi propia asistencia', () => {
  let fixture: ComponentFixture<MiPerfil>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MiPerfil],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MiPerfil);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/alumnos/yo/')).flush(alumno());
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('propone la primera disciplina inscrita y deja elegir si hay varias', () => {
    const c = fixture.componentInstance;
    expect(c.disciplinaCheckin).toBe(1);
    const selector = (fixture.nativeElement as HTMLElement).querySelector('.autoregistro select');
    expect(selector?.textContent).toContain('Striking');
    expect(selector?.textContent).toContain('Jiu Jitsu');
  });

  it('manda la disciplina a /asistencias/mi-checkin/ y muestra puntos, racha e insignias', async () => {
    const c = fixture.componentInstance;
    c.disciplinaCheckin = 2;
    c.registrarAsistencia();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/asistencias/mi-checkin/'));
    expect(req.request.body).toEqual({ disciplina_id: 2 });
    req.flush(resultado());
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).querySelector('.resultado-checkin')?.textContent ?? '';
    expect(texto).toContain('La Pantera');
    expect(texto).toContain('+10 pts');
    expect(texto).toContain('racha 4');
    expect(texto).toContain('Constante');
    expect(c.registrando()).toBe(false);
  });

  it('muestra el motivo cuando el backend rechaza el registro', async () => {
    const c = fixture.componentInstance;
    c.registrarAsistencia();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/asistencias/mi-checkin/'))
      .flush({ detail: 'Este alumno ya registró asistencia en esta clase hoy.' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.checkin()).toBeNull();
    expect(c.errorCheckin()).toContain('ya registró asistencia');
    expect((fixture.nativeElement as HTMLElement).querySelector('.autoregistro .aviso-error')?.textContent).toContain(
      'ya registró asistencia',
    );
  });
});
