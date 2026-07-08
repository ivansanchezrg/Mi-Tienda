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
- **Manual** (`invalidar()`) — al editar parámetros desde Configuración o cambiar descuentos POS. Limpia RAM y Preferences, **y descarta cualquier carga en vuelo** (generación + `invalidatedAt`).

> ⚠️ **Fix 2026-06-11 — carrera de cargas en vuelo:** `invalidar()` no cancelaba la carga ya
> iniciada por otro consumidor; quien llamaba `get()` después de invalidar se subía a esa promesa
> vieja (snapshot stale de Preferences). Síntoma real: el sidebar mostraba los módulos
> desactualizados tras un toggle del superadmin y requería **doble refresh**. Además, la
> invalidación de montaje vive ahora en `main-layout` (el PRIMER consumidor) — el sidebar reusa
> esa misma carga fresca en vez de invalidar tarde.

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

## Cambios aplicados el 2026-06-10

### 10. Stale-while-revalidate del home dashboard (arranque sin skeleton)

**Archivos:**
- `src/app/features/caja/services/turnos-caja.service.ts` — snapshot persistido + cache fallback offline
- `src/app/features/caja/pages/home/home.page.ts` — `cargarDatos()` pinta del snapshot al instante

**Problema:** Tras todas las optimizaciones anteriores, lo único lento que quedaba en el arranque era
el skeleton del home esperando `fn_home_dashboard`. Y el primer request tras un cold start no cuesta
solo los ~250-500ms de la RPC: paga además DNS + TLS + handshake HTTP/2 contra Supabase (~300-600ms
extra en red móvil). Crítico para el caso "la app estaba en reposo, Android mató el proceso, el usuario
la reabre" — un cold start disfrazado de reapertura.

**Solución:** El mismo patrón que ya usan `ConfigService` (§6) y el catálogo POS (plan offline §13.4),
aplicado a la pantalla de entrada:

```
cargarDatos() (no silencioso):
  ├── ¿Snapshot de HOY del MISMO negocio en Preferences?
  │     ├── SÍ → aplicarDashboard(snapshot) al instante, SIN skeleton
  │     │        └── el fetch de siempre corre igual y repinta con datos frescos (~0.5-1s)
  │     └── NO → skeleton normal (primer arranque del día)
  └── obtenerHomeDashboard() persiste el snapshot tras cada fetch exitoso
        └── (también lo refrescan pull-to-refresh, refrescarMovimientos y post-cierre)
```

**Validez del snapshot (sin TTL arbitrario):**
- **Mismo `negocio_id`** — invalida automáticamente al cambiar de tenant.
- **Mismo día local** (`getFechaLocal()`) — los turnos son diarios; un snapshot de ayer pintaría un
  "turno abierto" que ya no existe. El primer arranque de cada día muestra skeleton (una vez al día).
- **Logout** — `registerBeforeCleanup` borra la key (mismo mecanismo que ConfigService).

**Bonus offline:** `obtenerHomeDashboard()` ahora sirve el snapshot del día cuando la RPC no responde
(sin red). Antes, el home offline se pintaba con todo en ceros (los defaults defensivos del null).

**Trade-off aceptado:** durante ~0.5-1s el usuario ve saldos del último fetch del día (no de este
instante). El refresco en background y el Realtime de cajas lo corrigen de inmediato. Mismo criterio
ya aceptado para el catálogo POS.

**Impacto:** cold start con sesión válida y snapshot del día → el home aparece **lleno en el primer
render** (~5-10ms de lectura de Preferences), sin skeleton ni espera de red percibida.

---

## Cambios aplicados el 2026-06-13

### 11. Arranque offline: hidratar el usuario + reactivar la cadena del turno al volver la red

**Archivos:**
- `src/app/core/guards/auth.guard.ts` — la rama offline emite el usuario del cache en `usuarioActual$`
- `src/app/features/auth/services/auth.service.ts` — `hidratarUsuarioOffline()` (emite sin Realtime)
- `src/app/features/caja/pages/home/home.page.ts` — detección robusta del flanco de red + `reactivarTrasReconexion()` + reconciliación de `turnoActivo$`
- `src/app/features/caja/services/turnos-caja.service.ts` — `reabrirRealtimeTurnos()`, Realtime se abre aunque la query falle, `sincronizarTurnoDesdeHome()` acepta `null`

**Síntoma reportado:** al cerrar la app, apagar la red, abrirla sin internet y luego reconectar, el
home se pintaba pero el botón de turno mostraba **"Cierre" deshabilitado** (el `@else` del template,
sin `(click)`) en vez de "Cerrar"/"Abrir" funcional. Solo se corregía cerrando y reabriendo la app ya
con red.

**Causa raíz (la profunda):** el botón "Cierre" deshabilitado aparece cuando `cajaAbierta === true`
**y** `esMiTurno === false`. Y `esMiTurno` (`turnosCajaService.esMiTurnoValue`) compara
`turno.empleado_id === usuario.id` — **requiere que `usuarioActualValue` esté poblado.** El problema:

- **El guard offline nunca emitía el usuario.** Solo la rama **online** del guard llama
  `iniciarRealtimeDesdeCache()` (que hace `_usuarioActual$.next(usuario)`). La rama offline
  (`auth.guard.ts`, sin red + sesión local) retornaba `true` sin emitir nada → `usuarioActual$`
  quedaba en `null`.
- En cascada: `TurnosCajaService` (suscrito a `usuarioActual$` en su constructor) **nunca recibía el
  usuario** → `inicializarEstadoReactivo()` no corría → `_turnoActivo$` quedaba en `null` → y aunque
  el dashboard luego reportara el turno, `esMiTurnoValue` daba `false` porque `usuario` era `null`.
- Al volver la red, el dashboard repintaba `cajaAbierta = true` (de `estadoCaja`), pero `usuarioActual$`
  seguía sin emitirse (la rama online del guard no se re-ejecuta), así que `esMiTurno` permanecía
  `false`. De ahí el botón "Cierre" muerto hasta reiniciar.

**Causa secundaria (race de red):** el intento previo de re-disparo se inicializaba con
`estabaOffline = !this.network.isConnected()`. Pero `NetworkService.isOnline$` es un
`BehaviorSubject(true)` y `Network.getStatus()` lo actualiza de forma **async**: en el arranque
offline, `isConnected()` podía devolver el `true` por defecto antes de que el valor real (`false`)
llegara → `estabaOffline` quedaba en `false` → el flanco offline→online nunca se detectaba.

**Solución:**

1. **El guard offline hidrata el usuario.** Nueva `AuthService.hidratarUsuarioOffline(usuario)` emite
   el `UsuarioActual` del cache en `usuarioActual$` **sin** abrir Realtime (no hay red). La rama
   offline del guard la llama. Así `TurnosCajaService` recibe el usuario y `usuarioActualValue` queda
   poblado — base para que `esMiTurno` pueda ser `true` en cuanto haya un turno.

2. **Detección del flanco de red sin race.** El home ya no pre-calcula el estado con `isConnected()`.
   Rastrea `ultimoEstadoRed` **dentro** de la suscripción a `getNetworkStatus()` (empieza en
   `undefined`); solo reacciona cuando llega `true` y el valor previo confirmado era `false`. El
   `BehaviorSubject` entrega la secuencia completa, así que el `false` real siempre se registra antes
   del `true` de reconexión — el flanco se detecta sin importar el timing del plugin nativo.

3. **Reactivación completa al reconectar** (`reactivarTrasReconexion()`): (a) re-hidrata el usuario y
   abre los canales Realtime de usuario (idempotente); (b) reabre el canal Realtime de turnos con
   conexión limpia (`reabrirRealtimeTurnos()` — el canal abierto sin red pudo quedar en
   `CHANNEL_ERROR`); (c) reintenta `inicializarEstadoReactivo()`; (d) recarga el dashboard.

4. **`inicializarEstadoReactivo()` abre el Realtime aunque la query falle.** Antes, `abrirRealtimeTurnos()`
   estaba después de `obtenerTurnoActivo()` dentro del `try` — sin red, la excepción saltaba el canal.
   Ahora se abre en el `finally` (es idempotente y no depende del turno).

5. **Fuente única de verdad del turno:** `aplicarDashboard()` reconcilia `turnoActivo$` con el servidor
   comparando por `id` en ambos sentidos (`turnoServidor?.id !== turnoLocal?.id`); `sincronizarTurnoDesdeHome()`
   acepta `null` para limpiar un turno fantasma.

**Por qué NO se quitó el caché (decisión de diseño):** el síntoma parecía culpa del caché, pero el
caché es justo lo que evita ver el home **vacío en ceros** mientras no hay red. El problema era la
*hidratación del estado reactivo offline* y la *revalidación al reconectar*, no el *almacenamiento*.
La jerarquía sana queda: caché (pinta ya) → hidratación del usuario offline (la cadena reactiva no
queda muerta) → revalidación al volver la red (reactiva turno + dashboard) → fuente única del turno
(el botón nunca discrepa) → pull-to-refresh (override manual).

**Impacto:** arrancar sin red y reconectar deja el home y el botón de turno en el estado correcto sin
reiniciar la app ni navegar.

---

## Cambios aplicados el 2026-07-03

### 12. Fail-open del guard — el refresh de token sale del camino crítico del arranque

**Archivos:** `src/app/core/guards/auth.guard.ts`, `src/app/core/services/supabase.service.ts`

**Problema (reportado con medición real ~5s):** al volver del reposo con el proceso muerto
(Android mató la app en background = cold start disfrazado de reapertura) y el JWT vencido
(1+ hora dormida), la cadena era:

```
boot WebView (~1.5-2s)
  → authGuard → auth.getSession() con token vencido
      → supabase-js dispara un refresh de RED antes de resolver (DNS + TLS frío + roundtrip)
      → ~1-3s BLOQUEANDO la navegación (y el splash)
  → recién ahí el home pinta (snapshot o skeleton)
Total: ~4-5s
```

El fix §5 (2026-05-26) evitó el **doble** refresh, pero dejó el refresh único **bloqueando
el primer paint**. El peor caso era el arranque de cada mañana: proceso muerto + token
vencido + snapshot inválido (cambió el día) → se pagaba todo junto.

**Solución (2 piezas complementarias):**

1. **Fast path local en `authGuard` (antes de `getSession()`):** con sesión local
   (`hasLocalSession()`) + flag de auth activa (`hasActiveAuth()`) + `UsuarioActual` en cache
   → `return true` inmediato, sin esperar red. El refresh corre en paralelo
   (`refreshSessionOnResume()` fire-and-forget — no-op si el token está sano). Realtime +
   validación background igual que el fast path anterior. Si el refresh token ya no sirve
   (30+ días), el SDK emite `SIGNED_OUT` y el listener global redirige al login — mismo
   mecanismo de siempre, solo que unos segundos más tarde.

2. **`SupabaseService.call()` espera `resumeRefreshInFlight` antes de ejecutar** — sin esto,
   las queries disparadas por el home saldrían con el token vencido y fallarían con "JWT
   expired". Un solo `await` centralizado cubre toda la app; la promesa nunca rechaza.

**Lo que NO se cambió (deliberadamente):**
- `Network.getStatus()` del guard sigue siendo el roundtrip al plugin (~10-30ms). El valor
  en memoria de `NetworkService` arranca en `true` por defecto y el real puede llegar tarde
  (race documentada en §11) — el guard necesita el estado REAL para elegir la rama offline.
- El fast path viejo (post-`getSession()`) queda como fallback para bordes donde el nuevo
  declina (p.ej. sesión en memoria sin localStorage legible).

**Instrumentación agregada (verificable en logcat):**
- `authGuard`: "Fast path local en Xms" / "getSession() resuelto en Xms".
- `AppComponent.setupStartupTiming()`: "Primera navegación (url) resuelta en Xms desde el
  bootstrap" — la métrica que el usuario percibe como "la app abrió".

**Impacto esperado:** reapertura tras reposo con proceso muerto: de ~4-5s → ~2s (queda el
boot del WebView + render). Confirmar con los logs en dispositivo real.

### 13. Home más liviano — se eliminó la sección "Últimos 5 movimientos"

**Archivos:** `home.page.html/ts/scss`, `turnos-caja.service.ts`,
`docs/caja/sql/functions/fn_home_dashboard.sql` (v2.0 — **pendiente de re-ejecutar en Supabase**)

Decisión de producto (el historial completo vive en el detalle de cada cuenta), con bonus de
rendimiento y corrección:

- `fn_home_dashboard` v2 ya no arma la lista (4 JOINs por fila) ni el count. Devuelve
  `resumen_dia: { ingresos, egresos }` — agregados del **día completo**.
- **Fix de corrección incluido:** los deltas del hero ("HOY +$X / -$Y") antes se calculaban
  sumando **solo los últimos 5 movimientos** — subestimaban los totales del día. Ahora son
  agregados reales.
- Payload de la RPC y del snapshot de Preferences más chicos; menos DOM en el primer render.
- Key del snapshot bump a `:v2` (el shape cambió) — el primer arranque tras actualizar
  muestra skeleton una vez; desde ahí el snapshot v2 toma el relevo. El snapshot `:v1`
  huérfano se borra en el constructor del servicio (best-effort).
- Compatibilidad de despliegue: la app con RPC vieja no rompe (los agregados caen a 0 con
  `?? 0`); la app vieja con RPC nueva tampoco (ignora `resumen_dia`, movimientos vacíos).
  Aún así, **ejecutar la v2 en Supabase junto con el deploy** para que los deltas del hero
  tengan datos.

### 14. Reposo largo: warm-up del token al bootstrap + refresco silencioso al reanudar

**Contexto (medición del usuario):** reabrir tras reposo largo ~4s vs cerrar-manualmente-y-reabrir ~2s.
La diferencia no es el mecanismo sino el **estado**: la prueba de cierre manual se hace con token
fresco (<1h) y snapshot del día → mejor caso. El reposo largo paga token vencido + posible snapshot
descartado (cambió el día), y esos costos corrían **en serie**:

```
ANTES (reposo largo, proceso muerto):
  boot WebView (~1.5-2s)
    → guard fast path (retorna al instante, PERO recién aquí arranca el refresh del token)
    → home render → cargarDatos() → call() ESPERA el refresh completo (~1-1.5s, TLS frío)
    → recién entonces sale fn_home_dashboard (~0.5-1s)
  Total ≈ 4s hasta datos
```

**Fixes (3 piezas):**

1. **Warm-up del token en el constructor de `SupabaseService`** — `refreshSessionOnResume()`
   fire-and-forget en el milisegundo cero del bootstrap (antes arrancaba en el guard, ~1.8s
   más tarde). El refresh corre EN PARALELO con el boot de Angular y el render: cuando la
   primera RPC sale, el token ya está renovado. Es no-op si no hay sesión o el token está
   sano (umbral 5 min), y falla silencioso offline.

   ```
   AHORA: boot WebView (~1.5-2s) ∥ refresh del token (~1-1.5s, en paralelo)
     → home render → cargarDatos() → RPC sale casi directa
   Total ≈ 2-2.5s hasta datos
   ```

2. **Refresco silencioso del home al reanudar con proceso vivo** (`home.page.ts` →
   `setupResumeRefresh()`): si la app estuvo ≥ `TIMING.resumeHomeRefreshMinMs` (60s) en
   background y Android NO mató el proceso, el home recarga el dashboard en modo silencioso
   (sin skeleton, mismo camino que pull-to-refresh). Resuelve la deuda técnica "Frescura del
   home al volver del background". Los switches rápidos entre apps no refetchean.

3. **Instrumentación del resume** (antes solo se medía el cold start):
   - `Resume: App reanudada con proceso vivo tras Xs en background` (`app.component`) — si
     este log aparece SIN un "Primera navegación resuelta..." nuevo, fue warm resume; si
     aparece el de Startup, Android mató el proceso (cold start disfrazado).
   - `SupabaseService: Token sano (Xs de vida) — sin refresh (getSession Xms)` /
     `Sesión renovada (token tenía Xs de vida) en Xms` — cuánto costó realmente el refresh.

---

## Estimación de mejora actualizada

| Escenario | Original (pre-2026-05-22) | Post 2026-05-22 | Post 2026-05-30 | Post 2026-06-10 | Post 2026-07-03 | **Post 2026-07-06** |
|---|---|---|---|---|---|---|
| Cold start con sesión válida (caso 95%) | ~5s | ~2s | ~1.2-1.5s | home visible al primer render (snapshot del día) | igual | igual, sin el bloqueo de `suscripcionGuard` |
| Primera instalación / login fresco | ~5s | ~3-3.5s | ~3-3.5s | ~3-3.5s | ~3-3.5s | ~3-3.5s |
| Re-apertura tras background corto | ~2-3s | ~1-1.5s | ~0.8-1.2s | instantáneo con snapshot (si Android mató el proceso) | igual | igual |
| **Reposo largo + proceso muerto + token vencido** (el caso reportado ~5s) | ~5s | ~4-5s | ~4-5s | ~4-5s (refresh bloqueaba el guard) | ~2s (refresh en paralelo, guard no espera red) | **~1.3-1.8s** (`suscripcionGuard` ya no espera red) |
| Warm restart tras 1+ hora background | ~4-5s | ~2s | ~2s | ~2s (token) + home del snapshot mientras | ~boot + snapshot (token en paralelo) | igual |
| **Primer arranque del día** (antes: sin snapshot válido) | — | — | — | skeleton normal ~1.2-1.5s (una vez al día) | skeleton, pero sin esperar el refresh del token | **home lleno al instante** (snapshot degradado: saldos reales, turno neutro hasta reconciliar) |
| Primera navegación a /pos /ventas /inventario | ~400-800ms | ~400-800ms | ~0-100ms (precargado) | ~0-100ms | ~0-100ms | ~0-100ms |
| **Pull-to-refresh en home** | — | ~400-800ms | ~250-500ms | ~250-500ms | algo menor (RPC v2 sin lista de movimientos) | igual |

---

## Cambios aplicados el 2026-07-06

Revisión punta a punta del arranque/resume solicitada tras seguir midiendo ~5s en un Redmi
gama baja pese a los fixes de 2026-07-03. Hallazgo: esos fixes arreglaron el `authGuard`,
pero dejaron dos bloqueos intactos que se ejecutan en el mismo camino crítico.

### 15. `suscripcionGuard` deja de bloquear la primera navegación de cada cold start

**Archivo:** `src/app/core/services/suscripcion.service.ts`

**Problema:** `SuscripcionService` cacheaba el estado de suscripción **solo en RAM**
(decisión original: "no vale la pena persistirlo entre cold starts"). Pero
`suscripcionGuard` corre encadenado DESPUÉS de `authGuard` en `app.routes.ts`
(`canActivate: [authGuard, suscripcionGuard]`) — Angular no resuelve la ruta hasta que
AMBOS guards terminan. En cada cold start, sin RAM cache, el guard esperaba un roundtrip
completo de `fn_estado_suscripcion` (DNS + TLS frío + query), anulando en la práctica el
fast path que el `authGuard` había ganado en la sesión 2026-07-03.

**Solución:** mismo patrón stale-while-revalidate que `ConfigService` — snapshot en
Preferences que se sirve de inmediato (sin importar TTL) mientras se revalida en
background. El fail-open ante error de red ya estaba aceptado; servir un estado
levemente stale unos segundos (con el Realtime de `suscripciones` y la revalidación
en background corrigiendo si hubo una suspensión real) tiene el mismo riesgo con
costo percibido casi nulo.

**Impacto estimado:** -0.5 a -1.5s en TODOS los cold starts (no solo el de reposo largo).

### 16. Snapshot del home ya no se descarta al cambiar el día — se degrada

**Archivo:** `src/app/features/caja/services/turnos-caja.service.ts`

**Problema:** `obtenerHomeDashboardCacheado()` descartaba el snapshot completo si era
de "otro día" (`snapshot.fecha !== getFechaLocal()`). Efecto perverso: el arranque más
frecuente tras un reposo largo — la PRIMERA apertura de cada mañana — siempre caía en
el peor caso (skeleton + espera de red completa), porque el snapshot de ayer nunca
pasaba el filtro.

**Solución:** se separó en dos métodos:
- `leerSnapshotCrudo()` (privado) — el snapshot tal cual, sin filtro de día. Uso
  exclusivo: fallback offline dentro de `obtenerHomeDashboard()` cuando la RPC no
  responde por falta de red (ahí sí hace falta el turno real, aunque sea de ayer, para
  que el usuario pueda seguir operando POS/Cajón sin conexión).
- `obtenerHomeDashboardCacheado()` (público, usado por `home.page.ts` para el pintado
  optimista) — mismo día: snapshot tal cual. Otro día: se sirve degradado — saldos de
  cajas y flags de módulos intactos (no son diarios, son vaults que persisten),
  `estadoCaja` forzado a `SIN_ABRIR` sin turno y `ingresosHoy`/`egresosHoy` en 0. El
  fetch fresco de `cargarDatos()` corre en paralelo y reconcilia en ~1s si había turno.

**Impacto estimado:** el home aparece lleno en el primer render los 365 días del año,
no solo a partir del segundo arranque de cada día.

### 17. Priming offline diferido también en el disparador de reconexión de red

**Archivo:** `src/app/core/services/sync.service.ts`

**Problema:** `precalentarOffline()` (descarga catálogo POS + categorías + clientes +
CF + binarios de imágenes) ya estaba diferido `TIMING.primingArranqueDeferMs` (6s) en
el disparador de arranque con sesión, pero el disparador de reconexión de red
(`network.getNetworkStatus().subscribe`) lo llamaba sin defer. `NetworkService` reemite
`true` en cada resume de Android (~1-3s después de desbloquear, cuando el radio
reconecta) — justo el instante más caliente del resume, compitiendo por ancho de
banda/CPU con `fn_home_dashboard` y el refresh del token en gama baja.

**Solución:** mismo defer en ambos disparadores. `precalentarOffline()` ya era
reentrante-seguro (`primingEnCurso` + `esCacheFresco()`), así que no hay riesgo de
duplicar trabajo si ambos disparadores coinciden en el arranque en frío.

**Impacto estimado:** menos jank/contención de CPU-red durante el resume en gama baja;
no cambia el tiempo hasta que el catálogo esté listo para el vendedor (6s es aceptable,
está en el local con WiFi).

---

## Cambios aplicados el 2026-07-08 — arranque local-first ante "red mala"

Revisión con una lente nueva: **"red presente pero mala"** (lejos del router, WiFi
intermitente). Ahí `Network.getStatus()` reporta `connected: true`, la app toma el camino
online, y las queries cuelgan contra una red que responde lentísimo — ni el camino offline
(que es local) ni el online sano (que es rápido). El objetivo: la app abre SIEMPRE desde
datos locales y la red solo corrige en background.

**Principio adoptado:** `isConnected()` deja de usarse como señal de "la red funciona"
para decisiones de estado. La única señal confiable es "¿el servidor respondió de verdad?"
— un fallo de transporte puede ocurrir con `isConnected() === true`.

### 18. Turno local-first — `inicializarEstadoReactivo()` hidrata del snapshot local ANTES de la red

**Archivo:** `src/app/features/caja/services/turnos-caja.service.ts`

**Problema (2 bugs con red mala):**
1. La query del turno (`obtenerTurnoActivo()` vía `call()`) bloqueaba la cadena reactiva:
   con red mala, `esMiTurno` quedaba `false` durante los segundos/minutos que tardara →
   botón del turno roto y POS bloqueado aunque el turno del usuario siguiera abierto.
2. Peor: un fallo de transporte con `isConnected() === true` entraba a la rama "online",
   pisaba `turnoActivo$` con null y **borraba el snapshot local del turno**
   (`turno_activo_local`) — destruyendo el cobro offline justo cuando más se necesita.

**Solución:**
- Paso 1 local-first: hidratar `turnoActivo$` desde `turno_activo_local` (SQLite, ~ms)
  ANTES de tocar la red, y marcar `_inicializado$` de inmediato si había turno local —
  el `cajaAbiertaGuard` deja entrar al POS sin esperar la BD.
- Paso 2: `consultarTurnoActivoServidor()` (nuevo, privado) distingue "respuesta real"
  (ok: true, turno puede ser null = de verdad no hay turno) de "fallo" (ok: false =
  transporte/JWT/RLS). **Solo una respuesta 200 real pisa el estado local y el snapshot.**

### 19. El snapshot optimista del home ya no reconcilia `turnoActivo$`

**Archivo:** `src/app/features/caja/pages/home/home.page.ts`

**Problema (introducido por §16):** `aplicarDashboard()` reconciliaba el turno también
cuando el dashboard venía del snapshot de Preferences. Con el snapshot degradado
(cross-day: turno forzado a null), `sincronizarTurnoDesdeHome(null)` limpiaba un turno
local válido — y con red mala el fetch fresco que lo restauraría tarda o no llega.

**Solución:** `aplicarDashboard(dashboard, desdeSnapshot)` — el pintado optimista NO toca
`turnoActivo$` (solo pinta); si el subject ya tiene un turno más confiable (hidratado
local-first por §18), el chip del turno lo prefiere sobre el del snapshot. Solo los datos
reales del servidor reconcilian.

### 20. `ConfigService` reactivo — el layout ya no fuerza query a BD al montar

**Archivos:** `src/app/core/services/config.service.ts`,
`src/app/features/layout/pages/main/main-layout.page.ts`,
`src/app/shared/components/sidebar/sidebar.component.ts`

**Problema (el "punto 4" diferido de la sesión 2026-07-06):** `main-layout.ngOnInit()`
hacía `configService.invalidar()` al montar — forzaba una query fresca a `configuraciones`
en cada arranque, anulando el cache persistido de §6. Con red mala, el FAB y el sidebar
esperaban esa query durante segundos. El `invalidar()` había nacido para arreglar la
carrera del sidebar (2026-06-11: flags stale tras un toggle del superadmin).

**Solución (resuelve la carrera por reactividad, no por orden de cargas):**
- `ConfigService.config$` (BehaviorSubject) emite en cada carga/refresh del cache.
- `ConfigService.revalidar()` — revalidación NO destructiva: trae BD en background y
  emite, sin borrar el cache vigente. Bonus fix: el refresh en background ya no pisa el
  cache con defaults cuando la query falla por red (`rows === null` se ignora).
- `main-layout` y `sidebar`: `get()` pinta del cache al instante + suscripción a `config$`
  re-aplica los flags cuando llega el valor fresco. Ya no importa qué carga "gana".
- `invalidar()` queda SOLO para escrituras (parámetros, toggle superadmin, POS, cierre) —
  ahí el cache es obsoleto con certeza.

### 21. Tope fail-open en `getEstado()` sin snapshot

**Archivo:** `src/app/core/services/suscripcion.service.ts`

**Problema:** tras §15, el único camino que aún podía colgar la navegación era el primer
arranque post-login/instalación (sin snapshot): la RPC sin timeout contra red mala.

**Solución:** `Promise.race` con tope de 4s (`GUARD_TIMEOUT_MS`) → fail-open (mismo
criterio que el catch); la carga real sigue en background y puebla el cache para el
próximo arranque.

### Lo que NO se cambió (deliberadamente)

- **`supabase.call()` sigue esperando `resumeRefreshInFlight` completo** — ponerle timeout
  arriesga que queries salgan con token vencido → `handleExpiredSession()` → logout
  indebido. Con red mala el refresh colgado ya no bloquea el paint (todo lo visible es
  local); solo retrasa datos frescos, que es el comportamiento correcto.
- **No se migró usuario/config/suscripción a SQLite** — ya son locales en Preferences,
  que para blobs chicos es más rápido que abrir una conexión SQLite. SQLite queda para
  lo que ya lo usa: catálogo, clientes, outbox, turno local.

---

## Deuda técnica / próximos pasos

- **Lazy loading de imágenes en el catálogo POS** — ✅ implementado el 2026-06-10. Detalle en
  `docs/guides/PLAN-OFFLINE-POS-2026-06-08.md` §13.4 (rendimiento del catálogo POS, no del arranque).
- **Frescura del home al volver del background (proceso vivo)** — ✅ implementado el 2026-07-03 (ver §14):
  el home se refresca silenciosamente al reanudar si estuvo ≥60s en background.
- **Micro: `Network.getStatus()` en `authGuard`:** es un roundtrip al plugin (~10-30ms) por navegación
  guardada; `NetworkService.isConnected()` ya tiene el valor en memoria. Ganancia marginal.
- **Pre-calentar el cache del POS al boot:** evaluado el 2026-06-10 y **descartado** — parsear 1-3 MB de
  JSON en cada arranque (lo necesites o no) compite con el render del home para ahorrar ~50-150ms una vez
  por sesión. El POS ya pinta de su cache persistido (SQLite/IndexedDB) al entrar. No implementar.
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

### Sesión 2026-06-10
| Archivo | Cambio |
|---|---|
| `src/app/features/caja/services/turnos-caja.service.ts` | Snapshot del dashboard en Preferences (`obtenerHomeDashboardCacheado()` + persistencia tras cada fetch + fallback offline + limpieza en logout) |
| `src/app/features/caja/pages/home/home.page.ts` | `cargarDatos()` pinta del snapshot del día al instante (sin skeleton) y refresca en background |

### Sesión 2026-06-13
| Archivo | Cambio |
|---|---|
| `src/app/core/guards/auth.guard.ts` | La rama offline llama `hidratarUsuarioOffline()` para emitir el usuario del cache en `usuarioActual$` (antes offline no se emitía → `esMiTurno` quedaba muerto) |
| `src/app/features/auth/services/auth.service.ts` | `hidratarUsuarioOffline(usuario)` — emite `usuarioActual$` sin abrir Realtime (idempotente) |
| `src/app/features/caja/pages/home/home.page.ts` | Detección del flanco de red sin race (rastrea `ultimoEstadoRed` dentro de la suscripción) + `reactivarTrasReconexion()` (re-hidrata usuario, reabre Realtime, reinicia turno, recarga dashboard); `aplicarDashboard()` reconcilia `turnoActivo$` por `id` en ambos sentidos |
| `src/app/features/caja/services/turnos-caja.service.ts` | `reabrirRealtimeTurnos()` (canal limpio sin tocar `turnoActivo$`); `inicializarEstadoReactivo()` abre el Realtime en `finally` (aunque la query falle offline); `sincronizarTurnoDesdeHome()` acepta `null` |

### Sesión 2026-07-03
| Archivo | Cambio |
|---|---|
| `src/app/core/guards/auth.guard.ts` | Fast path local ANTES de `getSession()`: con sesión local + `hasActiveAuth` + cache → entra sin esperar el refresh de red; el refresh corre en paralelo. Instrumentación de tiempos |
| `src/app/core/services/supabase.service.ts` | `call()` espera `resumeRefreshInFlight` antes de ejecutar — ninguna query sale con el token vencido. Warm-up del token en el constructor (§14) + instrumentación de duración del refresh |
| `src/app/app.component.ts` | `setupStartupTiming()` — log del tiempo bootstrap → primer `NavigationEnd`. Log de warm resume con segundos en background (§14) |
| `src/app/features/caja/pages/home/*` | Sección "Últimos 5 movimientos" eliminada (HTML+TS+SCSS); deltas del hero desde `resumen_dia`; `refrescarMovimientos()` → `refrescarDashboard()`. `setupResumeRefresh()`: refresco silencioso del dashboard al reanudar tras ≥60s en background (§14) |
| `src/app/features/caja/services/turnos-caja.service.ts` | `HomeDashboard` v2 (`ingresosHoy`/`egresosHoy` en vez de la lista); key del snapshot → `:v2` + limpieza del `:v1` |
| `src/app/core/config/timing.config.ts` | Constante `resumeHomeRefreshMinMs` (60s) — umbral del refresco silencioso al reanudar |
| `docs/caja/sql/functions/fn_home_dashboard.sql` | v2.0 — sin lista de movimientos; `resumen_dia` con agregados del día completo. **Re-ejecutar en Supabase** |

### Sesión 2026-07-06
| Archivo | Cambio |
|---|---|
| `src/app/core/services/suscripcion.service.ts` | Snapshot persistido en Preferences (`STORAGE_KEY`, `leerCachePersistido()`, `guardarCachePersistido()`, `revalidarEnBackground()`) — `getEstado()` sirve del snapshot sin esperar red; `invalidar()` también limpia Preferences |
| `src/app/features/caja/services/turnos-caja.service.ts` | `obtenerHomeDashboardCacheado()` degrada (no descarta) el snapshot de otro día — saldos/módulos intactos, turno/deltas neutros. Snapshot crudo sin filtro de día movido a `leerSnapshotCrudo()` (privado), usado solo por el fallback offline de `obtenerHomeDashboard()` |
| `src/app/core/services/sync.service.ts` | El disparador de reconexión de red (`network.getNetworkStatus().subscribe`) ahora difiere `precalentarOffline()` con `TIMING.primingArranqueDeferMs`, igual que el disparador de arranque en frío |

### Sesión 2026-07-08
| Archivo | Cambio |
|---|---|
| `src/app/features/caja/services/turnos-caja.service.ts` | `inicializarEstadoReactivo()` local-first: hidrata del snapshot local ANTES de la red y marca `_inicializado$` temprano si hay turno local. `consultarTurnoActivoServidor()` (nuevo): solo una respuesta real del servidor pisa el estado/snapshot local — un fallo de transporte con `isConnected()=true` ya no borra el turno offline |
| `src/app/features/caja/pages/home/home.page.ts` | `aplicarDashboard(dashboard, desdeSnapshot)` — el pintado optimista del snapshot NO reconcilia `turnoActivo$` (fix del bug introducido en §16); prefiere el turno vigente del subject sobre el del snapshot para el chip |
| `src/app/core/services/config.service.ts` | `config$` (BehaviorSubject) + `revalidar()` (refresh no destructivo). El refresh en background ya no pisa el cache cuando la query falla por red |
| `src/app/features/layout/pages/main/main-layout.page.ts` | Ya no hace `invalidar()` al montar: `get()` del cache + `revalidar()` + suscripción a `config$` (flags se auto-corrigen) |
| `src/app/shared/components/sidebar/sidebar.component.ts` | Suscripción a `config$` — los flags de módulos se re-aplican con cada emisión fresca |
| `src/app/core/services/suscripcion.service.ts` | `GUARD_TIMEOUT_MS` (4s): tope fail-open cuando no hay snapshot y la RPC cuelga contra red mala; limpieza segura de `loadingPromise` |
