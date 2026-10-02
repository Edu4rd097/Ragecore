import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Alumno, ResumenEvaluacionMMA, claseNivelMMA, estadoPago } from '../core/models';
import {
  AvatarComponent,
  CargandoComponent,
  SemaforoComponent,
  VacioComponent,
} from '../shared/ui';
import { DescargarFicha } from '../shared/descargar-ficha';

/**
 * La pantalla más importante de la app: la ficha del peleador.
 * Todo lo que el alumno quiere saber de un vistazo antes de entrar a entrenar.
 */
@Component({
  selector: 'cb-dashboard-alumno',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    AvatarComponent,
    SemaforoComponent,
    CargandoComponent,
    VacioComponent,
    DescargarFicha,
  ],
  template: `
    @if (cargando()) {
      <cb-cargando texto="Cargando tu ficha" />
    } @else if (!alumno()) {
      <cb-vacio icono="⚠" titulo="No encontramos tu ficha" detalle="Avisa en recepción." />
    } @else {
      <div class="pila">
        <!-- ============ FICHA DE PELEADOR ============ -->
        <section class="ficha">
          <div class="ficha-fondo"></div>

          <div class="ficha-cuerpo">
            <cb-avatar
              [foto]="alumno()!.foto"
              [nombre]="alumno()!.nombre_completo"
              [tam]="96"
              [aro]="true"
              [sinIniciales]="true"
            />

            <div class="ficha-datos">
              @if (alumno()!.apodo) {
                <span class="apodo">"{{ alumno()!.apodo }}"</span>
              }
              <h1>{{ alumno()!.nombre_completo }}</h1>

              <div class="fila envuelve chips">
                <cb-semaforo [estado]="semaforo()" [dias]="alumno()!.dias_para_vencer" />
                @if (exp()?.lesion_activa) {
                  <span class="chip chip-rojo">🩹 Lesionado</span>
                } @else if (alumno()!.activo) {
                  <span class="chip chip-verde">Activo</span>
                } @else {
                  <span class="chip chip-gris">Inactivo</span>
                }
                @for (i of alumno()!.inscripciones; track i.id) {
                  <span class="chip chip-gris">{{ i.disciplina_nombre }}</span>
                }
              </div>

              <div class="meta mini tenue">
                @if (alumno()!.edad) {
                  <span>{{ alumno()!.edad }} años</span>
                }
                @if (alumno()!.peso_actual) {
                  <span>{{ alumno()!.peso_actual }} kg</span>
                }
                @if (alumno()!.estatura) {
                  <span>{{ alumno()!.estatura }} cm</span>
                }
                @if (exp()?.bjj_cinturon_display) {
                  <span>Cinturón {{ exp()!.bjj_cinturon_display }}</span>
                }
              </div>
            </div>

            <!-- Récord estilo cartelera -->
            <div class="record">
              <span class="etiqueta">Récord</span>
              <div class="record-num mono">
                <span class="g">{{ exp()?.peleas_ganadas ?? 0 }}</span>
                <span class="sep">-</span>
                <span class="p">{{ exp()?.peleas_perdidas ?? 0 }}</span>
                <span class="sep">-</span>
                <span class="e">{{ exp()?.peleas_empatadas ?? 0 }}</span>
              </div>
              <span class="mini tenue">G · P · E</span>
            </div>
          </div>

          <!-- Ficha técnica completa en PDF, con el diseño de la academia -->
          <div class="ficha-accion">
            <a class="btn btn-mini" [routerLink]="['/ficha', alumno()!.id]">👁 Ver ficha</a>
            <cb-descargar-ficha [alumnoId]="alumno()!.id" [mini]="true" />
          </div>
        </section>

        <!-- ============ PUNTOS Y RACHA ============ -->
        <div class="grid grid-3">
          <div class="tarjeta destacado">
            <span class="etiqueta">Puntos</span>
            <span class="grande mono">{{ alumno()!.puntos }}</span>
          </div>
          <div class="tarjeta destacado">
            <span class="etiqueta">Racha actual</span>
            <span class="grande mono">
              {{ exp()?.racha_asistencia ?? 0 }}
              @if ((exp()?.racha_asistencia ?? 0) >= 5) {
                <span class="fuego">🔥</span>
              }
            </span>
            <span class="mini tenue">Máxima: {{ exp()?.racha_maxima ?? 0 }}</span>
          </div>
          <div class="tarjeta destacado">
            <span class="etiqueta">Clases tomadas</span>
            <span class="grande mono">{{ alumno()!.total_asistencias }}</span>
          </div>
        </div>

        <!-- ============ EVALUACIÓN MMA (última finalizada) ============ -->
        <section class="tarjeta">
          <div class="fila-entre" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">Evaluación MMA</h2>
            <a routerLink="/mi/progreso" class="mini">Ver detalle →</a>
          </div>

          @if (ultimaMMA(); as u) {
            <div class="fila envuelve mma">
              <span class="grande mono">
                {{ u.puntaje_total }}<span class="mini tenue">/{{ u.puntaje_maximo }}</span>
              </span>
              <span class="chip" [class]="claseNivel(u.nivel)">{{ u.nivel }}</span>
              <span class="mini tenue">Preparación {{ u.preparacion.total }}/100</span>
            </div>
            <p class="mini tenue nivel">
              Evaluado el <span class="mono">{{ u.fecha }}</span>
              @if (exp(); as e) {
                · {{ e.numero_sparrings }} sparrings · {{ e.numero_torneos }} torneos
              }
            </p>
          } @else {
            <p class="mini tenue">Tu maestro todavía no registra una evaluación.</p>
          }
        </section>

        <!-- ============ ÚLTIMAS INSIGNIAS ============ -->
        <section class="tarjeta">
          <div class="fila-entre" style="margin-bottom:14px">
            <h2 class="titulo-seccion" style="margin:0">Últimos logros</h2>
            <a routerLink="/mi/insignias" class="mini">Ver todos →</a>
          </div>

          @if (ultimasInsignias().length) {
            <div class="medallas">
              @for (i of ultimasInsignias(); track i.id) {
                <div class="medalla" [title]="i.insignia_nombre">
                  <div class="disco">🏅</div>
                  <span class="mini">{{ i.insignia_nombre }}</span>
                </div>
              }
            </div>
          } @else {
            <p class="mini tenue">
              Aún no desbloqueas insignias. Entrena seguido y la primera cae sola.
            </p>
          }
        </section>

        <!-- ============ ACCESOS RÁPIDOS ============ -->
        <section>
          <h2 class="titulo-seccion">Accesos rápidos</h2>
          <div class="grid grid-4">
            @for (a of accesos; track a.ruta) {
              <a [routerLink]="a.ruta" class="tarjeta tarjeta-btn acceso">
                <span class="ico">{{ a.icono }}</span>
                <span class="rot">{{ a.rotulo }}</span>
              </a>
            }
          </div>
        </section>
      </div>
    }
  `,
  styles: [
    `
      /* --- Ficha de peleador --- */
      .ficha {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--borde);
        border-radius: var(--r-lg);
        background: var(--negro-800);
      }
      .ficha-fondo {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 85% -10%, rgba(0, 149, 255, 0.22), transparent 55%),
          repeating-linear-gradient(
            -45deg,
            rgba(0, 149, 255, 0.05) 0px,
            rgba(0, 149, 255, 0.05) 2px,
            transparent 2px,
            transparent 14px
          );
      }
      .ficha-cuerpo {
        position: relative;
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 22px;
        flex-wrap: wrap;
      }
      .ficha-datos {
        flex: 1;
        min-width: 190px;
      }
      .apodo {
        font-family: 'Oswald', sans-serif;
        color: var(--rojo-claro);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-size: 0.82rem;
      }
      .ficha-datos h1 {
        margin: 2px 0 10px;
        font-size: 1.55rem;
      }
      .chips {
        margin-bottom: 8px;
      }
      .meta {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .ficha-accion {
        position: relative;
        display: flex;
        justify-content: flex-end;
        align-items: flex-start;
        gap: 8px;
        flex-wrap: wrap;
        padding: 0 18px 16px;
      }
      .record {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 12px 18px;
        background: rgba(0, 0, 0, 0.42);
        border: 1px solid var(--borde);
        border-radius: var(--r);
      }
      .record-num {
        font-family: 'Oswald', sans-serif;
        font-size: 1.75rem;
        font-weight: 700;
        display: flex;
        gap: 5px;
      }
      .record-num .g {
        color: #4ade80;
      }
      .record-num .p {
        color: var(--rojo-claro);
      }
      .record-num .e {
        color: var(--texto-suave);
      }
      .record-num .sep {
        color: var(--texto-tenue);
      }

      /* --- Métricas --- */
      .destacado {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .grande {
        font-family: 'Oswald', sans-serif;
        font-size: 2rem;
        font-weight: 600;
        line-height: 1.1;
        color: var(--rojo-claro);
      }
      .fuego {
        font-size: 1.2rem;
      }

      .mma {
        align-items: center;
        gap: 12px;
      }
      .nivel {
        margin: 14px 0 0;
      }

      /* --- Medallas --- */
      .medallas {
        display: flex;
        gap: 14px;
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .medalla {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        min-width: 84px;
        text-align: center;
      }
      .disco {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.5rem;
        background: radial-gradient(circle at 35% 30%, var(--negro-600), var(--negro-900));
        border: 2px solid var(--rojo);
        box-shadow: 0 0 14px rgba(0, 149, 255, 0.25);
      }

      /* --- Accesos --- */
      .acceso {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        text-decoration: none;
        color: var(--texto);
        padding: 18px 10px;
      }
      .ico {
        font-size: 1.5rem;
      }
      .rot {
        font-family: 'Oswald', sans-serif;
        font-size: 0.76rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        text-align: center;
      }
    `,
  ],
})
export class DashboardAlumno {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  alumno = signal<Alumno | null>(null);
  cargando = signal(true);

  exp = computed(() => this.alumno()?.experiencia ?? null);
  /** Última evaluación MMA finalizada — misma fuente que el panel de "Mi progreso". */
  resumenMMA = signal<ResumenEvaluacionMMA | null>(null);
  ultimaMMA = computed(() => this.resumenMMA()?.ultima ?? null);
  claseNivel = claseNivelMMA;
  semaforo = computed(() =>
    estadoPago(this.alumno()?.al_corriente ?? false, this.alumno()?.dias_para_vencer ?? null),
  );
  ultimasInsignias = computed(() => (this.alumno()?.insignias_ganadas ?? []).slice(0, 6));

  accesos = [
    { ruta: '/mi/perfil', icono: '👤', rotulo: 'Mi perfil' },
    { ruta: '/mi/pagos', icono: '💳', rotulo: 'Mis pagos' },
    { ruta: '/mi/asistencia', icono: '📅', rotulo: 'Mi asistencia' },
    { ruta: '/mi/progreso', icono: '📈', rotulo: 'Mi progreso' },
  ];

  constructor() {
    // El admin que entra a "/mi" no tiene ficha propia; se le muestra vacío.
    const cargar = this.auth.esAlumno()
      ? this.api.yo()
      : this.api.alumno(this.auth.alumnoId() ?? -1);

    cargar.subscribe({
      next: (a) => {
        this.alumno.set(a);
        this.cargando.set(false);
        // Si falla, la tarjeta solo dice que aún no hay evaluación.
        this.api.resumenEvaluacionMMA(a.id).subscribe({
          next: (r) => this.resumenMMA.set(r),
          error: () => this.resumenMMA.set(null),
        });
      },
      error: () => this.cargando.set(false),
    });
  }
}
