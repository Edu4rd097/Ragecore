import { Component, ElementRef, OnInit, inject, input, output, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { CargandoComponent, ModalComponent } from './ui';

/**
 * Comprobante de un pago de membresía, con el diseño de la academia.
 *
 * No se arma aquí: se muestra el mismo HTML que llega por correo
 * (GET /pagos/{id}/comprobante/), así la app, el correo y el PDF nunca
 * difieren. Va en un iframe con sandbox SIN scripts; lo genera nuestro
 * backend con autoescape.
 *
 *   @if (comprobante(); as p) {
 *     <cb-comprobante-pago [pagoId]="p.id" (cerrar)="comprobante.set(null)" />
 *   }
 */
@Component({
  selector: 'cb-comprobante-pago',
  standalone: true,
  imports: [ModalComponent, CargandoComponent],
  template: `
    <cb-modal titulo="Comprobante de pago" [amplio]="true" (cerrar)="cerrar.emit()">
      @if (cargando()) {
        <cb-cargando texto="Generando comprobante" />
      } @else if (error()) {
        <p class="aviso aviso-error" role="alert">{{ error() }}</p>
      } @else if (html(); as h) {
        <iframe
          #marco
          title="Comprobante de pago"
          [srcdoc]="h"
          sandbox="allow-same-origin allow-modals"
        ></iframe>
      }
      <div pie>
        <button class="btn" type="button" (click)="cerrar.emit()">Cerrar</button>
        <button
          class="btn"
          type="button"
          [disabled]="!html() || descargando()"
          [attr.aria-busy]="descargando()"
          (click)="descargarPdf()"
        >
          {{ descargando() ? 'Generando...' : '⬇ Descargar PDF' }}
        </button>
        <button class="btn btn-rojo" type="button" [disabled]="!html()" (click)="imprimir()">
          🖨 Imprimir
        </button>
      </div>
      <div aria-live="polite">
        @if (errorPdf()) {
          <p class="aviso aviso-error mini" role="alert" style="margin-top:10px">{{ errorPdf() }}</p>
        }
      </div>
    </cb-modal>
  `,
  styles: [
    `
      iframe {
        display: block;
        width: 100%;
        height: min(68dvh, 760px);
        border: 0;
        border-radius: var(--r);
        background: var(--negro);
      }
    `,
  ],
})
export class ComprobantePago implements OnInit {
  private api = inject(ApiService);
  private sanitizer = inject(DomSanitizer);

  pagoId = input.required<number>();
  cerrar = output<void>();

  cargando = signal(true);
  error = signal<string | null>(null);
  html = signal<SafeHtml | null>(null);
  descargando = signal(false);
  errorPdf = signal<string | null>(null);
  marco = viewChild<ElementRef<HTMLIFrameElement>>('marco');

  ngOnInit(): void {
    this.api.comprobanteHtml(this.pagoId()).subscribe({
      next: (h) => {
        this.html.set(this.sanitizer.bypassSecurityTrustHtml(h));
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.error.set('No se pudo cargar el comprobante. Intenta de nuevo.');
      },
    });
  }

  imprimir(): void {
    this.marco()?.nativeElement.contentWindow?.print();
  }

  descargarPdf(): void {
    if (this.descargando()) return;
    this.descargando.set(true);
    this.errorPdf.set(null);
    this.api.comprobantePdf(this.pagoId()).subscribe({
      next: (blob) => {
        this.descargando.set(false);
        this.guardar(blob, `comprobante-${String(this.pagoId()).padStart(6, '0')}.pdf`);
      },
      error: () => {
        this.descargando.set(false);
        this.errorPdf.set('No se pudo generar el PDF.');
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
