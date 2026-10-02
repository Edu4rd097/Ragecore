import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { DescargarFicha } from './descargar-ficha';
import { CargandoComponent, LogoComponent } from './ui';

/**
 * /ficha/:id — ficha técnica del peleador en HTML (la plantilla
 * fichas/ficha.html del backend), con barra para descargar el PDF o imprimir.
 *
 * La ven el alumno (solo la suya), el maestro (sus alumnos) y el admin
 * (todos): el alcance lo aplica el backend, aquí solo se muestra un 404
 * como "no disponible".
 *
 * El HTML llega por HttpClient (lleva el token) y se pinta en un iframe con
 * srcdoc. Se marca como confiable porque lo genera nuestro backend con
 * autoescape; aun así el iframe va en sandbox SIN allow-scripts, así que
 * ningún script podría correr dentro aunque se colara.
 */
@Component({
  selector: 'cb-vista-ficha',
  standalone: true,
  imports: [LogoComponent, CargandoComponent, DescargarFicha],
  template: `
    <header class="barra">
      <button type="button" class="btn btn-mini btn-fantasma" (click)="volver()">← Volver</button>
      <cb-logo [tam]="26" [compacto]="true" />
      <span class="titulo">Ficha técnica</span>
      <span class="crece"></span>
      @if (html()) {
        <button type="button" class="btn btn-mini" (click)="imprimir()">🖨 Imprimir</button>
        <cb-descargar-ficha [alumnoId]="id()" [mini]="true" />
      }
    </header>

    <main class="lienzo">
      @if (cargando()) {
        <cb-cargando texto="Armando la ficha" />
      } @else if (error()) {
        <div class="contenedor">
          <p class="aviso aviso-error" role="alert">{{ error() }}</p>
        </div>
      } @else if (html(); as h) {
        <iframe
          #marco
          title="Ficha técnica del peleador"
          [srcdoc]="h"
          sandbox="allow-same-origin allow-modals"
        ></iframe>
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100dvh;
      }
      .barra {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: var(--negro-900);
        border-bottom: 1px solid var(--borde);
        flex-wrap: wrap;
      }
      .titulo {
        font-family: 'Oswald', sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 0.9rem;
      }
      .lienzo {
        flex: 1;
        min-height: 0;
        position: relative;
        z-index: 1;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--negro);
      }
      .contenedor {
        padding-top: 24px;
      }
      @media (max-width: 480px) {
        .titulo {
          display: none;
        }
      }
    `,
  ],
})
export class VistaFicha {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private location = inject(Location);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  /** :id de la ruta (withComponentInputBinding). */
  id = input.required<number, string>({ transform: (v: string) => Number(v) });

  cargando = signal(true);
  error = signal<string | null>(null);
  html = signal<SafeHtml | null>(null);
  marco = viewChild<ElementRef<HTMLIFrameElement>>('marco');

  ngOnInit(): void {
    if (!Number.isInteger(this.id()) || this.id() <= 0) {
      this.cargando.set(false);
      this.error.set('No encontramos esa ficha.');
      return;
    }
    this.api.fichaHtml(this.id()).subscribe({
      next: (h) => {
        this.html.set(this.sanitizer.bypassSecurityTrustHtml(h));
        this.cargando.set(false);
      },
      error: (e: HttpErrorResponse) => {
        this.cargando.set(false);
        this.error.set(
          e.status === 404
            ? 'Esta ficha no existe o no tienes acceso a ella.'
            : 'No se pudo cargar la ficha. Intenta de nuevo.',
        );
      },
    });
  }

  imprimir(): void {
    this.marco()?.nativeElement.contentWindow?.print();
  }

  /** Regresa a donde estaba; si entró directo por la URL, a su inicio. */
  volver(): void {
    if (window.history.length > 1) this.location.back();
    else this.router.navigateByUrl(this.auth.rutaInicio());
  }
}
