import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  inject,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';

import { AuthService, tokenInterceptor } from './core/auth.service';
import { routes } from './app.routes';

/**
 * La sesión se restaura ANTES de que el router evalúe los guards.
 * Si no, al recargar la app el guard vería `autenticado() === false`
 * y mandaría al login a alguien que sí tiene sesión válida.
 */
function restaurarSesion() {
  const auth = inject(AuthService);
  return () => firstValueFrom(auth.restaurarSesion());
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([tokenInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    { provide: APP_INITIALIZER, useFactory: restaurarSesion, multi: true },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
