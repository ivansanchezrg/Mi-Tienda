# Plan — Modo Offline "Vendedor de Calle" (Fase 2 del offline)

> Documento de decisión + plan de implementación. Creado: 2026-07-03.
> **Actualizado 2026-07-04:** dos cambios tras revisión con el dueño:
> 1. **Fase P — priming garantizado del cache** (§0.1, §2.9): el catálogo (y el CF, y los clientes)
>    solo se cachean al **entrar al POS con red**, así que "abrir turno y salir a la calle sin entrar
>    al POS" deja todo vacío. Prerequisito de máxima prioridad.
> 2. **Fase D — crear cliente offline** (§6.5): el vendedor de calle capta un cliente nuevo y quiere
>    el **ticket/nota a su nombre** (no factura fiscal). Revierte la decisión previa de "no crear
>    clientes offline". Es la única fase con escritura offline nueva + 1 función SQL.
> **Actualizado 2026-07-06:** revisión técnica contra el código (todas las referencias a archivos/líneas
> verificadas correctas). Se añaden 5 hallazgos: Trampa 3 de la Fase D (idempotencia por PK en el
> drenado — §6.5.2), política cliente dead-letter → ventas (§6.5.4), reglas de silenciado de toasts +
> deferral del priming (§P.3), trampa del parser WHERE del `IndexedDbAdapter` (§3) y condiciones
> exactas del snapshot de ventas (§5.2).
> **Estado: 📋 PLANIFICADO — pendiente de aprobación/implementación.**
>
> Continúa el trabajo de `PLAN-OFFLINE-POS-2026-06-08.md` (Fases 1-8 ✅ completas y en
> producción). Este plan NO reemplaza nada de aquel — amplía la **cobertura de lectura**
> de la capa local ya construida (`LocalDbService` + SQLite nativo / IndexedDB web).

---

## 0. Contexto — el caso de uso y qué ya existe

**Caso de uso objetivo:** vendedor que trabaja en la calle sin internet (referencia: app KYTE).
Flujo real: abre el turno en su local con WiFi → sale a vender todo el día sin señal →
vuelve al local → sincroniza y cierra el turno.

**Lo que YA funciona offline hoy** (Fases 1-8 del plan anterior, verificado en producción):

| Capacidad | Estado |
|---|---|
| Registrar venta efectivo/transferencia sin red (outbox + idempotency + sync FIFO) | ✅ |
| Catálogo POS completo (productos, variantes, presentaciones, categorías, búsqueda) | ✅ SQLite — **sobrevive cierre total y reinicio del teléfono** |
| Turno activo local (habilita cobrar sin red) | ✅ SQLite |
| Consumidor Final para la venta | ✅ localStorage |
| Home con snapshot del día | ✅ Preferences (solo mismo día — deliberado) |
| Tab "Pendientes" con la cola + barrera del cierre | ✅ |

**Lo que NO funciona offline y motiva este plan:**

| Gap | Síntoma en la calle |
|---|---|
| Selector de clientes del POS consulta el servidor (`buscarClientes` con ILIKE) | Sin red no se puede asignar cliente registrado a la venta — solo Consumidor Final |
| Listado de ventas del día lee solo del servidor (`fn_listar_ventas`) | La sección Ventas aparece vacía sin red (salvo tab Pendientes) |
| Sección Clientes lee solo del servidor | Aparece vacía sin red |

---

## 0.1 🔴 Bloqueador de raíz — el cache del catálogo depende de "entrar al POS con red" (hallazgo 2026-07-04)

> **Este hallazgo es la razón por la que este plan se amplía. Debe resolverse ANTES o JUNTO
> con las Fases A/B/C — de lo contrario todo el offline de calle es frágil.**

### El síntoma que reportó el dueño

> *"Lo que tengo funciona siempre y cuando yo me conecte primero a internet, entre al POS y se
> descarguen los productos. Pero si el cliente solo abre el turno con internet y se va a la calle
> sin entrar al POS, ya no funciona."*

**Es correcto.** Verificado en el código.

### La causa exacta

El snapshot del catálogo en SQLite (`cache_catalogo`) **solo se escribe en un único punto**:
`InventarioService.obtenerProductosCatalogoPOS()` cuando corre **online y sin filtro de categoría**
([inventario.service.ts:110-112](../../src/app/features/inventario/services/inventario.service.ts#L110)):

```typescript
if (!categoriaId && catalogo.length > 0) {
  this.guardarCacheEnBackground(catalogo, categoriasParaCache);  // ← ÚNICO write del cache
}
```

Y ese método **solo lo dispara la pantalla del POS** (`PosPage.cargarCatalogo()` / `refrescarCatalogo()`).
Ningún otro punto de la app llena el cache. En particular:

- **El Home NO precarga el catálogo.** `abrirTurno()` solo abre el turno; no toca productos (verificado).
- **El arranque de la app NO precarga el catálogo.** No hay priming al restaurar sesión.

Resultado — el cache se llena **solo si el usuario entra físicamente a la pantalla del POS con red**:

| Flujo del vendedor | ¿Cataloga offline en la calle? |
|---|---|
| WiFi → **entra al POS** (llena cache) → calle | ✅ Sí |
| WiFi → abre turno → **NO entra al POS** → calle | ❌ **No — catálogo vacío offline** |

Abrir turno y entrar al POS son **dos acciones separadas**. El vendedor de calle no tiene por qué
hacer la segunda. El plan base (§0, fila "Catálogo POS completo ✅") daba por sentado un cache ya
lleno — pero **ese "ya lleno" depende de un paso manual no garantizado.**

### Aclaración conceptual crítica (descarta la falsa solución)

Surgió la idea de *"replicar las tablas tal cual en SQLite en vez de un cache, para que se carguen
solas"*. **Eso NO resuelve el bug** y se descarta por estas razones:

1. **`cache_catalogo` YA es SQLite persistente** — no es un cache volátil en memoria. Sobrevive el
   cierre de la app y el reinicio del teléfono (una fila con `INSERT OR REPLACE`,
   [catalogo-local.service.ts:46-64](../../src/app/core/services/catalogo-local.service.ts#L46)).
   El problema **no es el formato de almacenamiento**, es **el momento en que se llena** (el *priming*).
   Tablas espejo vacías fallarían exactamente igual que un snapshot vacío.
2. **El catálogo del POS sale de `fn_catalogo_productos_pos`** — JOINs de ~7 tablas + COALESCE de
   categoría + presentaciones/atributos anidados. Replicar "las tablas tal cual" obligaría a
   **reimplementar toda esa lógica de JOINs en el cliente** y mantener ~10 esquemas SQLite en sync con
   cada migración. El snapshot aplanado tiene un solo punto de verdad (el SQL del servidor). Ya evaluado
   y descartado en PLAN-OFFLINE-POS §4.5 y §17.

> **Conclusión: el arreglo NO es cambiar dónde se guarda (ya es SQLite). Es cambiar CUÁNDO se descarga.**

### La solución correcta — priming multi-momento (Fase P, ver §3.1)

Precalentar el cache en los momentos donde el flujo **sí garantiza red**, mucho antes de que el
vendedor salga. En capas de oportunidad, de más temprana a más tardía:

| Momento | ¿Hay red normalmente? | Acción de priming |
|---|---|---|
| **Arranque de la app con sesión** (mañana, en el local) | ✅ Casi siempre | **Priming principal** — descargar catálogo + clientes + CF a SQLite |
| **Vuelve la red** (reconexión en cualquier punto) | ✅ | Refresh en background (oportunista) |
| **Abrir turno** (online-only por diseño) | ✅ | Priming de respaldo (por si el arranque falló) |
| **Entrar al POS** | ⚠️ Puede no haber | Ya existe hoy — última red de seguridad |

**Por qué el arranque es el momento principal (responde a "¿y si el internet se fue hace rato al abrir
turno?"):** si el priming dependiera solo de abrir turno y justo ahí no hay red, el catálogo quedaría
vacío — el mismo bug movido de lugar. Anclarlo al **arranque de la app** (que ocurre en el local con
WiFi, antes de todo) + **refresh al reconectar** hace que el único caso de fallo sea un teléfono que
**nunca** tuvo red desde que se abrió la app. Eso ya no es "olvidé entrar al POS" — es un caso extremo
aceptable, y el banner de frescura (Fase C) lo hace visible.

**Infraestructura que YA existe y se reutiliza (cero piezas nuevas de fondo):** `SyncService`
([sync.service.ts:34-52](../../src/app/core/services/sync.service.ts#L34)) ya se suscribe a los DOS
momentos correctos:
- `auth.usuarioActual$` filtrando `negocio_id` → **sesión restaurada** (arranque con sesión).
- `network.getNetworkStatus()` → **vuelve la red**.

Hoy esas suscripciones solo drenan el outbox de ventas. La Fase P les cuelga además la descarga del
catálogo (y las réplicas de clientes/CF de la Fase A). Es el mismo patrón best-effort, en el mismo
lugar, sin infraestructura nueva.

### El MISMO bug afecta al Consumidor Final y a los clientes (no solo al catálogo)

El barrido de código (2026-07-04) confirmó que el gap de priming del §0.1 **no es exclusivo del
catálogo** — se repite en dos datos más que también solo se cachean "al entrar al POS con red":

| Dato | Cómo se rompe hoy en la calle | Cubierto por |
|---|---|---|
| **Catálogo** | `cache_catalogo` solo se escribe al cargar el POS online | Fase P |
| **Consumidor Final** | `ClientesService.obtenerConsumidorFinal()` cachea el CF en `localStorage` **solo al cargar el POS online** (§13.1 plan anterior). Si nunca se cargó el POS con red → `sinConsumidorFinal = true` offline → **no se puede cobrar ni siquiera a Consumidor Final** | Fase P (incluir CF en `precalentarOffline()`) |
| **Clientes registrados** | La réplica de clientes (Fase A) se pensó "al abrir el POS online" — mismo antipatrón | Fase P (incluir clientes en `precalentarOffline()`) |

> **Refuerzo:** por esto la Fase P descarga **catálogo + CF + clientes** en el mismo momento (arranque
> con sesión). No basta con arreglar el catálogo: si el CF no está cacheado, el POS offline no cobra
> nada. Los tres comparten la misma cura.

---

## 1. Conclusión ejecutiva (TL;DR)

- **Arquitectura sin cambios:** se extiende el patrón *read model aplanado* ya probado
  (`CatalogoLocalService`): el servidor arma la proyección de lectura, el cliente la
  persiste completa en `LocalDbService` y la sirve offline con búsqueda en memoria.
  **No** se replican tablas espejo del schema, **no** se adopta motor de sync externo
  (PowerSync/ElectricSQL/RxDB — evaluados y diferidos en PLAN-OFFLINE-POS §17).
- **Alcance:** **(P) priming garantizado del cache** (arreglo de raíz — §0.1); (A) réplica de
  lectura de **clientes** + selector del POS offline; (B) **ventas del día** visibles offline;
  (C) sellos de frescura en la UI; **(D) crear cliente offline** para ticket/nota con nombre (§6.5,
  hallazgo 2026-07-04 — la única fase con escritura offline nueva + 1 función SQL).
- **La Fase P es el arreglo de fondo:** el catálogo hoy solo se cachea al entrar al POS con red —
  si el vendedor abre turno y se va sin entrar al POS, la calle no funciona (§0.1). P mueve la
  descarga a momentos con red garantizada (arranque + reconexión + apertura de turno), reutilizando
  el `SyncService` existente. **Sin P, todo lo demás es frágil.**
- **Cambios de BD:** cero en P/0/A/B/C (capa cliente pura). **Solo la Fase D** agrega 1 función SQL
  (`fn_crear_cliente_offline` con upsert por identificación). Todo lo demás es Angular + SQLite/IndexedDB.
- **Escrituras offline:** ventas (ya existían) + **crear cliente (Fase D)**. La Fase D crea el cliente
  con UUID generado en el cliente y lo drena ANTES que las ventas que lo referencian. **NO habilita
  FACTURA ni FIADO offline** — solo poner el nombre del cliente en un ticket/nota.

---

## 2. Decisiones de producto registradas (el "qué NO" y por qué)

| Decisión | Razón | Origen |
|---|---|---|
| ❌ **NO crear productos offline** | Nadie carga mercadería en la calle: el inventario se alimenta en el local, con internet, cuando llega la mercadería. Técnicamente además: (1) eliminaría la necesidad de una "cola de comandos ordenada" (una venta podría referenciar un producto que el servidor aún no conoce → drenado productos→ventas), la única pieza compleja nueva; (2) crear producto casi siempre lleva foto → upload a Storage → requiere red igual. | Decisión del dueño, 2026-07-03 |
| ⚠️ ~~NO crear clientes offline~~ → **SÍ, en la Fase D** (revisado 2026-07-04) | El uso real lo pidió: vendedor en la calle capta un cliente nuevo y quiere el **ticket/nota a su nombre** (NO factura fiscal). Con solo CF o clientes ya replicados no alcanza. Se agrega como Fase D (§6.5): outbox de clientes con drenado clientes→ventas, UUID generado en cliente, upsert por identificación al drenar. **Alcance acotado por decisión del dueño (2026-07-04): solo ticket/nota con nombre — NO habilita FACTURA offline.** | Este plan, revisado |
| ❌ NO abrir/cerrar turno, FIADO, FACTURA, ajustes de inventario, recargas, nómina, transferencias offline | Heredadas del plan anterior (§3): mueven dinero real, validan crédito contra servidor o consumen secuencias SRI. El servidor es la única fuente de verdad financiera. | PLAN-OFFLINE-POS §0/§3 |
| ❌ NO réplica relacional espejo del schema | Duplicaría la lógica de armado del catálogo (JOINs de `fn_catalogo_productos_pos`) en el cliente y exigiría mantener ~10 schemas sincronizados con cada migración. El read model aplanado tiene un solo punto de verdad (el SQL del servidor) y sync trivial (reemplazo del snapshot). | PLAN-OFFLINE-POS §4.5 + análisis 2026-07-03 |

> **Aclaración conceptual (2026-07-03):** "el modelo de productos en SQLite" YA existe —
> como snapshot aplanado en `cache_catalogo`, no como tablas espejo. Los métodos de pago
> tampoco requieren réplica: son valores fijos del cliente (EFECTIVO/TRANSFERENCIA/DEUNA/FIADO,
> CHECK en BD), no una tabla.

---

## 2.9 Fase P — Priming garantizado del cache (arreglo de raíz de §0.1)

> **Prerequisito de todo el plan.** Sin esto, el catálogo (y las réplicas nuevas de A) pueden
> estar vacíos en la calle aunque el vendedor haya tenido internet. Es la fase de mayor prioridad.

### P.1 Qué se precalienta

Un solo método coordinador — `precalentarOffline()` — que descarga en background lo que el vendedor
necesita para la calle: **catálogo POS** (Fase P mínima) y, cuando exista la Fase A, **clientes + CF**.
Reutiliza los métodos que YA existen:

- Catálogo: `InventarioService.obtenerProductosCatalogoPOS(undefined, categorias)` online → ya escribe
  `cache_catalogo` vía `guardarCacheEnBackground` (§0.1). No hay que crear el write, solo **invocarlo**
  desde los momentos correctos.
- Clientes/CF (Fase A): `ClientesService.descargarSnapshotParaCache()` + el cache de CF ya existente.

### P.2 Dónde se engancha (los momentos con red garantizada)

Todo cuelga del `SyncService`, que **ya se suscribe a los dos momentos correctos**
([sync.service.ts:34-52](../../src/app/core/services/sync.service.ts#L34)) — hoy solo drena ventas;
se le añade el priming del catálogo con el mismo patrón best-effort:

| Momento | Gancho existente | Acción nueva |
|---|---|---|
| **Arranque con sesión** (local, mañana) | `auth.usuarioActual$` filtrando `negocio_id` | + `precalentarOffline()` |
| **Vuelve la red** | `network.getNetworkStatus()` (online) | + `precalentarOffline()` |
| **Abrir turno** (respaldo) | Tras `abrirTurno()` OK en `turnos-caja.service` / home | Disparar `precalentarOffline()` best-effort |

> El priming del arranque + reconexión es lo que responde a *"¿y si el internet se fue hace rato
> cuando abro el turno?"*: para entonces el catálogo ya se bajó al abrir la app en el local. Abrir
> turno es solo el respaldo, no el momento crítico.

### P.3 Reglas

- **Best-effort, nunca bloquea:** si falla la descarga, la app sigue normal (el priming reintenta al
  próximo momento con red). Igual que el drenado del outbox hoy.
- **No re-descargar si ya es fresco:** guardar el `timestamp` del último priming (ya existe
  `CatalogoLocalService.obtenerTimestamp()`); saltar si el snapshot tiene < N minutos. Evita bursts de
  red innecesarios en reconexiones frecuentes. (Umbral sugerido: 10-15 min; ajustar en implementación.)
  **Leer el timestamp local ANTES de descargar** — la lectura es local y barata; la descarga no.
- **Debounce de reconexión:** si la red parpadea (offline↔online repetido), no disparar N descargas —
  reutilizar el mismo criterio de frescura del punto anterior lo cubre naturalmente.
- **Reentrante-seguro (hallazgo 2026-07-06):** flag `primingEnCurso` (mismo patrón que `sincronizando`
  en el drenado). En el arranque los DOS ganchos disparan a la vez: `getNetworkStatus()` es un
  `BehaviorSubject` que emite su valor actual (online) al suscribirse, y `usuarioActual$` emite al
  restaurar sesión — sin el flag, el priming inicial corre duplicado. Además `usuarioActual$` puede
  re-emitir después (refresh de token, `hidratarUsuarioOffline`): el flag + frescura lo absorben.
- **Silenciar errores — NO pasar por el toast de `call()` (hallazgo 2026-07-06):** `supabase.call()`
  solo silencia errores de transporte **estando offline** ([supabase.service.ts:208](../../src/app/core/services/supabase.service.ts#L208));
  un fallo online (500, timeout con red "conectada") mostraría un toast de error por una tarea en
  background que el usuario nunca inició. `precalentarOffline()` envuelve TODO en try/catch →
  `LoggerService`, sin toast. (El write del cache ya es best-effort; esta regla cubre el fetch.)
- **No competir con el arranque (performance):** la RPC del catálogo completo
  (`fn_catalogo_productos_pos`) es la lectura más pesada de la app. Dispararla en el mismo instante en
  que el Home carga `fn_home_dashboard` pelea ancho de banda/CPU en gama baja (ver
  `PERFORMANCE-STARTUP.md`). El priming del arranque se **difiere unos segundos** tras la emisión de
  `usuarioActual$` (constante en `timing.config.ts`, sugerido 5-8 s) — el vendedor está en el local
  con WiFi, no hay apuro de milisegundos.
- **Multi-tenant:** `precalentarOffline()` usa el `negocio_id` activo del JWT (igual que todo el resto).
  Al cambiar de negocio (hard reload), el nuevo arranque dispara su propio priming.

### P.4 Por qué en `SyncService` y no en un servicio nuevo

`SyncService` ya es el punto único del ciclo de vida offline (arranque + red + sesión), ya está
instanciado en el bootstrap (`app.component.ts`, §15.1 del plan anterior) y ya coordina trabajo
best-effort disparado por esos mismos eventos. Meter el priming ahí evita un segundo servicio que
duplique las suscripciones a red/sesión. La descarga en sí vive en `InventarioService`/`ClientesService`
(cache-aside); `SyncService` solo **orquesta cuándo**.

---

## 3. Fase 0 — `LocalDbService` v2 (base para las réplicas nuevas)

Agregar dos tablas al esquema local (mismo shape que `cache_catalogo` — snapshot JSON por negocio):

```
cache_clientes:
  negocio_id     TEXT PRIMARY KEY
  clientes_json  TEXT NOT NULL       -- Cliente[] (excluye consumidor final: ya tiene su cache propio)
  timestamp      INTEGER NOT NULL

cache_ventas_dia:
  negocio_id     TEXT PRIMARY KEY
  fecha          TEXT NOT NULL       -- 'YYYY-MM-DD' local — invalida al cambiar el día
  ventas_json    TEXT NOT NULL       -- primera página del listado del día (shape de fn_listar_ventas)
  timestamp      INTEGER NOT NULL
```

> ⚠️ **Trampa de versionado — NO saltarse esto:**
> - **SQLite (Android/iOS):** agregar la tabla a `TABLES` basta — `_open()` ejecuta
>   `CREATE TABLE IF NOT EXISTS` en cada apertura. **NO subir el `version` que se pasa a
>   `createConnection()`**: el plugin `@capacitor-community/sqlite` usa ese número para su
>   propio sistema de upgrade statements; cambiarlo sin registrar `addUpgradeStatement`
>   puede fallar al abrir una DB existente.
> - **IndexedDB (web/PWA):** los object stores SOLO se crean en `onupgradeneeded` →
>   **hay que subir la versión de `indexedDB.open()`** (hoy `SCHEMA_VERSION = 1` → `2`)
>   y agregar las keys nuevas al mapa `primaryKeys` del `IndexedDbAdapter`.
> - **Acción concreta:** separar las constantes — `IDB_VERSION = 2` (sube con cada tabla
>   nueva) y mantener el parámetro del plugin SQLite como está. Documentarlo en el código.

> ⚠️ **Trampa del parser SQL del `IndexedDbAdapter` (web) — hallazgo 2026-07-06:** `query()` y
> `run()` solo soportan **UN** `WHERE col = ?` — `_parseWhereCol` toma la primera condición y filtra
> únicamente con `params[0]` ([local-db.service.ts:229](../../src/app/core/services/local-db.service.ts#L229)).
> Un `WHERE negocio_id = ? AND fecha = ?` **ignoraría `fecha` silenciosamente** y devolvería filas
> equivocadas en web. Regla para las tablas nuevas: SELECT solo por la PK (`negocio_id`) y comparar
> `fecha` (u otras columnas) en TypeScript. Con una fila por negocio, el costo es cero.

**Política de limpieza:** misma que `cache_catalogo` — aislada por `negocio_id` (una DB
por negocio), NO se borra en logout (un usuario nuevo del mismo negocio ve la misma data
del negocio, que es correcta). Sin TTL: el snapshot vale hasta ser reemplazado por un
fetch online (stale-while-revalidate); `cache_ventas_dia` además se invalida al cambiar
el día local (mismo criterio que el snapshot del home).

---

## 4. Fase A — Clientes offline (lectura + selector del POS)

### 4.1 `ClientesLocalService` (core) — nuevo

Espejo de `CatalogoLocalService`: `guardar(clientes)`, `obtener()`, cache RAM por negocio,
best-effort (nunca lanza). Campos mínimos del snapshot: `id, nombre, identificacion,
telefono, email, es_consumidor_final` (la tabla `clientes` es plana — el modelo completo
cabe sin recortes).

### 4.2 Write path — cuándo se refresca la réplica

| Momento | Cómo |
|---|---|
| **Priming (Fase P)** — arranque con sesión + reconexión + apertura de turno | `precalentarOffline()` en `SyncService` descarga la lista completa (`select` liviano, `es_consumidor_final = false`, `order nombre`, cap 5000) junto al catálogo. **Este es el momento principal** — garantiza la réplica aunque el vendedor nunca entre al POS ni a Clientes (el mismo gap del §0.1 aplica a clientes) |
| Al abrir el POS online (respaldo) | Fetch en background junto al refresco del catálogo — no bloquea el render |
| Al entrar a la sección Clientes online (respaldo) | El listado ya trae datos → persiste (primera página no basta: usar el mismo fetch completo en background) |

> **Cap de 5000 clientes** (~1 MB JSON): más que suficiente para tienda minorista. Si un
> negocio lo supera, la réplica guarda los primeros 5000 por nombre y el selector offline
> avisa "resultados locales parciales". No optimizar antes de que exista el caso.

### 4.3 Read paths — offline

| Punto | Hoy (online-only) | Offline (nuevo) |
|---|---|---|
| `SeleccionarClienteModalComponent.buscar()` | `buscarClientes()` → ILIKE en servidor | Sin red o error de transporte → filtrar la réplica en memoria (`nombre`/`identificacion` includes, límite 20) — mismo criterio que la búsqueda del catálogo POS |
| `buscarPorIdentificacion()` (check de cédula) | Query al servidor | Lookup en la réplica |
| Botón "Crear cliente" del selector | Crea contra servidor | **Deshabilitado sin red** con toast "Crear clientes requiere conexión" (decisión §2) |
| Página Clientes (listado) | Paginado servidor con saldos | Pintar la réplica básica con sello de frescura; los saldos de fiados NO se muestran offline (vienen de agregados del servidor — mostrar guion o etiqueta "requiere conexión") |

**Con esto, la venta offline puede llevar cliente registrado**: `fn_registrar_venta_pos`
ya acepta `cliente_id` y la validación multi-tenant la hace el servidor al drenar la cola.
FIADO sigue bloqueado offline (el método de pago FIADO ya está vetado en el POS sin red).

### 4.4 Silenciado de errores

Reusar `SupabaseService.esErrorDeTransporte()` + `debeSilenciarErrorOffline()` — el
selector no debe mostrar "verifica tu conexión" cuando ya está sirviendo resultados
locales (regla de toasts del plan anterior §13.2).

---

## 5. Fase B — Ventas del día visibles offline

### 5.1 Alcance

Solo el **listado del día actual** (tab "Lista" de Ventas): es lo que el vendedor consulta
en la calle ("¿cuánto llevo vendido?"). El Resumen (gráficos Apexcharts) y el historial de
otros días siguen online-only — consultas de escritorio, no de calle.

### 5.2 Mecánica (mismo patrón del snapshot del home)

- Tras cada fetch online exitoso de la primera página del día en `VentasListadoPage`,
  persistir en `cache_ventas_dia` (negocio + fecha local + página 1).
  **Condición exacta de escritura (hallazgo 2026-07-06):** solo cuando la vista es la default —
  `filtro === 'hoy'` **y** `page === 0` **y** sin `busqueda` **y** sin `estado` **y** sin `turnoId`
  (`fn_listar_ventas` acepta los cinco parámetros). Un fetch filtrado o de página 2 NO debe
  sobrescribir el snapshot del día — mismo criterio que el catálogo ("solo el completo refresca").
- Offline: pintar el snapshot si es del mismo día + banner de frescura ("datos de las
  HH:mm"). Infinite scroll deshabilitado sin red (`hasMore = false`).
- Las ventas hechas offline NO aparecen en este listado (son intenciones, no ventas
  confirmadas) — siguen viéndose en la tab **Pendientes**, que ya existe y es la fuente
  de verdad de lo no sincronizado. Mensaje mental sin cambios: *Lista = sincronizado;
  Pendientes = por subir* (PLAN-OFFLINE-POS §7).

---

## 6. Fase C — UX de frescura

- Chip/nota "Actualizado HH:mm" visible **solo offline** en: selector de clientes,
  listado de clientes, listado de ventas del día (el catálogo POS ya tiene su sello).
- El banner global offline (`app-offline-banner`) sigue siendo la señal principal —
  los sellos son contexto por sección, no alarmas nuevas.

---

## 6.5 Fase D — Crear cliente offline (ticket/nota con nombre)

> **Origen:** hallazgo del dueño (2026-07-04). Vendedor en la calle capta un cliente nuevo y
> quiere el comprobante **a su nombre** en vez de "Consumidor Final". Revierte la decisión previa
> de §2 ("NO crear clientes offline"). **Es la pieza de escritura offline MÁS compleja del plan** —
> merece implementarse con cuidado, después de P/0/A/B/C.

### 6.5.1 Alcance — acotado deliberadamente (decisión del dueño 2026-07-04)

| Sí | No |
|---|---|
| Crear cliente offline (nombre + opcional identificación/teléfono/email) | ❌ NO habilita FACTURA offline |
| Colgar ese cliente a una venta **TICKET / NOTA_VENTA** offline | ❌ NO habilita FIADO offline |
| Drenar cliente→venta en orden al volver la red | ❌ NO edita clientes existentes offline (v1) |

> 🔴 **Regla clave a documentar en la UI:** crear un cliente offline sirve para poner su **nombre en
> un ticket/nota**, NO para emitirle una factura fiscal. La FACTURA sigue vetada offline (secuencia
> SRI del servidor, §3 plan anterior) — el `clienteId` de un cliente nuevo no cambia eso. Si el
> cliente exige factura formal, se emite al volver al local con internet. **Este límite NO es de la
> app, es del SRI.**

### 6.5.2 El problema técnico — dos trampas que resolver

**Trampa 1 — Orden de drenado (venta con FK a cliente que el servidor aún no conoce).**
La venta offline lleva `clienteId`. Si el cliente también es offline, al sincronizar hay que subir
**primero el cliente, después la venta**. Solución:
- El cliente offline recibe un **UUID generado en el cliente** (`crypto.randomUUID()`) — el schema usa
  UUID como PK (`clientes.id UUID DEFAULT uuid_generate_v4()`), así que un UUID del cliente es válido.
- Cola propia `outbox_clientes` (espejo de `outbox_ventas`). El `SyncService` drena **clientes ANTES
  que ventas** (nueva regla de orden entre colas). La venta referencia el UUID local del cliente; ese
  UUID viaja tal cual al servidor (no se remapea si el insert del cliente usó ese mismo UUID).

**Trampa 2 — `UNIQUE (negocio_id, identificacion)`** ([schema.sql:685](../setup/schema.sql#L685)).
Al drenar el cliente offline, su identificación puede **ya existir** en el servidor (creado otro día /
otro dispositivo). Insertar de nuevo → violación de UNIQUE. Solución:
- El drenado del cliente hace **upsert por `(negocio_id, identificacion)`**: si ya existe, NO inserta —
  reusa el ID del servidor y **remapea** el `clienteId` de las ventas encoladas de ese cliente al ID
  real antes de drenarlas.
- Cliente **sin identificación** (solo nombre): el UNIQUE no aplica (NULL) → insert directo con el UUID
  local. Es el caso más común en la calle y el más simple.

> ⚠️ Sin el manejo del UNIQUE, un cliente con cédula creado offline que ya existía en el servidor
> tumbaría el drenado de toda la cola (FIFO se corta al primer error). El upsert + remapeo es
> **obligatorio**, no opcional.

**Trampa 3 — Reintento tras fallo parcial: idempotencia por PK (hallazgo 2026-07-06).**
Si el insert del cliente **llega al servidor** pero la app muere o pierde la red antes de eliminar la
fila de `outbox_clientes`, el reintento reenvía el mismo UUID. Con identificación el upsert lo absorbe
(Trampa 2). Pero **sin identificación — el caso más común en la calle según este mismo plan** — un
INSERT directo repetido violaría la PK → dead-letter → bloquea el drenado de las ventas. Solución:
- `fn_crear_cliente_offline` debe ser **idempotente también por `id`**: si ya existe una fila con
  `p_id` en el negocio, responder success con ese registro (sin insertar). Es el mismo contrato que la
  `idempotency_key` de las ventas — "duplicado = éxito". Orden de resolución dentro de la función:
  `p_id` existe → success; `identificacion` existe → success con el ID del servidor (el cliente
  remapea); ninguno → INSERT.
- Como `ON CONFLICT` de Postgres solo apunta a UNA constraint, la función resuelve por SELECTs en
  orden + `EXCEPTION WHEN unique_violation` como red de seguridad ante carrera (caso legítimo según
  CLAUDE.md — manejo de idempotencia, no catch-all).

### 6.5.3 Mecánica

```
Crear cliente offline (selector del POS, sin red):
  → UUID local (crypto.randomUUID())
  → INSERT en outbox_clientes {id, nombre, identificacion?, ...} estado PENDING
  → INSERT en cache_clientes (para verlo en el selector de inmediato)
  → devolver el cliente al POS con su UUID local → se cuelga a la venta

Al volver la red (SyncService, ORDEN ENTRE COLAS):
  1. Drenar outbox_clientes PRIMERO:
       - sin identificación → insert directo con el UUID local
       - con identificación → upsert por (negocio_id, identificacion):
             existe → reusar ID servidor + remapear clienteId en outbox_ventas
             no existe → insert con el UUID local
  2. Drenar outbox_ventas (FIFO, como hoy) — ya con clienteId válido en el servidor
```

- **Crear cliente offline vía RPC nueva (no insert directo):** hoy `crearCliente()` hace `insert`
  directo a Supabase ([clientes.service.ts:90](../../src/app/features/clientes/services/clientes.service.ts#L90)),
  bloqueado por la RESTRICTIVE `superadmin_no_write`. El drenado debe usar una **función SQL
  `fn_crear_cliente_offline`** que acepte el UUID pre-generado + haga el upsert por identificación
  server-side (atómico, respeta el UNIQUE sin carrera). — **Este es el único cambio de BD del plan
  completo** (ver §7, actualizado).
- **Unificar también el camino online (decisión de implementación, recomendado):** migrar
  `crearCliente()` online a la misma RPC — un solo camino de código, mismo upsert (protege además el
  double-submit online), y el `fn_assert_no_superadmin` queda en un solo lugar. Si se unifica, el
  nombre `fn_crear_cliente_offline` queda equívoco → nombrarla **`fn_upsert_cliente`** desde el
  inicio (la función no tiene nada de "offline": recibe un UUID y hace upsert).
- **Selector del POS:** el botón "Crear cliente" deja de estar deshabilitado offline (revierte la
  Fase A §4.3) → abre el mini-form; al guardar sin red, encola en `outbox_clientes` + refresca
  `cache_clientes` para que aparezca al instante.

### 6.5.4 Riesgos específicos de la Fase D

| Riesgo | Mitigación |
|---|---|
| Dos vendedores crean el mismo cliente (misma cédula) offline en dispositivos distintos | El upsert server-side por `(negocio_id, identificacion)` colapsa ambos al mismo registro; las ventas de ambos remapean a ese ID. Sin duplicado. |
| Cliente offline con cédula inválida/repetida dentro del mismo dispositivo | Validación de cédula en el form (ya existe `cedula.util.ts`) + el UNIQUE local de `cache_clientes` |
| Se desinstala la app con clientes en cola | Mismo riesgo aceptado que las ventas (§11 plan anterior): sync agresivo al volver la red |
| Orden entre colas mal implementado (venta antes que su cliente) | El `SyncService` drena `outbox_clientes` a COMPLETITUD antes de tocar `outbox_ventas`. Test explícito de este orden. |
| Reintento reenvía el mismo UUID tras fallo parcial (app muere entre insert OK y eliminar de la cola) | **Trampa 3 (§6.5.2)** — `fn_crear_cliente_offline` idempotente por `id`: duplicado = éxito, igual que la `idempotency_key` de ventas |
| Cliente cae a dead-letter (error de datos al drenarlo) y sus ventas quedan atrás | **Política explícita (2026-07-06):** no se agrega mecánica nueva — cuando el drenado de ventas llegue a una venta cuyo `clienteId` nunca se creó, el servidor la rechaza (`fn_registrar_venta_pos` valida pertenencia del cliente) → dead-letter → corte FIFO, exactamente el flujo existente. Ambas quedan visibles en tab Pendientes. El corte FIFO también frena ventas posteriores sanas: aceptado — preserva el orden del ledger de caja y el caso es rarísimo (el form ya valida nombre/cédula antes de encolar) |

---

## 7. Cambios de base de datos

**Fases P / 0 / A / B / C: NINGUNO** — capa cliente pura (réplicas de lectura + priming + escritura
offline ya existente).

**Fase D: UN cambio aditivo** — `fn_crear_cliente_offline(p_id UUID, p_nombre, p_identificacion, …)`:
`SECURITY DEFINER` + `SET search_path = public`, filtra por `get_negocio_id()`, hace **upsert por
`(negocio_id, identificacion)`** (respeta el UNIQUE server-side, sin carrera), acepta el UUID
pre-generado en el cliente. Incluye `PERFORM public.fn_assert_no_superadmin();` al inicio y los
`GRANT`/`NOTIFY pgrst` de rigor. Es la única función SQL nueva del plan; se ejecuta en Supabase SQL
Editor cuando se implemente la Fase D (no antes).

> La Fase D no toca `fn_registrar_venta_pos` (ya acepta `cliente_id` y valida multi-tenant). Solo
> agrega la función de creación de cliente con UUID pre-generado + upsert.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Cache vacío en la calle (catálogo/clientes) porque el vendedor no entró al POS** | **Fase P (§2.9)** — priming al arranque con sesión + reconexión + apertura de turno. Es el riesgo de raíz del §0.1; sin la Fase P todo el offline de calle es frágil |
| Priming falla porque justo al abrir turno no hay red | El priming principal es al **arranque de la app** (local, WiFi), no al abrir turno. Único fallo real: teléfono que nunca tuvo red desde que se abrió la app → caso extremo, hecho visible por el sello de frescura (Fase C) |
| Versionado IndexedDB olvidado → web sin las tablas nuevas | Fase 0 lo trata como paso explícito con constante separada `IDB_VERSION` |
| Réplica de clientes desactualizada (cliente editado/creado en otro dispositivo) | Stale-while-revalidate: se refresca en cada priming (arranque/reconexión) y apertura online del POS/sección. La venta con cliente "viejo" no corrompe nada: el servidor valida el `cliente_id` al drenar; si el cliente fue eliminado, la venta cae a dead-letter con mensaje claro (flujo existente del outbox) |
| Catálogos/listas grandes | Cap 5000 clientes; el listado de ventas solo guarda la página 1 del día |
| Confusión "vendí pero no aparece en Lista" | Ya resuelto por diseño: tab Pendientes + badge del banner (existente). Fase B no lo cambia |
| **Cliente offline colisiona con uno existente (UNIQUE identificación)** | **Fase D (§6.5.2)** — upsert server-side por `(negocio_id, identificacion)` + remapeo del `clienteId` en las ventas encoladas. Obligatorio, no opcional |
| **Venta drenada antes que su cliente (FK rota)** | **Fase D** — `SyncService` drena `outbox_clientes` a COMPLETITUD antes de `outbox_ventas` |
| **Usuario cree que crear cliente offline le da factura fiscal** | **Fase D (§6.5.1)** — nota explícita en la UI: el nombre va al ticket/nota; la FACTURA sigue requiriendo red (SRI) |
| Multi-tenant | Ya resuelto: `LocalDbService` abre una DB por `negocio_id` |

---

## 9. Mapa de archivos

| Archivo | Acción | Fase |
|---|---|---|
| `core/services/sync.service.ts` | `precalentarOffline()` — orquesta la descarga del catálogo (+ clientes/CF en A) en los ganchos que YA existen (`usuarioActual$` = arranque con sesión, `getNetworkStatus` = vuelve la red). Best-effort + salto por frescura (timestamp) | **P** |
| `features/caja/services/turnos-caja.service.ts` (o `home.page.ts`) | Tras `abrirTurno()` OK: disparar `syncService.precalentarOffline()` best-effort (respaldo del priming) | **P** |
| `features/inventario/services/inventario.service.ts` | Sin cambios de lógica — `obtenerProductosCatalogoPOS()` ya escribe el cache online; la Fase P solo lo **invoca** desde el arranque | **P** |
| `core/services/local-db.service.ts` | Tablas `cache_clientes` + `cache_ventas_dia`, mapa `primaryKeys`, `IDB_VERSION = 2` (constante separada del parámetro SQLite) | 0 |
| `core/services/clientes-local.service.ts` | **Nuevo** — espejo de `CatalogoLocalService` | A |
| `features/clientes/services/clientes.service.ts` | `descargarSnapshotParaCache()` (fetch liviano completo, background) + rutas offline en `buscarClientes`/`buscarPorIdentificacion` (cache-aside) | A |
| `features/pos/pages/pos/pos.page.ts` | Disparar refresco de réplica de clientes junto al del catálogo (online, background) | A |
| `features/clientes/components/seleccionar-cliente-modal/*` | Búsqueda offline contra réplica + deshabilitar "Crear cliente" sin red (temporal — la Fase D lo revierte) + sello de frescura | A |
| `features/clientes/pages/*` (listado) | Pintar réplica offline con sello; saldos "requiere conexión" | A |
| `core/services/ventas-local.service.ts` (o método en el servicio de ventas) | Snapshot página 1 del día | B |
| `features/ventas/pages/listado/ventas-listado.page.ts` | Persistir tras fetch online + pintar snapshot offline + `hasMore=false` sin red | B |
| Sellos de frescura (SCSS/HTML de las 3 vistas) | Chip "Actualizado HH:mm" solo offline | C |
| `core/services/outbox-clientes.service.ts` | **Nuevo** — cola durable de clientes offline (espejo de `OutboxService`), estado PENDING/SYNCED/ERROR | D |
| `core/services/outbox.service.ts` | Método nuevo `remapearClienteId(idViejo, idNuevo)` — reescribe `payload_json` de las ventas encoladas. La API actual solo muta estado/error/intentos ([outbox.service.ts:123](../../src/app/core/services/outbox.service.ts#L123)) | D |
| `core/services/sync.service.ts` | Drenar `outbox_clientes` a completitud ANTES de `outbox_ventas`; upsert por identificación + remapeo de `clienteId` en ventas encoladas | D |
| `core/services/local-db.service.ts` | Tabla `outbox_clientes`; subir `IDB_VERSION` | D |
| `features/clientes/services/clientes.service.ts` | `crearClienteOffline()` — UUID local + encola + refresca `cache_clientes`. Online sigue por `fn_crear_cliente_offline` (upsert) | D |
| `features/clientes/components/seleccionar-cliente-modal/*` | Reactivar "Crear cliente" sin red (revierte A) → mini-form → encola; nota UI "sirve para el nombre en ticket, no factura fiscal" | D |
| `docs/clientes/sql/functions/fn_crear_cliente_offline.sql` | **Nueva función SQL** — UUID pre-generado + upsert `(negocio_id, identificacion)` + `fn_assert_no_superadmin`. Ejecutar en Supabase al implementar D | D (BD) |

---

## 10. Orden de implementación

| Fase | Descripción | Deployable solo | Estado |
|------|-------------|-----------------|--------|
| **P** | **Priming garantizado del cache del catálogo** (arreglo de raíz §0.1). Solo catálogo — no depende de las Fases 0/A. **Máxima prioridad: implementar primero** | Sí (arregla el bug real hoy mismo, sin tocar clientes/ventas) | ⬜ |
| **0** | LocalDbService v2 (tablas + versionado IDB) | Sí (no cambia comportamiento visible) | ⬜ |
| **A** | Clientes offline: réplica + selector POS + página clientes (+ enganchar clientes al priming de P) | Sí | ⬜ |
| **B** | Ventas del día offline | Sí | ⬜ |
| **C** | Sellos de frescura | Sí | ⬜ |
| **D** | **Crear cliente offline** (ticket/nota con nombre): `outbox_clientes` + drenado clientes→ventas + `fn_crear_cliente_offline` (upsert). Depende de A (réplica de clientes) | Sí (tras A) | ⬜ |

> Cada fase es independiente y deployable. **P es la de mayor prioridad**: arregla el
> bloqueador de raíz (§0.1) y hace que el catálogo funcione en la calle aunque el vendedor
> solo abra turno y se vaya. A completa el flujo de venta con cliente; B y C son visibilidad
> y confianza. **P puede — y debe — ir primero, antes que 0/A/B/C.** **D es la última** (la
> escritura offline más compleja) y **depende de A** — no tiene sentido crear clientes offline
> sin la réplica de lectura que ya trae la Fase A.

---

*Referencias: `PLAN-OFFLINE-POS-2026-06-08.md` (arquitectura base, outbox, §17 evaluación
de motores de sync), `docs/setup/schema.sql` (tabla `clientes`), `CatalogoLocalService`
(patrón a replicar).*
