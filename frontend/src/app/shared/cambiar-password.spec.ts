import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CambiarPassword } from './cambiar-password';

describe('CambiarPassword (Seguridad → Cambiar contraseña)', () => {
  let fixture: ComponentFixture<CambiarPassword>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CambiarPassword],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CambiarPassword);
    fixture.detectChanges();
    localStorage.removeItem('casabrava_token');
  });

  afterEach(() => http.verify());

  it('no manda nada si la confirmación no coincide o la nueva es corta', () => {
    const c = fixture.componentInstance;
    c.f = { actual: 'rotoplas', nueva: 'unaClaveLarga1', confirma: 'otraCosa' };
    c.guardar();
    expect(c.esError()).toBe(true);
    expect(c.mensaje()).toContain('no coincide');

    c.f = { actual: 'rotoplas', nueva: 'corta', confirma: 'corta' };
    c.guardar();
    expect(c.mensaje()).toContain('al menos 8');

    c.f = { actual: 'rotoplas', nueva: 'rotoplas', confirma: 'rotoplas' };
    c.guardar();
    expect(c.mensaje()).toContain('distinta');
    http.expectNone((r) => r.url.endsWith('/auth/cambiar-password/'));
  });

  it('manda actual y nueva al endpoint existente y guarda el token renovado', async () => {
    const c = fixture.componentInstance;
    c.f = { actual: 'rotoplas', nueva: 'unaClaveLarga1', confirma: 'unaClaveLarga1' };
    c.guardar();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/auth/cambiar-password/'));
    expect(req.request.body).toEqual({ actual: 'rotoplas', nueva: 'unaClaveLarga1' });
    req.flush({ detail: 'Contraseña actualizada.', token: 'tok-nuevo' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.guardando()).toBe(false);
    expect(c.esError()).toBe(false);
    expect(c.f.nueva).toBe('');
    expect(localStorage.getItem('casabrava_token')).toBe('tok-nuevo');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Contraseña actualizada.');
  });

  it('muestra el detalle del backend si la actual es incorrecta', async () => {
    const c = fixture.componentInstance;
    c.f = { actual: 'mala', nueva: 'unaClaveLarga1', confirma: 'unaClaveLarga1' };
    c.guardar();
    http
      .expectOne((r) => r.url.endsWith('/auth/cambiar-password/'))
      .flush({ detail: 'La contraseña actual no es correcta.' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.esError()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no es correcta');
  });
});
