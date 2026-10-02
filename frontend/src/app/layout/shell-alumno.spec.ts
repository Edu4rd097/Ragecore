import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Notificacion } from '../core/models';
import { ShellAlumno } from './shell-alumno';

@Component({ standalone: true, template: 'pantalla' })
class Pantalla {}

function noti(extra: Partial<Notificacion> = {}): Notificacion {
  return {
    id: 1, alumno: 9, tipo: 'MANUAL', tipo_display: 'Aviso', titulo: 'Clase cancelada',
    mensaje: 'Hoy no hay clase.', fecha_envio: new Date().toISOString(), leida: false,
    canal: 'PUSH', aviso: null, estado_correo: '', estado_correo_display: '', enviado_en: null,
    error_correo: '', ...extra,
  };
}

const pagina = <T>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

describe('ShellAlumno: campana y botón de regresar', () => {
  let fixture: ComponentFixture<ShellAlumno>;
  let http: HttpTestingController;
  let router: Router;
  const el = () => fixture.nativeElement as HTMLElement;
  const campana = () => el().querySelector('button.campana') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShellAlumno],
      providers: [
        provideRouter([
          { path: 'mi/inicio', component: Pantalla },
          { path: 'mi/pagos', component: Pantalla },
          { path: 'mi/notificaciones', component: Pantalla },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/mi/inicio');
    fixture = TestBed.createComponent(ShellAlumno);
    fixture.detectChanges();
    // Contador inicial de no leídas.
    http.expectOne((r) => r.url.endsWith('/notificaciones/') && r.params.get('leida') === 'false')
      .flush({ ...pagina([noti()]), count: 3 });
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('la campana abre y vuelve a cerrar el panel', () => {
    expect(el().querySelector('cb-panel-notificaciones')).toBeNull();

    campana().click();
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/notificaciones/') && r.params.get('page_size') === '10')
      .flush(pagina([noti()]));
    fixture.detectChanges();
    expect(el().querySelector('cb-panel-notificaciones')).not.toBeNull();
    expect(campana().getAttribute('aria-expanded')).toBe('true');
    expect(el().textContent).toContain('Clase cancelada');

    campana().click();
    fixture.detectChanges();
    expect(el().querySelector('cb-panel-notificaciones')).toBeNull();
    expect(campana().getAttribute('aria-expanded')).toBe('false');
  });

  it('se cierra con Esc y al leer una baja el globo', () => {
    campana().click();
    fixture.detectChanges();
    http.expectOne((r) => r.params.get('page_size') === '10').flush(pagina([noti()]));
    fixture.detectChanges();
    expect(el().querySelector('.badge')?.textContent?.trim()).toBe('3');

    (el().querySelector('button.noti') as HTMLButtonElement).click();
    http.expectOne((r) => r.url.endsWith('/notificaciones/1/marcar-leida/')).flush(noti({ leida: true }));
    fixture.detectChanges();
    expect(el().querySelector('.badge')?.textContent?.trim()).toBe('2');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el().querySelector('cb-panel-notificaciones')).toBeNull();
  });

  it('en el inicio no hay "Regresar"; en cualquier sección sí, y lleva al inicio', async () => {
    expect(el().querySelector('a.regresar')).toBeNull();

    await router.navigateByUrl('/mi/pagos');
    fixture.detectChanges();
    const regresar = el().querySelector('a.regresar') as HTMLAnchorElement;
    expect(regresar).not.toBeNull();
    expect(regresar.getAttribute('href')).toBe('/mi/inicio');
  });
});
