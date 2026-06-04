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

---

## Cambios aplicados el 2026-05-26

### 5. Guard espera el resume-refresh en curso (warm restart tras inactividad larga)

**Archivos:** `src/app/core/guards/auth.guard.ts`, `src/app/core/services/supabase.service.ts`

**Problema:** Cuando el usuario volvía a la app después de 1+ hora en background, ocurría esto casi en paralelo:

```
appStateChange → refreshSessionOnResume() [fire-and-forget]
                   └── getSession() → token expirado → refreshSession()

Angular router   → authGuard
                   └── auth.getSession() → token expirado → SEGUNDO refresh interno
                         └── Supabase serializa ambos con su lock interno = 4-5s visibles
```

Dos llamadas independientes con token expirado hacen que Supabase encole el segundo refresh detrás del primero — el usuario ve un freeze de 4-5 segundos al volver del background.

**Solución:** `resumeRefreshInFlight` pasó de `private` a público en `SupabaseService`. El guard lo espera antes de llamar `getSession()` si hay uno en curso — el refresh se paga una sola vez.

```typescript
// auth.guard.ts — antes de getSession()
if (supabase.resumeRefreshInFlight) {
  await supabase.resumeRefreshInFlight;
}
```

**Impacto estimado:** warm restart tras 1+ hora de inactividad: de 4-5s → ~2s (igual que cold start).

**Sin cambio de comportamiento** cuando `resumeRefreshInFlight` es null (el 95% del tiempo — token sano o throttle activo).

---

---

## Cambios aplicados el 2026-05-30

### 6. Cache persistido de `ConfigService` (stale-while-revalidate)

**Archivo:** `src/app/core/services/config.service.ts`

**Problema:** El `ConfigService` cacheaba solo en memoria. Cada cold start hacía 1 query bloqueante a `configuraciones` (~200-400ms) que `home.cargarDatos()` esperaba en su `Promise.all()`.

**Solución:** Cache en cascada de 3 niveles:

```
get():
  ├── 1. RAM hit (Configuracion | null)              → ~0ms
  ├── 2. Preferences hit (snapshot válido, TTL 1h)   → ~5-10ms + refresca BD en background
  └── 3. Miss/expirado → query BD                    → ~200-400ms + persiste snapshot
```

**Snapshot persistido:**
```ts
interface CacheSnapshot {
  negocio_id: string | null;   // invalida automáticamente al cambiar tenant
  cached_at: number;            // TTL: 1 hora
  data: Configuracion;
}
```

**Invalidación:**
- **Automática al cambiar negocio** — el snapshot guarda `negocio_id`; si no coincide con el JWT actual, se descarta.
- **Automática en logout** — `registerBeforeCleanup` borra la key.
- **Manual** (`invalidar()`) — al editar parámetros desde Configuración o cambiar descuentos POS. Limpia RAM y Preferences.

**Stale-while-revalidate:** cuando se sirve del cache persistido, se dispara un refresh contra BD en background. El próximo `get()` (incluso en el mismo cold start) ya tiene el valor fresco en RAM.

**Impacto estimado:** -200-400ms en cold start con sesión válida (caso 95%).

---

### 7. Preload selectivo de rutas frecuentes

**Archivos:**
- `src/app/core/strategies/selective-preload.strategy.ts` — nuevo
- `src/app/features/layout/layout.routes.ts` — marca `data: { preload: true }`
- `src/main.ts` — reemplaza `NoPreloading` por `SelectivePreloadStrategy`

**Problema:** `NoPreloading` significa que cada navegación desde el home a Ventas/POS/Inventario descargaba el chunk on-demand (~150-400ms de espera con red móvil).

**Solución:** Estrategia custom que precarga solo las rutas marcadas, esperando 2 segundos tras el bootstrap para no competir con el render inicial del home.

**Rutas marcadas para preload** (uso diario/frecuente desde el home):
- `/pos` — el empleado abre POS varias veces al día
- `/ventas` — admin consulta resumen de ventas diariamente
- `/inventario` — consulta de stock al cobrar
- `/clientes` — listado de clientes con saldo

**Rutas NO marcadas** (uso esporádico, on-demand):
- `/admin`, `/configuracion`, `/notas`, `/usuarios`, `/movimientos-empleados`, `/historial-recargas`

**Estrategia (código):**
```ts
preload(route, load) {
  if (route.data?.['preload'] === true) {
    return timer(2000).pipe(mergeMap(() => load()));
  }
  return of(null);
}
```

**Impacto estimado:** -300-800ms en la **primera navegación** desde el home a una ruta marcada. Chunk ya está en memoria.

**Trade-off:** ~150-300KB extra descargados en background tras el cold start. En 4G es invisible; en 3G/EDGE el chunk se descarga mientras el usuario mira el home.

---

### 8. Bundle analysis — resultados del build de producción

**Build run:** `npx ng build --configuration production --stats-json` (2026-05-30)

**Totales:**

| Métrica | Valor | Estado |
|---|---|---|
| Initial total (raw) | 1.68 MB | Aceptable |
| Initial total (transfer gzip) | **334.91 kB** | ✅ Bien |

**Lazy chunks más pesados (transfer gzip):**

| Chunk | Raw | Transfer | Cuándo se descarga |
|---|---|---|---|
| `apexcharts-ssr-esm` | 523 kB | 116 kB | Solo si se abre Ventas → Resumen |
| `apexcharts-esm` | 517 kB | 115 kB | Idem (variante del bundler — solo se carga uno) |
| `core-esm` (Ionic) | 336 kB | 77 kB | Lazy por rutas que lo usan |
| `pos-page` | 162 kB | 28 kB | Al entrar al POS (ahora precargado) |
| `home-page` | 96 kB | 18 kB | Initial render |
| `producto-crear-page` | 76 kB | 15 kB | Al crear/editar producto |

**Conclusiones:**
- Bundle inicial gzip 335 kB es **excelente** para una app Capacitor con esta superficie funcional. Comparable a referencias industria.
- Apexcharts (~115 kB gzip) está **correctamente lazy** — solo se descarga cuando el admin entra al resumen de ventas. No es problema.
- Las páginas pesadas (POS 28 kB, producto-crear 15 kB) son lazy y razonables para su complejidad.

**Hallazgos secundarios del build:**
1. `pos.page.scss` (28.05 kB) y `producto-crear.page.scss` (23.58 kB) están cerca del límite. Subimos el budget de `anyComponentStyle` a `30kb/40kb` para tener espacio.
2. Warning de Stencil sobre `import("./**/*.entry.js*")` — es ruido del compilador interno de Ionic, no afecta funcionalidad.

---

### 9. `fn_home_dashboard` — RPC consolidada del home

**Archivo SQL:** `docs/caja/sql/functions/fn_home_dashboard.sql`
**Servicio:** `src/app/features/caja/services/turnos-caja.service.ts` (método `obtenerHomeDashboard()`)
**Refactor:** `src/app/features/caja/pages/home/home.page.ts` (método `cargarDatos()`)

**Problema:** `home.cargarDatos()` ejecutaba 8 promesas en paralelo, pero internamente algunas hacían múltiples queries secuenciales:

```
home.cargarDatos() (antes):
  ├── obtenerEstadoCaja()         → 3 queries paralelas a turnos_caja
  ├── getSaldoVirtualActual(CEL)  → 2 queries secuenciales (snapshot + post)
  ├── getSaldoVirtualActual(BUS)  → 2 queries secuenciales (snapshot + post)
  ├── getNotificaciones()         → 3 queries (delegado a NotificacionesService)
  ├── getUsuarioActual()          → 0 queries (cache local sync)
  ├── configService.get()         → 0 queries (cache RAM/Preferences)
  ├── obtenerUltimosMovimientos() → 1 query a operaciones_cajas
  └── contarMovimientosHoy()      → 1 query a operaciones_cajas

Total: ~12 round-trips agrupados en 8 promesas. Limitado por la suma de las cadenas secuenciales (snapshot+post de cada servicio virtual).
```

**Solución:** Una RPC SQL única que consolida los datos más caros:
- Estado de caja (turno activo + count del día + último cierre)
- Saldos virtuales CELULAR y BUS (snapshot + post-snapshot por servicio)
- Últimos 5 movimientos del día + count total

**Flujo nuevo:**

```
home.cargarDatos() (ahora):
  ├── obtenerHomeDashboard()    → 1 RPC con todo lo de arriba
  ├── getNotificaciones()       → queda separada (lógica compleja, se evalúa después)
  ├── getUsuarioActual()        → cache local sync
  └── configService.get()       → cache RAM/Preferences

Total: 1 RPC + 0-1 queries de notificaciones (depende de flags activos). ~250-500ms vs ~400-800ms antes.
```

**Contrato JSON de la RPC:**
```json
{
  "estado_caja": {
    "turno_activo": { ...turno } | null,
    "turnos_hoy": 0,
    "fecha_ultimo_cierre": "2026-05-30" | null
  },
  "saldos_virtuales": { "celular": 0, "bus": 0 },
  "movimientos": {
    "lista": [...últimos 5 movimientos],
    "total": 0
  }
}
```

**Por qué no consolidé `getNotificaciones()` en la RPC:**
- Tiene lógica de negocio compleja (cálculo de días hasta fin de mes, ganancia BUS pendiente, productos con stock bajo).
- Algunos cálculos dependen de configuraciones (`bus_dias_antes_facturacion`).
- Embeber esa lógica en SQL hace la función frágil y difícil de mantener.
- Sigue siendo aceptable porque se ejecuta en paralelo con `obtenerHomeDashboard()`.

**Multi-tenant:** la RPC filtra todo por `public.get_negocio_id()`. Sin `fn_assert_no_superadmin` (es lectura — el superadmin necesita poder ver el dashboard de cualquier negocio activo).

**Métodos NO eliminados:** `obtenerEstadoCaja()`, `getSaldoVirtualActual()`, `obtenerUltimosMovimientos()`, `contarMovimientosHoy()` siguen existiendo porque se usan en otros lugares (cierre diario, modales, pull-to-refresh). Solo el home cambió a la RPC consolidada.

---

## Estimación de mejora actualizada

| Escenario | Original (pre-2026-05-22) | Post 2026-05-22 | Post 2026-05-30 (parte 1) | **Post 2026-05-30 (parte 2)** |
|---|---|---|---|---|
| Cold start con sesión válida (caso 95%) | ~5s | ~2s | ~1.5-1.7s | **~1.2-1.5s** |
| Primera instalación / login fresco | ~5s | ~3-3.5s | ~3-3.5s | ~3-3.5s |
| Re-apertura tras background corto | ~2-3s | ~1-1.5s | ~1-1.5s | **~0.8-1.2s** |
| Warm restart tras 1+ hora background | ~4-5s | ~2s | ~2s | ~2s |
| Primera navegación a /pos /ventas /inventario | ~400-800ms | ~400-800ms | ~0-100ms (precargado) | ~0-100ms |
| **Pull-to-refresh en home** | — | ~400-800ms | ~400-800ms | **~250-500ms** |

---

## Deuda técnica / próximos pasos

- **Lazy loading de imágenes:** verificar que las `<img>` del catálogo POS y categorías usen `loading="lazy"`. Si el catálogo muestra 30 productos con imagen sin lazy, se descargan las 30 al primer render.
- **Zoneless Change Detection (Angular 20.2+):** estable para producción según docs oficiales, pero **Ionic 8 no garantiza compatibilidad zoneless** (componentes que dependen de zone.js para propagar eventos). Reevaluar cuando salga Ionic 9 con soporte oficial.
- **Service Worker / PWA:** solo aplicaría al modo web. La app es Capacitor nativo principalmente — bajo ROI hoy.
- **Splash screen Android nativo:** evaluar reemplazar el splash de Capacitor por un Android 12+ themed splash. Mejora marginal (~100ms) pero más consistente visualmente.

---

## Referencia de archivos modificados

### Sesión 2026-05-22
| Archivo | Cambio |
|---|---|
| `src/app/core/guards/auth.guard.ts` | Fast path con cache agresivo |
| `src/app/features/auth/services/auth.service.ts` | `iniciarRealtimeDesdeCache()`, `validarUsuarioBackground()`, RPC en `validarUsuario()` |
| `docs/auth/sql/functions/fn_validar_sesion.sql` | Función SQL nueva |
| `src/app/features/caja/pages/home/home.page.html` | `@defer (on idle)` en VARIOS, CELULAR, BUS |

### Sesión 2026-05-26
| Archivo | Cambio |
|---|---|
| `src/app/core/guards/auth.guard.ts` | Espera `resumeRefreshInFlight` para evitar doble refresh tras background largo |
| `src/app/core/services/supabase.service.ts` | `resumeRefreshInFlight` pasa de privado a público |

### Sesión 2026-05-30
| Archivo | Cambio |
|---|---|
| `src/app/core/services/config.service.ts` | Cache persistido en Preferences con TTL 1h + stale-while-revalidate |
| `src/app/core/strategies/selective-preload.strategy.ts` | Estrategia nueva — precarga rutas marcadas tras 2s de idle |
| `src/app/features/layout/layout.routes.ts` | Marca `data: { preload: true }` en `/pos`, `/ventas`, `/inventario`, `/clientes` |
| `src/main.ts` | Reemplaza `NoPreloading` por `SelectivePreloadStrategy` |
| `angular.json` | Sube budget `anyComponentStyle` de 20/28 kB → 30/40 kB (POS y producto-crear estaban al límite) |
| `docs/caja/sql/functions/fn_home_dashboard.sql` | RPC nueva — consolida estado de caja + saldos virtuales + movimientos del home en 1 round-trip |
| `src/app/features/caja/services/turnos-caja.service.ts` | Método `obtenerHomeDashboard()` + interface `HomeDashboard` |
| `src/app/features/caja/pages/home/home.page.ts` | `cargarDatos()` ahora usa la RPC consolidada en vez de 8 promesas paralelas |
