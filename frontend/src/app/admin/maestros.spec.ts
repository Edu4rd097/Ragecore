import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlumnoLista, Maestro } from '../core/models';
import { AdminMaestros } from './maestros';

function maestro(extra: Partial<Maestro> = {}): Maestro {
  return {
    id: 4,
    nombre: 'Carlos',
    edad: null,
    telefono: '',
    email: 'carlos@correo.test',
    username: 'maestro-4',
    tiene_cuenta: true,
    foto: null,
    activo: true,
    codigo_qr: 'MST-1',
    qr_imagen: null,
    asignaciones: [],
    horarios: [{ id: 1, nombre: 'Matutino 07:00-09:00' }],
    alumnos_asignados: [{ id: 9, nombre_completo: 'Pedro Solo', apodo: '' }],
    total_alumnos: 5,
    ...extra,
  };
}

function pagina<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

describe('AdminMaestros: alcance por grupos y alumnos individuales', () => {
  let fixture: ComponentFixture<AdminMaestros>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminMaestros],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminMaestros);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/disciplinas/')).flush(pagina([]));
    http.expectOne((r) => r.url.endsWith('/horarios/')).flush(
      pagina([
        { id: 1, hora_inicio: '07:00:00', hora_fin: '09:00:00', turno: 'MATUTINO', turno_display: 'Matutino', dias: [] },
        { id: 2, hora_inicio: '16:00:00', hora_fin: '18:00:00', turno: 'VESPERTINO', turno_display: 'Vespertino', dias: [] },
      ]),
    );
    http.expectOne((r) => r.url.endsWith('/maestros/')).flush(pagina([maestro()]));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('pinta en la tarjeta el alcance del maestro', () => {
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Ve a 5 alumnos');
    expect(texto).toContain('Matutino 07:00-09:00');
    expect(texto).toContain('+1 individual');
  });

  it('al editar manda horarios_ids y alumnos_ids con lo elegido', async () => {
    const c = fixture.componentInstance;
    c.abrir(maestro());
    fixture.detectChanges();
    expect(c.f.horarios_ids).toEqual([1]);
    expect(c.alumnosElegidos().map((a) => a.id)).toEqual([9]);

    c.alternarHorario(2); // agrega la tarde
    c.quitarAlumno(9);
    c.agregarAlumno({ id: 12, nombre_completo: 'Juan Nuevo', apodo: '' } as AlumnoLista);
    c.guardar();

    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/maestros/4/'));
    expect(req.request.body.horarios_ids).toEqual([1, 2]);
    expect(req.request.body.alumnos_ids).toEqual([12]);
    req.flush(maestro({ horarios: [], alumnos_asignados: [] }));
    http.expectOne((r) => r.url.endsWith('/maestros/')).flush(pagina([maestro()]));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(c.modal()).toBe(false);
  });

  it('al dar de alta muestra una sola vez el usuario y la contraseña inicial', async () => {
    const c = fixture.componentInstance;
    c.abrir();
    c.f.nombre = 'Profe Nuevo';
    c.guardar();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/maestros/'));
    expect(req.request.body.alumnos_ids).toEqual([]);
    req.flush(maestro({ id: 7, username: 'maestro-7', password_inicial: 'rotoplas' }));
    http.expectOne((r) => r.url.endsWith('/maestros/')).flush(pagina([maestro()]));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.credenciales()).toEqual({ username: 'maestro-7', password: 'rotoplas' });
    const modal = (fixture.nativeElement as HTMLElement).querySelector('cb-modal');
    expect(modal?.textContent).toContain('maestro-7');
    expect(modal?.textContent).toContain('rotoplas');
  });
});
