# Auth - Autenticación con Google OAuth

Módulo de autenticación usando Supabase Auth con Google como proveedor OAuth.

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
- Después de establecer sesión (ambas plataformas), llama a `validateAndRedirect()` que ejecuta `AuthService.validarUsuario()` para verificar el estado del usuario en la tabla `usuarios`:
  - **No existe** → auto-registro con `activo: false` + redirige a `/auth/pending?estado=nuevo`
  - **Existe, `activo: false`** → redirige a `/auth/pending` (sin query param)
  - **Existe, `activo: true`** → guarda en Preferences, inicia Realtime y redirige a `/home`

> **⚠️ Gotcha crítico — `detectSessionInUrl: false` + flujo implícito web:**
> La implementación de refresh automático de JWT (sección 7) requiere `detectSessionInUrl: false` para que el SDK no interfiera con el callback. Pero esto tiene un efecto secundario: el SDK tampoco procesa el `#hash` con los tokens OAuth al redirigir. Si el callback solo espera el evento `SIGNED_IN` via `onAuthStateChange`, ese evento nunca llega porque el SDK no sabe que hay tokens en la URL — el spinner queda infinito. **Solución: parsear el hash manualmente con `setSession()`**, igual que se hace en Android.

### 5. Rutas

**Archivo:** `features/auth/auth.routes.ts`

```
/auth/login     → LoginPage       (publicGuard — redirige a /home si ya hay sesión)
/auth/callback  → CallbackPage    (sin guard — siempre debe ejecutarse)
/auth/pending   → PendingPage     (sin guard — lazy loaded)
```

Registradas en `app.routes.ts` **fuera** del layout (sin sidebar ni tabs).

### 6. Servicio de Auth

**Archivo:** `features/auth/services/auth.service.ts`

#### Estado reactivo

- `usuarioActual$: Observable<UsuarioActual | null>` — emite cada vez que el usuario cambia (login, cambio de rol/nombre via Realtime, logout). El sidebar y otros componentes se suscriben para actualizar la UI sin refrescar.
- `yaValidadoEnEstaSesion: boolean` — flag que indica si `validarUsuario()` ya se ejecutó en esta sesión. Permite que `authGuard` solo valide contra BD en la primera navegación.

#### Métodos de Sesión

- `hasLocalSession()` → verifica si hay sesión guardada en localStorage (sin llamada de red). Útil para soporte offline
- `getSession()` → retorna la sesión actual de Supabase o null
- `getUser()` → retorna el usuario actual o null
- `validarUsuario()` → consulta tabla `usuarios` por email con `.maybeSingle()` (incluye `es_superadmin`). Tres caminos:
  1. **No existe** → auto-inserta `{ nombre, usuario: email, rol: 'EMPLEADO', activo: false }` y navega a `/auth/pending?estado=nuevo`
  2. **Existe, `activo: false`** → guarda en Preferences y navega a `/auth/pending`
  3. **Existe, `activo: true`** → guarda en Preferences, inicia Realtime (`iniciarRealtimeUsuario(id)`) y retorna `true`
- `logout()` → muestra `AlertController` de confirmación, cierra sesión y redirige a `/auth/login`. Para usar **dentro de la app** (sidebar)
- `logoutSilent()` → cierra sesión directo, sin confirmación. Para usar en pantallas pre-app como `PendingPage`
- `forceLogout()` → **privado**, uso interno. Delega a `SupabaseService.handleExpiredSession()` que centraliza toda la limpieza (sesión, storage, canal Realtime via hook, redirect)
- `handleUsuarioDesactivado()` → **privado**, se llama desde el listener de Realtime cuando `activo=false`. A diferencia de `handleExpiredSession()`, este método **no cierra la sesión OAuth** (conserva el JWT para que "Reintentar" funcione en `/auth/pending`). Solo cierra el canal Realtime, limpia Preferences y redirige a `/auth/pending`

#### Métodos de Realtime

- `iniciarRealtimeUsuario(id)` → abre canal websocket para escuchar cambios del usuario actual (ver sección 9)
- `cerrarRealtimeUsuario()` → cierra el canal y resetea flags. Se llama automáticamente via hook `registerBeforeCleanup`

#### Métodos de Usuario Actual (Capacitor Preferences)

**Sistema de caché local para evitar consultas repetidas a la base de datos:**

- `getUsuarioActual()` → Obtiene el usuario actual desde **Capacitor Preferences** (lectura local, instantánea). No hace consultas a la BD. Retorna `null` si no hay usuario guardado.
- `saveUsuarioActual()` → **privado**. Guarda en Preferences y emite en `_usuarioActual$` (BehaviorSubject). Se llama desde `validarUsuario()` y desde el handler de Realtime UPDATE.

**Modelo `UsuarioActual`:**

```typescript
// features/auth/models/usuario_actual.model.ts

export type RolUsuario = 'ADMIN' | 'EMPLEADO';

export interface UsuarioActual {
  id: number;
  nombre: string;
  usuario: string;       // Email (coincide con Google account)
  activo: boolean;
  rol: RolUsuario;       // 'ADMIN' o 'EMPLEADO'
  es_superadmin: boolean; // true = administrador principal, no editable
}
```

**¿Cuándo se guarda automáticamente?**

- Al iniciar sesión exitosamente (`validarUsuario()` consulta la tabla `usuarios` y guarda)
- Al recibir un UPDATE via Realtime (rol, nombre, etc.)

**¿Cuándo se limpia automáticamente?**

- Al cerrar sesión (`handleExpiredSession()` limpia localStorage + Preferences)
- Al ser desactivado (`handleUsuarioDesactivado()` limpia Preferences pero conserva sesión OAuth)

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
      console.log('Rol:', usuario.rol);
      console.log('Superadmin:', usuario.es_superadmin);
    }
  }
}
```

### 7. Gestión de JWT y Refresh de Sesión

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
| Email no existe en `usuarios` | Auto-registro con `activo: false` | Pantalla pending "Registro exitoso" |
| Email existe pero `activo: false` | Guard o validación redirige | Pantalla pending "Aprobación pendiente" |
| Admin activa la cuenta | `validarUsuario()` retorna true | Acceso normal al home |

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
  ├─ Realtime: admin desactiva al usuario (UPDATE activo=false)
  │    └─ handleUsuarioDesactivado() → cerrar canal + limpiar Preferences → /auth/pending
  │       (sesión OAuth intacta — usuario puede tocar "Reintentar")
  │
  ├─ Realtime: admin cambia rol/nombre del usuario (UPDATE otros campos)
  │    └─ saveUsuarioActual() → emite en usuarioActual$ → sidebar se actualiza en vivo
  │
  ├─ Realtime: admin elimina al usuario (DELETE)
  │    └─ handleExpiredSession() → hook cierra canal → signOut → /auth/login
  │
  └─ Logout manual del usuario
       └─ AuthService.logout() → handleExpiredSession() → hook cierra canal → login
```

### 8. Guards (protección de rutas)

**Archivos:** `core/guards/auth.guard.ts`, `core/guards/public.guard.ts`, `core/guards/role.guard.ts`

#### authGuard (rutas privadas)

Protege el layout principal. Aplicado en `app.routes.ts`.

**Comportamiento con soporte offline + validación por sesión:**

| Escenario | Comportamiento |
|---|---|
| Online + sesión + primera navegación | `validarUsuario()` consulta BD, inicia Realtime, guarda en Preferences |
| Online + sesión + navegaciones siguientes | Skip — confía en cache + Realtime (cero queries extra) |
| Online + sesión + usuario inactivo en BD | `validarUsuario()` redirige a `/auth/pending` |
| Offline + sesión local + usuario activo | Permite acceso + toast "Sin conexión" |
| Offline + sesión local + usuario inactivo | Redirige a `/auth/pending` (lee Preferences) |
| Offline + sin sesión | Redirige a `/auth/login` |

Usa `AuthService.hasLocalSession()` para verificar sesión guardada en localStorage sin hacer llamadas de red. Usa `AuthService.yaValidadoEnEstaSesion` para evitar consultas BD repetidas.

#### publicGuard (rutas públicas)

Protege el login. Con sesión activa → redirige a `/home`. Aplicado en `auth.routes.ts`.

- **Importante:** `publicGuard` NO se aplica a `/auth/callback` ni `/auth/pending` para que siempre se ejecuten correctamente

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

### 9. Realtime — detección de usuario desactivado/eliminado/modificado en vivo

**Problema que resuelve:** un usuario logueado puede seguir operando indefinidamente si el admin lo desactiva o elimina directamente en BD. El JWT sigue siendo válido hasta expirar (1h), y `validarUsuario()` solo se llama al hacer login. Sin Realtime, la única protección es esperar a que el JWT expire o a que el usuario cierre y vuelva a abrir la app.

**Solución:** igual que `ConfigService` escucha cambios en `configuraciones`, `AuthService` escucha cambios en el registro del usuario actual en la tabla `usuarios` via Supabase Realtime.

#### Cómo funciona el listener

- Se abre **una sola conexión websocket** por sesión (canal `usuario-activo-{id}`)
- Filtra solo el registro del usuario actual: `filter: 'id=eq.{id}'`
- Escucha dos eventos con **comportamiento diferente** según el caso:
  - **`UPDATE`** con `activo=false` → `handleUsuarioDesactivado()` → cierra canal + limpia Preferences + redirige a `/auth/pending`. **NO cierra la sesión OAuth** (el usuario puede tocar "Reintentar" si lo reactivan sin necesidad de hacer login de nuevo)
  - **`UPDATE`** con otros cambios (rol, nombre, `es_superadmin`) → `saveUsuarioActual()` → emite en `usuarioActual$` → sidebar y UI se actualizan en vivo. Usa `NgZone.run()` para que Angular detecte el cambio.
  - **`DELETE`** → `handleExpiredSession()` → cierra sesión completa + redirige a `/auth/login` (no hay usuario que validar, el registro ya no existe)
- El canal se **cierra automáticamente** ante cualquier tipo de logout/expiración via el hook `registerBeforeCleanup` de `SupabaseService`. Esto garantiza cero websockets huérfanos sin importar la causa del cierre de sesión.
- Se inicia en `iniciarRealtimeUsuario(id)` — llamado desde `validarUsuario()` justo después de guardar el usuario en Preferences
- Es **idempotente**: si ya hay un canal abierto para el mismo usuario, no abre otro. Si hay un canal para otro usuario (cambio de cuenta), lo cierra primero.

#### Diferencia clave vs `configuraciones`

| | `configuraciones` | `usuarios` |
|---|---|---|
| Canal | `config-changes` (global) | `usuario-activo-{id}` (por usuario) |
| Filtro | `clave=eq.pos_habilitado` | `id=eq.{id}` |
| Eventos | `UPDATE` | `UPDATE` + `DELETE` |
| Al recibir UPDATE | Emite en `posHabilitado$` | Desactivado → pending / Otros → actualiza cache + UI |
| Se cierra | Nunca (singleton) | Al hacer logout |

#### Política RLS requerida en BD

A diferencia de `configuraciones` (política permisiva para todos), `usuarios` usa una política restrictiva: **cada usuario solo recibe eventos de su propio registro**, usando `auth.jwt() ->> 'email'` para comparar con la columna `usuario`.

Script completo: [`sql/setup/realtime_usuarios.sql`](./sql/setup/realtime_usuarios.sql)

```sql
-- Publicar tabla
ALTER PUBLICATION supabase_realtime ADD TABLE usuarios;

-- Política: solo el propio registro
CREATE POLICY "usuario puede leer su propio registro"
ON usuarios FOR SELECT TO authenticated
USING (usuario = (auth.jwt() ->> 'email'));
```

#### Hook `registerBeforeCleanup` — cómo se cierra el canal sin dependencias circulares

`SupabaseService` no puede importar `AuthService` directamente (dependencia circular). Para cerrar el canal al expirar la sesión, `AuthService` registra un hook genérico en su constructor:

```typescript
// AuthService constructor
this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeUsuario());
```

`handleExpiredSession()` ejecuta este hook antes de limpiar la sesión. Así el canal siempre se cierra sin importar quién disparó el logout (SDK, guard, `call()`, logout manual, Realtime DELETE).

#### Cobertura de escenarios

| Escenario | Sin Realtime | Con Realtime |
|---|---|---|
| Admin desactiva usuario logueado | Sigue operando hasta cerrar app | Redirige a `/auth/pending` en segundos (conserva sesión para "Reintentar") |
| Admin elimina usuario logueado | Sigue operando hasta que JWT expire (1h) | Redirige a `/auth/login` en segundos (sesión cerrada completa) |
| Admin cambia rol del usuario | No se entera hasta cerrar app | Sidebar y menú se actualizan en vivo |
| Admin cambia nombre del usuario | No se entera hasta cerrar app | Sidebar muestra el nombre nuevo en vivo |
| Admin reactiva usuario tras desactivarlo | Debe cerrar y abrir la app | Puede tocar "Reintentar" en `/auth/pending` sin re-autenticarse |
| App sin internet al momento del evento | — | Evento se entrega al reconectarse (Supabase encola) |
| Usuario hace logout manual | — | Canal cerrado via hook `registerBeforeCleanup` |
| JWT expira (>1h background) | — | Canal cerrado via hook cuando `handleExpiredSession()` se ejecuta |
| Doble llamada a `iniciarRealtimeUsuario()` | — | Idempotente: si el canal ya existe para ese ID, no abre otro |
| Realtime falla al suscribirse | — | Log de error, el usuario entra normal — las capas JWT siguen como red de seguridad |

### 10. Sidebar con datos reactivos del usuario

**Archivo:** `shared/components/sidebar/sidebar.component.ts`

- En `ngOnInit()` obtiene el usuario via `AuthService.getUsuarioActual()` (Preferences, sin consulta a BD)
- Se suscribe a `AuthService.usuarioActual$` (BehaviorSubject) para recibir cambios en tiempo real
- Cuando Realtime envía un UPDATE (cambio de rol, nombre, etc.), el sidebar se actualiza automáticamente sin refrescar
- Muestra `nombre`, `usuario` (email) y `rol` del usuario logueado
- El rol se muestra como "Administrador" o "Empleado" (legible)
- **Filtra los items del menú según el rol:** ADMIN ve "Usuarios" y "Configuración"; EMPLEADO no los ve. El menú se recalcula cada vez que el rol cambia via Realtime.
- Logout llama a `AuthService.logout()`
- La suscripción se limpia en `ngOnDestroy()` para evitar memory leaks

### 11. Superadmin (`es_superadmin`)

**Columna en BD:** `es_superadmin BOOLEAN DEFAULT FALSE` en tabla `usuarios`

Marca a un usuario como el administrador principal del sistema. Solo puede haber uno (el primer usuario insertado en `schema.sql`).

**Protecciones implementadas:**

| Capa | Protección |
|---|---|
| UI — editar-usuario-modal | Banner "Administrador principal". Campos de rol y estado deshabilitados visualmente + click guards |
| Lógica — editar-usuario-modal | El DTO solo envía `nombre` para superadmin (nunca `rol` ni `activo`) |
| UI — listado usuarios | Badge "Super" con icono escudo (reemplaza badge de rol normal) |
| Realtime | El handler de UPDATE incluye `es_superadmin` en el modelo actualizado |
| Cache | `UsuarioActual` y `Usuario` incluyen `es_superadmin: boolean` |

**Misma protección se aplica cuando un usuario edita su propio perfil** (`esMismoUsuario`): no puede cambiar su rol ni desactivarse.

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---|---|
| `core/services/supabase.service.ts` | `signInWithGoogle()`, `pendingDeepLinkUrl`, listener global de auth, `handleExpiredSession()` (con hook `registerBeforeCleanup` + protección anti-doble-ejecución), `refreshSessionOnResume()` (con throttle 30s + skip token sano + anti-concurrencia), detección JWT en `call()` |
| `core/guards/auth.guard.ts` | Guard para rutas privadas (autenticación + offline fallback + validación por sesión con `yaValidadoEnEstaSesion`) |
| `core/guards/public.guard.ts` | Guard para rutas públicas (evita login si ya hay sesión) |
| `core/guards/role.guard.ts` | Guard para rutas por rol (`roleGuard(['ADMIN'])`) |
| `app.component.ts` | `setupDeepLinkListener()` (deep links Android) + `setupResumeListener()` (refresh on resume) |
| `app.routes.ts` | `authGuard` aplicado a layout |
| `features/auth/models/usuario_actual.model.ts` | `UsuarioActual` (con `es_superadmin`), `RolUsuario` |
| `features/auth/pages/login/login.page.ts` | UI de login + botón Google con spinner inline + `ChangeDetectorRef` para forzar render antes del OAuth |
| `features/auth/pages/callback/callback.page.ts` | Procesa tokens web y Android, llama `validarUsuario()` |
| `features/auth/pages/pending/pending.page.ts` | Pantalla de cuenta pendiente — dos estados: `?estado=nuevo` (primer registro) vs sin param (ya registrado, sin aprobación). Botón "Reintentar" llama `validarUsuario()`, botón "Salir" llama `logoutSilent()` |
| `features/auth/services/auth.service.ts` | `hasLocalSession()`, `getSession()`, `getUser()`, `validarUsuario()` (auto-registro + inicia Realtime), `logout()`, `logoutSilent()`, `iniciarRealtimeUsuario()`, `cerrarRealtimeUsuario()`, `handleUsuarioDesactivado()`, `getUsuarioActual()` (Preferences), `usuarioActual$` (BehaviorSubject reactivo) |
| `features/auth/auth.routes.ts` | Rutas `/auth/login` (con `publicGuard`), `/auth/callback` (sin guard), `/auth/pending` (lazy loaded, sin guard) |
| `shared/components/sidebar/sidebar.component.ts` | Muestra datos del usuario, filtra items por rol, suscripción reactiva a `usuarioActual$`, logout |
| `docs/auth/sql/setup/realtime_usuarios.sql` | Script SQL para habilitar Realtime en tabla `usuarios` + política RLS (ejecutar 1 vez en Supabase) |

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
