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

### 4. Callback (procesamiento de tokens + validación empleado)

**Archivo:** `features/auth/pages/callback/callback.page.ts`

- **Web** (`handleWebCallback`): Verifica sesión con `getSession()`. Si no existe aún, se suscribe a `onAuthStateChange` esperando el evento `SIGNED_IN`. La suscripción se limpia en `ngOnDestroy()`.
- **Android** (`handleAndroidCallback`): Lee `pendingDeepLinkUrl`, parsea el hash para extraer `access_token` y `refresh_token`, llama a `setSession()` para establecer la sesión manualmente.
- Después de establecer sesión (ambas plataformas), llama a `validateAndRedirect()` que ejecuta `AuthService.validateEmployee()` para verificar que el email exista en la tabla `empleados` con `activo = true`
- Si no es empleado válido → cierra sesión y redirige a `/auth/login`
- Si es empleado válido → redirige a `/home`

### 5. Rutas

**Archivo:** `features/auth/auth.routes.ts`

```
/auth/login     → LoginPage
/auth/callback  → CallbackPage
```

Registradas en `app.routes.ts` **fuera** del layout (sin sidebar ni tabs).

### 6. Servicio de Auth

**Archivo:** `features/auth/services/auth.service.ts`

- `hasLocalSession()` → verifica si hay sesión guardada en localStorage (sin llamada de red). Útil para soporte offline
- `getSession()` → retorna la sesión actual de Supabase o null
- `getUser()` → retorna el usuario actual o null
- `validateEmployee()` → consulta tabla `empleados` por email. Retorna `true` si existe y `activo = true`. Si no, muestra error, cierra sesión y redirige al login
- `logout()` → muestra confirmación, cierra sesión y redirige a `/auth/login`. Funciona con o sin internet (limpia sesión local)
- `forceLogout()` → cierra sesión sin confirmación ni loading (uso interno)

### 7. Guards (protección de rutas)

**Archivos:** `core/guards/auth.guard.ts`, `core/guards/public.guard.ts`

#### authGuard (rutas privadas)

Protege el layout principal. Aplicado en `app.routes.ts`.

**Comportamiento con soporte offline:**
- **Con internet:** Valida sesión con Supabase normalmente
- **Sin internet + sesión local:** Permite acceso + muestra toast "Sin conexión a internet"
- **Sin internet + sin sesión:** Redirige a `/auth/login`

Usa `AuthService.hasLocalSession()` para verificar sesión guardada en localStorage sin hacer llamadas de red. Esto evita que la app se quede en pantalla blanca cuando no hay internet.

#### publicGuard (rutas públicas)

Protege el login. Con sesión activa → redirige a `/home`. Aplicado en `auth.routes.ts`.

- **Importante:** `publicGuard` NO se aplica a `/auth/callback` para que el callback siempre se ejecute y valide al empleado

### 8. Datos del usuario en sidebar y configuración

**Archivos:** `shared/components/sidebar/sidebar.component.ts`, `features/configuracion/pages/main/configuracion.page.ts`

- En `ngOnInit()` obtienen el usuario via `AuthService.getUser()`
- Muestran `full_name` y `email` del perfil de Google
- Logout llama a `AuthService.logout()`

---

## Mapa rápido de archivos

| Archivo                                                   | Qué tiene                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `core/services/supabase.service.ts`                       | `signInWithGoogle()` (con `Browser.open()`), `pendingDeepLinkUrl`      |
| `core/guards/auth.guard.ts`                               | Guard para rutas privadas                                              |
| `core/guards/public.guard.ts`                             | Guard para rutas públicas                                              |
| `app.component.ts`                                        | `setupDeepLinkListener()` + `Browser.close()` para Android             |
| `app.routes.ts`                                           | `authGuard` aplicado a layout                                          |
| `features/auth/pages/login/login.page.ts`                 | UI de login + botón Google                                             |
| `features/auth/pages/callback/callback.page.ts`           | Procesa tokens web y Android                                           |
| `features/auth/services/auth.service.ts`                  | `hasLocalSession()`, `getSession()`, `getUser()`, `validateEmployee()`, `logout()` |
| `features/auth/auth.routes.ts`                            | Rutas `/auth/login` (con `publicGuard`) y `/auth/callback` (sin guard) |
| `shared/components/sidebar/sidebar.component.ts`          | Muestra datos del usuario, logout                                      |
| `features/configuracion/pages/main/configuracion.page.ts` | Muestra datos del usuario, logout                                      |

---

## Configuración externa

La configuración de Google Cloud Console y Supabase Dashboard está documentada en [GOOGLE_OAUTH_SETUP.md](../../../../../../../doc/GOOGLE_OAUTH_SETUP.md).

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
