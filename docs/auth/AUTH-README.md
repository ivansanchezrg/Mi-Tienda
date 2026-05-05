# Auth - Autenticación con Google OAuth (Multi-Tenant v11)

Módulo de autenticación usando Supabase Auth con Google como proveedor OAuth.
Desde v11, la app es **multi-tenant**: un usuario puede pertenecer a múltiples negocios,
y el negocio activo se controla via JWT claims (`negocio_id`, `rol`).

---

## Qué se implementó y dónde

### 1. Login con Google OAuth

**Archivo:** `core/services/supabase.service.ts` → método `signInWithGoogle()`

- Detecta la plataforma (web o Android) y genera el `redirectUrl` correspondiente
- Web: `${window.location.origin}/auth/callback` (dinámico — funciona en cualquier host/puerto)
- Android: `ec.mitienda.app://auth/callback` (Deep Link)
- Llama a `client.auth.signInWithOAuth()` con provider `google`
- **Nativo:** usa `skipBrowserRedirect: true` y abre la URL manualmente con `Browser.open()` (`@capacitor/browser`) para poder cerrar la pestaña después
- **Web:** usa `skipBrowserRedirect: false` (Supabase redirige normalmente)
- También se agregó la propiedad `pendingDeepLinkUrl` para almacenar la URL del Deep Link en Android

### 2. Página de Login

**Archivo:** `features/auth/pages/login/login.page.ts`

- Botón "Continuar con Google" que llama a `signInWithGoogle()`
- Verifica conexión a internet antes de iniciar OAuth (muestra toast si no hay red)
- Al presionar el botón: spinner inline reemplaza el ícono de Google + texto cambia a "Conectando..."
- `ChangeDetectorRef.detectChanges()` fuerza el render del spinner **antes** de que Capacitor abra el browser OAuth (si no, Angular no actualiza el DOM porque la app ya está yendo al background)
- Maneja error con `UiService.showError()`

### 3. Deep Link Listener (Android)

**Archivo:** `app.component.ts` → método `setupDeepLinkListener()`

- Solo se activa en plataforma nativa (`Capacitor.isNativePlatform()`)
- Escucha el evento `appUrlOpen` de `@capacitor/app`
- Al recibir el deep link, ejecuta `Browser.close()` para cerrar la pestaña de Chrome que se abrió para OAuth
- Guarda la URL completa (con tokens en el hash) en `supabase.pendingDeepLinkUrl`
- Navega a `/auth/callback` usando `NgZone` para que Angular detecte el cambio

### 4. Callback (procesamiento de tokens + validación usuario)

**Archivo:** `features/auth/pages/callback/callback.page.ts`

Supabase OAuth en web usa **flujo implícito**: redirige a `/auth/callback#access_token=...&refresh_token=...` con los tokens en el **hash** de la URL. Con `detectSessionInUrl: false` el SDK **no procesa ese hash automáticamente** — hay que hacerlo manual.

- **Web** (`handleWebCallback`): 3 casos en orden:
  1. **Hash con tokens** (caso normal): parsea `#access_token` + `#refresh_token` del hash y llama `setSession()` directamente — mismo mecanismo que Android
  2. **`?code` PKCE en query params** (flujo alternativo): llama `exchangeCodeForSession()`
  3. **SDK ya procesó la sesión** (fallback): verifica con `getSession()`
  - Si ningún caso tiene tokens → redirige a login directamente (sin esperar `SIGNED_IN`)
- **Android** (`handleAndroidCallback`): Lee `pendingDeepLinkUrl`, parsea el hash para extraer `access_token` y `refresh_token`, llama a `setSession()` para establecer la sesión manualmente.
- Después de establecer sesión (ambas plataformas), llama a `validateAndRedirect()` que ejecuta `AuthService.validarUsuario()`.

> **⚠️ Gotcha crítico — `detectSessionInUrl: false` + flujo implícito web:**
> La implementación de refresh automático de JWT (sección 7) requiere `detectSessionInUrl: false` para que el SDK no interfiera con el callback. Pero esto tiene un efecto secundario: el SDK tampoco procesa el `#hash` con los tokens OAuth al redirigir. Si el callback solo espera el evento `SIGNED_IN` via `onAuthStateChange`, ese evento nunca llega porque el SDK no sabe que hay tokens en la URL — el spinner queda infinito. **Solución: parsear el hash manualmente con `setSession()`**, igual que se hace en Android.

### 5. Rutas

**Archivo:** `features/auth/auth.routes.ts`

```
/auth/login                → LoginPage              (publicGuard — redirige a /caja si ya hay sesión)
/auth/callback             → CallbackPage           (sin guard — siempre debe ejecutarse)
/auth/pending              → PendingPage            (sin guard — lazy loaded)
/auth/seleccionar-negocio  → SelectorNegocioPage    (sin guard — lazy loaded)
/auth/crear-negocio        → CrearNegocioPage       (sin guard — lazy loaded)
```

Registradas en `app.routes.ts` **fuera** del layout (sin sidebar ni tabs).

### 6. Servicio de Auth — Multi-Tenant

**Archivo:** `features/auth/services/auth.service.ts`

#### Estado reactivo

- `usuarioActual$: Observable<UsuarioActual | null>` — emite cada vez que el usuario cambia (login, cambio de rol/nombre via Realtime, logout). El sidebar y otros componentes se suscriben para actualizar la UI sin refrescar.
- `negociosDisponibles: NegocioDisponible[]` — propiedad pública que persiste la lista de negocios para `SelectorNegocioPage` cuando el usuario tiene 2+ negocios. Se limpia tras activar un negocio.
- `validadoEnEstaSesion: boolean` (getter) — flag que indica si `validarUsuario()` ya se ejecutó en esta sesión. Permite que `authGuard` solo valide contra BD en la primera navegación.

#### `validarUsuario()` — flujo v11 multi-tenant

```
1.  getUser() → email del JWT
2.  FROM usuarios SELECT id, nombre, email, es_superadmin, activo WHERE email = $email
3.  No existe → auto-registro (INSERT email + nombre, sin rol) → /onboarding/negocio
4.  activo = false (y no es superadmin) → /auth/pending?motivo=usuario
5.  Existe → iniciarRealtimeUsuario(id) tan pronto como se confirma identidad
6.  Obtener TODAS las membresías (activas e inactivas) con JOIN a negocios(nombre, activo)
7.  Cache hit (negocio_id en Preferences sigue en lista activa) → re-activar directo
8.  es_superadmin sin cache → guardar UsuarioActual mínimo → /admin
9.  0 membresías activas + tiene membresías inactivas → /auth/pending?motivo=membresia
10. 0 membresías en total → /onboarding/negocio (usuario nuevo)
11. Todos los negocios suspendidos → negociosDisponibles = todos → /auth/seleccionar-negocio
12. 1 negocio activo y es el único total → activarNegocio() directo → /caja
13. N negocios (o mix activos+suspendidos) → negociosDisponibles = todos → /auth/seleccionar-negocio
```

**Motivos del paso 11 vs 12:** el selector siempre muestra todos los negocios (activos y suspendidos) para que el usuario vea el estado. Solo activa directo cuando hay exactamente 1 negocio y está activo — así el usuario con un negocio suspendido llega al selector y ve el badge "Suspendido" en vez de recibir un error sin contexto.

**Auto-registro v11:** solo inserta `{ nombre, email }` en `usuarios`. No inserta `rol` ni `activo` — el rol vive en `usuario_negocios` y la activación vive en el flujo de membresía.

#### `activarNegocio(negocio: NegocioDisponible)` — nuevo en v11

Activa un negocio para el usuario (usado tanto en login como en cambio de negocio):

```
1. RPC fn_set_negocio_activo(p_negocio_id) → escribe negocio_id + rol en JWT app_metadata
2. supabase.auth.refreshSession() → cliente recibe JWT actualizado (RLS activas)
3. saveUsuarioActual({ ...usuarioBase, negocio_id, negocio_nombre, rol })
4. iniciarRealtimeUsuario(usuarioBase.id)
5. validadoEnEstaSesion = true, negociosDisponibles = [], usuarioBase = null
6. router.navigate([ROUTES.home])
```

**`usuarioBase`:** propiedad privada que almacena temporalmente `{ id, nombre, email, es_superadmin }` entre `validarUsuario()` y `activarNegocio()`. Se reconstruye si es null (recarga de página durante el flujo).

#### `cambiarNegocio(negocioId, negocioNombre)` — cambio en-sesión

Para cambiar de negocio sin necesidad de re-login (desde el panel admin o selector):
- No depende de `usuarioBase` — lee `UsuarioActual` desde Preferences
- Para usuarios normales, lee el `rol` real de `usuario_negocios` antes de actualizar JWT
- Superadmin siempre opera como `ADMIN` en cualquier negocio
- Llama `fn_set_negocio_activo` + `refreshSession` + `saveUsuarioActual` + navega a `/caja`

#### `irAlPanelAdmin()` — superadmin vuelve al panel

- Solo válido si `es_superadmin = true`
- Limpia `negocio_id` y `negocio_nombre` del cache (panel admin opera sin tenant)
- Navega a `/admin`

#### Métodos de Sesión

- `hasLocalSession()` → verifica si hay sesión guardada en localStorage (sin llamada de red). Útil para soporte offline
- `getSession()` → retorna la sesión actual de Supabase o null
- `getUser()` → retorna el usuario actual o null
- `logout()` → muestra `AlertController` de confirmación, cierra sesión y redirige a `/auth/login`. Para usar **dentro de la app** (sidebar)
- `logoutSilent()` → cierra sesión directo, sin confirmación. Para usar en pantallas pre-app como `PendingPage`
- `forceLogout()` → **privado**, uso interno. Delega a `SupabaseService.handleExpiredSession()` que centraliza toda la limpieza (sesión, storage, canal Realtime via hook, redirect)
- `handleUsuarioDesactivado()` → **privado**, se llama desde el listener de Realtime cuando `activo=false`. A diferencia de `handleExpiredSession()`, este método **no cierra la sesión OAuth** (conserva el JWT para que "Reintentar" funcione en `/auth/pending`). Solo cierra el canal Realtime, limpia Preferences y redirige a `/auth/pending`

#### Métodos de Realtime

- `iniciarRealtimeUsuario(id: string)` → abre canal websocket para escuchar cambios del usuario actual. Idempotente. (ver sección 9)
- `cerrarRealtimeUsuario()` → cierra canal de usuario Y canal de negocio. Se llama automáticamente via hook `registerBeforeCleanup`
- `iniciarRealtimeNegocio(negocioId: string)` → abre canal para detectar suspensión del negocio activo. Se abre en `activarNegocio()`. (ver sección 9)
- `cerrarRealtimeNegocio()` → cierra solo el canal de negocio. Llamado internamente por `cerrarRealtimeUsuario()`

#### Métodos de Usuario Actual (Capacitor Preferences)

**Sistema de caché local para evitar consultas repetidas a la base de datos:**

- `getUsuarioActual()` → Obtiene el usuario actual desde **Capacitor Preferences** (lectura local, instantánea). No hace consultas a la BD. Retorna `null` si no hay usuario guardado.
- `saveUsuarioActual()` → **privado**. Guarda en Preferences y emite en `_usuarioActual$` (BehaviorSubject). Se llama desde `activarNegocio()` y desde el handler de Realtime UPDATE.

**Modelo `UsuarioActual`:**

```typescript
// features/auth/models/usuario_actual.model.ts

export type RolUsuario = 'ADMIN' | 'EMPLEADO';

export interface UsuarioActual {
  id: string;              // UUID (antes era number)
  nombre: string;
  email: string;           // antes: usuario (columna renombrada en BD)
  activo: boolean;
  rol: RolUsuario;         // ADMIN | EMPLEADO (viene de usuario_negocios via JWT)
  es_superadmin: boolean;
  negocio_id: string;      // UUID del negocio activo ('' en superadmin sin negocio)
  negocio_nombre: string;  // nombre para mostrar en sidebar ('' en superadmin sin negocio)
}
```

**¿Cuándo se guarda automáticamente?**

- Al activar un negocio (`activarNegocio()`) — incluye `negocio_id` + `negocio_nombre` + `rol`
- Al recibir un UPDATE via Realtime (nombre, `es_superadmin`)
- Al superadmin navegar a `/admin` (con `negocio_id: ''`)

**¿Cuándo se limpia automáticamente?**

- Al cerrar sesión (`handleExpiredSession()` limpia localStorage + Preferences)
- Al ser desactivado (`handleUsuarioDesactivado()` limpia Preferences pero conserva sesión OAuth)

**Ejemplo de uso en otros módulos:**

```typescript
import { AuthService } from '../../../auth/services/auth.service';

export class MiPage {
  private authService = inject(AuthService);

  async cargarDatos() {
    const usuario = await this.authService.getUsuarioActual();
    if (usuario) {
      console.log('ID:',           usuario.id);
      console.log('Nombre:',       usuario.nombre);
      console.log('Email:',        usuario.email);
      console.log('Rol:',          usuario.rol);
      console.log('Negocio:',      usuario.negocio_nombre);
      console.log('Superadmin:',   usuario.es_superadmin);
    }
  }
}
```

### 7. `NegocioDisponible` — tipo para selector de negocio

```typescript
// Exportado desde features/auth/services/auth.service.ts
export interface NegocioDisponible {
  negocio_id: string;
  negocio_nombre: string;
  rol: 'ADMIN' | 'EMPLEADO';
  negocio_activo: boolean;  // false si el negocio está suspendido
}
```

Usado en `SelectorNegocioPage`, `EditarUsuarioModalComponent` (transferencia de empleados) y `NegocioService`.

### 8. Pantalla selector de negocio (`/auth/seleccionar-negocio`)

**Archivo:** `features/auth/pages/seleccionar-negocio/`

- Se muestra cuando el usuario tiene 2+ negocios o todos están suspendidos
- Lee `authService.negociosDisponibles` (array en memoria, sin nueva query)
- Muestra cards por negocio con nombre + badge de rol (Admin / Empleado)
- Negocios suspendidos muestran badge "Suspendido" (warning), card con opacidad reducida y bloquean el tap con toast explicativo
- Al tocar un negocio activo → `authService.activarNegocio(negocio)` con spinner
- Si `negociosDisponibles` está vacío (recarga de página) → recarga desde BD directamente para evitar bucles
- Inicia `iniciarRealtimeUsuario()` al cargar para detectar suspensión mientras el usuario está eligiendo negocio

### 9. Gestión de JWT y Refresh de Sesión

**Archivos:** `core/services/supabase.service.ts`, `app.component.ts`

#### Cómo funciona el SDK de Supabase JS v2 (internals)

El SDK de Supabase maneja tokens así:

| Token | TTL por defecto | Configurable en |
|---|---|---|
| Access Token (JWT) | 1 hora (3600s) | Supabase Dashboard → Auth → JWT Expiry |
| Refresh Token | 30 días | Supabase Dashboard → Auth → Refresh Token Rotation |

**Flujo interno del SDK:**
1. Al autenticarse, el SDK recibe `access_token` + `refresh_token` y los guarda en `localStorage`
2. Inicia un **timer interno** que renueva el access token ~30s antes de que expire
3. Cuando renueva, emite el evento `TOKEN_REFRESHED` via `onAuthStateChange`
4. Si el refresh token también expiró o fue revocado, emite `SIGNED_OUT`

**Opciones de configuración que usamos:**

```typescript
createClient(url, key, {
  auth: {
    autoRefreshToken: true,    // Renueva JWT automáticamente (default: true)
    persistSession: true,      // Guarda tokens en localStorage (default: true)
    detectSessionInUrl: false  // No parsear tokens de la URL (lo hacemos manual en callback)
  }
});
```

> **⚠️ Efecto secundario de `detectSessionInUrl: false`:** Al desactivar la detección automática, el SDK tampoco procesa el `#hash` con `access_token` y `refresh_token` que Supabase envía en el redirect OAuth. El callback **debe parsear el hash manualmente** con `setSession()`. Si se omite este paso y solo se espera el evento `SIGNED_IN`, ese evento nunca llega y el login queda colgado con spinner infinito. Ver sección 4 (Callback) para el detalle de implementación.

#### Problema en Capacitor/Android

Cuando la app va a background (el usuario cambia a otra app, apaga pantalla, etc.), el WebView se suspende y **el timer de auto-refresh se detiene**. Si el usuario vuelve después de >1h, el access token ya expiró pero el SDK no lo sabe hasta que se ejecuta una query.

**Solución implementada — 3 capas de protección:**

##### Capa 1: Refresh proactivo al volver del background

`app.component.ts` escucha el evento `appStateChange` de Capacitor. Cuando la app vuelve a primer plano (`isActive: true`), llama a `SupabaseService.refreshSessionOnResume()`.

```
app.component.ts → appStateChange → isActive → supabase.refreshSessionOnResume()
```

**Optimizaciones aplicadas para evitar lag al volver del background:**

1. **THROTTLE (30s)** — Si el último refresh fue hace menos de 30 segundos, salir inmediatamente. Android dispara `appStateChange` en ráfagas (desbloqueo, notificaciones, switch rápido entre apps), no tiene sentido refrescar en cada uno.

2. **SKIP TOKEN SANO (>5 min de vida)** — Antes de refrescar, lee `session.expires_at` y calcula cuántos segundos quedan. Si quedan más de 5 minutos, el token está sano → no refrescar. Esto elimina el lag en el 95% de los casos (cuando el usuario vuelve después de poco tiempo). El JWT dura 1 hora, refrescarlo después de 1 minuto de inactividad era un desperdicio.

3. **ANTI-CONCURRENCIA** — Si ya hay un refresh HTTP en curso (`resumeRefreshInFlight`), no dispara otro paralelo. Reutiliza la promesa existente.

| Escenario | Comportamiento |
|---|---|
| Vuelvo después de 10 segundos | Skip total — 0 ms de lag |
| Vuelvo después de 1 minuto | Skip total — token sano |
| Vuelvo después de 30 minutos | Skip total — token tiene 30 min de vida |
| Vuelvo después de 56 minutos | Refresh HTTP — token a punto de expirar |
| Android dispara 5 appStateChange en 10s | 1 solo intento — throttle bloquea los demás |
| Refresh ya está corriendo + otro evento | Reutiliza la promesa en curso |

##### Capa 2: Listener global de `onAuthStateChange`

`SupabaseService` registra un listener global en el constructor que escucha:
- **`TOKEN_REFRESHED`** → log informativo (no requiere acción)
- **`SIGNED_OUT`** → limpia sesión local y redirige al login (con protección anti-loop para no redirigir si ya estamos en `/auth/*`)

Este listener cubre el caso donde el refresh token expiró (>30 días sin abrir la app) — el SDK emite `SIGNED_OUT` automáticamente al intentar renovar.

##### Capa 3: Detección en `call()`

Si por alguna razón las capas 1 y 2 no detectaron el problema, `SupabaseService.call()` detecta errores con "JWT" + "expired"/"invalid" en el mensaje y ejecuta `handleExpiredSession()`.

```
Query falla → catch → isJwtError() → handleExpiredSession()
```

#### `handleExpiredSession()` — Punto centralizado de limpieza

Tanto `AuthService.forceLogout()`, `AuthService.executeLogout()`, el listener de `SIGNED_OUT`, y la detección en `call()` convergen en este único método:

```typescript
async handleExpiredSession(): Promise<void> {
  // 1. Guard anti-múltiples redirects (flag + setTimeout 500ms para cubrir signOut async)
  if (this.redirectingToLogin) return;
  this.redirectingToLogin = true;

  // 2. Hook pre-cleanup (ej: cerrar canal de Realtime del usuario)
  if (this.onBeforeSessionCleanup) {
    try { await this.onBeforeSessionCleanup(); }
    catch (err) { /* log error */ }
  }

  // 3. Limpiar storage local ANTES de signOut (evita race conditions)
  localStorage.removeItem(this.STORAGE_KEY);
  await Preferences.remove({ key: 'usuario_actual' });

  // 4. signOut en Supabase (fire-and-forget, emitirá SIGNED_OUT pero
  //    el listener verifica currentUrl.startsWith('/auth') y no re-ejecuta)
  this.client.auth.signOut().catch(() => {});

  // 5. Redirigir al login (replaceUrl evita botón Atrás)
  await this.router.navigate(['/auth/login'], { replaceUrl: true });

  // 6. Resetear flag con delay (el SIGNED_OUT de signOut llega async)
  setTimeout(() => { this.redirectingToLogin = false; }, 500);
}
```

**Protección contra doble ejecución:** `signOut()` emite `SIGNED_OUT` asíncronamente via `onAuthStateChange`. Sin protección, el listener re-ejecutaría `handleExpiredSession()`. Se evita con dos capas: (1) el listener verifica `currentUrl.startsWith('/auth')` — como ya navegamos a `/auth/login`, no re-entra; (2) el flag `redirectingToLogin` se mantiene `true` por 500ms extras después del navigate para cubrir el delay del evento.

#### Comportamiento del usuario

| Escenario | Qué pasa | El usuario ve |
|---|---|---|
| App en background <55 min | Token sano, `refreshSessionOnResume()` hace skip | Nada, cero lag al volver |
| App en background >55 min, <30 días | `refreshSessionOnResume()` renueva el token | Breve pausa (~500ms) mientras renueva |
| App cerrada >30 días | Refresh token expiró → SDK emite `SIGNED_OUT` | Toast "Sesión expirada" + redirect a login |
| Query falla con JWT expired | `call()` detecta y limpia | Toast "Sesión expirada" + redirect a login |
| Sin internet + sesión local | `authGuard` permite acceso offline | Toast "Sin conexión a internet" |
| Sin internet + sin sesión | `authGuard` redirige | Pantalla de login |
| Email no existe en `usuarios` | Auto-registro (email + nombre) → crear negocio | Pantalla onboarding |
| Sin negocios activos | Redirige a `/auth/crear-negocio` | Onboarding crear negocio |
| 1 negocio | `activarNegocio()` directo | Acceso a `/caja` sin selector |
| N negocios | Selector de negocio | Pantalla de elección |
| Superadmin sin negocio cacheado | Siempre va a `/admin` | Panel de administración |

#### Diagrama de flujo

```
App vuelve del background
  │
  ├─ appStateChange(isActive: true)
  │    └─ refreshSessionOnResume()
  │         ├─ Throttle 30s → skip (si último refresh fue reciente)
  │         ├─ Token sano (>5 min) → skip (sin lag)
  │         ├─ Token por expirar (<5 min) → refresh HTTP
  │         │    ├─ OK → token renovado, queries funcionan
  │         │    └─ Error → SDK emite SIGNED_OUT
  │         │                └─ Listener → handleExpiredSession() → login
  │         └─ Refresh ya en curso → reutiliza promesa existente
  │
  ├─ Primera query después de resume
  │    ├─ OK → flujo normal
  │    └─ JWT expired → call() → handleExpiredSession() → login
  │
  ├─ Realtime canal usuarios: superadmin suspende al usuario (UPDATE activo=false)
  │    └─ handleUsuarioDesactivado() → cerrar ambos canales + limpiar Preferences
  │         └─ /auth/pending?motivo=usuario  (sesión OAuth intacta — "Verificar estado" sin re-login)
  │
  ├─ Realtime canal negocios: superadmin suspende el negocio (UPDATE activo=false)
  │    └─ cerrar ambos canales + limpiar Preferences
  │         └─ /auth/pending?motivo=negocio  (sesión OAuth intacta — "Verificar negocio" sin re-login)
  │
  ├─ Realtime canal usuarios: superadmin cambia nombre del usuario (UPDATE otros campos)
  │    └─ saveUsuarioActual() → emite en usuarioActual$ → sidebar se actualiza en vivo
  │
  ├─ Realtime canal usuarios: superadmin elimina al usuario (DELETE)
  │    └─ handleExpiredSession() → hook cierra ambos canales → signOut → /auth/login
  │
  └─ Logout manual del usuario
       └─ AuthService.logout() → handleExpiredSession() → hook cierra ambos canales → login
```

### 10. Guards (protección de rutas)

**Archivos:** `core/guards/auth.guard.ts`, `core/guards/public.guard.ts`, `core/guards/role.guard.ts`, `core/guards/superadmin.guard.ts`

#### authGuard (rutas privadas)

Protege el layout principal. Aplicado en `app.routes.ts`.

**Comportamiento con soporte offline + validación por sesión:**

| Escenario | Comportamiento |
|---|---|
| Online + sesión + primera navegación | `validarUsuario()` consulta BD, activa negocio, inicia Realtime (usuario + negocio), guarda en Preferences |
| Online + sesión + navegaciones siguientes | Skip — confía en cache + Realtime (cero queries extra) |
| Online + sesión + usuario suspendido en BD | `validarUsuario()` redirige a `/auth/pending?motivo=usuario` |
| Online + sesión + negocio suspendido | Canal Realtime detecta en segundos → `/auth/pending?motivo=negocio` |
| Offline + sesión local + usuario activo | Permite acceso + toast "Sin conexión" |
| Offline + sesión local + usuario inactivo | Redirige a `/auth/pending` (lee Preferences) |
| Offline + sin sesión | Redirige a `/auth/login` |

Usa `AuthService.hasLocalSession()` para verificar sesión guardada en localStorage sin hacer llamadas de red. Usa `AuthService.yaValidadoEnEstaSesion` para evitar consultas BD repetidas.

#### publicGuard (rutas públicas)

Protege el login. Con sesión activa → redirige a `/caja`. Aplicado en `auth.routes.ts`.

- **Importante:** `publicGuard` NO se aplica a `/auth/callback`, `/auth/pending`, `/auth/seleccionar-negocio` ni `/auth/crear-negocio` para que siempre se ejecuten correctamente

#### roleGuard (rutas por rol)

**Archivo:** `core/guards/role.guard.ts`

Protege rutas que requieren un rol específico. Lee el rol desde `getUsuarioActual()` (Preferences, sin consulta a BD).

- Si el usuario no tiene el rol requerido → redirige a `/caja` (no al login, ya está autenticado)
- Si no hay usuario en caché → redirige a `/caja`

**Uso:**

```typescript
// layout.routes.ts
{
  path: 'usuarios',
  canActivate: [roleGuard(['ADMIN'])],
  loadChildren: () => import('../usuarios/usuarios.routes').then(...)
},
```

**Acceso por rol:**

| Sección | EMPLEADO | ADMIN |
|---|---|---|
| Home / Dashboard | ✅ | ✅ |
| Historial de Gastos | ✅ | ✅ |
| Historial de Recargas | ✅ | ✅ |
| Saldo Virtual | ✅ | ✅ |
| Operaciones de Caja | ✅ | ✅ |
| Cierre Diario | ✅ | ✅ |
| Usuarios | ❌ | ✅ |
| Configuración | ❌ | ✅ |

#### superadminGuard (panel admin)

Protege `/admin`. Verifica `es_superadmin = true` en `getUsuarioActual()`. Si no es superadmin → redirige a `/caja`.

### 11. Realtime — detección en vivo de suspensión, desactivación y cambios de usuario

**Problema que resuelve:** un usuario logueado puede seguir operando indefinidamente si el admin lo desactiva o suspende el negocio directamente en BD. El JWT sigue siendo válido hasta expirar (1h), y `validarUsuario()` solo se llama al hacer login. Sin Realtime, la única protección es esperar a que el JWT expire.

**Solución:** dos canales Realtime independientes, uno por tabla:

| Canal | Tabla | Evento | Efecto |
|-------|-------|--------|--------|
| `usuario-activo-{id}` | `usuarios` | `UPDATE activo=false` | `handleUsuarioDesactivado()` → `/auth/pending?motivo=usuario` |
| `usuario-activo-{id}` | `usuarios` | `UPDATE otros campos` | Actualiza cache + emite `usuarioActual$` → sidebar se actualiza en vivo |
| `usuario-activo-{id}` | `usuarios` | `DELETE` | `handleExpiredSession()` → cierra sesión + `/auth/login` |
| `negocio-activo-{id}` | `negocios` | `UPDATE activo=false` | Cierra ambos canales + limpia Preferences + `/auth/pending?motivo=negocio` |

#### Canal de usuario (`iniciarRealtimeUsuario`)

- Se abre una sola conexión por sesión: `canal usuario-activo-{id}`
- Filtro: `id=eq.{id}` — solo el registro del usuario actual
- `UPDATE activo=false` → `handleUsuarioDesactivado()`: **NO cierra la sesión OAuth**. Solo cierra canales + limpia Preferences + redirige a `/auth/pending?motivo=usuario`. El usuario puede tocar "Verificar estado" cuando lo reactiven sin re-autenticarse.
- `UPDATE` otros campos (nombre, es_superadmin) → `saveUsuarioActual()` + emite `usuarioActual$`. `NgZone.run()` para que Angular detecte el cambio.
- `DELETE` → `handleExpiredSession()` → cierre completo de sesión + `/auth/login`
- Se inicia en `validarUsuario()` tan pronto como se confirma la identidad (antes de activar negocio) — cubre la pantalla del selector y el onboarding

#### Canal de negocio (`iniciarRealtimeNegocio`)

- Se abre en `activarNegocio()` junto con el canal de usuario
- Filtro: `id=eq.{negocioId}` — solo el negocio activo del usuario
- `UPDATE activo=false` → cierra ambos canales (`cerrarRealtimeUsuario()` llama a `cerrarRealtimeNegocio()` internamente) + limpia Preferences + toast + `/auth/pending?motivo=negocio`
- Idempotente: si ya hay canal para el mismo negocio, no abre otro

#### Comportamiento diferenciado por tipo de suspensión

```
activo=false en tabla usuarios (propietario suspendido por superadmin)
  → handleUsuarioDesactivado()
  → toast "Tu acceso fue suspendido por el administrador."
  → navigate /auth/pending?motivo=usuario
  → [sesión OAuth conservada para "Verificar estado"]

activo=false en tabla negocios (negocio suspendido por superadmin)
  → handler de iniciarRealtimeNegocio
  → toast "Este negocio fue suspendido por el administrador."
  → navigate /auth/pending?motivo=negocio
  → [sesión OAuth conservada para "Verificar estado"]
```

#### Ambos canales se inician incluso en el selector de negocios

`iniciarRealtimeUsuario()` se llama desde `validarUsuario()` — antes de activar ningún negocio — para proteger la pantalla del selector. `iniciarRealtimeNegocio()` se llama al activar. Si el usuario es suspendido mientras elige negocio, el canal de usuario ya está escuchando.

#### Política RLS requerida en BD

- Tabla `usuarios`: cada usuario solo recibe eventos de su propio registro (`email = auth.jwt() ->> 'email'`). Ver `docs/auth/sql/setup/realtime_usuarios.sql`.
- Tabla `negocios`: debe estar publicada con `REPLICA IDENTITY FULL`. Ver `docs/admin/sql/setup/realtime_negocios.sql`.

#### Hook `registerBeforeCleanup` — cierre sin dependencias circulares

`SupabaseService` no puede importar `AuthService` (dependencia circular). `AuthService` registra un hook en su constructor:

```typescript
this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeUsuario());
```

`cerrarRealtimeUsuario()` cierra el canal de usuario Y el de negocio. Se ejecuta ante cualquier logout: SDK, guard, `call()` JWT expired, logout manual, Realtime DELETE.

#### Cobertura de escenarios

| Escenario | Sin Realtime | Con Realtime |
|---|---|---|
| Superadmin suspende usuario logueado | Sigue operando 1h hasta que expire el JWT | Redirige a `/auth/pending?motivo=usuario` en segundos. Sesión OAuth conservada. |
| Superadmin suspende negocio activo | Sigue operando 1h | Redirige a `/auth/pending?motivo=negocio` en segundos. Sesión OAuth conservada. |
| Superadmin elimina usuario logueado | Sigue operando 1h | Redirige a `/auth/login` en segundos. Sesión cerrada. |
| Superadmin cambia nombre del usuario | No se entera hasta cerrar app | Sidebar se actualiza en vivo |
| Superadmin reactiva usuario | Debe cerrar y abrir la app | "Verificar estado" en `/auth/pending` re-ejecuta `validarUsuario()` sin re-login |
| Superadmin reactiva negocio | Debe cerrar y abrir la app | "Verificar negocio" en `/auth/pending` re-ejecuta `validarUsuario()` sin re-login |
| App sin internet al suspender | — | Evento se entrega al reconectarse (Supabase encola) |
| Doble llamada a `iniciarRealtimeUsuario()` | — | Idempotente — mismo id: no abre segundo canal |
| Realtime falla al suscribirse | — | Log de error, el usuario entra normal. Las capas de JWT y guards siguen activas. |

### 12. Sidebar con datos reactivos del usuario y negocio

**Archivo:** `shared/components/sidebar/sidebar.component.ts`

- En `ngOnInit()` obtiene el usuario via `AuthService.getUsuarioActual()` (Preferences, sin consulta a BD)
- Se suscribe a `AuthService.usuarioActual$` (BehaviorSubject) para recibir cambios en tiempo real
- Cuando Realtime envía un UPDATE (cambio de nombre), el sidebar se actualiza automáticamente sin refrescar
- Muestra `nombre`, `email` y `rol` del usuario logueado
- Muestra `negocio_nombre` del negocio activo (nuevo en v11)
- El rol se muestra como "Administrador" o "Empleado" (legible)
- **Filtra los items del menú según el rol:** ADMIN ve "Usuarios" y "Configuración"; EMPLEADO no los ve. El menú se recalcula cada vez que el rol cambia.
- Logout llama a `AuthService.logout()`
- La suscripción se limpia en `ngOnDestroy()` para evitar memory leaks

### 13. Superadmin (`es_superadmin`)

**Columna en BD:** `es_superadmin BOOLEAN DEFAULT FALSE` en tabla `usuarios`

Marca a un usuario como el administrador principal del sistema. Solo puede haber uno (el primer usuario insertado en `schema.sql`).

**Flujo del superadmin:**
1. Login → `validarUsuario()` detecta `es_superadmin = true` sin negocio cacheado → guarda `UsuarioActual` con `negocio_id: ''` → navega a `/admin`
2. Desde `/admin`, toca un negocio → `cambiarNegocio()` → JWT actualizado con ese `negocio_id` → `/caja` para operar dentro del negocio como ADMIN
3. Desde `/caja`, puede volver a `/admin` via `irAlPanelAdmin()` (botón en sidebar)

**Protecciones implementadas:**

| Capa | Protección |
|---|---|
| Guard | `superadminGuard` protege `/admin` — verifica `es_superadmin` en Preferences |
| UI — editar-usuario-modal | Banner "Administrador principal". Campos de rol y estado deshabilitados visualmente + click guards |
| Lógica — editar-usuario-modal | El DTO solo envía `nombre` para superadmin (nunca `rol` ni `activo`) |
| UI — listado usuarios | Badge "Super" con icono escudo (reemplaza badge de rol normal) |
| Cache | `UsuarioActual` y `Usuario` incluyen `es_superadmin: boolean` |

**Misma protección se aplica cuando un usuario edita su propio perfil** (`esMismoUsuario`): no puede cambiar su rol ni desactivarse.

### 14. Módulo Usuarios

La gestión del equipo (listado, alta, edición, transferencia entre sucursales) está documentada en [`docs/usuarios/USUARIOS-README.md`](../usuarios/USUARIOS-README.md).

Lo que conecta auth con usuarios:
- `NegocioDisponible` (exportado desde `auth.service.ts`) es el tipo que usa `EditarUsuarioModalComponent` para listar las sucursales destino en la transferencia
- `comparten_negocio()` (definida en `schema.sql`) es el helper de RLS que determina qué usuarios ve el admin — incluye inactivos intencionalmente para que puedan ser gestionados
- El `negocio_id` del JWT (seteado por `fn_set_negocio_activo`) es lo que filtra el equipo visible en el listado

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---|---|
| `core/services/supabase.service.ts` | `signInWithGoogle()`, `pendingDeepLinkUrl`, listener global de auth, `handleExpiredSession()` (con hook `registerBeforeCleanup` + protección anti-doble-ejecución), `refreshSessionOnResume()` (con throttle 30s + skip token sano + anti-concurrencia), detección JWT en `call()` |
| `core/guards/auth.guard.ts` | Guard para rutas privadas (autenticación + offline fallback + validación por sesión con `yaValidadoEnEstaSesion`) |
| `core/guards/public.guard.ts` | Guard para rutas públicas (evita login si ya hay sesión) |
| `core/guards/role.guard.ts` | Guard para rutas por rol (`roleGuard(['ADMIN'])`) |
| `core/guards/superadmin.guard.ts` | Guard para `/admin` — verifica `es_superadmin` |
| `app.component.ts` | `setupDeepLinkListener()` (deep links Android) + `setupResumeListener()` (refresh on resume) |
| `app.routes.ts` | `authGuard` aplicado a layout |
| `features/auth/models/usuario_actual.model.ts` | `UsuarioActual` (con `negocio_id`, `negocio_nombre`, `es_superadmin`, `id: string`), `RolUsuario` |
| `features/auth/pages/login/login.page.ts` | UI de login + botón Google con spinner inline + `ChangeDetectorRef` para forzar render antes del OAuth |
| `features/auth/pages/callback/callback.page.ts` | Procesa tokens web y Android, llama `validarUsuario()` |
| `features/auth/pages/pending/pending.page.ts` | Pantalla de suspensión con UI contextual según `?motivo=usuario\|negocio\|membresia`. "Verificar estado" consulta BD directamente antes de llamar `validarUsuario()` — evita falso positivo "sigue suspendido" cuando ya fue reactivado. |
| `features/auth/pages/seleccionar-negocio/` | Selector de negocio activo. Muestra todos (activos + suspendidos). Badge "Suspendido" en warning, bloqueo de tap en suspendidos. Inicia Realtime al cargar. |
| `features/auth/services/auth.service.ts` | `hasLocalSession()`, `getSession()`, `getUser()`, `validarUsuario()` (multi-tenant + suspensión), `activarNegocio()`, `cambiarNegocio()`, `irAlPanelAdmin()`, `logout()`, `logoutSilent()`, `iniciarRealtimeUsuario()`, `cerrarRealtimeUsuario()`, `iniciarRealtimeNegocio()`, `cerrarRealtimeNegocio()`, `handleUsuarioDesactivado()`, `getUsuarioActual()` (Preferences), `usuarioActual$` (BehaviorSubject reactivo), `negociosDisponibles` |
| `features/auth/services/negocio.service.ts` | `getMisNegocios()` — lista de negocios del usuario autenticado (para transferencias y cambio de negocio). Incluye `negocio_activo: boolean` |
| `features/auth/auth.routes.ts` | Rutas `/auth/login` (publicGuard), `/auth/callback`, `/auth/pending`, `/auth/seleccionar-negocio`, `/auth/crear-negocio` |
| `shared/components/sidebar/sidebar.component.ts` | Muestra datos del usuario + nombre del negocio activo, filtra items por rol, suscripción reactiva a `usuarioActual$`, logout |
| `docs/setup/02_rls.sql` | Script SQL idempotente con TODAS las políticas RLS del proyecto, incluidas `usuarios`, `usuario_negocios`, `negocios`. Ejecutar tras cada `schema.sql` |
| `docs/auth/sql/setup/realtime_usuarios.sql` | Publicación Realtime para tabla `usuarios` (suspensión + cambios en tiempo real) |
| `docs/admin/sql/setup/realtime_negocios.sql` | Publicación Realtime para tabla `negocios` (suspensión en tiempo real) |
| `docs/auth/sql/setup/trigger_proteger_superadmin.sql` | Trigger + política DELETE que blinda al superadmin contra UPDATE/DELETE accidentales |
| `docs/setup/03_functions.sql` | Incluye `fn_set_negocio_activo`. Bloquea acceso si `usuarios.activo=false` o `negocios.activo=false` (excepto superadmin) |
| `docs/setup/schema.sql` | `comparten_negocio()` — helper RLS + columna `activo` en `usuarios` |
| `docs/admin/ADMIN-README.md` | Panel superadmin: gestión de negocios, suspensión, funciones SQL, setup Realtime |
| `docs/usuarios/USUARIOS-README.md` | Documentación completa del módulo de gestión de equipo |

---

## Configuración externa

La configuración de Google Cloud Console y Supabase Dashboard está documentada en [GOOGLE_OAUTH_SETUP.md](../GOOGLE_OAUTH_SETUP.md).

### Android - Deep Link (AndroidManifest.xml)

Se agregó manualmente el siguiente `intent-filter` dentro del `<activity>` principal en `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Deep Link para OAuth callback (Google/Supabase) -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="ec.mitienda.app" />
</intent-filter>
```

**IMPORTANTE:** El valor de `android:scheme` debe coincidir con el `appId` en `capacitor.config.ts` y con el `redirectUrl` en `supabase.service.ts` (`ec.mitienda.app://auth/callback`).

---

## Tareas pendientes

- [ ] Verificar que `trg_updated_at_usuario_negocios` no rompa otras operaciones tras el DROP (o agregar columna `updated_at` a `usuario_negocios` si se necesita)
- [ ] Probar `fn_transferir_empleado` con el trigger eliminado

---

## Referencia cruzada

- **Wizard de creación de negocio (onboarding):** [`docs/onboarding/ONBOARDING-README.md`](../onboarding/ONBOARDING-README.md)
- **Panel de superadmin (gestión de negocios, suspensión):** [`docs/admin/ADMIN-README.md`](../admin/ADMIN-README.md)
- **Gestión del equipo (empleados, roles):** [`docs/usuarios/USUARIOS-README.md`](../usuarios/USUARIOS-README.md)
- **Configuración Google OAuth:** [`docs/guides/GOOGLE_OAUTH_SETUP.md`](../guides/GOOGLE_OAUTH_SETUP.md)
