import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { CargandoComponent } from '../shared/ui';

/** Manda a cada quien a su área según el rol. */
@Component({
  selector: 'cb-redirigir',
  standalone: true,
  imports: [CargandoComponent],
  template: `<cb-cargando texto="Entrando" />`,
})
export class Redirigir {
  constructor() {
    const auth = inject(AuthService);
    inject(Router).navigate([auth.rutaInicio()]);
  }
}
