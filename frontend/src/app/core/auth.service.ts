import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { API_BASE } from './api.service';
import { RespuestaLogin, Rol, Usuario } from './models';

const CLAVE_TOKEN = 'casabrava_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  /** Estado reactivo. Los componentes leen estos signals directamente. */
  readonly usuario = signal<Usuario | null>(null);
  readonly cargando = signal(true);

  readonly autenticado = computed(() => this.usuario() !== null);
  readonly rol = computed<Rol | null>(() => this.usuario()?.rol ?? null);
  readonly esAdmin = computed(() => this.rol() === 'ADMINISTRATIVO');
  readonly esMaestro = computed(() => this.rol() === 'MAESTRO');
  readonly esAlumno = computed(() => this.rol() === 'ALUMNO');
  readonly alumnoId = computed(() => this.usuario()?.alumno_id ?? null);

  get token(): string | null {
    return localStorage.getItem(CLAVE_TOKEN);
  }

  login(username: string, password: string): Observable<RespuestaLogin> {
    return this.http.post<RespuestaLogin>(`${API_BASE}/auth/login/`, { username, password }).pipe(
      tap((r) => {
        localStorage.setItem(CLAVE_TOKEN, r.token);
        this.usuario.set(r.usuario);
      }),
    );
  }

  /**
   * Al recargar la PWA el signal se pierde pero el token no.
   * Esto rehidrata la sesión antes de que arranque el router.
   */
  restaurarSesion(): Observable<Usuario | null> {
    if (!this.token) {
      this.cargando.set(false);
      return of(null);
    }
    return this.http.get<Usuario>(`${API_BASE}/auth/yo/`).pipe(
      tap((u) => {
        this.usuario.set(u);
        this.cargando.set(false);
      }),
      catchError(() => {
        this.limpiar();
        this.cargando.set(false);
        return of(null);
      }),
    );
  }

  cambiarPassword(actual: string, nueva: string) {
    return this.http
      .post<{ detail: string; token: string }>(`${API_BASE}/auth/cambiar-password/`, {
        actual,
        nueva,
      })
      .pipe(tap((r) => localStorage.setItem(CLAVE_TOKEN, r.token)));
  }

  logout(): void {
    // No esperamos la respuesta: la sesión local se corta de inmediato.
    this.http.post(`${API_BASE}/auth/logout/`, {}).subscribe({ error: () => {} });
    this.limpiar();
    this.router.navigate(['/entrar']);
  }

  limpiar(): void {
    localStorage.removeItem(CLAVE_TOKEN);
    this.usuario.set(null);
  }

  /** Ruta de inicio según el rol. */
  rutaInicio(): string {
    if (this.esAdmin()) return '/admin';
    if (this.esMaestro()) return '/maestro';
    if (this.esAlumno()) return '/mi';
    return '/entrar';
  }
}

// ---------------------------------------------------------------------------
// Interceptor: agrega el token y maneja el 401
// ---------------------------------------------------------------------------

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token;

  const peticion = token
    ? req.clone({ setHeaders: { Authorization: `Token ${token}` } })
    : req;

  return next(peticion).pipe(
    catchError((err: HttpErrorResponse) => {
      // Token vencido o revocado: se cierra sesión en vez de dejar la app en
      // un estado a medias donde todo falla en silencio.
      if (err.status === 401 && !req.url.includes('/auth/login/')) {
        auth.limpiar();
        router.navigate(['/entrar']);
      }
      return throwError(() => err);
    }),
  );
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export const guardAutenticado: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.autenticado() ? true : router.createUrlTree(['/entrar']);
};

/** Uso: canActivate: [guardRol('ADMINISTRATIVO')] */
export function guardRol(...roles: Rol[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.autenticado()) return router.createUrlTree(['/entrar']);
    // A quien entra por la puerta equivocada se le manda a la suya, no a un 403.
    return roles.includes(auth.rol()!) ? true : router.createUrlTree([auth.rutaInicio()]);
  };
}

/** Impide volver al login con la sesión abierta. */
export const guardInvitado: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.autenticado() ? router.createUrlTree([auth.rutaInicio()]) : true;
};
