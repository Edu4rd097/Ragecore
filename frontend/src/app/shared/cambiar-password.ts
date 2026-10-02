import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';

const MINIMO = 8;

/**
 * "Seguridad → Cambiar contraseña" del propio usuario. Un solo componente
 * para los tres paneles (alumno en Mi perfil, maestro y admin en Mi cuenta):
 * llama a AuthService.cambiarPassword(), que ya existía y que además renueva
 * el token de la sesión. La contraseña inicial con la que nace cada cuenta
 * la asigna el backend; aquí es donde el usuario la reemplaza por una suya.
 */
@Component({
  selector: 'cb-cambiar-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="tarjeta">
      <h2 class="titulo-seccion">Seguridad</h2>
      <p class="mini tenue" style="margin-top:-8px">
        Cambia tu contraseña. Si entraste con la contraseña inicial que te dio la academia,
        hazlo ahora.
      </p>

      @if (mensaje()) {
        <div class="aviso" [class.aviso-ok]="!esError()" [class.aviso-error]="esError()" role="alert">
          {{ mensaje() }}
        </div>
      }

      <form (ngSubmit)="guardar()" class="pila" autocomplete="off">
        <div class="campo">
          <label for="cp-actual">Contraseña actual</label>
          <input
            id="cp-actual"
            name="actual"
            type="password"
            [(ngModel)]="f.actual"
            autocomplete="current-password"
            required
          />
        </div>
        <div class="grid grid-2">
          <div class="campo">
            <label for="cp-nueva">Nueva contraseña</label>
            <input
              id="cp-nueva"
              name="nueva"
              [type]="ver() ? 'text' : 'password'"
              [(ngModel)]="f.nueva"
              autocomplete="new-password"
              required
              [attr.minlength]="minimo"
            />
          </div>
          <div class="campo">
            <label for="cp-confirma">Confirmar nueva contraseña</label>
            <input
              id="cp-confirma"
              name="confirma"
              [type]="ver() ? 'text' : 'password'"
              [(ngModel)]="f.confirma"
              autocomplete="new-password"
              required
            />
          </div>
        </div>
        <div class="fila envuelve" style="justify-content:space-between">
          <button type="button" class="btn btn-mini btn-fantasma" (click)="ver.set(!ver())">
            {{ ver() ? 'Ocultar' : 'Mostrar' }} contraseñas
          </button>
          <button type="submit" class="btn btn-rojo" [disabled]="guardando()">
            {{ guardando() ? 'Guardando...' : 'Cambiar contraseña' }}
          </button>
        </div>
        <p class="mini tenue" style="margin:0">Mínimo {{ minimo }} caracteres.</p>
      </form>
    </section>
  `,
})
export class CambiarPassword {
  private auth = inject(AuthService);

  readonly minimo = MINIMO;
  f = { actual: '', nueva: '', confirma: '' };

  guardando = signal(false);
  mensaje = signal('');
  esError = signal(false);
  ver = signal(false);

  private avisar(texto: string, error: boolean): void {
    this.esError.set(error);
    this.mensaje.set(texto);
  }

  guardar(): void {
    const { actual, nueva, confirma } = this.f;
    if (!actual || !nueva || !confirma) {
      this.avisar('Llena los tres campos.', true);
      return;
    }
    if (nueva.length < MINIMO) {
      this.avisar(`La nueva contraseña debe tener al menos ${MINIMO} caracteres.`, true);
      return;
    }
    if (nueva !== confirma) {
      this.avisar('La confirmación no coincide con la nueva contraseña.', true);
      return;
    }
    if (nueva === actual) {
      this.avisar('La nueva contraseña debe ser distinta de la actual.', true);
      return;
    }

    this.guardando.set(true);
    this.mensaje.set('');
    this.auth.cambiarPassword(actual, nueva).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.f = { actual: '', nueva: '', confirma: '' };
        this.avisar(r.detail || 'Contraseña actualizada.', false);
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisar(e?.error?.detail ?? 'No se pudo cambiar la contraseña.', true);
      },
    });
  }
}
