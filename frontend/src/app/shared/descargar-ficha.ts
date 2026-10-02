import { HttpResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { ApiService } from '../core/api.service';

/**
 * Botón "Descargar ficha": baja la ficha técnica del peleador en PDF
 * (GET /alumnos/{id}/ficha-pdf/). El backend decide qué se muestra y
 * valida el alcance por rol; aquí solo se descarga el archivo.
 *
 *   <cb-descargar-ficha [alumnoId]="a.id" />
 */
@Component({
  selector: 'cb-descargar-ficha',
  standalone: true,
  template: `
    <button
      type="button"
      class="btn"
      [class.btn-rojo]="principal()"
      [class.btn-mini]="mini()"
      [class.btn-bloque]="bloque()"
      [disabled]="generando()"
      [attr.aria-busy]="generando()"
      (click)="descargar()"
    >
      <span aria-hidden="true">⬇</span>
      {{ generando() ? 'Generando ficha...' : 'Descargar ficha' }}
    </button>
    <span aria-live="polite">
      @if (error()) {
        <span class="aviso aviso-error mini" role="alert">{{ error() }}</span>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-direction: column;
        gap: 6px;
      }
      .btn {
        gap: 8px;
      }
      .aviso {
        display: block;
      }
    `,
  ],
})
export class DescargarFicha {
  private api = inject(ApiService);

  alumnoId = input.required<number>();
  principal = input(true);
  mini = input(false);
  bloque = input(false);

  generando = signal(false);
  error = signal<string | null>(null);

  descargar(): void {
    if (this.generando()) return;
    this.generando.set(true);
    this.error.set(null);
    this.api.fichaPdf(this.alumnoId()).subscribe({
      next: (r) => {
        this.generando.set(false);
        if (r.body) this.guardar(r.body, nombreDeArchivo(r, this.alumnoId()));
      },
      error: () => {
        this.generando.set(false);
        this.error.set('No se pudo generar la ficha. Intenta de nuevo.');
      },
    });
  }

  /** Aparte para poder sustituirlo en las pruebas (jsdom no descarga). */
  guardar(pdf: Blob, nombre: string): void {
    const url = URL.createObjectURL(pdf);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/** Nombre que manda el backend en Content-Disposition; si no llega, uno genérico. */
export function nombreDeArchivo(r: HttpResponse<Blob>, alumnoId: number): string {
  const cabecera = r.headers.get('Content-Disposition') ?? '';
  const nombre = /filename="?([^";]+)"?/i.exec(cabecera)?.[1];
  return nombre || `ficha-${alumnoId}.pdf`;
}
