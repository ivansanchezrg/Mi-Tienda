# Plan — Modo Offline en Mi Tienda (POS)

> Documento de decisión + plan de implementación.
> Creado: 2026-06-08. Reescrito: 2026-06-09. **Actualizado: 2026-06-10** con estado real de implementación
> (incluye fixes de rendimiento offline del catálogo: cache RAM, no-firmar-offline y cache de URLs firmadas).
> **Estado: ✅ IMPLEMENTACIÓN COMPLETA — Fases 1-8 hechas. Cambios de BD de la Fase 6 ejecutados
> en Supabase (2026-06-10).** (Cobro offline end-to-end: outbox + sync + BD stock negativo +
> barrera del cierre + UI Pendientes + endurecimiento post-revisión §15.)
> Objetivo: que el POS **nunca pierda una venta** cuando no hay internet o la señal es intermitente,
> sincronizando contra Supabase apenas vuelve la red.

---

## 0. Historia de la decisión (por qué este plan cambió de rumbo)

La v1 de este plan (2026-06-08) descartaba SQLite y proponía un cache liviano en Preferences/IndexedDB.
Tras validar contra fuentes actuales y discutir el caso real, **se decidió cambiar a una capa de datos
local con SQLite** (nativo en móvil, IndexedDB en web vía el mismo plugin). Razones:

- El objetivo no es "cachear unos tickets" sino **una capa de datos local profesional y escalable** que cubra
  catálogo, imágenes y cola de ventas, sin que dé problemas a futuro.
- `@capacitor-community/sqlite` resultó **activamente mantenido** (v8.1.0, marzo 2026, por Robin Genz /
  Capawesome — el mismo equipo del plugin premium). Soporta Capacitor 8, Android, iOS, Electron y Web.
- La advertencia de la industria "evitar IndexedDB en móvil por poca fiabilidad" **refuerza** usar SQLite
  nativo en Android/iOS y dejar IndexedDB solo para web.
- ⚠️ **Corrección 2026-06-10 (durante implementación):** `jeep-sqlite 2.8.0` (el fallback web del plugin) tiene un bug de WebAssembly confirmado (`LinkError: Import #34 function import requires a callable`) sin fix oficial. **Decisión: no usar jeep-sqlite en web.** En su lugar, `LocalDbService` detecta la plataforma e implementa un adaptador `IndexedDbAdapter` nativo del browser. Android/iOS siguen usando SQLite nativo. Un solo código, dos motores — el resto del código no sabe cuál usa.

> ⚠️ **El límite que NO se cruza:** SQLite local guarda datos para LEER (catálogo, imágenes) y la **cola de
> ventas como intenciones pendientes** (el payload crudo del RPC). **NUNCA** replica la lógica financiera
> (cálculo de stock, kardex, secuencias, saldos). El servidor (Supabase) sigue siendo la **única fuente de
> verdad financiera**. SQLite es una cola durable + cache de lectura, no un libro contable paralelo.

---

## 1. Conclusión ejecutiva (TL;DR)

- **Capa de datos local con SQLite**, vía `@capacitor-community/sqlite`: SQLite nativo en Android/iOS,
  **IndexedDB nativo del browser** en web/PWA (sin jeep-sqlite — ver §0 y §2). Un solo código mediante el patrón adaptador en `LocalDbService`.
- **Estrategia Local-First (§4):** toda venta se persiste en local **primero** (estado `PENDING`), se responde
  al cajero al instante, y un `SyncService` la empuja a Supabase apenas hay red. La venta existe en el momento
  que toca el disco local, no cuando toca el servidor → **nunca se pierde**.
- **Alcance offline:** (a) catálogo + categorías + búsqueda en POS; (b) **registrar venta POS efectivo/transferencia**
  dentro de un turno ya abierto. Todo lo demás (apertura/cierre de turno, FIADO, FACTURA, inventario, nómina,
  recargas, transferencias) **sigue online-only**.
- **Decisiones de negocio cerradas:** stock negativo permitido en ventas offline (§5); UI de la cola = tab
  "Pendientes" en `ventas` + badge en banner (§7); no cerrar turno con cola pendiente (§4.7).
- **Desktop Windows nativo (.exe):** diferido. Hoy se cubre con PWA (web + IndexedDB). El puente
  `@capacitor-community/electron` está **abandonado** (solo Capacitor 5) — si se necesita .exe a futuro,
  la ruta es Electron directo, fuera del alcance de este plan. Ver §16.

---

## 2. Plugin y capa de datos — implementado (actualizado 2026-06-10)

**Plugin instalado:** `@capacitor-community/sqlite@8.1.0`

| Plataforma | Motor real | Estado |
|------------|-----------|--------|
| **Android / iOS** | SQLite nativo vía `@capacitor-community/sqlite` | ✅ Implementado y verificado en Android |
| **Web / PWA (Windows desktop hoy)** | **IndexedDB nativo del browser** (sin jeep-sqlite) | ✅ Implementado — ver nota abajo |
| **Electron (.exe futuro)** | `better-sqlite3` | Diferido — puente Electron abandonado. Ver §13. |

> ⚠️ **Por qué no se usa jeep-sqlite en web (cambio respecto al diseño original):**
> `jeep-sqlite@2.8.0` tiene un bug de WebAssembly confirmado y sin fix oficial
> (`LinkError: Import #34 "a" "I": function import requires a callable`). Afecta la versión actual
> y versiones anteriores — reportado por múltiples desarrolladores, issue abierto sin resolución.
> **Solución implementada:** el `LocalDbService` tiene un patrón adaptador — en web usa un
> `IndexedDbAdapter` escrito sobre la API nativa del browser (cero WebAssembly, cero dependencias
> adicionales). En Android/iOS usa `SQLiteAdapter` sobre el plugin. El resto del código
> (`CatalogoLocalService`, `OutboxService`, `TurnoLocalService`) usa `IDbAdapter` y no sabe qué motor
> corre debajo.

**Patrón adaptador implementado en `LocalDbService`:**
```
Capacitor.getPlatform() === 'web'
  → IndexedDbAdapter (IndexedDB nativo — confiable en desktop, sin wasm)
Capacitor.getPlatform() === 'android' | 'ios'
  → SQLiteAdapter (SQLite nativo vía @capacitor-community/sqlite)
```

**Setup completado:**
- `@capacitor-community/sqlite@8.1.0` instalado.
- Android: `npx cap sync android` requerido tras instalar el plugin.

> **Limpieza 2026-06-10:** se eliminó `src/assets/sql-wasm.wasm` y el asset de jeep-sqlite de
> `angular.json`. Eran peso muerto — `LocalDbService` usa IndexedDB **nativo** en web, nunca jeep-sqlite,
> y `jeep-sqlite` ni siquiera es dependencia directa en `package.json`. Si a futuro se resuelve el bug de
> WebAssembly de jeep-sqlite y se decide usarlo, re-agregar el asset es una sola línea. No tiene sentido
> copiar varios MB sin uso en cada build de producción.

**Por qué este plugin y no otros:**
- vs **Capawesome SQLite (premium):** de pago (suscripción Insiders). No justificado para tiendas pequeñas/medianas.
- vs **RxDB:** su valor principal es sync bidireccional automático — que no queremos (sync unidireccional, servidor manda).

---

## 3. Qué SÍ y qué NO funciona offline

| Flujo | ¿Offline? | Por qué |
|-------|-----------|---------|
| **Registrar venta POS (efectivo/transferencia)** | ✅ **SÍ** | Caso crítico. Cliente enfrente con dinero. No vender = perder la venta. |
| **Catálogo + categorías + búsqueda (texto/código) en POS** | ✅ **SÍ (lectura local)** | Para armar el carrito sin red. Solo lectura — el POS nunca muta estas tablas. |
| Venta **FIADO** | ❌ NO | Requiere validar/mutar saldo del cliente contra el servidor. |
| Venta **FACTURA** | ❌ NO (v1) | Secuencias SRI se asignan en el servidor. |
| **Apertura / cierre de turno** | ❌ **NO (§4.6, §4.7)** | Mueven dinero real + generan IDs en el servidor. Se hacen online. |
| Inventario, recargas, nómina, transferencias | ❌ NO | No urgentes frente al cliente / requieren datos en tiempo real. |

> **Decisión:** "Modo offline" = **"un turno ya abierto sigue cobrando efectivo/transferencia y la venta se
> guarda local-first hasta sincronizar"**. Nada más.

---

## 4. Arquitectura — Local-First + Outbox

### 4.1 La estrategia: Local-First (decisión clave)

Toda venta se guarda en SQLite local **antes de tocar la red**:

```
Cobrar
  │
  ▼
INSERT en SQLite local (estado PENDING)   ← la venta YA EXISTE aquí (milisegundos)
  │
  ▼
Responder al cajero: "Venta registrada" ✅  ← no espera al servidor
  │
  ▼
SyncService (background): ¿hay red?
  ├── SÍ → fn_registrar_venta_pos(payload + idempotencyKey)
  │         ├── success/duplicado → marcar SYNCED, quitar de cola
  │         ├── error de RED      → dejar PENDING, reintentar con backoff
  │         └── error de DATOS    → marcar ERROR (dead-letter), avisar
  └── NO → queda PENDING, el listener de red la empujará luego
```

**Por qué Local-First y no "online primero":** en "online primero" existe la *ventana de la muerte* — el
servidor procesa la venta pero la respuesta se pierde (señal cae justo ahí) → la app no sabe si guardó →
duplica o pierde. Local-First elimina eso de raíz: la venta está en disco antes de la red, y la
`idempotency_key` hace que el reenvío sea siempre inofensivo.

> Con buena señal, el sync ocurre en <1s y el cajero no nota diferencia. Con mala señal, queda `PENDING` y se
> sincroniza sola. En ambos casos **el cajero ya siguió vendiendo** — nunca espera.

### 4.2 Lo que YA existe a favor (idempotencia)

El POS ya implementa idempotencia ([pos.page.ts:1269-1310](../../src/app/features/pos/pages/pos/pos.page.ts#L1269)):
genera `crypto.randomUUID()` → lo persiste en `localStorage` antes del RPC → `ventas.idempotency_key UUID UNIQUE`
en BD → `fn_registrar_venta_pos` detecta duplicados. **Esto es el cimiento del local-first** — reenviar es 100%
seguro. El cambio generaliza "1 venta pendiente en localStorage" a "cola N en SQLite".

### 4.3 Esquema SQLite local (mínimo)

```
TABLA outbox_ventas (cola de ventas pendientes — INTENCIONES, no ventas calculadas):
  idempotency_key  TEXT PRIMARY KEY   -- la misma UUID que va al RPC
  negocio_id       TEXT NOT NULL      -- aislamiento multi-tenant local
  turno_id         TEXT NOT NULL      -- turno (abierto online) al que pertenece
  payload_json     TEXT NOT NULL      -- el VentaPayload + items, crudo, tal cual al RPC
  estado           TEXT NOT NULL      -- PENDING | SYNCING | SYNCED | ERROR
  intentos         INTEGER DEFAULT 0
  ultimo_error     TEXT
  created_at       INTEGER NOT NULL   -- epoch ms (orden FIFO)

TABLA turno_activo_local (snapshot del turno abierto — habilita cobrar offline):
  negocio_id   TEXT PRIMARY KEY       -- 1 turno abierto por negocio (modelo mono-caja)
  turno_id     TEXT NOT NULL          -- el UUID generado por fn_abrir_turno en el servidor
  empleado_id  TEXT NOT NULL
  numero_turno INTEGER
  abierto_at   INTEGER NOT NULL
  -- Se ESCRIBE al abrir turno (online). Se BORRA al cerrar turno (online).
  -- Sin esta fila, no se puede cobrar offline (no hay turno_id al cual colgar la venta).

TABLA cache_catalogo (snapshot de lectura, por negocio):
  negocio_id   TEXT PRIMARY KEY
  catalogo_json TEXT NOT NULL         -- ProductoPOS[] aplanado de fn_catalogo_productos_pos
  categorias_json TEXT NOT NULL
  timestamp    INTEGER NOT NULL
```

> El payload se guarda **crudo** (el mismo objeto que se manda al RPC). No se interpreta ni recalcula nada
> localmente. Sincronizar = leer la fila y mandarla a `fn_registrar_venta_pos`.

### 4.4 Sincronización (automática + manual)

Automática **apenas hay red de cualquier tipo** (WiFi o datos móviles) vía
`Network.addListener('networkStatusChange')` ([network.service.ts:25](../../src/app/core/services/network.service.ts#L25)).
El cajero no hace nada. Botón "Sincronizar ahora" como respaldo.

- **FIFO estricto:** el trigger `fn_actualizar_saldo_caja_venta` ([schema.sql:1157](../setup/schema.sql#L1157)) suma
  cada venta EFECTIVO al saldo del cajón en orden de inserción. Sincronizar fuera de orden = ledger incoherente.
- **Red vs datos:** error de conexión → `PENDING`, reintenta con **backoff exponencial + jitter** (5s, 15s,
  45s…). Error de validación del servidor → `ERROR` (dead-letter), NO reintenta en loop, visible en tab Pendientes.

### 4.5 Cache del catálogo (lectura)

Se cachea el **resultado aplanado de `fn_catalogo_productos_pos`** (array `ProductoPOS` con template +
atributos + presentaciones ya anidados por el servidor), NO las 7 tablas crudas. El POS nunca muta estas tablas.

- **Filtro por categoría offline:** la RPC debe devolver `categoria_id` (`COALESCE(template, producto)`) para que
  el filtro funcione en memoria. **Cambio de BD requerido** (ver §6) + campo `categoria_id` en `ProductoPOS`.
- **Búsqueda offline:** por texto (`includes` = el `ILIKE`) y por código (lookup dual producto + presentación
  anidada), todo en memoria sobre el catálogo cacheado.
- **Refresco:** se reescribe en cada carga online del catálogo (`refrescarCatalogo()` en
  [pos.page.ts:1384](../../src/app/features/pos/pages/pos/pos.page.ts#L1384)). Sello "actualizado: <fecha>".
- **Imágenes offline (implementado parcial 2026-06-10):** dos correcciones en `StorageService.resolveImageUrl`:
  1. **Sin red no se firma** — antes cada imagen llamaba `createSignedUrl` (red), que offline se cuelga hasta
     timeout (~5s) y resuelve `null` igual. Ahora corta de raíz → `null` inmediato (placeholder, UI sin congelar).
  2. **Cache de URLs firmadas por path crudo** — una imagen firmada online se reutiliza al filtrar por categoría,
     buscar o perder la red. El path es estable entre vistas, así que la foto **se mantiene visible offline** si ya
     se vio con red en la sesión. Reuso con margen de 50 min (TTL real de la signed URL: 60 min).
  - **Límite:** solo cubre imágenes ya vistas online en la sesión. Una foto de un producto nunca renderizado con red
    sigue en placeholder offline. La cobertura total ("toda foto offline siempre") es la mejora de blobs en SQLite
    (abajo). No bloquea vender en ningún caso.
- **Imágenes — cobertura total (mejora diferida):** guardar blobs en SQLite (ahora SÍ es viable y ordenado, a
  diferencia de IndexedDB suelto). Permitiría ver toda foto offline, incluso las nunca vistas con red.

### 4.6 Turno offline — se cachea el turno YA ABIERTO, no la apertura

`fn_abrir_turno` ([fn_abrir_turno.sql](../caja/sql/functions/fn_abrir_turno.sql)) mueve dinero real (EGRESO de
Tienda + valida saldo) y genera el `turno_id` en el servidor. **No se abre turno offline.** El flujo real:
mañana abre (online) → vende todo el día (aquí entra offline) → noche cierra (online).

> 🔴 **BLOQUEADOR CRÍTICO descubierto en el código (2026-06-09).** Hay **dos** puntos que verifican el turno y
> cada uno rompe el offline de forma distinta:
>
> 1. **`PosService.procesarVenta()` consulta el servidor por el turno ANTES de cada venta.**
>    [pos.service.ts:33](../../src/app/features/pos/services/pos.service.ts#L33) hace
>    `await this.turnosService.obtenerTurnoActivo()` → que es una **query directa a Supabase**
>    ([turnos-caja.service.ts:273](../../src/app/features/caja/services/turnos-caja.service.ts#L273)). Sin red,
>    devuelve null → `throw 'SIN_TURNO'` → **la venta se rechaza.** Tal como está hoy, **el cobro offline es
>    imposible aunque tengamos el outbox**, porque consulta el servidor por el turno antes de poder encolar.
>    Este es EL bloqueador real, no un detalle.
>
> 2. **`cajaAbiertaGuard` depende del estado en memoria que se llena con una query a BD.**
>    [caja-abierta.guard.ts:27](../../src/app/core/guards/caja-abierta.guard.ts#L27) hace
>    `await esperarEstadoListo()` → que espera a `inicializarEstadoReactivo()`
>    ([turnos-caja.service.ts:129](../../src/app/features/caja/services/turnos-caja.service.ts#L129)), el cual
>    **consulta la BD**. Si la app se abre ya sin internet, `_turnoActivo$` queda null → el guard **bloquea el
>    POS aunque haya un turno abierto**.

**Solución (Local-First del turno):** el turno también vive en local, en `turno_activo_local` (§4.3).

```
Al ABRIR turno (online):
  fn_abrir_turno → genera turno_id en servidor
  → INSERT en turno_activo_local {turno_id, empleado_id, numero_turno}

Al COBRAR (offline u online):
  procesarVenta() YA NO consulta el servidor por el turno
  → lee turno_id de turno_activo_local
  → arma payload y lo mete en el outbox (local-first)

Al entrar al POS (guard, sin red):
  cajaAbiertaGuard lee turno_activo_local en vez de bloquear

Al CERRAR turno (online):
  fn_ejecutar_cierre_diario OK → DELETE de turno_activo_local
```

- **Cambio en `procesarVenta()`:** dejar de llamar `obtenerTurnoActivo()` (query a servidor) y leer el
  `turno_id` del snapshot local. Esto es lo que destraba el cobro offline.
- **Cambio en `cajaAbiertaGuard`:** sin red, caer al `turno_activo_local` en vez de negar el acceso.
- **Regla anti-fantasma:** el snapshot se BORRA al cerrar turno. Combinado con la barrera del cierre (§4.7, que
  no deja cerrar con cola pendiente), nunca se cobra sobre un turno ya cerrado: vendes offline → vuelve red →
  sincronizan las ventas → recién ahí se puede cerrar (que borra el snapshot).

### 4.7 Barrera del cierre de turno — no cerrar con cola pendiente

Si se cierra el turno con ventas en cola, esas ventas llegarían al servidor después del cierre → caja
descuadrada. Como el cierre es online (siempre hay red ahí), se aprovecha para drenar la cola primero.

```
Cerrar turno → ¿hay ventas PENDING/ERROR en la cola?
   ├── NO → cerrar normal (95% de los casos)
   └── SÍ → forzar sync PRIMERO → ¿quedó todo SYNCED?
              ├── SÍ → permitir cerrar
              └── NO → BLOQUEAR + avisar, atajo a Ventas → Pendientes
```

**Dos capas:** (a) guardia de datos en el cliente que invoca el cierre (`cierre-diario.page.ts`) — fuente de
verdad; (b) guía visual en "Cerrar turno" del Home (badge "N sin sincronizar"). Ambas leen `OutboxService.cantidadPendientes()`.

> ⚠️ La guardia NO va en `fn_ejecutar_cierre_diario` — el servidor no ve la cola local. Vive en el cliente.

> 🔴 **Por qué esta barrera es OBLIGATORIA (no solo buena práctica) — hallazgo de `3_PROCESO_CIERRE_CAJA.md`:**
> el cierre cuadra la caja con `efectivo_esperado = saldo_digital(CAJA_CHICA) + fondo_apertura`, y ese
> `saldo_digital` lo alimenta el trigger `trg_actualizar_caja_por_venta` **solo cuando cada venta EFECTIVO llega
> al servidor**. Si hay ventas offline sin sincronizar al cerrar, el `saldo_digital` está incompleto → el sistema
> espera **menos** efectivo del que hay físicamente → cuadre incorrecto, y peor: puede generar un
> `FALTANTE_CAJA` **injusto** al empleado (deuda en `movimientos_empleados`). Drenar la cola antes de cerrar no
> es opcional: es lo que mantiene el cuadre de caja correcto.

---

## 5. Stock offline — se permite negativo

El stock cacheado es **optimista**: el cliente offline no puede validar contra el servidor. Hoy la app es
**mono-caja** (ver `PLAN-MULTICAJA.md`, solo prep de BD hecha) → un solo turno abierto por negocio → el conflicto
real se reduce a un ajuste de inventario hecho por otra vía antes de sincronizar. Riesgo bajo.

**Decisión: permitir stock negativo en ventas offline.** La venta ya ocurrió físicamente (cliente se llevó el
producto y pagó). Negarla al sincronizar descuadraría la caja. El negativo es información honesta para el admin,
que corrige con un ajuste de inventario.

> ⚠️ **No es trivial:** la BD prohíbe stock negativo en dos capas — `chk_stock_no_negativo CHECK (stock_actual >= 0)`
> ([schema.sql:469](../setup/schema.sql#L469)) y `RAISE EXCEPTION 'Stock insuficiente'` en el trigger
> `fn_actualizar_stock_venta` ([schema.sql:1099](../setup/schema.sql#L1099)). Hay que relajar ambas **solo para la
> ruta offline** vía `p_permitir_stock_negativo` (ver §6).

---

## 6. Cambios de base de datos requeridos

Verificado contra `docs/setup/schema.sql` y las funciones SQL reales.

| Cambio | Archivo | Detalle |
|--------|---------|---------|
| `categoria_id` en RPC del catálogo | `fn_catalogo_productos_pos.sql` | Agregar `'categoria_id', COALESCE(t.categoria_id, p.categoria_id)`. Sin esto el filtro offline no funciona. |
| `categoria_id` en RPC de búsqueda | `fn_buscar_productos_pos.sql` | Igual, para consistencia del tipo `ProductoPOS`. |
| `p_permitir_stock_negativo` | `fn_registrar_venta_pos.sql` | Param nuevo (default `false`). Solo las ventas de la cola offline lo activan. |
| Relajar validación de stock | `fn_actualizar_stock_venta` (trigger) + `chk_stock_no_negativo` | El trigger omite el `RAISE` cuando la venta trae la bandera; el CHECK de columna se ajusta para no bloquear la ruta offline. |

> Todas son aditivas y se aplican en Supabase SQL Editor. `fn_registrar_venta_pos` ya tiene la idempotencia y la
> validación multi-tenant — solo se le agrega el parámetro y se propaga al trigger vía variable de sesión.

**Implementación real (2026-06-10) — ✅ ambos archivos YA EJECUTADOS en Supabase SQL Editor:**

1. `docs/pos/sql/migrations/2026-06-10_stock_negativo_offline.sql` — quita el CHECK + recrea el
   trigger `fn_actualizar_stock_venta` con la bandera. Archivo autocontenido e idempotente.
2. `docs/pos/sql/functions/fn_registrar_venta_pos.sql` — función v3.1 con `p_permitir_stock_negativo`.

> ⚠️ **Nota de alcance del cambio:** al eliminar `chk_stock_no_negativo`, el único guardián del
> stock a nivel BD es el trigger de ventas. Otras rutas que mutan stock (ajustes de inventario,
> compras) ya no tienen backstop de columna — dependen de su propia validación. Aceptado
> conscientemente (§11).

> El paso del trigger NO se copia desde `schema.sql` (ese es el archivo de reset completo). El archivo de
> migración tiene la función lista para pegar tal cual en una BD con datos.

**Mecanismo elegido — variable de sesión transaccional, no parámetro al trigger:** el trigger corre por
cada fila de `ventas_detalles` y no recibe parámetros de la función. `fn_registrar_venta_pos` hace
`set_config('app.permitir_stock_negativo', 'on', true)` (con `is_local=true` → vive solo en esa transacción)
y el trigger lo lee con `current_setting('app.permitir_stock_negativo', true)`. Las ventas online normales no
setean nada → `current_setting` con `missing_ok=true` devuelve NULL → se mantiene el `RAISE` de stock insuficiente.

---

## 7. UI de la cola — tab "Pendientes" en `ventas`

El módulo `ventas` ya usa tabs internas (`VentasTabsComponent` + listado + resumen, patrón obligatorio de
CLAUDE.md, documentado en `VENTAS-README.md` §"Patrón de tabs internas"). Se agrega una 3ª tab **"Pendientes"**
siguiendo ese mismo patrón (componente en `components/`, rutas planas, cada página con su `ion-header` + tabs):
- Lista de ventas en cola con su estado (`PENDING`/`SYNCING`/`ERROR`), sello de última sincronización, botón
  "Sincronizar ahora".
- La tab/badge solo aparece si hay ventas en cola.
- El `OfflineBannerComponent` (ya global en `app.component.html`) se amplía con badge "N en cola" → enlaza a la tab.

> ⚠️ **Expectativa de UX a manejar (hallazgo de `VENTAS-README.md`):** el listado y el resumen de ventas
> (`fn_listar_ventas`, `fn_reporte_ventas_periodo`) leen **solo del servidor**. Las ventas en cola offline **NO
> aparecen** ahí ni en los KPIs hasta sincronizar — es coherente con local-first (la verdad está en el servidor).
> Para que el cajero no piense que "perdió" ventas, la tab **Pendientes** es donde las ve mientras suben. Mensaje
> mental: *Lista/Resumen = lo ya sincronizado; Pendientes = lo que falta subir.*

---

## 8. Mapa de archivos afectados

| Archivo / Componente | Acción | Estado |
|----------------------|--------|--------|
| `@capacitor-community/sqlite@8.1.0` | Instalado | ✅ Fase 1 |
| `LocalDbService` (core) | Creado — patrón adaptador: `SQLiteAdapter` (Android/iOS) + `IndexedDbAdapter` (web nativo) | ✅ Fase 1 |
| `src/assets/sql-wasm.wasm` + asset jeep-sqlite en `angular.json` | **Eliminados (2026-06-10)** — peso muerto, IndexedDB nativo no los usa | ✅ Fase 1 |
| `CatalogoLocalService` (core) | Creado — cache SQLite/IndexedDB + cache RAM + búsqueda en memoria | ✅ Fase 2 |
| `inventario.service.ts` — 4 métodos POS | Cache-aside contra `CatalogoLocalService` | ✅ Fase 2 |
| `producto.model.ts` — `ProductoPOS` | Campo `categoria_id` agregado | ✅ Fase 2 |
| `pos.page.ts` — 2 guardas `isConnected()` | Invertidas: buscar offline contra cache | ✅ Fase 2 |
| `pos.page.ts` — `seleccionarCategoriaCatalogo()` | Omite skeleton si el filtro es instantáneo (cache RAM offline) | ✅ Fase 2 |
| `storage.service.ts` — `resolveImageUrl()` | No firma offline (evita timeout 5s) + cache de URLs firmadas por path → imágenes persisten al filtrar/buscar/perder red | ✅ Fase 2 |
| `fn_catalogo_productos_pos.sql` + `fn_buscar_productos_pos.sql` | Campo `categoria_id` en JSON. **Ya ejecutadas en Supabase.** | ✅ Fase 2 (BD) |
| `OutboxService` (core) | Creado — cola de ventas (PENDING/SYNCING/SYNCED/ERROR) + contador reactivo `pendientes$` | ✅ Fase 4 |
| `SyncService` (core) | Creado — push automático al reconectar, FIFO estricto, red-vs-datos (dead-letter) | ✅ Fase 5 |
| `pos.service.ts` — `encolarVentaOffline()` | Creado — arma payload crudo, encola, dispara sync | ✅ Fase 4 |
| `cierre-diario.page.ts` — `colaSincronizadaParaCerrar()` | Barrera: drena la cola o bloquea el cierre | ✅ Fase 7 |
| `fn_actualizar_stock_venta` (trigger) + `chk_stock_no_negativo` | Variable de sesión + CHECK eliminado | ✅ Fase 6 (BD) |
| `VentasPendientesPage` | Creada — lista + estado (PENDING/ERROR) + sincronizar/reintentar/descartar | ✅ Fase 8 |
| `ventas-tabs.component` + `ventas.routes` | 3ª tab "Pendientes" condicional (solo si hay cola) + ruta | ✅ Fase 8 |
| `offline-banner.component` | Badge "N en cola" (offline) + barra "Sincronizando N" (online drenando) → enlazan a Pendientes | ✅ Fase 8 |
| `pos.page.ts` — `ejecutarCobro()` / `cobrarOffline()` | Híbrido: online directo (nº comprobante), offline encola local-first | ✅ Fase 4 |
| `TurnoLocalService` (core) | Creado — CRUD del snapshot `turno_activo_local` (`guardar`/`obtener`/`borrar`) | ✅ Fase 3 |
| `pos.service.ts` — `procesarVenta()` | `resolverTurno()`: memoria (Realtime) → snapshot local, **sin roundtrip al servidor por venta**. RPC directo con clasificación transporte/datos: error de transporte → encola con la misma idempotency key (§15.2) | ✅ Fase 3 + §15.2 |
| `app.component.ts` | Instancia `SyncService` en el bootstrap (drenado al arranque, §15.1) | ✅ §15.1 |
| `sync.service.ts` | Suscripción a `usuarioActual$`: hidrata el contador del outbox + drena la cola al restaurar sesión. Clasificación de errores unificada con `SupabaseService.esErrorDeTransporte()` | ✅ §15.1 |
| `turnos-caja.service.ts` | `sincronizarSnapshotLocal()` solo con red: escribe al abrir, borra al cerrar. Cableado en `inicializarEstadoReactivo`, `refrescarTurnoActivo`, `handleTurnoChange` | ✅ Fase 3 |
| `caja-abierta.guard.ts` | Sin red: fallback a `turno_activo_local` (valida que sea del propio empleado) | ✅ Fase 3 |
| `clientes.service.ts` — `obtenerConsumidorFinal()` | Cache en `localStorage` por negocio → habilita cobro offline (el CF se sirve del cache sin red) | ✅ Refinamiento UX |
| `ui.service.ts` — `showError()` | Silencia el toast cuando es error de red **y** offline (el banner global ya avisa). Helper `esErrorDeRed()` | ✅ Refinamiento UX |
| `paginated-list.page.ts` — `cargar()` | Usa `showError` (hereda el silenciado offline) en vez de `showToast` | ✅ Refinamiento UX |
| `offline-banner.component` + `app.component.scss` + `global.scss` | Rediseño: flujo (no `fixed`) empuja el contenido; safe area solo con banner visible; status bar conserva su color; warning ámbar (sin conexión) / primary azul (sincronizando); toasts mantienen safe area | ✅ Refinamiento UX |

---

## 9. Orden de implementación (fases deployables)

| Fase | Descripción | Estado |
|------|-------------|--------|
| **1** | Setup SQLite — `LocalDbService` con patrón adaptador (SQLite nativo + IndexedDB web). Limpieza de jeep-sqlite/sql-wasm | ✅ **Completada** |
| **2** | Cache de catálogo — `CatalogoLocalService`, integrar `InventarioService`, invertir guards POS, RPCs con `categoria_id`. **Fixes offline:** cache RAM del catálogo, no firmar imágenes offline, cache de URLs firmadas (fotos persisten al filtrar/buscar/perder red) | ✅ **Completada** |
| **3** | Turno local — `TurnoLocalService`, snapshot sincronizado en `TurnosCajaService`, lectura local en `PosService`, fallback en `cajaAbiertaGuard` | ✅ **Completada** |
| **4** | OutboxService + cobro local-first — `OutboxService`, `ejecutarCobro()` híbrido (online directo, offline encola) | ✅ **Completada** |
| **5** | SyncService — push automático al volver red, FIFO estricto, distinción red/datos (dead-letter) | ✅ **Completada** |
| **6** | Cambios de BD — `p_permitir_stock_negativo` en RPC + variable de sesión en trigger + quitar CHECK | ✅ **Completada — ejecutada en Supabase (2026-06-10)** |
| **7** | Barrera del cierre — guardia `colaSincronizadaParaCerrar()` en `cierre-diario.page` (drena o bloquea) | ✅ **Completada** |
| **8** | UI — tab "Pendientes" en `ventas` (solo visible con cola) + `VentasPendientesPage` + badge en `OfflineBannerComponent` | ✅ **Completada** |

> **Nota sobre la Fase 5:** se implementó FIFO estricto con corte al primer error (red o datos) para preservar
> el orden del ledger. El backoff exponencial + jitter del diseño original se simplificó: el reintento lo dispara
> el listener de red (`NetworkService`) al reconectar, no un timer propio. Suficiente para el caso real (la cola se
> drena al volver la señal); si en producción se ve necesidad de reintentos temporizados sin cambio de red, se agrega.

> Fases 1-3 no tocan nada financiero. El bloque de ventas (4-8) requiere los cambios de BD (fase 6).

---

## 10. Evidencia técnica (contraste con código y schema real)

| Hallazgo | Implicación |
|----------|-------------|
| `fn_registrar_venta_pos` asigna `numero_comprobante` atómicamente (`UPDATE secuencias_comprobantes +1`) | La numeración no puede generarse offline → servidor única fuente de verdad. Refuerza local-first (encolar, no calcular). |
| `idempotency_key UUID UNIQUE` ([schema.sql:603](../setup/schema.sql#L603)) + doble guarda en la función | Reenviar es 100% seguro. Cimiento del outbox. |
| Venta dispara 3 triggers (stock, kardex, saldo cajón) | No replicar en SQLite. SQLite solo guarda el payload crudo. |
| `chk_stock_no_negativo` + `RAISE` en trigger | Stock negativo prohibido hoy → relajar para ruta offline (§5, §6). |
| `fn_abrir_turno` mueve dinero + genera `turno_id` | Abrir turno offline imposible → se cachea el turno ya abierto (§4.6). |
| 🔴 `procesarVenta()` consulta el servidor por el turno antes de cada venta ([pos.service.ts:33](../../src/app/features/pos/services/pos.service.ts#L33)) | **Bloqueador del cobro offline.** Debe leer el turno del snapshot local, no del servidor (§4.6). |
| `cajaAbiertaGuard` depende de estado en memoria llenado por query a BD | Sin red al iniciar, bloquea el POS con turno abierto → fallback a `turno_activo_local` (§4.6). |
| El cierre cuadra con `saldo_digital(CAJA_CHICA)` que alimenta el trigger por venta (3_PROCESO_CIERRE_CAJA.md) | Ventas offline sin sincronizar → cuadre incorrecto + `FALTANTE_CAJA` injusto → barrera del cierre §4.7 es **obligatoria**. |
| Listado/resumen de ventas leen solo del servidor (VENTAS-README.md) | Ventas offline no aparecen hasta sincronizar → la tab Pendientes las muestra mientras suben (§7). |
| POS aborta con toast si `!isConnected()` (2 guardas, no 3 — "buscar por nombre" es computed en memoria) | Invertir: buscar contra cache (§4.5). |
| `idempotency_key` hoy en `localStorage` (1 venta) | Se migra a SQLite (cola N). El patrón ya existe, se generaliza. |

---

## 11. Riesgos aceptados conscientemente

- Stock puede quedar negativo (correcto, se ajusta manual).
- FACTURA y FIADO no aplican offline en v1.
- Ventas offline no aparecen en otros dispositivos hasta sincronizar.
- Si se desinstala la app con cola pendiente, esas ventas se pierden → mitigación: sync agresivo al volver la red.
- SQLCipher obliga a declarar encriptación en export compliance de EE.UU. (checkbox, no bloqueo).

---

## 12. Estado del repositorio

- Partimos del commit limpio `8d9e409` ("antes de impl el modo OFFLine").
- La Fase 1 anterior (IndexedDB directo) quedó respaldada en `git stash` (`respaldo-offline-fase1-descartada`).
- **Pendiente al re-aplicar §6:** las RPCs `fn_catalogo_productos_pos` y `fn_buscar_productos_pos` ya fueron
  ejecutadas con `categoria_id` en Supabase durante la fase descartada; hay que re-aplicar ese mismo cambio en el
  **código** (los `.sql` volvieron a su versión vieja con el reset) para que coincida con lo que ya corre en la BD.

---

## 13. Refinamientos de UX offline (2026-06-10, post Fases 1-8)

Ajustes hechos tras probar el flujo completo. No cambian la arquitectura — pulen la experiencia.

### 13.1 Consumidor Final cacheado (habilita cobrar offline)

`ClientesService.obtenerConsumidorFinal()` consultaba Supabase → sin red devolvía null → no se podía cobrar
(toda venta efectivo/transferencia necesita el cliente CF). Ahora cachea el CF en `localStorage` por negocio:
online lee de Supabase y refresca el cache; offline lo sirve del cache. Transparente para el POS.

> **Decisión de alcance:** solo se cachea el **Consumidor Final**, no la lista de clientes registrados. Los
> clientes registrados en el POS solo sirven para **FIADO**, que está vetado offline (§3). Cachearlos sería
> trabajo sin propósito y abriría la puerta a fiar sin red.

### 13.2 Toasts de conexión — silenciados cuando el banner ya avisa

El banner global (`<app-offline-banner>`) es la **única** señal de offline. Mostrar además toasts "Verifica tu
conexión" al entrar a cada sección era redundante. Solución centralizada en `UiService.showError()`:

- Si el mensaje es de red (`esErrorDeRed()`: failed to fetch / network / timeout / conexión) **y** `!isConnected()`
  → no muestra el toast. Un cambio cubre las ~15 páginas sin tocarlas una por una.
- `PaginatedListPage.cargar()` migró de `showToast` a `showError` → hereda el silenciado.

**Regla de qué toast se queda y cuál se va:**

| Tipo de toast | Ejemplo | ¿Se muestra offline? |
|---|---|---|
| "Entré a sección y no cargó por red" | "Error al cargar... Verifica tu conexión" | ❌ No (el banner ya avisa) |
| "Hice una acción, este es su resultado" | "Venta guardada — se sincronizará..." | ✅ Sí |
| "Acción que NO se puede sin red" | "Fiado no disponible sin conexión" | ✅ Sí |

> Resultado en el POS offline: al cobrar el cajero ve **un solo toast** ("Venta guardada — se sincronizará al
> volver la conexión"). Nada de "verifica tu conexión" al entrar.

### 13.3 Rediseño visual del banner

| Cambio | Antes | Ahora |
|--------|-------|-------|
| **Posición** | `position: fixed` → se montaba sobre el contenido | Flujo normal: `ion-app` es flex column, el banner empuja el contenido hacia abajo (`app.component.scss`) |
| **Safe area (celular)** | El banner tapaba la status bar | El `:host` reserva el safe area **solo con banner visible** (`:host-context(body.offline-banner-visible)`) — online no ocupa espacio |
| **Color status bar** | El rojo pintaba la franja de la hora/batería | La franja del safe area usa `--app-bg` (color de la app); el banner empieza debajo |
| **Color banner** | Rojo (`danger`) — parecía error | Ámbar (`warning`) para "Sin conexión"; azul (`primary`) para "Sincronizando" |
| **Doble safe area** | Banner + header reservaban el espacio dos veces (hueco grande) | `body.offline-banner-visible` anula `--ion-safe-area-top` en toolbars y `.sidebar-header` |
| **Toasts** | El override de safe area los subía a la status bar | `ion-toast` restaura su safe area real dentro de `body.offline-banner-visible` |

**Mecanismo clave:** `OfflineBannerComponent` togglea la clase `body.offline-banner-visible` según
`isOffline || pendientes > 0`. Toda la coordinación de safe area cuelga de esa clase en `global.scss`.

### 13.4 Rendimiento de carga del catálogo (aplica también ONLINE)

El cache local que se construyó para el offline también acelera el arranque online. Tres mejoras, un único
método de pintado reutilizado (`publicarCatalogoConImagenesProgresivas()` en `pos.page.ts`):

| Mejora | Antes | Ahora |
|--------|-------|-------|
| **Imágenes progresivas** | `cargarCatalogo` firmaba las N imágenes (N llamadas a Storage) antes de pintar | Pinta la cuadrícula al instante reutilizando imágenes ya resueltas; firma las nuevas en background |
| **Stale-while-revalidate** | El POS esperaba la respuesta del servidor antes de mostrar nada | `cargarCatalogo` pinta del cache local al instante (`pintarDesdeCacheSiExiste`) y refresca en background — arranque percibido inmediato |
| **Query de categorías redundante** | `guardarCacheEnBackground` re-consultaba categorías ya cargadas | `obtenerProductosCatalogoPOS(catId, categorias)` recibe las ya cargadas → una query menos |

> El método único elimina la duplicación que existía entre `refrescarCatalogo` y el resto de cargas. La lógica
> financiera no cambia — solo el **orden de pintado** (mostrar antes, resolver detalles después).

**✅ Implementado (2026-06-10) — lazy loading de imágenes + render diferido del grid:**
antes el grid disparaba **todas** las descargas de imagen en el primer render (fotos WebP 1600px usadas
como thumbs de ~110px: ~8-15 MB con 100 productos, ~80-150 MB proyectado a 1000) y pintaba todas las
cards del DOM aunque solo ~15 quepan en pantalla. Dos cambios baratos lo resuelven:

1. `loading="lazy"` en los 4 `<img>` del POS (grid simple + template, lista y panel desktop) — el
   browser solo descarga las imágenes cercanas al viewport. Ahorra datos del cajero y egress de Storage.
2. `content-visibility: auto` + `contain-intrinsic-size` en `.catalogo-card` — el browser salta el
   layout/paint de las cards fuera de pantalla. Seguro sin saltos de scroll (aspect-ratio + ancho del
   grid fijan la geometría). Pospone la necesidad de virtual scroll real por mucho tiempo.

**Próximo cuello de botella a escala (no urgente, anotado):** `resolverImagenesCatalogo()` firma las
URLs de TODOS los productos en background (`createSignedUrl` × N). Son requests JSON pequeños, pero a
1000 productos es un burst de 1000+ llamadas a Storage. Optimización futura: firmar bajo demanda
(viewport) o miniaturas reales generadas al subir. No implementar hasta que el catálogo lo justifique.

---

## 15. Endurecimiento post-revisión (2026-06-10)

Dos brechas detectadas en revisión profesional del código ya implementado. Ambas tocaban la promesa
central del plan ("nunca perder una venta / sync apenas vuelve la red") y fueron corregidas.

### 15.1 Drenado al arranque en frío (cola invisible tras reiniciar la app)

**Brecha:** `SyncService` es `providedIn: 'root'` (lazy) — solo se instanciaba cuando alguna página
lo inyectaba (POS, Pendientes, cierre). Además `OutboxService._pendientes$` nace en `0` y nadie
llamaba `refrescarContador()` al boot. Escenario real: vender offline → cerrar la app → reabrirla
con red → si el usuario no entraba al POS, **las ventas ni se sincronizaban ni aparecían en el
badge** (parecían perdidas; la barrera del cierre las atrapaba recién al cerrar turno).

**Fix (2 piezas):**
1. `app.component.ts` inyecta `SyncService` en el bootstrap (mismo patrón que `TurnosCajaService`).
2. El constructor de `SyncService` se suscribe a `auth.usuarioActual$` (filtrando usuario con
   `negocio_id`): al restaurarse la sesión → `outbox.refrescarContador()` (hidrata el badge) +
   `sincronizar()` (drena lo que quedó de la sesión anterior). Ambos son no-op/baratos si la cola
   está vacía o no hay red.

### 15.2 Ventana de la muerte residual en la ruta online

**Brecha:** el local-first solo aplicaba si `isConnected()` ya era `false` ANTES de cobrar. Con señal
intermitente (el caso de uso declarado del plan) el flujo online fallaba en dos puntos:
- `resolverTurno()` consultaba el servidor por el turno en cada venta → el fetch moría en vuelo →
  `SIN_TURNO` falso aunque el turno existiera. (El plan §4.6 ya decía "procesarVenta() YA NO consulta
  el servidor" — la implementación había quedado a medias: solo evitaba la query estando offline.)
- Si el RPC de la venta moría en vuelo, la venta NO se encolaba — toast de error y el cajero debía
  recobrar, con riesgo de duplicar si el servidor sí había procesado.

**Fix (en `pos.service.ts`):**
1. `resolverTurno()` ya no toca la red: lee el estado en memoria de `TurnosCajaService` (mantenido
   por la query inicial + Realtime) y cae al snapshot `turno_activo_local`. Bonus de rendimiento:
   un roundtrip menos por venta.
2. `procesarVenta()` llama al RPC directo (sin `supabase.call()`, que se traga el error crudo) y
   clasifica con `SupabaseService.esErrorDeTransporte()`:
   - **Transporte** (request murió en vuelo, no se sabe si el servidor procesó) → encola en el
     outbox con la **misma idempotency key** y retorna `{ success: true, encolada: true }`. Reenviar
     es siempre seguro: si la venta sí llegó, el sync recibe `duplicado: true` y la descarta.
   - **Datos** (validación del servidor) → throw con el mensaje real (incluye extracción de
     `superadmin_blocked:`). La página muestra un solo toast (antes `call()` + página duplicaban).
3. `pos.page.ts`: si `response.encolada` → toast "Conexión inestable — venta guardada, se
   sincronizará automáticamente" en vez del número de comprobante.

**Además:** `SyncService` dejó de usar su heurística propia `esErrorDeRed()` (el `includes('fetch')`
amplio podía clasificar un error de datos como red → reintento infinito) y usa el helper ya
probado `SupabaseService.esErrorDeTransporte()` — un solo clasificador en toda la app.

---

## 16. Desktop Windows (.exe) — diferido

- **Hoy:** Windows se cubre con **PWA** (la app web instalable) + IndexedDB. Suficiente — en desktop casi siempre
  hay internet, el offline es crítico en el celular del cajero, no en la PC del mostrador.
- **`@capacitor-community/electron` está ABANDONADO** (última v5.0.1 de sept-2023, solo Capacitor 5). No usar.
- **Si a futuro se necesita .exe nativo con SQLite real:** la ruta es **Electron directo** (empaquetar el Angular
  con Electron + `better-sqlite3`), como proyecto aparte. La capa `LocalDbService` que construiremos ya quedaría
  lista para ese motor. Fuera del alcance de este plan.

---

## 17. Evaluación de motores de sync de terceros (2026-07-03) — mantener arquitectura actual

Se evaluó reemplazar/ampliar la capa local con un motor de sync de terceros (réplica profesional para
desktop + celular, ante la pregunta de si esto podía "subir de nivel" el offline actual). Investigación
contra fuentes de 2025-2026. **Conclusión: no migrar el core. La arquitectura Local-First + Outbox de
este documento es la correcta para el lado de escritura y se mantiene.**

### 17.1 Por qué una réplica bidireccional clásica NO aplica aquí

El schema tiene ~36 tablas y ~36 funciones/triggers. Una venta dispara 3 triggers (stock, kardex, saldo
de caja), los comprobantes usan secuencias atómicas del servidor (`secuencias_comprobantes`), el cierre
cuadra contra `saldo_digital`, y todo está protegido por RLS multi-tenant + `fn_assert_no_superadmin`.
Replicar tablas bidireccionalmente bypassearía triggers, secuencias y validaciones — el mismo motivo por
el que este plan ya eligió Outbox + RPC idempotente en vez de un ORM local que escribe filas (§2, comparación
con RxDB). Esto no es una limitación de herramientas: es el modelo de negocio (Postgres = única fuente de
verdad financiera, §0).

Confirmado en la propia documentación de PowerSync: las escrituras locales van a una *upload queue* y el
desarrollador implementa `uploadData()` llamando a su propio backend. Es decir, el patrón que ya existe
(`OutboxService` → `fn_registrar_venta_pos` con `idempotency_key`) **es** ese mismo patrón — no hay nada
que un motor de terceros mejore en el lado de escritura.

### 17.2 Comparativa de opciones (lado de lectura)

| Opción | Qué hace | Fit |
|---|---|---|
| **PowerSync** | Postgres → SQLite en el cliente vía *sync streams* (replicación lógica). Partner oficial de Supabase. SDK Capacitor **en alpha (nov-2025)**: SQLite nativo en Android/iOS, wa-sqlite en web, un solo código. `@powersync/node` para Electron. Escrituras vía upload queue → RPCs propios | Mejor fit técnico si se quisiera réplica real de lectura (vs. los snapshots JSON de `cache_catalogo`) |
| **ElectricSQL** | Solo *read-path* (shapes por HTTP); escrituras 100% a cargo del desarrollador | Menos integrado — no resuelve más que lo que ya resuelve `CatalogoLocalService` |
| **RxDB** | DB reactiva JS con réplica bidireccional, last-write-wins | Descartado — mismo motivo que en §2 (storage SQLite premium, modelo LWW no encaja con ledger financiero) |
| **Extender `LocalDbService`** | Ampliar el adaptador propio con pulls incrementales por cursor (`updated_at`) | Cero infraestructura/costo nuevo, pero el protocolo de sync incremental se mantiene a mano |

### 17.3 Decisión

- **No adoptar un motor de sync de terceros ahora.** El outbox actual ya es el patrón correcto para
  escrituras; migrarlo no gana nada y agrega infraestructura (PowerSync Cloud o self-host).
- **Si en el futuro se quiere reemplazar los snapshots JSON de lectura** (catálogo, clientes, historial de
  ventas) **por una réplica SQLite real con sync incremental**, la única opción con fit real es **PowerSync**,
  pero:
  - El SDK de Capacitor está en **alpha** — no apto para producción de un sistema de caja sin un spike
    aislado primero.
  - La replicación lógica **no pasa por RLS** — el aislamiento multi-tenant (`negocio_id`) debe replicarse
    manualmente en las *sync rules* de PowerSync. Un error ahí filtra datos entre negocios.
  - Es infraestructura nueva (costo + servicio externo) vs. la solución actual, que no tiene ninguno de los dos.
- **Desktop (.exe):** sin cambios respecto a §16. Si se llega a necesitar réplica real en Electron, la ruta
  sería `@powersync/node` (o mantener `better-sqlite3` con el `LocalDbService` actual) — evaluar junto con
  el spike de PowerSync, no antes.

> Este documento sigue siendo la fuente de verdad de la implementación real. §17 es una nota de evaluación,
> no un cambio de rumbo — el "qué NO hacer" queda registrado para no re-evaluar esto desde cero en el futuro.

---

*Implementación completa (Fases 1-8 + refinamientos §13 + endurecimiento §15). BD de la Fase 6
ejecutada en Supabase el 2026-06-10. Evaluación de motores de sync de terceros añadida el 2026-07-03 (§17)
— se mantiene la arquitectura actual. El documento refleja el estado real del código.*
