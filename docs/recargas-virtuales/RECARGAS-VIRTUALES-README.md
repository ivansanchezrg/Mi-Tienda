# Recargas Virtuales

Feature independiente para la gestión de saldo virtual de CELULAR y BUS. Permite registrar recargas del proveedor, pagar deudas, comprar saldo Bus y liquidar ganancias.

**Punto de entrada:** Sidebar → Recargas Virtuales → `/caja/recargas-virtuales`

---

## Modulos opt-in por negocio

Desde 2026-05-01, **CELULAR y BUS son módulos opcionales independientes**. Un negocio recién creado tiene ambos desactivados — no aparecen ni en el dashboard, ni en el sidebar, ni en parámetros.

| Flag (en `configuraciones`) | Quién lo activa | Efecto al activar |
|----------------------------|-----------------|-------------------|
| `recargas_celular_habilitada` | Solo superadmin (Parámetros → Módulos) | Crea CAJA_CELULAR. Categoría `PAGO-PROV-CEL` ya existe en `categorias_sistema` (global). |
| `recargas_bus_habilitada`     | Solo superadmin (Parámetros → Módulos) | Crea CAJA_BUS. Categoría `COMPRA-BUS` ya existe en `categorias_sistema` (global). |

Función SQL: `fn_configurar_modulos(p_celular BOOLEAN, p_bus BOOLEAN, p_varios BOOLEAN DEFAULT FALSE)` en `docs/onboarding/sql/functions/` (desde dentro del negocio) y `fn_configurar_modulos_admin` en `docs/admin/sql/functions/` (desde `/admin`).

**Comportamiento condicional en la UI** (la página detecta los flags via `ConfigService.get()` y se adapta):

| Estado | Sidebar | Página Recargas Virtuales |
|--------|---------|---------------------------|
| Ambos OFF | Sección "Recargas" oculta | Página inaccesible vía menú |
| Solo CELULAR | Sección visible | Sin tabs, contenido CELULAR directo |
| Solo BUS | Sección visible | Sin tabs, contenido BUS directo |
| Ambos ON | Sección visible | Tabs Celular/Bus (`chrome-tabs`) |

> La página saltea queries de módulos inactivos (`Promise.resolve(0)` o `Promise.resolve([])` en lugar de llamar al servicio) para evitar requests innecesarios a Supabase — ver `cargarDatos()` en `recargas-virtuales.page.ts`.

---

## ¿Qué es?

La tienda vende recargas de celular y pasajes de bus usando **saldo virtual** de dos proveedores distintos. Cada servicio tiene un modelo de negocio diferente:

| | CELULAR | BUS |
|---|---|---|
| **Cómo funciona** | El proveedor carga saldo virtual a la cuenta. La tienda lo usa para vender recargas. Después le paga al proveedor. | La tienda deposita plata en la cuenta del proveedor y recibe saldo virtual equivalente. |
| **Modelo** | Crédito — primero se usa, después se paga | Compra directa — se deposita primero |
| **Flujo de caja** | Sin movimiento inmediato al registrar. EGRESO al pagar al proveedor via `fn_pagar_proveedor_celular` | EGRESO inmediato de CAJA_BUS al registrar la compra |
| **Estado en BD** | `pagado_proveedor=false` (deuda) → `pagado_proveedor=true` via `fn_pagar_proveedor_celular` → `ganancia_liquidada=true` via `fn_liquidar_ganancias` | `pagado_proveedor=true` desde el registro (no tiene etapa de pago a proveedor) → `ganancia_liquidada=true` via `fn_liquidar_ganancias` |
| **Ganancia** | 5% — `monto_virtual * 0.05` (calculada y guardada al registrar) | % configurable — `ROUND(monto * comision%, 2)` (calculada y guardada al registrar) |
| **Caja involucrada** | CAJA_CELULAR | CAJA_BUS |

> **Importante (fix 2026-06-22):** antes, `fn_registrar_compra_saldo_bus` insertaba BUS con `pagado_proveedor=false` (modelo viejo, con una etapa de "deuda pendiente de cobro" que ya no existe). Esto dejaba las filas BUS permanentemente fuera del filtro de `fn_liquidar_ganancias` (que exige `pagado_proveedor=true` desde su unificación v2.0) — ninguna ganancia BUS podía liquidarse nunca, aunque la UI mostrara un monto pendiente > 0. Corregido en `fn_registrar_compra_saldo_bus` v4.1: BUS ahora nace directo en `pagado_proveedor=true`.

---

## Página

### Recargas Virtuales (`pages/recargas-virtuales/`)

Única página del feature. Dos tabs (Celular/Bus) si ambos módulos están activos; si solo uno está activo, muestra su contenido directo sin tabs.

| Tab | Muestra | Acciones |
| --- | --- | --- |
| CELULAR | Saldo virtual, saldo de Caja Celular, card "Recarga de proveedor", card "Pagar al proveedor" (solo si hay deudas), card "Movimientos" (con badge de ganancia por liquidar) | Registrar recarga, Pagar al proveedor, Ver movimientos (liquidar desde ahí) |
| BUS | Saldo virtual, saldo de Caja Bus, hint "¿Cómo funciona?" (solo onboarding, sin movimientos aún), card "Recargar saldo máquina", card "Movimientos" (con badge de ganancia por liquidar) | Comprar saldo, Ver movimientos (liquidar desde ahí) |

> **No hay liquidación desde la página principal.** Liquidar ganancia es una acción del `HistorialModalComponent` (ver abajo) — la página solo enlaza a "Movimientos", que muestra el badge de cuánto hay pendiente.

**Ruta:** `/caja/recargas-virtuales`

---

## Componentes Modales

### Registrar Recarga Modal (`components/registrar-recarga-modal/`)

Modal compartido para dos flujos según el `tipo` recibido:

- **CELULAR:** Registra una carga del proveedor → crea deuda pendiente (`pagado_proveedor=false`), vía `fn_registrar_recarga_proveedor_celular`.
- **BUS:** Registra una compra de saldo → EGRESO inmediato de CAJA_BUS, `pagado_proveedor=true` desde el INSERT (ganancia disponible de inmediato para liquidar), vía `fn_registrar_compra_saldo_bus`. Soporta modo básico y modo con mini cierre (ventas del día calculadas con `saldo_virtual_maquina`).

### Pagar Proveedor Modal (`components/pagar-proveedor-modal/`)

Solo CELULAR. Lista deudas pendientes (`pagado_proveedor=false`) con selección individual o total via `IonCheckbox`. **Solo paga al proveedor** — descuenta `monto_a_pagar` de CAJA_CELULAR y marca `pagado_proveedor=true` (vía `fn_pagar_proveedor_celular`). La ganancia queda en CAJA_CELULAR hasta que se liquide desde el Historial Modal.

### Historial Modal (`components/historial-modal/`)

Muestra el historial reciente (últimas 50 filas, `obtenerHistorial()`) del servicio activo, y permite liquidar la ganancia pendiente.

**Tabla** — columnas según servicio:

| Servicio | Columnas |
|---|---|
| CELULAR (5 columnas) | Fecha · Saldo recibido (`monto_virtual`) · Ganancia (atenuada si `!pagado_proveedor`) · Proveedor (badge Pagado/Pendiente) · Ganancia liquidada (badge Liquidado/Pendiente) |
| BUS (4 columnas) | Fecha · Depósito (`monto_a_pagar`) · Ganancia · Ganancia liquidada (badge Liquidado/Pendiente) |

> BUS no tiene columna "Proveedor": desde el fix de `pagado_proveedor=true` por defecto, ese badge siempre diría lo mismo y no aporta información — se quitó solo para BUS (`tabla-header--bus`/`tabla-fila--bus` en el SCSS). CELULAR conserva la columna porque ahí sí existe la distinción real.

**Totales** (fila horizontal al pie de la tabla, derivados de `historial` — informativos):
- **Ya transferido** (verde) — suma de `ganancia` donde `ganancia_liquidada=true`.
- **Por liquidar** — ver abajo, fuente distinta.
- **Total ganancia** (gris) — solo aparece si hay ambos tipos.

**Por liquidar y botón "Transferir $X"** — **no** se calculan desde `historial` (que está truncado a 50 filas y no sirve como fuente de un total transaccional). Se calculan desde el `@Input() pendientes`, el mismo dataset que ya carga la página padre con `RecargasVirtualesService.obtenerPendientes()` (`pagado_proveedor=true AND ganancia_liquidada=false`, sin límite de filas). Esto garantiza que el monto mostrado siempre coincide con lo que `fn_liquidar_ganancias` realmente liquidará.

> **Bug corregido (2026-06-22):** antes, el total "Por liquidar" del modal se derivaba de `historial` (top-50, sin filtrar `pagado_proveedor`), mientras el header de la página usaba `obtenerPendientes()` (sin límite, con el filtro completo). Podían divergir en ambas direcciones — el modal podía mostrar de más (sumando ganancias con proveedor sin pagar, que la BD rechaza al liquidar) o de menos (si había pendientes antiguos fuera del top-50). Ver `historial-modal.component.ts` — getter `totalPorLiquidar`.

**Botón "Transferir $X"** — visible siempre que `totalPorLiquidar > 0` (`puedeLiquidar`), **sin exigir que el saldo de la caja alcance**. Si la caja origen no cubre el monto, `confirmarLiquidacion()` lo explica con un toast (`"Caja X tiene $A y necesitas $B para liquidar"`) antes de abrir la confirmación — el botón nunca desaparece sin que el usuario sepa por qué.

**Aviso de ganancia atrapada (solo CELULAR)** — si hay filas con `!ganancia_liquidada && !pagado_proveedor` dentro del historial visible, un banner de advertencia explica: *"$X en ganancia no se puede liquidar todavía — primero debes pagar al proveedor esas recargas."* (getter `gananciaSinPagarProveedor`, solo informativo, no afecta el monto a liquidar). BUS nunca muestra este banner — no tiene esa etapa intermedia.

**Liquidación** — confirmación con `AlertController` ("¿Transferir $X de Caja X a Varios/Tienda?"), luego:

```
ejecutarLiquidacion()
  └─ RPC: fn_liquidar_ganancias(servicio, p_empleado_id)
       ├─ SELECT FOR UPDATE de filas WHERE pagado_proveedor=true AND ganancia_liquidada=false
       ├─ Valida saldo de la caja origen >= total
       ├─ Calcula caja destino: VARIOS si caja_varios_activa=true, sino CAJA (Tienda)
       ├─ fn_crear_transferencia: caja origen → caja destino (atómico)
       └─ UPDATE ganancia_liquidada=true, fecha_liquidacion_ganancia=hoy (solo los IDs bloqueados)
```

Si `liquidarGanancias()` recibe `null` de `supabase.call()` (la BD ya rechazó con un `RAISE EXCEPTION` y `call()` ya mostró su toast), el componente no muestra un segundo toast genérico — solo aborta en silencio.

El padre (`recargas-virtuales.page.ts → abrirHistorial()`) siempre recarga sus datos al cerrar el modal (liquidado o no), para que la próxima apertura reciba `@Input()` frescos.

---

## Rutas

```
/caja/recargas-virtuales → RecargasVirtualesPage
```

> Definida en `src/app/features/caja/caja.routes.ts`.

---

## Servicios

| Servicio | Ubicación | Descripción |
| --- | --- | --- |
| `RecargasVirtualesService` | `recargas-virtuales/services/recargas-virtuales.service.ts` | Saldo virtual, deudas, pendientes de liquidar, RPCs de registro/pago/liquidación, historial |
| `GananciasService` | `recargas-virtuales/services/ganancias.service.ts` | Ganancia BUS pendiente y del mes actual, para notificaciones |

### Métodos de saldo virtual — cuándo usar cada uno

| Método | Fórmula | Usar en |
|---|---|---|
| `getSaldoVirtualActual(servicio)` | Último snapshot + recargas posteriores al snapshot | Página de Recargas Virtuales, cuadre de caja, notificaciones, modal de compra BUS. **Home ya NO lo llama directamente** — desde 2026-05-30 usa `fn_home_dashboard`. **Cierre diario tampoco** — usa `fn_datos_cierre_diario` que retorna `saldos_virtuales` (total UI) y `snapshot_virtuales` (base para SQL). |

> Ambos servicios viven en el feature `recargas-virtuales/services/` — fueron movidos desde `core/` porque solo los usa este módulo y el dashboard de caja los accede via `inject()`.

### `obtenerPendientes(servicio)` — filtro unificado

```typescript
.eq('ganancia_liquidada', false)
.eq('pagado_proveedor', true)
```

Mismo filtro para CELULAR y BUS, idéntico al que usa `fn_liquidar_ganancias` en la BD. BUS lo cumple siempre desde el INSERT (no tiene paso intermedio); CELULAR lo cumple solo después de `fn_pagar_proveedor_celular`.

### Patrón de filtros en queries de `recargas_virtuales`

Las queries que filtran por servicio usan `tipo_servicio_id` (FK directa) en lugar del join embebido `tipos_servicio!inner(codigo)`. El filtro en joins embebidos de Supabase JS **no actúa como WHERE** — solo filtra columnas del resultado, no filas. Usar siempre:

```typescript
const tipoId = await this.getTipoServicioId(servicio); // resuelve y cachea el ID
query.eq('tipo_servicio_id', tipoId)                   // ✅ filtra filas correctamente
// ❌ NO: .eq('tipos_servicio.codigo', servicio)        // no filtra filas en Supabase JS
```

`getTipoServicioId()` tiene cache en memoria + in-flight dedup para evitar queries duplicadas cuando CELULAR y BUS se resuelven en paralelo.

---

## Base de datos

| Tabla | Propósito |
|---|---|
| `recargas_virtuales` | Registro de TODAS las cargas/compras (CELULAR y BUS). Un registro = una transacción con el proveedor. |
| `recargas` | Snapshot del saldo virtual — lo genera el cierre diario **y también el mini cierre** (cuando se compra saldo con ventas pendientes). Guarda `saldo_virtual_actual` al momento del evento. |
| `cajas` | Saldos actuales de CAJA_CELULAR y CAJA_BUS |
| `operaciones_cajas` | Historial de movimientos de efectivo generados al pagar o comprar |
| `tipos_servicio` | Configuración del servicio: `codigo` ('CELULAR'/'BUS'), `porcentaje_comision` |

### Campos clave de `recargas_virtuales`

| Campo | CELULAR | BUS |
|---|---|---|
| `monto_virtual` | Saldo que cargó el proveedor | Monto del depósito |
| `monto_a_pagar` | `monto_virtual * 0.95` (lo que se le paga al proveedor) | Igual a `monto_virtual` |
| `ganancia` | `monto_virtual * 0.05`, calculada al insertar | `ROUND(monto * comision%, 2)`, calculada al insertar |
| `pagado_proveedor` | `false` al crear → `true` via `fn_pagar_proveedor_celular` | `true` desde el INSERT (fix v4.1 — antes `false`, dejaba la fila sin poder liquidarse nunca) |
| `fecha_pago_proveedor` | NULL → se llena al ejecutar `fn_pagar_proveedor_celular` | Sin uso real (BUS no tiene esta etapa) |
| `operacion_pago_id` | NULL → FK a `operaciones_cajas` al pagar al proveedor | NULL (no aplica — el EGRESO está en la operación de compra) |
| `ganancia_liquidada` | `false` → `true` al ejecutar `fn_liquidar_ganancias('CELULAR', ...)` | `false` → `true` al ejecutar `fn_liquidar_ganancias('BUS', ...)` |
| `fecha_liquidacion_ganancia` | NULL → se llena al liquidar | NULL → se llena al liquidar |

---

## Saldo virtual — fórmula de cálculo

```
saldo_virtual_actual = último_cierre.saldo_virtual_actual
                     + SUM(recargas_virtuales.monto_virtual
                           WHERE created_at > último_cierre.created_at)
```

**Por qué `created_at` y no `fecha`:** `fecha` es la fecha del negocio (puede ser hoy o días anteriores). Lo que determina si una recarga ya fue incorporada al snapshot es cuándo se creó el registro (`created_at`). Si se creó después del último snapshot (cierre o mini cierre), todavía no está contada.

**Por qué `clock_timestamp()` en el INSERT de `recargas_virtuales` (mini cierre):** `NOW()` es estable dentro de una transacción PostgreSQL — todas las llamadas devuelven el mismo valor. Si el snapshot (`recargas`) y la compra (`recargas_virtuales`) se insertan en la misma transacción con `NOW()`, quedan con `created_at` idéntico. El filtro `created_at > snapshot.created_at` no contaría la compra. `clock_timestamp()` avanza en tiempo real y garantiza que `recargas_virtuales.created_at` sea estrictamente posterior al snapshot.

Implementado en: `RecargasVirtualesService.getSaldoVirtualActual()` (TypeScript) y dentro de `fn_registrar_compra_saldo_bus` (SQL, vía `clock_timestamp()` en el INSERT de `recargas_virtuales`).

---

## Flujos

### CELULAR — Registrar recarga del proveedor

Cuando el proveedor carga saldo virtual a la cuenta (ej: carga $210.53):

```
RegistrarRecargaModalComponent (tipo='CELULAR')
  ├─ ngOnInit: getPorcentajeComision('CELULAR') → 5% (de tipos_servicio)
  │    Muestra preview: monto_a_pagar=$200.00, ganancia=$10.53
  └─ confirmar()
       └─ RPC: fn_registrar_recarga_proveedor_celular(fecha, empleado_id, monto_virtual)
            ├─ Calcula monto_a_pagar = monto_virtual * 0.95
            ├─ INSERT recargas_virtuales (pagado_proveedor=false)  ← crea la deuda
            ├─ Calcula saldo_virtual_celular actualizado (fórmula de arriba)
            ├─ Obtiene lista de deudas pendientes actualizadas
            └─ Retorna JSON completo → UI actualiza sin queries adicionales
```

> La función retorna todo lo necesario para actualizar la UI en una sola llamada (saldo + deudas). No hay queries adicionales desde TypeScript después del RPC.

### CELULAR — Pagar al proveedor

Cuando se le paga en efectivo al proveedor, el usuario abre el modal **"Pagar al proveedor"** desde la card de acción en la tab CELULAR. Puede seleccionar individualmente qué recargas pagar (o todas). Este paso **solo mueve el efectivo** — la ganancia queda en CAJA_CELULAR hasta que se liquide.

```
RecargasVirtualesPage (tab CELULAR) → card "Pagar al proveedor"
  └─ PagarProveedorModalComponent
       ├─ Lista de deudas con IonCheckbox (selección individual o todas)
       ├─ Valida: cajaCelularSaldo >= totalSeleccionado
       └─ confirmar()
            └─ RPC: fn_pagar_proveedor_celular(empleado_id, ids_recargas[])
                 ├─ Calcula total = SUM(monto_a_pagar) de las filas seleccionadas
                 ├─ Valida CAJA_CELULAR.saldo >= total
                 ├─ INSERT operaciones_cajas EGRESO CAJA_CELULAR
                 ├─ UPDATE recargas_virtuales: pagado_proveedor=true, fecha_pago_proveedor=hoy, operacion_pago_id=FK
                 └─ UPDATE saldo CAJA_CELULAR
```

> Función SQL dedicada: `fn_pagar_proveedor_celular`. La categoría usada es `PAGO-PROV-CEL` de `categorias_sistema` (UUID fijo `a1000001-0000-0000-0000-000000000011`). La ganancia se queda en CAJA_CELULAR y se transfiere solo al liquidar.

### CELULAR / BUS — Liquidar ganancia

Desde el `HistorialModalComponent` (botón "Transferir $X a Varios/Tienda"), no desde la página principal:

```
HistorialModalComponent → confirmarLiquidacion()
  └─ AlertController: "¿Transferir $X de Caja X a {Varios|Tienda}?"
       └─ Confirma → ejecutarLiquidacion()
            └─ RPC: fn_liquidar_ganancias(servicio, p_empleado_id)
                 ├─ SELECT FOR UPDATE filas WHERE tipo=servicio AND pagado_proveedor=true AND ganancia_liquidada=false
                 ├─ Valida CAJA_origen.saldo >= total → si no, RAISE EXCEPTION
                 ├─ Calcula caja destino: VARIOS si caja_varios_activa=true, sino CAJA
                 ├─ fn_crear_transferencia: CAJA_origen → caja destino (atómico)
                 └─ UPDATE recargas_virtuales: ganancia_liquidada=true, fecha_liquidacion_ganancia=hoy
                      (solo los IDs bloqueados con FOR UPDATE — no un WHERE genérico)
```

> Atómico todo-o-nada. El botón en el frontend ya valida que haya algo pendiente, pero NO el saldo (ver sección Historial Modal arriba) — si la BD rechaza por saldo insuficiente, el toast de `confirmarLiquidacion()` ya lo explica antes de llegar a la BD.

### BUS — Comprar saldo virtual

Cuando la tienda deposita en el banco para recargar la cuenta del proveedor:

```
RegistrarRecargaModalComponent (tipo='BUS')
  ├─ ngOnInit: getSaldoCajaActual('CAJA_BUS') + getSaldoVirtualActual('BUS')
  │    Muestra: saldo disponible, saldo_virtual del sistema, ventas calculadas del día
  └─ confirmar()
       └─ RPC: fn_registrar_compra_saldo_bus(fecha, empleado_id, monto, notas?, saldo_virtual_maquina?)

            ── Modo básico (sin saldo_virtual_maquina) ──
            ├─ Valida: CAJA_BUS >= monto
            ├─ INSERT operaciones_cajas EGRESO CAJA_BUS
            ├─ INSERT recargas_virtuales (pagado_proveedor=true, ganancia=ROUND(monto*comision%,2), created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS

            ── Modo con mini cierre (saldo_virtual_maquina ingresado y ventas > 0) ──
            ├─ Calcula: ventas_del_día = saldo_virtual_sistema - saldo_virtual_maquina
            ├─ Calcula: disponible = CAJA_BUS + ventas_del_día
            ├─ Valida: disponible >= monto (lanza EXCEPTION si no)
            ├─ INSERT recargas (snapshot/mini cierre): saldo_virtual_actual = saldo_virtual_maquina
            │    ON CONFLICT (turno_id, tipo_servicio_id) → acumula si ya hubo un mini cierre hoy
            ├─ INSERT operaciones_cajas INGRESO CAJA_BUS por ventas_del_día
            ├─ INSERT operaciones_cajas EGRESO CAJA_BUS por monto
            ├─ INSERT recargas_virtuales (pagado_proveedor=true, ganancia=ROUND(monto*comision%,2), created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS → nunca queda negativa
```

> **Mini cierre:** cuando hay ventas del día sin cerrar, la función las registra como INGRESO en CAJA_BUS antes del EGRESO (depósito). Así CAJA_BUS siempre refleja la realidad y nunca queda negativa. El cierre diario (`fn_ejecutar_cierre_diario`) detecta el mini cierre via `ON CONFLICT` y solo acumula las ventas restantes del resto del día.
>
> `clock_timestamp()` en `recargas_virtuales` garantiza que su `created_at` sea posterior al snapshot del mini cierre, para que `getSaldoVirtualActual` lo cuente correctamente.

---

## Notificaciones BUS en Home

Las notificaciones están centralizadas en `NotificacionesService`. `home.page.ts` llama a `notificacionesService.getNotificaciones()` al cargar y muestra el badge con el total de todas las notificaciones pendientes de la app.

Para BUS hay dos tipos de notificación con propósitos distintos:

### FACTURACION_BUS_PENDIENTE — ganancia BUS sin liquidar

Aparece cuando hay ganancia BUS sin liquidar (filas con `ganancia_liquidada=false`). Persiste hasta que se complete la liquidación:

```
home.page.ts → cargarDatos()
  └─ notificacionesService.getNotificaciones()
       └─ gananciasService.calcularGananciaBusPendiente()
            → SUM(ganancia) WHERE tipo=BUS AND ganancia_liquidada=false
            → Si > 0 → retorna number → notificación visible
            → Si = 0 → retorna null → no hay notificación

Al liquidar (desde el botón "Transferir" del Historial Modal):
  └─ RPC: fn_liquidar_ganancias('BUS', p_empleado_id)
       → marca ganancia_liquidada=true en recargas_virtuales
       → la próxima llamada a calcularGananciaBusPendiente() retorna null → notificación desaparece
```

> **Fix 2026-06-22:** antes filtraba por `pagado_proveedor=false`, que tenía sentido cuando BUS nacía en `false`. Tras el fix de `fn_registrar_compra_saldo_bus` (BUS nace en `true`), ese filtro siempre devolvía 0 filas — la notificación quedó rota hasta corregirla a `ganancia_liquidada=false`.

### FACTURACION_BUS_PROXIMA — fin de mes

Recordatorio preventivo que aparece los últimos N días del mes actual si ya hay ganancias acumuladas. `N` viene de la clave `bus_dias_antes_facturacion` en `configuraciones`. Solo aparece si no hay `FACTURACION_BUS_PENDIENTE` activa (para no duplicar).

```
Si no hay FACTURACION_BUS_PENDIENTE y diasHastaFinMes <= bus_dias_antes_facturacion:
  └─ calcularGananciaBusMesActual() > 0
       → muestra: "Quedan N días — Ganancias acumuladas: $X"
```

`calcularGananciaBusMesActual()` suma directamente la columna `ganancia` de las filas del mes (ya calculada y guardada por fila al registrar) — no recalcula con el `porcentaje_comision` actual, para no divergir si la comisión cambia después de registrada la compra.

### Claves de `configuraciones` relacionadas

| Clave | Notificación |
|---|---|
| `bus_alerta_saldo_bajo` | `SALDO_BAJO_BUS` — alerta cuando saldo virtual BUS <= este valor |
| `bus_dias_antes_facturacion` | `FACTURACION_BUS_PROXIMA` — días de anticipación al fin de mes |

---

## Funciones SQL

> 📄 `fn_registrar_recarga_proveedor_celular` → [sql/functions/fn_registrar_recarga_proveedor_celular.sql](sql/functions/fn_registrar_recarga_proveedor_celular.sql)

> 📄 `fn_pagar_proveedor_celular` → [sql/functions/fn_pagar_proveedor_celular.sql](sql/functions/fn_pagar_proveedor_celular.sql)

> 📄 `fn_registrar_compra_saldo_bus` (v4.1) → [sql/functions/fn_registrar_compra_saldo_bus.sql](sql/functions/fn_registrar_compra_saldo_bus.sql) — BUS nace con `pagado_proveedor=true`

> 📄 `fn_liquidar_ganancias` (v2.3) → [sql/functions/fn_liquidar_ganancias.sql](sql/functions/fn_liquidar_ganancias.sql) — ambos servicios filtran `pagado_proveedor=true AND ganancia_liquidada=false`, con `SELECT FOR UPDATE` para evitar race conditions

---

## Notas de implementación

- `RecargasVirtualesService` usa `throw response.error` en métodos de lectura directa (`getPorcentajeComision`, `getSaldoVirtualActual`, `obtenerPendientes()`, etc.). Los callers tienen try/catch.
- `getSaldoVirtualActual(servicio)` tiene in-flight dedup: si home y `NotificacionesService` llaman simultáneamente con el mismo servicio, solo se lanza una query — ambos awaitan la misma `Promise`. El mapa `saldoInFlight` se limpia al resolver (`.finally()`). Mismo patrón que `ConfigService.loadingPromise`.
- `getTipoServicioId(servicio)` tiene cache en memoria (`tipoServicioIdCache`) + in-flight dedup (`tipoServicioInFlight`). Resuelve el ID de `tipos_servicio` una sola vez por sesión aunque se llame en paralelo para CELULAR y BUS simultáneamente.
- `liquidarGanancias()` retorna `Promise<LiquidacionResult | null>` — `null` significa que `supabase.call()` ya mostró el toast con el motivo real del rechazo (ej. "No hay ganancias CELULAR pendientes de liquidar"). El caller no debe mostrar un segundo toast genérico al recibir `null`.
- El porcentaje de comisión viene de la tabla `tipos_servicio` (`porcentaje_comision`). Nunca está hardcodeado en el código TypeScript ni en las funciones SQL. Esto permite cambiar la comisión BUS sin tocar código.
- **`fn_datos_cierre_diario` devuelve `saldos_virtuales` ya como total final** (snapshot + agregado). El campo `agregado_virtual_hoy` es solo informativo para mostrar en la UI cuánto se sumó hoy — no se debe volver a sumar sobre `saldos_virtuales`. El getter `saldoEsperadoBus` en `cierre-diario.page.ts` usa solo `saldoVirtualActualBus` sin sumar el agregado.

---

## Estado del Proyecto

- ✅ Registro de recargas CELULAR (con deuda pendiente, `pagado_proveedor=false`)
- ✅ Pago al proveedor CELULAR — modal `PagarProveedorModalComponent` con selección múltiple via `IonCheckbox`, EGRESO atómico via `fn_pagar_proveedor_celular`
- ✅ Compra de saldo BUS (modo básico y extendido con mini cierre), `pagado_proveedor=true` desde el registro (v4.1)
- ✅ Liquidación de ganancia CELULAR/BUS — desde el Historial Modal, filtra `pagado_proveedor=true AND ganancia_liquidada=false` con `SELECT FOR UPDATE`
- ✅ Historial modal: tabla de 5 columnas (CELULAR) / 4 columnas (BUS), totales, banner de ganancia atrapada por proveedor (solo CELULAR), botón de liquidar que nunca se oculta por falta de saldo (toast explicativo en su lugar)
- ✅ Badge de notificación en Home cuando hay ganancia BUS pendiente de liquidar
