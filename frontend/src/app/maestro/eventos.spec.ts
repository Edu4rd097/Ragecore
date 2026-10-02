import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlumnoLista, Evento, EventoInscripcion, Torneo } from '../core/models';
import { Eventos } from './eventos';

function evento(extra: Partial<Evento> = {}): Evento {
  return {
    id: 3,
    titulo: 'Copa Brava',
    tipo: 'TORNEO',
    tipo_display: 'Torneo',
    fecha: '2026-05-10',
    lugar: 'Arena',
    descripcion: '',
    disciplina: null,
    disciplina_nombre: '',
    creado_por: null,
    creado_por_username: 'profe',
    total_inscritos: 1,
    inscrito: null,
    creado_en: '2026-05-01T00:00:00Z',
    actualizado_en: '2026-05-01T00:00:00Z',
    ...extra,
  };
}

function torneo(extra: Partial<Torneo> = {}): Torneo {
  return {
    id: 9,
    alumno: 7,
    alumno_nombre: 'Pepe Res',
    nombre_torneo: 'Copa Brava',
    fecha: '2026-05-10',
    resultado: 'GANO',
    resultado_display: 'Ganó',
    metodo: 'KO',
    metodo_display: 'KO/TKO',
    disciplina: null,
    evento: 3,
    evento_titulo: 'Copa Brava',
    notas: '',
    ...extra,
  };
}

function inscripcion(extra: Partial<EventoInscripcion> = {}): EventoInscripcion {
  return {
    id: 5,
    evento: 3,
    evento_titulo: 'Copa Brava',
    alumno: 7,
    alumno_nombre: 'Pepe Res',
    fecha_inscripcion: '2026-05-02T10:00:00Z',
    asistio: false,
    torneo: null,
    ...extra,
  };
}

function pagina<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}

describe('Eventos (personal): inscritos y resultados', () => {
  let fixture: ComponentFixture<Eventos>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Eventos],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Eventos);
    fixture.detectChanges();
    // Arranque: catálogo de disciplinas + primera página de eventos.
    http.expectOne((r) => r.url.endsWith('/disciplinas/')).flush(pagina([]));
    http.expectOne((r) => r.url.endsWith('/eventos/')).flush(pagina([evento()]));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function abrirDetalle(e = evento(), inscritos = [inscripcion()]): Promise<HTMLElement> {
    fixture.componentInstance.abrirDetalle(e);
    fixture.detectChanges();
    http
      .expectOne(
        (r) => r.url.endsWith('/inscripciones-evento/') && r.params.get('evento') === String(e.id),
      )
      .flush(pagina(inscritos));
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('cb-modal') as HTMLElement;
  }

  it('en un torneo ofrece registrar el resultado y lo manda al endpoint anidado', async () => {
    const modal = await abrirDetalle();
    expect(modal.textContent).toContain('Resultado');

    const registrar = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Registrar',
    ) as HTMLButtonElement;
    expect(registrar).toBeTruthy();
    registrar.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.editandoResultado()).toBe(5);

    fixture.componentInstance.fr = { resultado: 'GANO', metodo: 'KO' };
    fixture.componentInstance.guardarResultado(inscripcion());
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/inscripciones-evento/5/resultado/'),
    );
    expect(req.request.body).toEqual({ resultado: 'GANO', metodo: 'KO' });
    req.flush(inscripcion({ asistio: true, torneo: torneo() }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.editandoResultado()).toBeNull();
    expect(modal.textContent).toContain('Ganó');
    expect(modal.textContent).toContain('por KO/TKO');
    expect(modal.querySelector('.chip-verde')).toBeTruthy();
  });

  it('un seminario no lleva columna de resultado', async () => {
    const modal = await abrirDetalle(
      evento({ id: 4, tipo: 'SEMINARIO', tipo_display: 'Seminario' }),
      [inscripcion({ id: 6, evento: 4 })],
    );
    const encabezados = Array.from(modal.querySelectorAll('th')).map((t) => t.textContent?.trim());
    expect(encabezados).not.toContain('Resultado');
    expect(modal.textContent).not.toContain('Registrar');
  });

  it('agrega un alumno a la lista y actualiza el conteo sin recargar', async () => {
    const modal = await abrirDetalle();
    const nuevo: AlumnoLista = {
      id: 8,
      nombres: 'Lu',
      apellidos: 'Díaz',
      nombre_completo: 'Lu Díaz',
      apodo: '',
      foto: null,
      activo: true,
      puntos: 0,
      record: '0-0-0',
      horario: null,
      horario_display: null,
      membresia: null,
      membresia_nombre: null,
      al_corriente: true,
      dias_para_vencer: 10,
    };

    fixture.componentInstance.agregarAlumno(nuevo);
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/inscripciones-evento/'),
    );
    expect(req.request.body).toEqual({ evento: 3, alumno: 8 });
    req.flush(inscripcion({ id: 11, alumno: 8, alumno_nombre: 'Lu Díaz' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(modal.querySelectorAll('table.inscritos tbody tr').length).toBe(2);
    expect(modal.textContent).toContain('Inscritos (2)');
    expect(modal.textContent).toContain('Lu Díaz');
    expect(fixture.componentInstance.lista()[0].total_inscritos).toBe(2);
  });

  it('muestra el mensaje del backend si el resultado no se pudo guardar', async () => {
    const modal = await abrirDetalle();
    fixture.componentInstance.guardarResultado(inscripcion());
    http
      .expectOne((r) => r.url.endsWith('/inscripciones-evento/5/resultado/'))
      .flush(
        { detail: 'Solo los eventos de tipo Torneo llevan resultado.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.guardandoResultado()).toBe(false);
    expect(modal.textContent).toContain('Solo los eventos de tipo Torneo');
  });
});
