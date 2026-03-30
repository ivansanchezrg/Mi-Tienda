# Auth - Autenticación con Google OAuth

Módulo de autenticación usando Supabase Auth con Google como proveedor OAuth.

---

## Qué se implementó y dónde

### 1. Login con Google OAuth

**Archivo:** `core/services/supabase.service.ts` → método `signInWithGoogle()`

- Detecta la plataforma (web o Android) y genera el `redirectUrl` correspondiente
- Web: `localhost:8100/auth/callback`
- Android: `ec.mitienda.app://auth/callback` (Deep Link)
- Llama a `client.auth.signInWithOAuth()` con provider `google`
- **Nativo:** usa `skipBrowserRedirect: true` y abre la URL manualmente con `Browser.open()` (`@capacitor/browser`) para poder cerrar la pestaña después
- **Web:** usa `skipBrowserRedirect: false` (Supabase redirige normalmente)
- También se agregó la propiedad `pendingDeepLinkUrl` para almacenar la URL del Deep Link en Android

### 2. Página de Login

**Archivo:** `features/auth/pages/login/login.page.ts`

- Botón "Continuar con Google" que llama a `signInWithGoogle()`
- Verifica conexión a internet antes de iniciar OAuth (muestra toast si no hay red)
- No muestra loading propio porque la app va a segundo plano al abrir el navegador
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
- Después de establecer sesión (ambas plataformas), llama a `validateAndRedirect()` que ejecuta `AuthService.validarUsuario()` para verificar que el email exista en la tabla `usuarios` con `activo = true`
- Si no es usuario válido → cierra sesión y redirige a `/auth/login`
- Si es usuario válido → redirige a `/home`

> **⚠️ Gotcha crítico — `detectSessionInUrl: false` + flujo implícito web:**
> La implementación de refresh automático de JWT (sección 7) requiere `detectSessionInUrl: false` para que el SDK no interfiera con el callback. Pero esto tiene un efecto secundario: el SDK tampoco procesa el `#hash` con los tokens OAuth al redirigir. Si el callback solo espera el evento `SIGNED_IN` via `onAuthStateChange`, ese evento nunca llega porque el SDK no sabe que hay tokens en la URL — el spinner queda infinito. **Solución: parsear el hash manualmente con `setSession()`**, igual que se hace en Android.

### 5. Rutas

**Archivo:** `features/auth/auth.routes.ts`

```
/auth/login     → LoginPage
/auth/callback  → CallbackPage
```

Registradas en `app.routes.ts` **fuera** del layout (sin sidebar ni tabs).

### 6. Servicio de Auth

**Archivo:** `features/auth/services/auth.service.ts`

#### Métodos de Sesión

- `hasLocalSession()` → verifica si hay sesión guardada en localStorage (sin llamada de red). Útil para soporte offline
- `getSession()` → retorna la sesión actual de Supabase o null
- `getUser()` → retorna el usuario actual o null
- `validarUsuario()` → consulta tabla `usuarios` por email, seleccionando también `rol`. Retorna `true` si existe y `activo = true`. Si no, muestra error, cierra sesión y redirige al login. **Después de validar, guarda automáticamente el usuario en Preferences**
- `logout()` → muestra confirmación, cierra sesión y redirige a `/auth/login`. Funciona con o sin internet (limpia sesión local y Preferences)
- `forceLogout()` → cierra sesión sin confirmación ni loading (uso interno). Limpia sesión local y Preferences

#### Métodos de Usuario Actual (Capacitor Preferences)

**Sistema de caché local para evitar consultas repetidas a la base de datos:**

- `getUsuarioActual()` → Obtiene el usuario actual desde **Capacitor Preferences** (lectura local, instantánea). No hace consultas a la BD. Retorna `null` si no hay usuario guardado.

**Modelo `UsuarioActual`:**

```typescript
// features/auth/models/usuario_actual.model.ts

export type RolUsuario = 'ADMIN' | 'EMPLEADO';

export interface UsuarioActual {
  id: number;
  nombre: string;
  usuario: string;  // Email (coincide con Google account)
  activo: boolean;
  rol: RolUsuario;  // 'ADMIN' o 'EMPLEADO'
}
```

**¿Cuándo se guarda automáticamente?**

Al iniciar sesión exitosamente, `validarUsuario()` consulta la tabla `usuarios` UNA SOLA VEZ y guarda los datos en Preferences. A partir de ahí, todos los módulos pueden usar `getUsuarioActual()` sin consultar Supabase.

**¿Cuándo se limpia automáticamente?**

Al cerrar sesión (tanto `logout()` como `forceLogout()`), se limpian automáticamente las Preferences.

**Ejemplo de uso en otros módulos:**

```typescript
import { AuthService } from '../../../auth/services/auth.service';

export class MiPage {
  private authService = inject(AuthService);

  async cargarDatos() {
    // Lectura instantánea, sin consulta a BD
    const usuario = await this.authService.getUsuarioActual();

    if (usuario) {
      console.log('ID:', usuario.id);
      console.log('Nombre:', usuario.nombre);
      console.log('Email:', usuario.usuario);
      console.log('Rol:', usuario.rol); // 'ADMIN' o 'EMPLEADO'
    }
  }
}
```

**Ventajas:**

- ⚡ **10x más rápido** - Lectura local vs consulta HTTP a Supabase
- 📱 **Funciona offline** - Datos guardados en el dispositivo
- 💾 **Ahorra ancho de banda** - No consulta BD repetidamente
- 🔋 **Ahorra batería** - Menos operaciones de red
- 🎯 **Automático** - Se guarda al login, se limpia al logout

### 7. Gestión de JWT y Refresh de Sesión

**Archivos:** `core/services/supabase.service.ts`, `core/services/ui.service.ts`, `app.component.ts`

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

`app.component.ts` escucha el evento `appStateChange` de Capacitor. Cuando la app vuelve a primer plano (`isActive: true`), llama a `SupabaseService.refreshSessionOnResume()` que fuerza un `client.auth.refreshSession()`. Esto renueva el access token antes de que cualquier query lo use.

```
app.component.ts → appStateChange → isActive → supabase.refreshSessionOnResume()
```

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
  // 1. Guard anti-múltiples redirects
  if (this.redirectingToLogin) return;
  this.redirectingToLogin = true;

  // 2. signOut en Supabase (ignora errores si no hay red)
  this.client.auth.signOut().catch(() => {});

  // 3. Limpiar localStorage (tokens) y Preferences (usuario cacheado)
  localStorage.removeItem(this.STORAGE_KEY);
  await Preferences.remove({ key: 'usuario_actual' });

  // 4. Redirigir al login (replaceUrl evita botón Atrás)
  await this.router.navigate(['/auth/login'], { replaceUrl: true });
  this.redirectingToLogin = false;
}
```

#### Comportamiento del usuario

| Escenario | Qué pasa | El usuario ve |
|---|---|---|
| App en background <1h | Access token aún válido | Nada, todo funciona normal |
| App en background >1h, <30 días | `refreshSessionOnResume()` renueva el token | Nada, transparente |
| App cerrada >30 días | Refresh token expiró → SDK emite `SIGNED_OUT` | Toast "Sesión expirada" + redirect a login |
| Query falla con JWT expired | `call()` detecta y limpia | Toast "Sesión expirada" + redirect a login |
| Sin internet + sesión local | `authGuard` permite acceso offline | Toast "Sin conexión a internet" |
| Sin internet + sin sesión | `authGuard` redirige | Pantalla de login |

#### Diagrama de flujo

```
App vuelve del background
  │
  ├─ appStateChange(isActive: true)
  │    └─ refreshSessionOnResume()
  │         ├─ OK → token renovado, queries funcionan
  │         └─ Error → SDK emite SIGNED_OUT
  │                     └─ Listener → handleExpiredSession() → login
  │
  ├─ Primera query después de resume
  │    ├─ OK → flujo normal
  │    └─ JWT expired → call() → handleExpiredSession() → login
  │
  └─ Logout manual del usuario
       └─ AuthService.logout() → handleExpiredSession() → login
```

### 8. Guards (protección de rutas)

**Archivos:** `core/guards/auth.guard.ts`, `core/guards/public.guard.ts`, `core/guards/role.guard.ts`

#### authGuard (rutas privadas)

Protege el layout principal. Aplicado en `app.routes.ts`.

**Comportamiento con soporte offline:**
- **Con internet:** Valida sesión con Supabase normalmente
- **Sin internet + sesión local:** Permite acceso + muestra toast "Sin conexión a internet"
- **Sin internet + sin sesión:** Redirige a `/auth/login`

Usa `AuthService.hasLocalSession()` para verificar sesión guardada en localStorage sin hacer llamadas de red. Esto evita que la app se quede en pantalla blanca cuando no hay internet.

#### publicGuard (rutas públicas)

Protege el login. Con sesión activa → redirige a `/home`. Aplicado en `auth.routes.ts`.

- **Importante:** `publicGuard` NO se aplica a `/auth/callback` para que el callback siempre se ejecute y valide al usuario

#### roleGuard (rutas por rol)

**Archivo:** `core/guards/role.guard.ts`

Protege rutas que requieren un rol específico. Lee el rol desde `getUsuarioActual()` (Preferences, sin consulta a BD).

- Si el usuario no tiene el rol requerido → redirige a `/home` (no al login, ya está autenticado)
- Si no hay usuario en caché → redirige a `/home`

**Uso:**

```typescript
// layout.routes.ts
{
  path: 'usuarios',
  canActivate: [roleGuard(['ADMIN'])],
  loadChildren: () => import('../usuarios/usuarios.routes').then(...)
},
{
  path: 'configuracion',
  canActivate: [roleGuard(['ADMIN'])],
  loadChildren: () => import('../configuracion/configuracion.routes').then(...)
}
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

### 9. Sidebar con datos reales del usuario

**Archivo:** `shared/components/sidebar/sidebar.component.ts`

- En `ngOnInit()` obtiene el usuario via `AuthService.getUsuarioActual()` (Preferences, sin consulta a BD)
- Muestra `nombre`, `usuario` (email) y `rol` del usuario logueado
- El rol se muestra como "Administrador" o "Empleado" (legible)
- **Filtra los items del menú según el rol:** ADMIN ve "Usuarios" y "Configuración"; EMPLEADO no los ve
- Los items con `soloAdmin: true` solo aparecen si `empleadoRol === 'ADMIN'`
- Logout llama a `AuthService.logout()`

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---|---|
| `core/services/supabase.service.ts` | `signInWithGoogle()`, `pendingDeepLinkUrl`, listener global de auth, `handleExpiredSession()`, `refreshSessionOnResume()`, detección JWT en `call()` |
| `core/services/ui.service.ts` | `formatErrorMessage()` (convierte errores técnicos a mensajes amigables) |
| `core/guards/auth.guard.ts` | Guard para rutas privadas (autenticación + offline fallback) |
| `core/guards/public.guard.ts` | Guard para rutas públicas (evita login si ya hay sesión) |
| `core/guards/role.guard.ts` | Guard para rutas por rol (`roleGuard(['ADMIN'])`) |
| `app.component.ts` | `setupDeepLinkListener()` (deep links Android) + `setupResumeListener()` (refresh on resume) |
| `app.routes.ts` | `authGuard` aplicado a layout |
| `features/auth/models/usuario_actual.model.ts` | `UsuarioActual`, `RolUsuario` |
| `features/auth/pages/login/login.page.ts` | UI de login + botón Google |
| `features/auth/pages/callback/callback.page.ts` | Procesa tokens web y Android, llama `validarUsuario()` |
| `features/auth/services/auth.service.ts` | `hasLocalSession()`, `getSession()`, `getUser()`, `validarUsuario()`, `logout()`, **`getUsuarioActual()`** (Preferences) |
| `features/auth/auth.routes.ts` | Rutas `/auth/login` (con `publicGuard`) y `/auth/callback` (sin guard) |
| `shared/components/sidebar/sidebar.component.ts` | Muestra datos del usuario, filtra items por rol, logout |

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
