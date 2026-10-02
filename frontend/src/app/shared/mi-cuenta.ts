import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { CambiarPassword } from './cambiar-password';

/**
 * "Mi perfil" del maestro y del administrativo: datos de la cuenta con la que
 * entró y la sección Seguridad → Cambiar contraseña. Se monta en dos rutas
 * (/maestro/perfil y /admin/perfil), igual que maestro/eventos.ts. El alumno
 * tiene su propia página (alumno/perfil.ts) porque además edita sus datos.
 */
@Component({
  selector: 'cb-mi-cuenta',
  standalone: true,
  imports: [CommonModule, CambiarPassword],
  template: `
    @if (auth.usuario(); as u) {
      <div class="pila">
        <h1>Mi perfil</h1>

        <section class="tarjeta">
          <h2 class="titulo-seccion">Mi cuenta</h2>
          <dl class="lista-datos">
            <div>
              <dt class="etiqueta">Nombre</dt>
              <dd>{{ u.nombre }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Usuario</dt>
              <dd class="mono">{{ u.username }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Correo</dt>
              <dd>{{ u.email || '—' }}</dd>
            </div>
            <div>
              <dt class="etiqueta">Rol</dt>
              <dd>
                <span class="chip chip-gris">{{ rotuloRol(u.rol) }}</span>
              </dd>
            </div>
            @if (u.maestro; as m) {
              <div>
                <dt class="etiqueta">Grupos asignados</dt>
                <dd>
                  @if (m.horarios.length) {
                    @for (h of m.horarios; track h.id) {
                      <span class="chip chip-gris">{{ h.nombre }}</span>
                    }
                  } @else {
                    <span class="tenue">Ninguno todavía</span>
                  }
                </dd>
              </div>
              <div>
                <dt class="etiqueta">Alumnos a cargo</dt>
                <dd class="mono">{{ m.total_alumnos }}</dd>
              </div>
            }
          </dl>
          <p class="mini tenue" style="margin:12px 0 0">
            Estos datos los administra la academia. Si algo no cuadra, avísale al administrador.
          </p>
        </section>

        <cb-cambiar-password />
      </div>
    }
  `,
  styles: [
    `
      .lista-datos {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .lista-datos div {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      dd {
        margin: 0;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class MiCuenta {
  auth = inject(AuthService);

  rotuloRol(rol: string): string {
    switch (rol) {
      case 'ADMINISTRATIVO':
        return 'Staff / Admin';
      case 'MAESTRO':
        return 'Maestro';
      case 'ALUMNO':
        return 'Alumno';
      default:
        return rol;
    }
  }
}
