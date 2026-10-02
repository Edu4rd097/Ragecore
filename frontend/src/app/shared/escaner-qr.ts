import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import jsQR from 'jsqr';

/** Subconjunto del API nativo BarcodeDetector (Chrome, Edge, Android). */
interface DetectorNativo {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface ConstructorDetectorNativo {
  new (opciones: { formats: string[] }): DetectorNativo;
  getSupportedFormats(): Promise<string[]>;
}

type Estado = 'iniciando' | 'activo' | 'error' | 'sin-soporte';

/**
 * Escáner de códigos QR con la cámara del equipo (webcam o cámara trasera).
 *
 * Abre la cámara con getUserMedia, decodifica cada ~150 ms con el
 * BarcodeDetector nativo si el navegador lo tiene y, si no, con jsQR sobre
 * un canvas. Emite `codigo` con el texto leído y evita dobles lecturas del
 * mismo código durante unos segundos. `pausado` congela la lectura (por
 * ejemplo mientras se muestra la confirmación) sin apagar la cámara.
 *
 *   <cb-escaner-qr (codigo)="checkin($event)" [pausado]="procesando()" />
 *
 * Requiere HTTPS (o localhost): los navegadores no dan cámara en HTTP plano.
 */
@Component({
  selector: 'cb-escaner-qr',
  standalone: true,
  template: `
    <div class="marco" [class.pausado]="pausado()">
      <video #video playsinline muted autoplay [class.oculto]="estado() !== 'activo'"></video>
      <canvas #lienzo hidden></canvas>
      <div class="esquina tl"></div>
      <div class="esquina tr"></div>
      <div class="esquina bl"></div>
      <div class="esquina br"></div>

      @switch (estado()) {
        @case ('iniciando') {
          <span class="texto">Abriendo la cámara…</span>
        }
        @case ('sin-soporte') {
          <div class="mensaje"><p>{{ error() }}</p></div>
        }
        @case ('error') {
          <div class="mensaje">
            <p>{{ error() }}</p>
            <button type="button" class="btn btn-mini" (click)="iniciar()">Reintentar</button>
          </div>
        }
        @case ('activo') {
          @if (pausado()) {
            <span class="texto pausa">En pausa</span>
          } @else {
            <div class="laser"></div>
            <span class="texto">Apunta la cámara al código QR del alumno</span>
          }
        }
      }
    </div>

    @if (estado() === 'activo') {
      <div class="controles">
        <span class="mini tenue">
          {{ motor() === 'nativo' ? 'Detector nativo del navegador' : 'Decodificador jsQR' }}
        </span>
        @if (camaras().length > 1) {
          <button type="button" class="btn btn-mini" (click)="cambiarCamara()">🔄 Cambiar cámara</button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .marco {
        position: relative;
        aspect-ratio: 4 / 3;
        max-width: 420px;
        margin: 0 auto;
        background: var(--negro-900);
        border-radius: var(--r-lg);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      video.oculto {
        visibility: hidden;
      }
      .pausado video {
        filter: grayscale(1) brightness(0.55);
      }
      .esquina {
        position: absolute;
        width: 26px;
        height: 26px;
        border-color: var(--rojo);
        border-style: solid;
        z-index: 2;
      }
      .tl { top: 12px; left: 12px; border-width: 3px 0 0 3px; }
      .tr { top: 12px; right: 12px; border-width: 3px 3px 0 0; }
      .bl { bottom: 12px; left: 12px; border-width: 0 0 3px 3px; }
      .br { bottom: 12px; right: 12px; border-width: 0 3px 3px 0; }
      .laser {
        position: absolute;
        left: 20px;
        right: 20px;
        height: 2px;
        background: var(--rojo);
        box-shadow: 0 0 8px var(--rojo);
        animation: scan 2.2s ease-in-out infinite;
        z-index: 2;
      }
      @keyframes scan {
        0%, 100% { top: 20%; }
        50% { top: 76%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .laser { animation: none; top: 50%; }
      }
      .texto {
        position: absolute;
        bottom: 14px;
        left: 0;
        right: 0;
        padding: 6px 12px;
        font-size: 0.72rem;
        letter-spacing: 0.06em;
        text-align: center;
        color: var(--texto);
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        z-index: 2;
      }
      .texto.pausa {
        bottom: auto;
        font-family: 'Oswald', sans-serif;
        font-size: 1.1rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .mensaje {
        position: relative;
        z-index: 2;
        padding: 24px;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: center;
        color: var(--texto-suave);
        font-size: 0.9rem;
      }
      .mensaje p {
        margin: 0;
        max-width: 32ch;
      }
      .controles {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        max-width: 420px;
        margin: 8px auto 0;
      }
    `,
  ],
})
export class EscanerQr implements OnDestroy {
  /** Congela la lectura (la cámara sigue encendida). */
  pausado = input(false);
  /** Texto del QR leído, ya recortado. */
  codigo = output<string>();

  estado = signal<Estado>('iniciando');
  error = signal('');
  camaras = signal<MediaDeviceInfo[]>([]);
  motor = signal<'nativo' | 'jsqr'>('jsqr');

  /** Ventana en la que el mismo código no se vuelve a emitir (dobles lecturas). */
  static readonly ANTIRREBOTE_MS = 3000;
  /** Cada cuánto se intenta decodificar un cuadro. */
  static readonly INTERVALO_MS = 150;

  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');

  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private detector: DetectorNativo | null = null;
  private indiceCamara = 0;
  private decodificando = false;
  private ultimoCodigo = '';
  private ultimoInstante = 0;

  constructor() {
    afterNextRender(() => void this.iniciar());
  }

  async iniciar(): Promise<void> {
    this.detener();
    const medios = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!medios?.getUserMedia) {
      this.estado.set('sin-soporte');
      this.error.set(
        'Este navegador no permite usar la cámara aquí. Hace falta HTTPS (o localhost) y un navegador moderno; teclea el código abajo.',
      );
      return;
    }

    this.estado.set('iniciando');
    this.error.set('');
    try {
      const camara = this.camaras()[this.indiceCamara];
      const seleccion: MediaTrackConstraints = camara
        ? { deviceId: { exact: camara.deviceId } }
        : { facingMode: { ideal: 'environment' } };
      this.stream = await medios.getUserMedia({
        video: { ...seleccion, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      const el = this.video().nativeElement;
      el.srcObject = this.stream;
      await el.play();

      // Con permiso ya concedido, enumerateDevices sí devuelve etiquetas e ids.
      if (!this.camaras().length) {
        const dispositivos = await medios.enumerateDevices();
        this.camaras.set(dispositivos.filter((d) => d.kind === 'videoinput'));
      }

      await this.prepararDetector();
      this.estado.set('activo');
      this.timer = setInterval(() => void this.cuadro(), EscanerQr.INTERVALO_MS);
    } catch (e) {
      this.detener();
      this.estado.set('error');
      this.error.set(this.explicar(e));
    }
  }

  cambiarCamara(): void {
    if (this.camaras().length < 2) return;
    this.indiceCamara = (this.indiceCamara + 1) % this.camaras().length;
    void this.iniciar();
  }

  /**
   * Emite el código leído. Devuelve false si se descartó por ser el mismo
   * código dentro de la ventana antirrebote (o texto vacío).
   */
  procesar(texto: string): boolean {
    const limpio = texto.trim();
    if (!limpio) return false;
    const ahora = Date.now();
    if (limpio === this.ultimoCodigo && ahora - this.ultimoInstante < EscanerQr.ANTIRREBOTE_MS) {
      return false;
    }
    this.ultimoCodigo = limpio;
    this.ultimoInstante = ahora;
    this.codigo.emit(limpio);
    return true;
  }

  detener(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try {
      const el = this.video().nativeElement;
      el.pause();
      el.srcObject = null;
    } catch {
      /* la vista puede no existir ya */
    }
  }

  ngOnDestroy(): void {
    this.detener();
  }

  private async prepararDetector(): Promise<void> {
    const Ctor = (globalThis as { BarcodeDetector?: ConstructorDetectorNativo }).BarcodeDetector;
    this.detector = null;
    if (Ctor) {
      try {
        const formatos = await Ctor.getSupportedFormats();
        if (formatos.includes('qr_code')) {
          this.detector = new Ctor({ formats: ['qr_code'] });
          this.motor.set('nativo');
          return;
        }
      } catch {
        /* cae a jsQR */
      }
    }
    this.motor.set('jsqr');
  }

  private async cuadro(): Promise<void> {
    if (this.pausado() || this.decodificando || this.estado() !== 'activo') return;
    const video = this.video().nativeElement;
    if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA || !video.videoWidth) return;

    this.decodificando = true;
    try {
      let texto: string | null = null;
      if (this.detector) {
        const codigos = await this.detector.detect(video);
        texto = codigos[0]?.rawValue ?? null;
      } else {
        const lienzo = this.lienzo().nativeElement;
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        // A 640 px de ancho se lee bien y decodificar cuesta mucho menos.
        const escala = Math.min(1, 640 / video.videoWidth);
        lienzo.width = Math.round(video.videoWidth * escala);
        lienzo.height = Math.round(video.videoHeight * escala);
        ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
        const imagen = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        texto =
          jsQR(imagen.data, imagen.width, imagen.height, { inversionAttempts: 'dontInvert' })?.data ??
          null;
      }
      if (texto) this.procesar(texto);
    } catch {
      /* un cuadro que falla no detiene el escaneo */
    } finally {
      this.decodificando = false;
    }
  }

  private explicar(e: unknown): string {
    const nombre = (e as { name?: string } | null)?.name ?? '';
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
      return 'Permiso de cámara denegado. Actívalo desde el candado de la barra del navegador y pulsa Reintentar.';
    }
    if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
      return 'No se encontró ninguna cámara en este equipo. Teclea el código abajo.';
    }
    if (nombre === 'NotReadableError') {
      return 'La cámara está en uso por otra aplicación. Ciérrala y pulsa Reintentar.';
    }
    return 'No se pudo abrir la cámara. Teclea el código abajo.';
  }
}
