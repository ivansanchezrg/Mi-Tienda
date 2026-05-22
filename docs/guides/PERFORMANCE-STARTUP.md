# Rendimiento de Arranque — Mi Tienda

Guía de referencia sobre el estado actual de la optimización de startup y los cambios aplicados el 2026-05-22.

---

## Objetivo

Reducir el tiempo de carga inicial de la app (cold start) de ~5 segundos a 2-3 segundos en Android, sin sacrificar seguridad ni correctitud.

---

## Estado actual — qué ya estaba bien antes de los cambios

| Área | Estado | Detalle |
|---|---|---|
| Lazy loading de rutas | ✅ | Todas las rutas usan `loadChildren`. Sin imports eagerly en `app.routes.ts` |
| Build config (AOT) | ✅ | `angular.json` producción: `optimization: true`, `sourceMap: false`, `namedChunks: false`. AOT activo por defecto |
| SplashScreen control | ✅ | `launchAutoHide: false` en `capacitor.config.ts`. Se oculta en el primer `NavigationEnd` con fallback de 3s |
| Skeleton screens | ✅ | `home.page.html` usa `ion-skeleton-text` extensivamente mientras `cargando = true` |
| APP_INITIALIZER | ✅ | No existe — el auth es guard-driven, no bloquea el bootstrap de Angular |
| Queries en el home | ✅ | `cargarDatos()` usa `Promise.all()` para las 8 queries en paralelo |
| `@defer` en templates | ✅ | Aplicado en 2026-05-22 (ver abajo) |
| Cache de sesión en guard | ✅ | Aplicado en 2026-05-22 (ver abajo) |

---

## Cambios aplicados el 2026-05-22

### 1. Fast path en `authGuard` (mayor impacto)

**Archivo:** `src/app/core/guards/auth.guard.ts`

**Problema:** En cada cold start con sesión válida, el guard ejecutaba `validarUsuario()` de forma síncrona — 2 queries a Supabase (~800-1600ms) antes de que Angular pudiera renderizar el home.

**Solución:** Si el JWT no expiró Y hay `UsuarioActual` en Preferences (cache local), el guard retorna `true` inmediatamente sin esperar red. La validación contra BD ocurre en background (fire-and-forget).

**Flujo nuevo:**

```
authGuard (cold start con sesión previa):
  ├── JWT válido + UsuarioActual en cache
  │   ├── iniciarRealtimeDesdeCache()  ← protección activa desde el primer render
  │   ├── validarUsuarioBackground()   ← valida contra BD sin bloquear
  │   └── return true INMEDIATO        ← Angular renderiza el home al instante
  │
  └── Sin cache o JWT expirado         ← flujo síncrono completo (primera instalación, logout)
      └── validarUsuario() síncrono → BD → redirige según resultado
```

**Casos que siguen siendo síncronos (sin cambio de seguridad):**
- Primera instalación (sin `UsuarioActual` en Preferences)
- Después de logout
- JWT expirado
- Sin `hasActiveAuth()` (reinstalación de la app)

**Protección ante suspensión offline:** los canales Realtime (`iniciarRealtimeUsuario` + `iniciarRealtimeMembresia`) se abren antes de soltar el guard. Si el usuario fue suspendido mientras la app estaba cerrada, lo detecta en cuanto el websocket se conecta — redirige a `/auth/pending` automáticamente, igual que antes.

---

### 2. Dos métodos nuevos en `AuthService`

**Archivo:** `src/app/features/auth/services/auth.service.ts`

#### `iniciarRealtimeDesdeCache(usuario: UsuarioActual)`

Abre los canales Realtime usando el `UsuarioActual` del cache local, sin esperar a `validarUsuario()`. Es idempotente — si los canales ya están abiertos, no hace nada.

Garantiza que la protección por desactivación (`activo=false`) esté activa desde el primer render del home, incluso cuando el guard usó el fast path.

#### `validarUsuarioBackground()`

Llama a `validarUsuario()` sin `await` — fire-and-forget. Si la validación detecta un problema (suspensión, sesión inválida), ejecuta el mismo flujo de redirección que el path síncrono. Los errores se loguean vía `LoggerService` y no rompen la UI.

---

### 3. `fn_validar_sesion` — un solo round-trip a la BD

**Archivo SQL:** `docs/auth/sql/functions/fn_validar_sesion.sql`

**Problema:** El slow path de `validarUsuario()` hacía 2 queries **secuenciales**:
1. `SELECT` a `usuarios` (~400-800ms)
2. `SELECT` a `usuario_negocios` JOIN `negocios` (~400-800ms)

Total: ~800-1600ms bloqueando la navegación en cada primera instalación o login fresco.

**Solución:** Una función SQL `fn_validar_sesion()` que devuelve ambos en un único round-trip (~400-700ms). Lee el email del JWT internamente via `get_email()` — sin parámetros externos.

**Retorno:**
```json
{
  "usuario": {
    "id": "uuid",
    "nombre": "string",
    "email": "string",
    "es_superadmin": false,
    "activo": true
  },
  "membresias": [
    {
      "negocio_id": "uuid",
      "rol": "ADMIN",
      "activo": true,
      "negocio_nombre": "string"
    }
  ]
}
```

**Permisos:** `REVOKE` a `anon`, `GRANT` a `authenticated`. `SECURITY DEFINER` + `SET search_path = public`.

**No aplica `fn_assert_no_superadmin`** porque es lectura de datos propios del usuario autenticado — el superadmin también la ejecuta en su propio login.

---

### 4. `@defer` en tarjetas opcionales del home

**Archivo:** `src/app/features/caja/pages/home/home.page.html`

**Problema:** Las tarjetas VARIOS, CELULAR y BUS se compilaban en el mismo chunk que el home, aunque la mayoría de los negocios no las usan (son opt-in por superadmin).

**Solución:** Cada tarjeta opcional está envuelta en `@defer (on idle)`. Angular las carga como chunks JS separados después del primer paint, cuando el browser está ocioso.

```html
@defer (on idle) {
  @if (variosActiva) {
    <!-- tarjeta VARIOS con funcionalidad completa -->
  }
} @placeholder {
  @if (variosActiva) {
    <!-- skeleton idéntico al que ya existía — sin cambio visual -->
  }
}
```

**Tarjetas diferidas:** VARIOS, CELULAR (CAJA_CELULAR), BUS (CAJA_BUS).

**Tarjetas que NO se difieren:** CAJA (Tienda) y CAJA_CHICA (Cajón) — son las 2 cajas base que todo negocio tiene y el usuario las ve siempre en el primer render.

**Impacto visual:** Cero. Si la tarjeta estaba oculta (`variosActiva = false`), el `@defer` tampoco renderiza nada. Si estaba visible, el placeholder muestra el mismo skeleton hasta que el chunk carga (~50-100ms en idle).

---

## Estimación de mejora

| Escenario | Antes | Después |
|---|---|---|
| Cold start con sesión válida (caso 95%) | ~5s | ~2s |
| Primera instalación / login fresco | ~5s | ~3-3.5s |
| Re-apertura tras background corto | ~2-3s | ~1-1.5s |

---

## Deuda técnica / próximos pasos

- **Cache de `ConfigService` persistido:** actualmente el `ConfigService` recarga configuraciones de BD en cada arranque. Persistir en Preferences con TTL de 1h reduciría otra query en el home.
- **Preloading strategy:** evaluar `PreloadAllModules` o una estrategia custom para pre-cargar las rutas más visitadas tras el arranque (ej: ventas, caja) mientras el usuario está en el home.
- **Bundle analysis:** correr `ng build --stats-json` + `webpack-bundle-analyzer` para identificar dependencias pesadas que puedan extraerse con code splitting adicional.

---

## Referencia de archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/core/guards/auth.guard.ts` | Fast path con cache agresivo |
| `src/app/features/auth/services/auth.service.ts` | `iniciarRealtimeDesdeCache()`, `validarUsuarioBackground()`, `validarUsuario()` usa RPC |
| `docs/auth/sql/functions/fn_validar_sesion.sql` | Función SQL nueva — ejecutar en Supabase |
| `src/app/features/caja/pages/home/home.page.html` | `@defer (on idle)` en VARIOS, CELULAR, BUS |
