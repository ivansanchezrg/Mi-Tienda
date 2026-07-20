# Módulo Suscripciones

Sistema de monetización SaaS de Mi Tienda. Cada negocio paga una suscripción para operar; al vencer, la app bloquea el acceso hasta que el superadmin registre el pago.

---

## Terminología importante

| Término | Qué es |
|---------|--------|
| **Suscripción / plan** | Este módulo. El negocio paga para usar la app. |
| **Membresía** | Rol del **usuario** dentro de un negocio (`usuario_negocios`). Concepto completamente distinto. |

**Nunca usar la palabra "membresía" para referirse al pago.**

---

## Tablas de BD

| Tabla | Tipo | Descripción |
|-------|------|-------------|
| `planes` | Catálogo global (sin `negocio_id`) | Catálogo de planes: **precio dual** (`precio_mensual` + `precio_anual` opcional), trial, features. |
| `metodos_pago_suscripcion` | Catálogo global | Formas de pago aceptadas (transferencia, depósito, efectivo). |
| `config_plataforma` | Singleton (id = 1, global) | Datos de cobro del titular: WhatsApp + cuentas bancarias (JSONB). |
| `suscripciones` | Por tenant (`negocio_id` **UNIQUE**) | **Estado actual** de cada negocio (una sola fila, se hace `UPDATE`). Incluye `periodo_contratado`, `purga_avisada_el`/`purga_programada_el` (ver nota abajo). |
| `suscripcion_pagos` | Por tenant (`negocio_id`) | **Historial financiero** inmutable. Una fila por pago, con `monto` real. Ligada al propietario. |

### Precio dual — mensual / anual

El **periodo lo elige el cliente al pagar**, no lo define el plan. Por eso:
- `planes.precio_mensual` (obligatorio) + `planes.precio_anual` (NULL = el plan no ofrece pago anual).
- `suscripciones.periodo_contratado` (`MENSUAL` | `ANUAL`) guarda qué eligió en cada fila → determina el vencimiento al renovar (+1 mes o +1 año) y el precio mostrado.
- La pantalla "Planes y precios" tiene un **toggle global Mensual/Anual** que cambia el precio de todas las tarjetas y resalta el ahorro anual (`precio_mensual × 12 − precio_anual`) y el equivalente mensual (`precio_anual / 12`).
- El toggle solo aparece si **algún** plan tiene `precio_anual`. El modal de registrar pago (admin) tiene su propio toggle; "Anual" se deshabilita si el plan no lo ofrece.

### Estado almacenado vs. derivado

`suscripciones.estado` solo almacena: `TRIAL` · `ACTIVA` · `SUSPENDIDA` · `CANCELADA`.

Los estados de vencimiento **no se guardan** — se derivan por **fecha de calendario en hora local (Ecuador)** en `fn_estado_suscripcion`, distinguiendo el origen (contexto comercial opuesto):

| Estado guardado | + fecha de corte pasada | Estado efectivo derivado | UI ofrece |
|---|---|---|---|
| `TRIAL`  | sí | `TRIAL_VENCIDO` | **Activar** (nunca pagó) |
| `ACTIVA` | sí | `VENCIDA`        | **Renovar** (fue cliente) |

Se evalúa por **fecha**, no por instante: si vence "el 18", el cliente opera **todo el 18 local** y se bloquea al iniciar el 19. El mismo criterio gobierna `dias_restantes`. Sin jobs, sin inconsistencias.

### Purga automática de negocios vencidos (`purga_avisada_el` / `purga_programada_el`)

Un negocio cuyo trial o suscripción vence nunca se borraba solo: quedaba bloqueado indefinidamente pero sus datos y fotos vivían para siempre en BD y Storage. Este flujo agrega un **periodo de gracia + purga diferida** (patrón estándar SaaS — Notion, Linear): nunca se borra en caliente, siempre hay aviso previo, el borrado real ocurre días después del vencimiento. Implementado 2026-06-27, auditado y corregido 2026-07-18.

**Decisiones de diseño:**
- **Facturación y purga por propietario, no por negocio.** El plan MAX cubre hasta 3 negocios del mismo `propietario_usuario_id` bajo un solo ciclo de pago — si el propietario no paga, se purgan **todos** sus negocios juntos (mismo criterio que `fn_suspender_propietario_suscripcion`). Esto incluye negocios `SUSPENDIDA` manualmente por otro motivo — la purga no hace excepción por estado de bloqueo individual (confirmado 2026-07-18).
- **Periodo de gracia: 30 días desde el vencimiento.** Aviso al día 23 (marca `purga_avisada_el`), 7 días de cuenta regresiva, purga habilitada al día 30 (`purga_programada_el`).
- **El usuario global (`usuarios`) nunca se borra automáticamente** — solo sus negocios y datos asociados. `negocios.propietario_usuario_id` es nullable (Fase 1) para que `fn_purgar_negocio` pueda ponerlo en `NULL` transitoriamente antes del `DELETE`, rompiendo el `ON DELETE RESTRICT` sin tocar `usuarios`.
- **Flujo 100% manual, sin cron ni Edge Function.** El superadmin opera desde `/admin`: detecta pendientes, avisa por WhatsApp, ejecuta "Purgar ahora" verificando con sus propios ojos que BD + Storage quedaron limpios. Automatizar esto (Edge Function + `pg_cron`/`pg_net`) queda diferido hasta que el volumen lo justifique.

**Columnas** (`suscripciones`, agregadas vía `docs/suscripcion/sql/setup/alter_suscripciones_purga.sql`):
- `purga_avisada_el` — cuándo `fn_marcar_negocios_para_purga` detectó vencimiento + gracia cumplida (≥23 días) y marcó al propietario.
- `purga_programada_el` — fecha desde la que el botón "Purgar ahora" queda habilitado en `/admin` (`purga_avisada_el` + 7 días). `fn_purgar_negocio` exige `purga_programada_el <= NOW()` antes de borrar.
- Ambas se limpian (`NULL`) si el propietario paga antes de la purga (`fn_registrar_pago_propietario`) o el superadmin la cancela manualmente (`fn_cancelar_purga_negocio`).

**Funciones SQL** (`docs/suscripcion/sql/functions/`):
| Función | Descripción |
|---------|-------------|
| `fn_marcar_negocios_para_purga()` | Detecta propietarios vencidos ≥23 días (excluye `SUSPENDIDA`/`CANCELADA` de la *detección*), marca `purga_avisada_el`/`purga_programada_el` en todos sus negocios. Sin parámetros — evalúa todo el sistema. Disparada por el botón "Detectar pendientes". |
| `fn_listar_negocios_pendientes_purga()` | Solo lectura. Devuelve cada negocio con `purga_avisada_el IS NOT NULL`, con `dias_restantes_purga` y `puede_purgar_ya` ya calculados, y `telefono_contacto` (del negocio ancla del propietario, el más antiguo por `created_at`). |
| `fn_purgar_negocio(p_negocio_id)` | Borrado real e irreversible. Exige `purga_programada_el <= NOW()`. Borra en orden manual (hijos → padres) las tablas con FK interna sin CASCADE, luego `DELETE FROM negocios` limpia el resto vía CASCADE. `suscripcion_pagos` conserva su historial con `negocio_id = NULL`. |
| `fn_cancelar_purga_negocio(p_propietario_id)` | Excepción de soporte: limpia las columnas de purga de todos los negocios del propietario sin que medie un pago real. |

**Storage:** `StorageService.deleteNegocioFolder(negocioId)` borra recursivamente `{negocioId}/` en el bucket `mi-tienda` **antes** de `fn_purgar_negocio` (si Storage falla, no se continúa con el DELETE en BD — ver `SuscripcionService.purgarNegocio`). La RLS de Storage (`docs/setup/03_storage_rls.sql`) tiene una rama de superadmin (`EXISTS ... es_superadmin = true`) en `SELECT`/`DELETE`, necesaria porque el superadmin purga desde `/admin` sin tener ese negocio activo en su JWT — sin esa rama, `list()` devuelve `[]` sin error (RLS filtra en silencio) y los archivos quedan huérfanos aunque la BD sí se purgue.

**Triggers de inmutabilidad:** `fn_purgar_negocio` activa `SET LOCAL app.purga_en_curso = 'true'` (efecto acotado a la transacción) para que `fn_proteger_operacion_caja`, `fn_bloquear_delete_movimiento` y `fn_proteger_propietario_negocio` cedan durante el borrado — ver `docs/suscripcion/sql/setup/fix_triggers_purga.sql`.

**Panel `/admin`:** integrado en el flujo existente de Negocios (`admin-negocios.page.ts`), no es una pantalla separada. Botón "Detectar pendientes" en el header; badge "Purga en X día(s)" / "Lista para purgar" por propietario marcado; 3 acciones en su menú (Avisar por WhatsApp, Purgar ahora, Cancelar purga).

### Estado actual vs. historial financiero (dos tablas)

El modelo separa **estado** de **historial** (refactor 2026-06, práctica estándar SaaS):

- **`suscripciones`** — el **estado actual** de cada negocio. `negocio_id` es **UNIQUE**: hay **una sola fila por negocio**. Se hace `UPDATE` (no `INSERT`) al pagar, suspender o reactivar. Es la fuente de verdad del estado; leerla es directo, sin `DISTINCT ON`.
- **`suscripcion_pagos`** — el **historial financiero inmutable** (libro de cobros). Cada pago registrado inserta **una fila** con su `monto` real, ligada al **propietario** (`propietario_id`) y al negocio ancla (`negocio_id`, para reportes). Nunca se modifica. Sumar ingresos es `SUM(monto)` sin trucos.

Así el estado no acumula filas y la contabilidad queda limpia (sin las viejas "filas de sincronización con monto 0").

---

## Funciones SQL

Todas en `docs/suscripcion/sql/functions/`.

| Función | Descripción |
|---------|-------------|
| `fn_estado_suscripcion(p_negocio_id)` | Deriva el estado vigente del negocio. Retorna JSON con `estado`, `bloqueada`, `dias_restantes`, `features`. |
| `fn_registrar_pago_propietario(p_propietario_id, p_monto, p_metodo_pago_id, p_plan_id, p_periodo, p_nota)` | **Punto único de pago / renovación.** **Actualiza** (`UPDATE`) el estado de **TODOS los negocios del propietario** a `ACTIVA` con el **mismo** plan, periodo y `vence_el` (la suscripción se paga por dueño: PRO = 1 negocio, MAX = N bajo un solo precio). Base de la renovación = vencimiento **más próximo** entre sus negocios (`MIN(vence_el)`, o `NOW` si ya venció) + 1 mes/año. El pago se registra **una sola vez** en `suscripcion_pagos` con el monto real (sin filas de sincronización). Solo superadmin. Espejo de `fn_suspender_propietario_suscripcion`. Cuando se integre una pasarela, su webhook llamaría a esta misma función. |
| `fn_suspender_propietario_suscripcion(p_propietario_id, p_suspender)` | Suspende/reactiva **por cobro** a un propietario: **actualiza** (`UPDATE`) a `SUSPENDIDA`/`ACTIVA` la suscripción de **todos sus negocios** en una sola sentencia (plan y `vence_el` intactos). La suscripción se paga por propietario, no por sucursal (ver §"Suspensión por propietario"). Solo superadmin. |
| `fn_listar_suscripciones_admin()` | Lista todos los negocios con su suscripción (una fila por negocio, JOIN directo). Solo superadmin. |

### `fn_estado_suscripcion` — estructura del JSON retornado

```json
{
  "tiene_suscripcion": true,
  "bloqueada": false,
  "estado": "ACTIVA",
  "plan_codigo": "PRO",
  "plan_nombre": "Plan PRO",
  "periodo": "MENSUAL",
  "precio": 9.99,
  "precio_mensual": 9.99,
  "precio_anual": 99.99,
  "vence_el": "2026-07-15T00:00:00Z",
  "dias_restantes": 30,
  "features": {
    "panel_financiero": true, "pos": true, "inventario": true,
    "ventas": true, "clientes": true, "empleados": true,
    "nomina": true, "notas": true, "acciones_rapidas": true, "configuracion": true
  }
}
```

> `periodo` = el contratado; `precio` = el que aplica a ese periodo (lo que paga). `precio_mensual`/`precio_anual` son los dos precios del plan, por si la UI muestra el toggle/ahorro.

**`bloqueada` es el único campo que el guard necesita mirar.** Encapsula las razones de bloqueo:
- `TRIAL` con fecha de corte pasada → `TRIAL_VENCIDO` (prueba terminada, nunca pagó)
- `ACTIVA` con fecha de corte pasada → `VENCIDA`
- `estado = 'SUSPENDIDA'` → suspensión manual del superadmin
- `estado = 'CANCELADA'` → cancelación

El `estado` efectivo da el **contexto comercial** para que la UI use el lenguaje y CTA correctos (activar / renovar / reactivar), todos con el mismo flujo de pago.

### Renovación desde el vencimiento

```sql
v_base        := GREATEST(v_vence_anterior, NOW());
v_nuevo_vence := v_base + INTERVAL '1 month';   -- o '1 year' si es ANUAL
```

El cliente que pagó tarde no pierde días; el que pagó con 2 meses de retraso no recibe meses retroactivos.

### Suscripción inicial al crear negocio

`fn_completar_onboarding` crea una fila `TRIAL` al nacer el **primer** negocio del propietario (paso 8b), con el plan **PRO** (`WHERE codigo = 'PRO' AND activo = TRUE`) y la duración de su `trial_dias`. PRO es el plan de entrada del producto — no es configurable por el propietario. Si PRO no existe o está desactivado, la función falla con `onboarding_error:` y hace rollback (es atómica). Para sucursales adicionales del mismo dueño, la suscripción se **hereda** (ver §"Suscripciones sincronizadas por propietario").

---

## Servicios y guardias (Frontend)

### `SuscripcionService` — `core/services/suscripcion.service.ts`

Punto único de acceso al estado de suscripción. **No usar RPC directo desde componentes.**

```typescript
private suscripcion = inject(SuscripcionService);

// Estado del negocio activo (cache RAM + snapshot en Preferences, fail-open ante error de red)
const estado = await this.suscripcion.getEstado();

// Verificar si está bloqueado (el campo bloqueada resume vencida/suspendida/cancelada)
if (estado.bloqueada) { ... }

// Feature gate (sin estado conocido → false)
if (this.suscripcion.tieneFeature('ia')) { ... }

// Config de cobro para pantalla de bloqueo
const config = await this.suscripcion.getConfigPlataforma();

// Historial de pagos del negocio activo, paginado (tab "Pagos")
const pagos = await this.suscripcion.listarPagos(page, pageSize); // → SuscripcionPago[]
```

**Estrategia de cache (stale-while-revalidate, 2026-07-06):** RAM + snapshot persistido en Preferences, patrón idéntico a `ConfigService`. El guard se ejecuta en cada navegación; sin cache serían decenas de queries por sesión.
- **RAM hit** (mismo negocio, TTL 5 min vivo) → ~0ms.
- **Preferences hit** (snapshot del mismo negocio, sin importar TTL) → ~5-10ms: se sirve **al instante** y se dispara una revalidación en background. Es lo que evita que `suscripcionGuard` bloquee la primera navegación de cada cold start con un roundtrip de red — corre en el camino más caliente del arranque (tras `authGuard`, antes de `NavigationEnd`). Ver `docs/guides/PERFORMANCE-STARTUP.md` §15.
- **Sin snapshot** (primer arranque tras login/instalación) → espera la RPC, pero con **tope fail-open de 4s** (`GUARD_TIMEOUT_MS`) para no colgar la navegación contra "red mala" (WiFi asociado pero sin respuesta — ver §21). La carga real sigue en background y puebla el cache para el próximo arranque.
- Se invalida (RAM + Preferences) al cambiar de negocio o tras registrar un pago/reactivar; se limpia en logout.

**Fail-open:** ante error de red o BD (o timeout), `getEstado()` devuelve `{ bloqueada: false }` y el guard deja entrar. El usuario no queda encerrado por un problema de conectividad. El Realtime de `suscripciones` y la revalidación en background corrigen en segundos si hubo una suspensión real mientras se servía el snapshot stale.

### Realtime — detección instantánea de suspensión (2026-06-16)

El TTL de 5 min y el chequeo solo-en-navegación son insuficientes para una acción **instantánea** del superadmin: suspender a un propietario (o registrar su pago) debía notarse en segundos, no esperar a la próxima navegación o a que expire el cache. Mismo patrón que ya usa `AuthService` para membresías (`iniciarRealtimeMembresia`):

- **Ciclo de vida atado al usuario activo, no a la navegación.** `SuscripcionService` se suscribe a `AuthService.usuarioActual$` en su constructor: cuando hay un `negocio_id` activo (y no es superadmin) abre el canal `suscripcion-negocio-{negocio_id}`; cuando no hay usuario/negocio (logout, cambio de cuenta) lo cierra. Así la protección está viva **desde el primer render**, igual que el Realtime de membresía. No depende de que el guard navegue. *(No hay ciclo de DI: el servicio ya inyecta `AuthService`.)*
  - `getEstado()` mantiene además una **red de seguridad** idempotente: si el guard corre antes de que `usuarioActual$` emita, también intenta abrir el canal. No abre duplicados (es idempotente por `negocio_id`).
- Escucha **`*`** (INSERT + UPDATE) en `suscripciones`. Modelo de estado mutable: el onboarding crea la fila (INSERT) y cada pago/suspensión/reactivación la **actualiza** (UPDATE).
- Al detectar un cambio, fuerza `getEstado(true)` (relectura real vía `fn_estado_suscripcion`, no confía en el payload crudo) y reacciona en **ambas direcciones** (el superadmin está exento de toda redirección, igual que el guard):
  - **Quedó bloqueada** (suspensión / vencimiento) → navega a `ROUTES.suscripcion.root`, salvo que ya esté ahí.
  - **Se desbloqueó** (pago / reactivación) **y venía bloqueada** y sigue varado en `/suscripcion` → navega a `ROUTES.home`. Solo redirige si **venía** bloqueado: si el usuario entró voluntariamente a "Mi Plan" (vigente) y solo cambió de plan, no se lo mueve. Para distinguirlo, captura `cache.bloqueada` **antes** de forzar la relectura.
- El canal se cierra en `registerBeforeCleanup` (logout / cambio de cuenta), igual que el resto de canales del proyecto.
- Requiere que `suscripciones` esté publicada en `supabase_realtime` con `REPLICA IDENTITY FULL`. **FULL es obligatorio** ahora que se escucha UPDATE: sin él, el payload del UPDATE no trae la fila completa y el handler no podría leer el nuevo `estado`. Vive en **dos lugares** (idempotentes): el bloque Realtime de `docs/setup/schema.sql` (para que sobreviva un reset completo — `DROP TABLE CASCADE` borra la publicación) y el script suelto `docs/suscripcion/sql/setup/realtime_suscripciones.sql` (para aplicarlo a una BD existente). La RLS `suscripciones_select` ya permite que el negocio lea su propia fila, así que Realtime entrega el evento sin cambios adicionales de RLS.

> **Por qué `*` (INSERT + UPDATE):** desde el refactor 2026-06 hay **una fila por negocio** (`negocio_id` UNIQUE). El onboarding la crea (INSERT) y pagar/suspender/reactivar la modifican (UPDATE). Escuchar solo INSERT perdería los cambios de estado posteriores, que son justo los que importan.

### `suscripcionGuard` — `core/guards/suscripcion.guard.ts`

Guard independiente (responsabilidad única: ¿el negocio pagó?). Se encadena **después** de `authGuard`:

```typescript
// app.routes.ts
{ path: 'layout', canActivate: [authGuard, suscripcionGuard], ... }
```

**Comportamiento:**
- Superadmin → deja pasar siempre (exento).
- Sin negocio activo → deja pasar (el authGuard ya manejó eso).
- `bloqueada === true` → redirige a `ROUTES.suscripcion.root`.
- Error de red → **fail-open** (deja pasar).

---

## Estructura de archivos

```
src/app/
├── core/
│   ├── services/suscripcion.service.ts       ← estado, cache, métodos admin
│   ├── guards/suscripcion.guard.ts           ← bloqueo por vencimiento
│   └── components/suscripcion-banner/        ← aviso preventivo "vence en X días"
│       ├── suscripcion-banner.component.ts
│       └── suscripcion-banner.component.scss
└── features/
    ├── suscripcion/
    │   ├── models/suscripcion.model.ts       ← Plan, MetodoPago, EstadoSuscripcionResult, SuscripcionPago, etc.
    │   ├── components/
    │   │   ├── suscripcion-tabs/             ← tabs internas "Mi Plan" / "Pagos" (router-driven, patrón chrome-tabs)
    │   │   ├── coordinar-pago-modal/         ← modal de método de pago (WhatsApp)
    │   │   └── detalle-pago-modal/           ← detalle de un pago del historial (solo lectura)
    │   ├── pages/
    │   │   ├── suscripcion/                  ← pantalla dual (bloqueo / Mi Plan), con tabs en modo informativo
    │   │   └── historial-pagos/               ← listado paginado de suscripcion_pagos (tab "Pagos")
    │   └── suscripcion.routes.ts             ← '' (Mi Plan) + 'historial' (Pagos)
    └── admin/
        ├── components/
        │   ├── registrar-pago-modal/         ← modal superadmin: registrar pago
        │   ├── plan-modal/                   ← modal CRUD de planes
        │   └── cuenta-bancaria-modal/        ← modal CRUD de cuentas bancarias
        └── pages/
            ├── suscripciones/                ← tab "Suscripciones" del panel admin
            ├── planes/                       ← tab "Planes" del panel admin
            └── configuracion/               ← tab "Cobro" del panel admin

docs/suscripcion/
└── sql/functions/
    ├── fn_estado_suscripcion.sql
    ├── fn_registrar_pago_propietario.sql      ← pago / renovación por dueño (renueva todos sus negocios)
    ├── fn_suspender_propietario_suscripcion.sql
    └── fn_listar_suscripciones_admin.sql
```

---

## Pantalla de bloqueo (`SuscripcionPage`)

Ruta: `ROUTES.suscripcion.root` (`/suscripcion`). `ROUTES.suscripcion` es un objeto `{ root, historial }` (antes era un string único — cambió al agregar el historial de pagos). Vive **fuera** del layout con tabs para evitar que el guard la proteja a sí misma (loop de redirección).

La página tiene **dos modos** según el estado de la suscripción:

| Modo | Condición | Qué muestra | Salida del header |
|------|-----------|-------------|-------------------|
| **Bloqueo** | `bloqueada === true` | Título/subtítulo/CTA **según el origen** (trial vencido / vencida / suspendida) + pasos de pago (cuentas + WhatsApp) | Ninguna (no debe escapar; solo "Cerrar sesión" en el cuerpo) |
| **Planes y precios** | `bloqueada === false` | Tabs internas "Mi Plan" / "Pagos" + lista de planes (el actual + mejoras disponibles) — **catálogo de venta (upsell)** | Flecha "volver" → `ROUTES.home` |

### Tabs internas — "Mi Plan" / "Pagos" (solo modo informativo)

`SuscripcionTabsComponent` (`components/suscripcion-tabs/`) — mismo patrón router-driven que `VentasTabsComponent` (clases globales `chrome-tabs`/`chrome-tab`, detecta la ruta activa con `NavigationEnd`, sin `@Input()`). Cada página incluye el componente en su propio `ion-header`:

| Tab | Ruta | Página |
|-----|------|--------|
| Mi Plan | `ROUTES.suscripcion.root` (`/suscripcion`) | `SuscripcionPage` (modo informativo) |
| Pagos | `ROUTES.suscripcion.historial` (`/suscripcion/historial`) | `HistorialPagosPage` |

Las tabs **no aparecen en modo bloqueo** — no hay nada que navegar mientras la cuenta está bloqueada, la pantalla "Suscríbete" es de salida única hacia el pago.

### Historial de pagos (`HistorialPagosPage`)

Lista paginada (`PaginatedListPage<SuscripcionPago>`, infinite scroll) de la tabla `suscripcion_pagos` — historial financiero que **ya existía en BD** (escrita por `fn_registrar_pago_propietario`) pero nunca se leía desde el frontend hasta esta feature.

- **Lectura:** `SuscripcionService.listarPagos(page, pageSize)` — query directa paginada (`.range()`) con joins a `planes` y `metodos_pago_suscripcion`. No hay función SQL nueva: el RLS de SELECT en `suscripcion_pagos` ya filtra por `negocio_id = get_negocio_id()` (o superadmin), y es un CRUD de 1 tabla con joins simples.
- **Listado:** fecha, plan + periodo, monto, badge "Pagado" (siempre — la fila solo existe si el pago se registró), botón "Ver".
- **"Ver" abre `DetallePagoModalComponent`** (`bottom-sheet-modal`, sin footer — la ✕ del header cierra): monto protagonista + ficha con fecha de pago, método de pago, vigencia resultante (`vence_el`) y nota/referencia si existe.
- **No hay PDF ni comprobante adjunto** — el modelo de cobro es 100% manual (WhatsApp + superadmin registra), `nota` es texto libre con la referencia que el superadmin anotó al cobrar.
- Empty state si el negocio aún no tiene pagos registrados (ej. está en TRIAL).

**Encabezado contextual del modo bloqueo** (getters en `SuscripcionPage`, derivados de `estado.estado`):

| `estado` efectivo | Título | CTA / acción del modal |
|---|---|---|
| `TRIAL_VENCIDO` | "Tu prueba gratuita terminó" (ícono primary) | "Activar mi plan" → `activar` |
| `VENCIDA` | "Tu suscripción venció" | "Renovar mi plan" → `renovar` |
| `SUSPENDIDA` / `CANCELADA` | "Suscripción suspendida" | "Contactar por WhatsApp" → `reactivar` |

Los **pasos de pago son idénticos** para los tres (cuentas bancarias + WhatsApp con comprobante). Solo cambian título, subtítulo, texto del paso 2 y label del botón. Los textos son **contextuales en código** (no editables desde BD — son parte del flujo UX, no copy de marketing).

> **Navegación del header (Mi Plan):** la pantalla vive fuera del layout, así que **no tiene sidebar**. El header muestra una flecha de retroceso (`navCtrl.back()` — pop del stack de Ionic para que la animación de retroceso sea inmediata y el guard de suscripción no se re-ejecute al volver), no el menú hamburguesa — un `ion-menu-button` aquí quedaría huérfano (no hay `ion-menu` que abrir). En modo bloqueo no hay flecha, para que el usuario no pueda saltarse el bloqueo.

**Jerarquía de acciones en modo bloqueo:**
1. Botón WhatsApp (canal principal en Ecuador) — abre chat con mensaje pre-escrito.
2. Cuentas bancarias (secundario) — banco, tipo, número, titular, cédula (estándar Ecuador para confirmar transferencias).

Los datos de contacto vienen de `config_plataforma` (WhatsApp + cuentas bancarias, editables desde el panel admin sin redeploy). Los **textos** del bloqueo no viven aquí — son contextuales por estado, en el frontend.

### Modo "Planes y precios" — punto de venta (upsell)

No es solo un recibo: es una superficie de venta. Es **una sola lista** de tarjetas (`planesOrdenados`), sin resúmenes duplicados ni título/subtítulo de sección (el header "Planes y precios" ya da el contexto) — el plan actual es una tarjeta más, no se repite arriba:

- **Toggle global Mensual/Anual** anclado en el `ion-header` (segunda `ion-toolbar`) — permanece visible al hacer scroll. Solo aparece si algún plan tiene `precio_anual`. Cambia el precio de **todas** las tarjetas a la vez; en anual muestra el equivalente mensual (`precio_anual/12`) y el ahorro (`precio_mensual×12 − precio_anual`).
- **Orden:** el plan vigente en la vista actual **primero**, luego los superiores de menor a mayor precio. El ojo lee "lo que tengo → a lo que puedo subir"; el plan tope/recomendado cierra la pantalla.
- **Plan vigente en la vista** → badge "Tu plan actual · Mensual|Anual" + su estado (TRIAL/ACTIVA), vencimiento y días restantes. Atenuado (borde punteado), **sin CTA**. La vigencia depende del método `esPlanVigente()` (ver abajo).
- **Plan recomendado** (el de mayor `precio_mensual` que no es el vigente en la vista) → acento de color + flag "Recomendado". Si el usuario tiene Mensual y el toggle está en Anual, su propio plan aparece como "Recomendado" (oportunidad de upgrade de periodo).
- Cada plan lista las **features nuevas** respecto al plan inferior, bajo "Todo lo del {plan inferior}, más:" (vía `featuresNuevasDe` + `FEATURE_LABELS`). El plan más barato lista todas sus features sin encabezado.
- **Planes sin precio anual** → cuando el toggle está en "Anual", muestran un badge "Solo mensual" en lugar del precio anual. El precio mostrado sigue siendo mensual.
- **Bloques visuales de marketing en el plan MAX** (código `'MAX'`): tres bloques extra debajo del separador de features: "Multisucursal" (gestión de múltiples negocios), "Multiplataforma" (Android, web y tablet), "IA — próximamente" (análisis y predicciones). Son bloques informativos, no features verificables todavía.
- **Layout responsivo:** móvil = tarjetas apiladas (1 columna); tablet/desktop (≥600px) = grid de hasta 3 columnas.
- Botón **"Quiero este plan"** en los que no son el vigente. Si el plan es el actual pero en diferente periodo (e.g. tengo Mensual y veo Anual), el CTA dice **"Cambiar a anual"**.

Catálogo: `listarPlanes(true)` (solo activos — lo que se ofrece hoy).

**El cliente no paga aquí** (el cobro es manual — ver §8.1 del plan). "Quiero este plan" / "Cambiar a anual" abre WhatsApp con el lead pre-armado usando `config_plataforma.whatsapp_cobro`. El mensaje incluye nombre del negocio, `negocio_slug` (identificador URL-safe único) y email del usuario para que el superadmin ubique el negocio sin ambigüedad. El superadmin confirma el pago y registra el cambio de plan desde `/admin`. Cuando se integre una pasarela, ese mismo botón se conectará al checkout sin rehacer la pantalla.

> **Por qué el catálogo aquí y no solo en el admin:** cada visita a "Mi Plan" es una oportunidad de upsell. Mostrar los planes superiores convierte una pantalla pasiva en un canal de venta, reusando la infraestructura existente (catálogo + WhatsApp). Es el patrón de Notion/Linear/Spotify: tu plan visible pero discreto, los superiores presentados como invitación a subir.

### `esPlanVigente()` — lógica de "plan actual" en la UI

El método del componente determina si una tarjeta debe mostrarse como "plan vigente" (con badge de estado, sin CTA). La regla es: el usuario tiene este plan **Y** el periodo que está viendo en el toggle coincide con el que contrató.

```typescript
esPlanVigente(plan: Plan): boolean {
  if (!this.esPlanActual(plan)) return false;
  const periodoContratado = this.estado?.periodo ?? 'MENSUAL';
  // Si el toggle pide anual pero el plan no lo ofrece → precio es mensual → coincide
  if (this.periodoVista === 'ANUAL' && plan.precio_anual == null) return true;
  return this.periodoVista === periodoContratado;
}
```

Casos:
- Toggle=MENSUAL, contratado=MENSUAL → `esPlanVigente = true` (estado visible, sin CTA).
- Toggle=ANUAL, contratado=MENSUAL → `esPlanVigente = false` → la tarjeta del plan actual aparece como opción de upsell (CTA "Cambiar a anual"), y se convierte en la "recomendada".
- Toggle=ANUAL, plan sin precio anual → `esPlanVigente = true` (muestra badge "Solo mensual" + estado, sin CTA).

### `negocio_slug` en el JWT

`fn_set_negocio_activo` escribe `negocio_slug` en `app_metadata` del JWT junto con `negocio_id`, `rol` y `es_superadmin`. El frontend lo lee de `AuthService.usuarioActualValue?.negocio_slug` (tipo `string` en `UsuarioActual`).

**Por qué slug y no id:** el `negocio_id` (UUID) es difícil de leer en un mensaje de WhatsApp. El slug (`tienda-ivan`) es legible, único (`UNIQUE` en `negocios`) y no es un secreto de seguridad — solo identifica al negocio. El superadmin puede buscarlo en el panel admin.

**Uso actual:** mensajes de WhatsApp armados en `abrirModalPago()` (lo disparan `activarPlan`, `renovarPlan`, `solicitarPlan` y `contactarWhatsApp`). El usuario elige método de pago en el `CoordinarPagoModalComponent` antes de abrir el chat:
```
Hola, quiero activar Plan PRO ($9.99/mes) para mi negocio "Tienda Ejemplo".
ID negocio: tienda-ejemplo
Cuenta: admin@email.com
Método de pago: Transferencia bancaria
Referencia: 00234567
```
> No se incluye una nota "sube la foto del comprobante" en el mensaje: el modal ya instruyó al usuario a enviarla, y repetirla dentro del propio chat sería redundante. Para **efectivo** sí se añade una nota ("Nuestro equipo coordinará la visita…") porque ahí no hay comprobante que adjuntar.

---

## Banner de aviso preventivo (`SuscripcionBannerComponent`)

Se muestra cuando `dias_restantes <= 7` y la suscripción **no está bloqueada** (aviso preventivo, no bloqueo). Condiciones adicionales:
- Usuario con `negocio_id` activo (no visible en login/onboarding).
- No superadmin.
- Con conexión (sin red no tiene sentido pedir renovar — y el banner offline ya ocupa la franja).

Tocar el banner lleva a `ROUTES.suscripcion.root` (modo "Mi Plan").

**Convención de colores de banners (no reusar entre tipos):**

| Color | Evento |
|-------|--------|
| `warning` (ámbar) | Sin conexión — exclusivo del offline-banner |
| `primary` (azul) | Vence en X días (7 > dias_restantes > 1) |
| `danger` (rojo) | Vence hoy o mañana (`dias_restantes <= 1`) |

---

## Panel del superadmin (`/admin`)

El panel admin tiene **3 tabs**. La gestión de suscripciones NO tiene tab propia —
vive dentro del menú de cada negocio en la tab **Negocios** (la suscripción es de un
negocio concreto, su acción natural está junto al negocio).

| Tab | Ruta | Qué hace |
|-----|------|----------|
| Negocios | `/admin` | Lista de negocios por propietario + estado de suscripción (badge por negocio). Pago y suspensión viven en el menú del propietario. |
| Planes | `/admin/planes` | CRUD del catálogo de planes (incluye `max_negocios`) |
| Cobro | `/admin/configuracion` | WhatsApp de cobro + cuentas bancarias |

### Dos niveles de menú en la tab Negocios

Tanto el **pago** como la **suspensión** son acciones del **propietario** (la suscripción se paga por dueño, no por sucursal) → ambas viven en el menú del propietario, no en el del negocio.

- **Menú del negocio** (⋮ en cada fila): Ingresar · Módulos. Cada fila muestra un badge con el estado de suscripción (Activa/Prueba/Vencida/Suspendida).
- **Menú del propietario** (⋮ en el header del grupo): **Registrar pago** + **Suspender/Reactivar negocio(s)** — ambas acciones globales que afectan **todos** sus negocios a la vez. Los textos hablan de "negocio(s)" y se adaptan a singular/plural según cuántos tenga. Iconos: `card-outline` (pago), `ban-outline` (suspender), `checkmark-circle-outline` (reactivar). Ver §"Suspensión por propietario".

### Registrar un pago (flujo del superadmin)

1. Cliente confirma que transfirió/depositó.
2. Superadmin abre tab Negocios → menú ⋮ del **propietario** → "Registrar pago".
3. `RegistrarPagoModalComponent`: muestra el alcance ("Renueva los N negocios de {dueño}"), selecciona plan, **periodo (toggle Mensual/Anual)**, método y monto (prellenado según plan + periodo), referencia opcional. "Anual" se deshabilita si el plan no ofrece pago anual.
4. `fn_registrar_pago_propietario` renueva **todos** los negocios del dueño con el mismo plan, periodo y `vence_el` (base = vencimiento más próximo entre ellos, o `NOW`; +1 mes/año). El monto se registra una sola vez.
5. Todos sus negocios quedan `ACTIVA` con el mismo vencimiento → al próximo ingreso el guard los deja pasar; en tiempo real (Realtime) salen de la pantalla de cobro al instante.

**No hay intervención manual posterior.** El bloqueo/desbloqueo es automático por fecha.

### Suscripciones sincronizadas por propietario (MAX)

El plan MAX cubre **N negocios bajo un solo precio** → conceptualmente es **una** suscripción del dueño. Para que sus negocios se venzan, suspendan y renueven **juntos**, sus filas de `suscripciones` comparten el mismo `vence_el`. Esto se garantiza en dos puntos:

- **Al crear un negocio** (`fn_completar_onboarding`): si el propietario YA tiene una suscripción vigente (creando su 2º/3er negocio MAX), el negocio nuevo **hereda** plan + estado + periodo + `vence_el` de esa suscripción, en vez de arrancar su propio trial. Solo el **primer** negocio del dueño nace en trial (plan PRO).
- **Al pagar** (`fn_registrar_pago_propietario`): el pago aplica el mismo `vence_el` a todos. El `MIN(vence_el)` como base es la red de seguridad para datos viejos desfasados (de antes de esta regla).

### Suspensión por propietario

La suscripción se paga **por propietario, no por sucursal** (PRO = 1 negocio, MAX = 3; una sola suscripción cubre todas). Por eso suspender es una acción del **propietario**, no de un negocio puntual:

- **Suspender propietario** → `fn_suspender_propietario_suscripcion` marca `SUSPENDIDA` la suscripción de **todos** sus negocios. Cada sucursal muestra la **pantalla de cobro** (WhatsApp + cuentas), no un muro seco.
- **Reactivar propietario** → revierte a `ACTIVA` conservando el `vence_el` de cada negocio.
- En la UI, un propietario se ve "suspendido" (badge + estilo) cuando **todos** sus negocios están `SUSPENDIDA`.

> **Histórico:** antes existían `fn_suspender_suscripcion` (1 negocio puntual) y `fn_suspender_usuario` (`usuarios.activo = false`, muro seco sin canal de pago). Ambas se eliminaron el 2026-06-16 al unificar la suspensión a nivel de propietario por cobro. La columna `usuarios.activo` y toda su infraestructura (Realtime, `/auth/pending?motivo=usuario`) se eliminaron por completo el mismo día — ver `docs/setup/migrations/004_eliminar_usuarios_activo.sql`.

### Métodos de gestión del servicio (solo superadmin)

```typescript
// Tab Negocios (la página carga negocios + suscripciones en paralelo)
await this.suscripcion.listarSuscripcionesAdmin();                  // → SuscripcionAdmin[]
await this.suscripcion.registrarPagoPropietario({ propietarioId, monto, metodoPagoId, planId, periodo, nota }); // renueva TODOS sus negocios
await this.suscripcion.suspenderPropietario(propietarioId, true);  // suspender (todos sus negocios)
await this.suscripcion.suspenderPropietario(propietarioId, false); // reactivar

// Tab Planes
await this.suscripcion.listarPlanes();                             // → Plan[]
await this.suscripcion.guardarPlan(plan);                          // crear o actualizar

// Tab Cobro
await this.suscripcion.getConfigPlataformaAdmin();                 // → ConfigPlataforma
await this.suscripcion.guardarConfigPlataforma(config);
```

### Límite de negocios por plan (`max_negocios`)

`planes.max_negocios` define cuántos negocios puede tener un propietario (PRO = 1, MAX = 3; `NULL` = ilimitado). El guardián definitivo es `fn_completar_onboarding`: antes de crear un negocio cuenta **todos** los del propietario y, si alcanzó el tope de su plan vigente, lanza `RAISE EXCEPTION 'limite_negocios: ...'`. El límite es **absoluto** — aplica también al superadmin creando para un dueño. El frontend (`OnboardingService.completar`) extrae el texto tras `limite_negocios:` y lo muestra como toast claro.

**Validación preventiva en el sidebar:** `SelectorNegocioModalComponent` también valida antes de navegar al wizard de creación, consultando `SuscripcionService.getEstado()` (cacheado) y comparando `negocios.length` contra `LIMITE_NEGOCIOS[plan_codigo]` (`{ PRO: 1, MAX: 3 }`). Si el plan no permite sucursales (PRO) o ya alcanzó el tope (MAX con 3 negocios), muestra un toast informativo y no abre el wizard — evitando que el usuario complete todos los pasos para recibir el error de BD al final. La BD sigue siendo el guardián definitivo; el frontend es una validación de UX, no de seguridad.

---

## Modelos TypeScript

| Interfaz / Tipo | Descripción |
|-----------------|-------------|
| `EstadoSuscripcionResult` | Resultado de `fn_estado_suscripcion`. Campo clave: `bloqueada`. |
| `EstadoSuscripcion` | `'TRIAL' \| 'ACTIVA' \| 'TRIAL_VENCIDO' \| 'VENCIDA' \| 'SUSPENDIDA' \| 'CANCELADA'` |
| `Plan` | Fila de `planes` (catálogo global). |
| `MetodoPago` | Fila de `metodos_pago_suscripcion` (catálogo global). |
| `CuentaBancaria` | Objeto dentro del JSONB `config_plataforma.cuentas_bancarias`. |
| `ConfigPlataforma` | Datos de cobro globales (WhatsApp + cuentas bancarias). |
| `SuscripcionAdmin` | Fila del listado del panel admin (`fn_listar_suscripciones_admin`). |
| `SuscripcionPago` | Fila de `suscripcion_pagos` con joins embebidos (`plan_nombre`, `metodo_pago_nombre`) — historial de pagos. |
| `PlanFeatures` | `Record<string, boolean>` — mapa de features del plan. |

---

## RLS

| Tabla | Lectura | Escritura |
|-------|---------|-----------|
| `planes` | Todos los autenticados | Solo superadmin (RLS `planes_admin`) |
| `metodos_pago_suscripcion` | Todos los autenticados | Solo superadmin |
| `config_plataforma` | Todos los autenticados (cliente bloqueado necesita ver las cuentas para pagar) | Solo superadmin |
| `suscripciones` | El negocio ve la suya; superadmin ve todas (verificación via tabla `usuarios`, no JWT) | Bloqueada directamente (RESTRICTIVE `suscripciones_no_write`); solo via funciones SQL |
| `suscripcion_pagos` | El negocio ve sus pagos; superadmin ve todos (via tabla `usuarios`) | Bloqueada directamente (RESTRICTIVE `suscripcion_pagos_no_write`); solo via `fn_registrar_pago_propietario` |

**Por qué `suscripciones` usa tabla `usuarios` y no `get_es_superadmin()`:** en `/admin` el JWT del superadmin puede no tener el claim actualizado. Patrón documentado en CLAUDE.md — mismo que `negocios_select`.

---

## Planes actuales (2026-06-15)

La plataforma tiene dos planes activos:

| Código | Nombre | Precio mensual | Precio anual | Trial |
|--------|--------|---------------|--------------|-------|
| `PRO`  | Plan PRO | — (definido en BD) | — | 15 días |
| `MAX`  | Plan MAX — "Gestión inteligente, sin límites" | $19.99/mes | $179.99/año | — |

> Los precios exactos del plan PRO se gestionan desde el panel admin (tabla `planes`) sin redeploy.

**Features del plan PRO** (actualizar en Supabase):
```sql
UPDATE planes SET features = '{
  "panel_financiero":true, "pos":true, "inventario":true,
  "ventas":true, "clientes":true, "empleados":true,
  "nomina":true, "notas":true, "acciones_rapidas":true, "configuracion":true
}'::jsonb WHERE codigo = 'PRO';
```

**Features del plan MAX** (incluye todo lo de PRO + `ia`):
```sql
UPDATE planes SET features = '{
  "panel_financiero":true, "pos":true, "inventario":true,
  "ventas":true, "clientes":true, "empleados":true,
  "nomina":true, "notas":true, "acciones_rapidas":true, "configuracion":true, "ia":true
}'::jsonb WHERE codigo = 'MAX';
```

### `FEATURE_LABELS` — etiquetas legibles en la UI

El componente `SuscripcionPage` tiene un mapa `FEATURE_LABELS` que convierte cada clave JSON de `features` a una etiqueta legible para mostrar en las tarjetas de planes:

| Clave | Etiqueta mostrada |
|-------|-------------------|
| `panel_financiero` | Panel financiero en tiempo real |
| `pos` | Punto de venta con escáner de productos |
| `inventario` | Inventario con control de stock y kardex |
| `ventas` | Historial de ventas y anulaciones |
| `clientes` | Clientes, créditos y fiados |
| `empleados` | Gestión de empleados y roles |
| `nomina` | Nómina, adelantos y cuenta corriente de empleados |
| `notas` | Notas compartidas entre el equipo |
| `acciones_rapidas` | Acciones rápidas (precio, margen de ganancia) |
| `configuracion` | Configuración completa del negocio |
| `ia` | Inteligencia artificial |

---

## Diferenciadores del plan MAX — roadmap de bloqueo técnico

**Planes actuales:** Plan PRO (acceso completo al sistema base — POS, inventario, clientes, caja; solo web, 1 negocio) y Plan MAX (todo lo del PRO, más Multisucursal, Multiplataforma y próximamente IA).

Los tres diferenciadores del MAX se muestran hoy como bloques visuales en la tarjeta de planes (`susc-plan__extra-bloque`) — son **marketing**, sin bloqueo técnico real todavía, salvo Multisucursal que ya está implementado.

### 1. Multiplataforma — pendiente

```sql
UPDATE planes SET features = features || '{"movil": true}' WHERE codigo = 'MAX';
```
```typescript
// En suscripcionGuard, tras verificar estado:
if (Capacitor.isNativePlatform() && !suscripcionService.tieneFeature('movil')) {
  router.navigate([ROUTES.suscripcion.root]);
  return false;
}
```
Mensaje en pantalla de suscripción: "Tu plan Pro solo está disponible en web. Actualiza al Max para usar la app en celular y tablet."

### 2. Multisucursal — ✅ implementado (2026-06-16)

```sql
-- migrations/003_planes_max_negocios.sql
ALTER TABLE planes ADD COLUMN IF NOT EXISTS max_negocios INT; -- NULL = ilimitado
UPDATE planes SET max_negocios = 1 WHERE codigo = 'PRO';
UPDATE planes SET max_negocios = 3 WHERE codigo = 'MAX';
```

`fn_completar_onboarding` (paso de validación) cuenta todos los negocios del propietario y los compara con `max_negocios` del plan vigente — si alcanzó el tope, lanza `RAISE EXCEPTION 'limite_negocios: ...'`. Ver sección "Límite de negocios por plan" arriba para el detalle completo (frontend, absoluto también para superadmin, sin bloqueo preventivo del botón).

**Beneficio MAX concreto ya construido sobre esto:** el dashboard "Resumen General" multi-negocio (módulo `grupo`) — ver [`docs/grupo/GRUPO-README.md`](../grupo/GRUPO-README.md).

### 3. Inteligencia artificial — pendiente

Feature key `ia: true` ya está en el JSON de features del MAX (ver "Planes actuales" arriba). Cuando el módulo de IA esté construido, `tieneFeature('ia')` ya funcionará sin cambios de esquema.

### Por qué se difirió

Solo hay clientes de prueba — bloquear hoy generaría fricción sin beneficio comercial. La señal visual es suficiente para el pitch de venta. Los cambios de esquema (`max_negocios`) son simples y no bloquean el desarrollo actual.

---

## Pendientes

- **Fase 7 (feature gates):** `tieneFeature()` ya existe en `SuscripcionService`. Pendiente: agregar `@if` en sidebar/templates cuando haya planes con features distintas. Ver "Diferenciadores del plan MAX" arriba para el roadmap de Multiplataforma e IA (Multisucursal ya implementado). Referencia en backlog: `docs/PENDIENTES.md` → "Bloqueo técnico por dispositivo y multisucursal según plan".
- **CRUD de métodos de pago desde UI:** hoy se gestiona por SQL/seed. El selector en `RegistrarPagoModalComponent` ya los consume.
- **Cobro automático con tarjeta (Payphone/Kushki):** arquitectura preparada. `fn_registrar_pago_propietario` es el punto único de renovación — el webhook de la pasarela lo llamaría. Evaluable cuando el cobro manual sea tedioso con múltiples clientes.
