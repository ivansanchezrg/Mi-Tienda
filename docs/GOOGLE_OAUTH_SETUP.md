# Configuracion de Google OAuth - Mi Tienda

Guia de referencia para la configuracion de Google OAuth con Supabase en este proyecto.

---

## Datos del Proyecto

| Campo | Valor |
|-------|-------|
| Supabase Project ID | `ygubggmnxxgmfhtbifyo` |
| Supabase URL | `https://ygubggmnxxgmfhtbifyo.supabase.co` |
| App ID (Android) | `ec.mitienda.app` |
| Custom Scheme (deep link) | `ec.mitienda.app://` |
| OAuth Flow | `implicit` |
| Callback Web | `http://localhost:8100/auth/callback` |
| Callback Android | `ec.mitienda.app://auth/callback` |
| Supabase Redirect URI | `https://ygubggmnxxgmfhtbifyo.supabase.co/auth/v1/callback` |

---

## Parte 1: Google Cloud Console

### 1.1 Crear Credenciales OAuth 2.0

1. Ve a [Google Cloud Console](https://console.cloud.google.com) > **APIs y servicios** > **Credenciales**
2. Click en **+ Crear credenciales** > **ID de cliente de OAuth 2.0**
3. Tipo: **Aplicacion web**
4. Nombre: `Mi Tienda - Web`

**Origenes de JavaScript autorizados:**

```
http://localhost:8100
http://localhost:4200
https://ygubggmnxxgmfhtbifyo.supabase.co
```

**URIs de redireccion autorizadas:**

```
https://ygubggmnxxgmfhtbifyo.supabase.co/auth/v1/callback
```

5. Copiar el **Client ID** y **Client Secret** generados.

### 1.2 Pantalla de Consentimiento

1. **APIs y servicios** > **Pantalla de consentimiento de OAuth**
2. Tipo: **Externo**
3. Agregar emails de prueba mientras la app este en desarrollo

---

## Parte 2: Supabase Dashboard

### 2.1 Habilitar Google Provider

1. **Authentication** > **Providers** > **Google**
2. Activar toggle **Enabled**
3. Pegar **Client ID** y **Client Secret** de Google Cloud

### 2.2 URL Configuration

En **Authentication** > **URL Configuration**:

**Site URL:**

```
http://localhost:8100
```

**Redirect URLs:**

```
http://localhost:8100/**
ec.mitienda.app://auth/callback
```

---

## Parte 3: Configuracion Android

### 3.1 AndroidManifest.xml

El intent filter para deep links ya esta configurado en `android/app/src/main/AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="ec.mitienda.app" />
</intent-filter>
```

El `android:launchMode="singleTask"` esta en la activity principal.

### 3.2 capacitor.config.ts

```typescript
const config: CapacitorConfig = {
  appId: 'ec.mitienda.app',
  appName: 'Mi Tienda',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};
```

### 3.3 Supabase Client (supabase.service.ts)

El redirect se determina segun la plataforma:

```typescript
const redirectTo = Capacitor.isNativePlatform()
  ? 'ec.mitienda.app://auth/callback'   // Android
  : `${window.location.origin}/auth/callback`;  // Web
```

---

## Flujo de Autenticacion

### Web

1. Usuario click "Continuar con Google"
2. Supabase abre Google OAuth
3. Google redirige a `/auth/callback#access_token=xxx`
4. Supabase detecta el token en `window.location.hash` automaticamente
5. CallbackPage verifica sesion con `getSession()` o `onAuthStateChange`
6. Valida que el email exista en tabla `empleados` con `activo = true`
7. Redirige a `/home`

### Android

1. Usuario click "Continuar con Google"
2. `signInWithGoogle()` usa `skipBrowserRedirect: true` y abre la URL con `Browser.open()` (`@capacitor/browser`)
3. Se abre Chrome con Google OAuth
4. Google redirige a `ec.mitienda.app://auth/callback#access_token=xxx`
5. Android intercepta el deep link via intent filter
6. Evento `appUrlOpen` se dispara en AppComponent
7. AppComponent ejecuta `Browser.close()` para cerrar la pestaña de Chrome
8. Guarda la URL en `supabaseService.pendingDeepLinkUrl` y navega a `/auth/callback`
9. CallbackPage extrae `access_token` y `refresh_token` de la URL guardada
10. Setea la sesion manualmente con `auth.setSession()`
11. Valida que el email exista en tabla `empleados` con `activo = true`
12. Redirige a `/home`

**Diferencia clave:** En web Supabase detecta el token del hash automaticamente (`skipBrowserRedirect: false`). En Android se usa `skipBrowserRedirect: true` + `Browser.open()` para controlar la pestaña y poder cerrarla con `Browser.close()` al volver.

---

## Archivos Involucrados

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/app/core/services/supabase.service.ts` | Cliente Supabase, OAuth, almacena `pendingDeepLinkUrl` |
| `src/app/features/auth/services/auth.service.ts` | Coordina auth + verificacion de empleado |
| `src/app/features/auth/pages/login/login.page.ts` | Pagina de login, inicia OAuth |
| `src/app/features/auth/pages/callback/callback.page.ts` | Procesa tokens OAuth, setea sesion |
| `src/app/app.component.ts` | Deep link listener (`appUrlOpen`) |
| `src/app/core/guards/auth.guard.ts` | Protege rutas autenticadas |
| `src/app/core/guards/public.guard.ts` | Redirige a home si ya esta logueado |
| `android/app/src/main/AndroidManifest.xml` | Intent filter para deep links |
| `capacitor.config.ts` | App ID y configuracion Android |

---

## Problemas Conocidos y Soluciones

### Deep link listener deshabilitado = OAuth no funciona en Android

**Fecha:** 2026-01-27

**Sintoma:** Despues de seleccionar la cuenta de Google en Android, la app vuelve al login en vez de ir a home. En web funciona correctamente.

**Causa:** El deep link listener (`setupDeepLinkListener()`) en `app.component.ts` fue comentado/deshabilitado. Sin el, cuando Google redirige a `ec.mitienda.app://auth/callback#access_token=xxx`:

1. Android abre la app pero Capacitor **no navega automaticamente** el WebView a `/auth/callback`
2. El usuario se queda en la LoginPage
3. Supabase no detecta el token (no esta en `window.location`, esta en la URL del deep link)
4. El flujo se interpreta como cancelacion de OAuth

**NO DESHABILITAR** el listener de deep links en `app.component.ts`. Es indispensable para que OAuth funcione en Android. La linea critica es:

```typescript
// app.component.ts - constructor
this.setupDeepLinkListener();
```

Ademas, `App.getLaunchUrl()` solo funciona en **cold start** (app cerrada). En **warm start** (app ya en memoria, caso comun con `singleTask`) retorna `null`. Por eso se guarda la URL del evento `appUrlOpen` en `supabaseService.pendingDeepLinkUrl` y CallbackPage la lee de ahi.

### Error: "redirect_uri_mismatch"

La URI de redireccion no coincide entre Google Cloud y Supabase. Verificar que en Google Cloud este exactamente:

```
https://ygubggmnxxgmfhtbifyo.supabase.co/auth/v1/callback
```

### Error: "Access blocked: app has not completed verification"

La app esta en modo desarrollo en Google Cloud. Agregar los emails de prueba en **Pantalla de consentimiento OAuth** > **Usuarios de prueba**.

### Usuario autenticado pero sin acceso

El email no esta en la tabla `empleados` o tiene `activo = false`. Verificar en Supabase > Table Editor > `empleados`.

---

## Base de Datos: Tabla empleados

```sql
CREATE TABLE IF NOT EXISTS public.empleados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura a usuarios autenticados"
ON public.empleados FOR SELECT TO authenticated USING (true);
```

---

**Ultima actualizacion**: 2026-01-29
