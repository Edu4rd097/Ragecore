import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Experiencia } from '../core/models';

/**
 * Formulario de la ficha técnica (cinturón, sparrings, peso, lesión, notas).
 * Extraído de la pestaña "Experiencia" de admin/alumno-detalle.ts para
 * reusarlo también en maestro/alumnos.ts — mismos campos, mismo endpoint
 * (api.editarExperiencia), sin duplicar el formulario. La medición de
 * habilidades NO va aquí: vive en cb-evaluacion-mma-form.
 */
@Component({
  selector: 'cb-experiencia-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (fe) {
      <p class="mini tenue" style="margin-top:-8px">
        Esto lo captura el maestro. El alumno lo ve pero no lo puede editar.
      </p>

      @if (error()) {
        <div class="aviso aviso-error" style="margin-bottom:12px">{{ error() }}</div>
      }

      <div class="grid grid-3">
        <div class="campo">
          <label>Cinturón BJJ</label>
          <select [(ngModel)]="fe.bjj_cinturon">
            @for (c of cinturones; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </div>
        <div class="campo">
          <label>Sparrings</label>
          <input type="number" [(ngModel)]="fe.numero_sparrings" />
        </div>
        <div class="campo">
          <label>Peso de competencia</label>
          <input type="number" step="0.1" [(ngModel)]="fe.peso_competencia" />
        </div>
        <div class="campo">
          <label>Método favorito</label>
          <select [(ngModel)]="fe.metodo_victoria_favorito">
            <option value="">—</option>
            <option value="KO">KO/TKO</option>
            <option value="SUMISION">Sumisión</option>
            <option value="DECISION">Decisión</option>
          </select>
        </div>
        <div class="campo">
          <label>¿Lesionado?</label>
          <select [(ngModel)]="fe.lesion_activa">
            <option [ngValue]="false">No</option>
            <option [ngValue]="true">Sí</option>
          </select>
        </div>
      </div>

      @if (fe.lesion_activa) {
        <div class="campo">
          <label>Detalle de la lesión</label>
          <textarea [(ngModel)]="fe.detalle_lesion"></textarea>
        </div>
      }

      <div class="campo">
        <label>Notas del maestro</label>
        <textarea [(ngModel)]="fe.notas_maestro"></textarea>
      </div>

      <p class="mini tenue">
        El récord de peleas no se edita aquí: se calcula solo a partir de los torneos
        registrados en el historial del alumno.
      </p>

      <button class="btn btn-rojo" [disabled]="guardando()" (click)="guardar()">
        {{ guardando() ? 'Guardando...' : 'Guardar ficha' }}
      </button>
    }
  `,
})
export class ExperienciaForm {
  private api = inject(ApiService);

  experiencia = input.required<Experiencia | null>();
  guardado = output<Experiencia>();

  guardando = signal(false);
  error = signal('');

  cinturones = ['BLANCO', 'AZUL', 'PURPURA', 'MARRON', 'NEGRO'];

  fe: Partial<Experiencia> | null = null;

  constructor() {
    effect(() => {
      const exp = this.experiencia();
      this.fe = exp ? { ...exp } : null;
      this.error.set('');
    });
  }

  guardar(): void {
    const exp = this.experiencia();
    if (!exp || !this.fe) return;
    this.guardando.set(true);
    this.error.set('');

    this.api.editarExperiencia(exp.id, this.fe as never).subscribe({
      next: (actualizada) => {
        this.guardando.set(false);
        this.guardado.emit(actualizada);
      },
      error: () => {
        this.guardando.set(false);
        this.error.set('No se pudo guardar la ficha. Revisa los valores capturados.');
      },
    });
  }
}
