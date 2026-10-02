import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Alumno, AlumnoLista, Experiencia } from '../core/models';
import {
  AvatarComponent,
  CargandoComponent,
  ModalComponent,
  PaginadorComponent,
  VacioComponent,
} from '../shared/ui';
import { ExperienciaForm } from '../shared/experiencia-form';
import { EvaluacionMMAPanel } from '../shared/evaluacion-mma-panel';
import { DescargarFicha } from '../shared/descargar-ficha';

/**
 * Panel del maestro: lista de solo-lectura de los alumnos a su cargo — los
 * de los grupos (horarios) que el administrador le asignó más los asignados
 * individualmente. El backend devuelve ÚNICAMENTE esos (ver
 * core.views.AlumnoViewSet.get_queryset y Maestro.alumnos_a_cargo); aquí no
 * se filtra nada. Desde cada alumno se le evalúa: Evaluación MMA por
 * habilidad (con historial) y ficha técnica rápida (Experiencia). No puede
 * editar datos personales, pagos ni membresía: eso sigue siendo exclusivo de
 * admin/alumnos.ts.
 */
@Component({
  selector: 'cb-maestro-alumnos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AvatarComponent,
    CargandoComponent,
    VacioComponent,
    PaginadorComponent,
    ModalComponent,
    ExperienciaForm,
    EvaluacionMMAPanel,
    DescargarFicha,
    RouterLink,
  ],
  template: `
    <div class="pila">
      <h1 style="margin:0">Mis alumnos</h1>
      <p class="mini tenue" style="margin-top:-6px">
        Alumnos de los grupos que tienes asignados y los que te asignaron individualmente.
        Selecciona uno para evaluarlo.
      </p>

      <section class="tarjeta filtros">
        <div class="campo crece">
          <label for="busca">Buscar</label>
          <input
            id="busca"
            [(ngModel)]="busqueda"
            (ngModelChange)="teclea$.next($event)"
            placeholder="Nombre o apodo"
          />
        </div>
      </section>

      @if (cargando()) {
        <cb-cargando />
      } @else if (lista().length) {
        <div class="grid grid-2">
          @for (a of lista(); track a.id) {
            <article class="tarjeta fila alumno-fila" (click)="abrir(a)">
              <cb-avatar [foto]="a.foto" [nombre]="a.nombre_completo" [tam]="48" />
              <div class="crece">
                <strong>{{ a.nombre_completo }}</strong>
                @if (a.apodo) {
                  <div class="mini tenue">"{{ a.apodo }}"</div>
                }
                <div class="mini tenue">{{ a.horario_display ?? 'Sin horario' }}</div>
              </div>
              <span class="chip" [class]="a.activo ? 'chip-verde' : 'chip-gris'">
                {{ a.activo ? 'Activo' : 'Baja' }}
              </span>
            </article>
          }
        </div>

        <cb-paginador [pagina]="pagina()" [total]="total()" (ir)="recargar($event)" />
      } @else {
        <cb-vacio
          icono="🥋"
          titulo="Sin alumnos"
          detalle="Todavía no tienes grupos ni alumnos asignados. Pídele al administrador que te los asigne."
        />
      }
    </div>

    @if (seleccionado(); as a) {
      <cb-modal [titulo]="a.nombre_completo" [amplio]="true" (cerrar)="seleccionado.set(null)">
        <div class="fila-entre envuelve" style="margin-bottom:12px">
          <span class="mini tenue">Evaluación y ficha técnica del peleador</span>
          <div class="fila" style="gap:8px">
            <a class="btn btn-mini" [routerLink]="['/ficha', a.id]">👁 Ver ficha</a>
            <cb-descargar-ficha [alumnoId]="a.id" [mini]="true" />
          </div>
        </div>
        <div class="pestanas">
          <button type="button" [class.activa]="pestana() === 'mma'" (click)="pestana.set('mma')">
            Evaluación MMA
          </button>
          <button type="button" [class.activa]="pestana() === 'ficha'" (click)="pestana.set('ficha')">
            Ficha técnica
          </button>
        </div>

        @if (pestana() === 'mma') {
          <cb-evaluacion-mma-panel [alumnoId]="a.id" [editable]="true" />
        } @else {
          <cb-experiencia-form [experiencia]="a.experiencia" (guardado)="actualizarExperiencia($event)" />
        }
      </cb-modal>
    }
  `,
  styles: [
    `
      .filtros {
        display: flex;
      }
      .filtros .campo {
        margin-bottom: 0;
        flex: 1;
      }
      .alumno-fila {
        cursor: pointer;
        align-items: center;
        gap: 12px;
      }
      .alumno-fila:hover {
        border-color: var(--rojo);
      }
    `,
  ],
})
export class MaestroAlumnos {
  private api = inject(ApiService);

  lista = signal<AlumnoLista[]>([]);
  cargando = signal(true);

  pagina = signal(1);
  total = signal(0);

  busqueda = '';
  teclea$ = new Subject<string>();

  seleccionado = signal<Alumno | null>(null);
  pestana = signal<'mma' | 'ficha'>('mma');

  abrir(a: AlumnoLista): void {
    this.pestana.set('mma');
    this.api.alumno(a.id).subscribe((detalle) => this.seleccionado.set(detalle));
  }

  actualizarExperiencia(exp: Experiencia): void {
    const a = this.seleccionado();
    if (a) this.seleccionado.set({ ...a, experiencia: exp });
  }

  recargar(pagina = 1): void {
    this.cargando.set(true);
    this.pagina.set(pagina);
    this.api
      .alumnos({ page: pagina, search: this.busqueda || undefined, activo: true })
      .subscribe({
        next: (p) => {
          this.lista.set(p.results);
          this.total.set(p.count);
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
  }

  constructor() {
    this.teclea$.pipe(debounceTime(350)).subscribe(() => this.recargar(1));
    this.recargar(1);
  }
}
