# Recargas Virtuales

Feature independiente para la gestión de saldo virtual de CELULAR y BUS. Permite registrar recargas del proveedor, pagar deudas, comprar saldo Bus y liquidar ganancias mensuales.

**Punto de entrada:** Sidebar → Recargas Virtuales → `/caja/recargas-virtuales`

---

## Modulos opt-in por negocio

Desde 2026-05-01, **CELULAR y BUS son módulos opcionales independientes**. Un negocio recién creado tiene ambos desactivados — no aparecen ni en el dashboard, ni en el sidebar, ni en parámetros.

| Flag (en `configuraciones`) | Quién lo activa | Efecto al activar |
|----------------------------|-----------------|-------------------|
| `recargas_celular_habilitada` | Solo superadmin (Parámetros → Módulos) | Crea CAJA_CELULAR + categoría "Pago Proveedor Celular" (`seleccionable=true`) |
| `recargas_bus_habilitada`     | Solo superadmin (Parámetros → Módulos) | Crea CAJA_BUS + categoría "Compra Saldo Virtual Bus" (`seleccionable=false`) |

Función SQL: `fn_configurar_modulos(p_celular BOOLEAN, p_bus BOOLEAN, p_varios BOOLEAN DEFAULT FALSE)` en `docs/onboarding/sql/functions/` (desde dentro del negocio) y `fn_configurar_modulos_admin` en `docs/admin/sql/functions/` (desde `/admin`).

**Comportamiento condicional en la UI** (las páginas detectan los flags via `ConfigService.get()` y se adaptan):

| Estado | Sidebar | Dashboard | Saldo Virtual | Historial Recargas |
|--------|---------|-----------|---------------|---------------------|
| Ambos OFF | Sección "Recargas" oculta | Cards CELULAR/BUS ocultas | Página inaccesible vía menú | Solo cierres de turno (sin filtros) |
| Solo CELULAR | Sección visible | Solo card CELULAR | Sin tabs, contenido CELULAR directo | Sin barra de filtros, solo CELULAR |
| Solo BUS | Sección visible | Solo card BUS | Sin tabs, contenido BUS directo | Sin barra de filtros, solo BUS |
| Ambos ON | Sección visible | Ambas cards | Tabs CELULAR/BUS | Filtros Todas/Celular/Bus |

> Las páginas saltean queries de módulos inactivos (`Promise.resolve(0)` o `Promise.resolve([])` en lugar de llamar al servicio) para evitar requests innecesarios a Supabase.

---

## ¿Qué es?

La tienda vende recargas de celular y pasajes de bus usando **saldo virtual** de dos proveedores distintos. Cada servicio tiene un modelo de negocio diferente:

| | CELULAR | BUS |
|---|---|---|
| **Cómo funciona** | El proveedor carga saldo virtual a la cuenta. La tienda lo usa para vender recargas. Después le paga al proveedor. | La tienda deposita plata en la cuenta del proveedor y recibe saldo virtual equivalente. |
| **Modelo** | Crédito — primero se usa, después se paga | Compra directa — se deposita primero |
| **Flujo de caja** | Sin movimiento inmediato al registrar. EGRESO al pagar al proveedor via `fn_pagar_proveedor_celular` | EGRESO inmediato de CAJA_BUS al registrar la compra |
| **Estado en BD** | `pagado_proveedor=false` (deuda) → `pagado_proveedor=true` via `fn_pagar_proveedor_celular` → `ganancia_liquidada=true` via `fn_liquidar_ganancias` | `pagado_proveedor=true` desde el registro → `ganancia_liquidada=true` via `fn_liquidar_ganancias` |
| **Ganancia** | 5% — `monto_virtual * 0.05` (calculada al registrar) | % configurable — `ROUND(monto_a_pagar * comision%, 2)` (calculada al registrar) |
| **Caja involucrada** | CAJA_CELULAR | CAJA_BUS |

---

## Páginas

### Recargas Virtuales (`pages/recargas-virtuales/`)

Panel principal con dos tabs (CELULAR / BUS):

| Tab | Muestra | Acciones |
| --- | --- | --- |
| CELULAR | Saldo virtual + alerta de deudas pendientes + card "Liquidar Ganancia" (4 estados, ver abajo) | Registrar recarga, Pagar deudas, Liquidar ganancia, Ver historial |
| BUS | Saldo virtual + card "Liquidar Ganancia" (3 estados, ver abajo) | Comprar saldo, Liquidar ganancia, Ver historial |

**Cards "Liquidar Ganancia":**

Al confirmar, la liquidación es **atómica y automática**: transfiere el total de la ganancia pendiente desde la caja origen a la **caja destino fija** (sin elección manual). La caja destino se decide así:

- Si `caja_varios_activa = true` → **Varios** (fondo de emergencia, prioridad).
- Si no → **Tienda** (CAJA principal, fallback).

> Si el dueño quiere mover el dinero a otra caja después, hace una transferencia normal entre cajas — no es responsabilidad de esta feature.

**CELULAR — 4 estados:**

| Estado | Condición | Apariencia | Acción al click |
|---|---|---|---|
| Activa | `gananciaCelularPendiente > 0 AND cajaCelularSaldo >= gananciaCelularPendiente` | Card verde, monto en badge | `AlertController` con confirmación |
| Bloqueada por saldo | `gananciaCelularPendiente > 0 AND cajaCelularSaldo < gananciaCelularPendiente` | Card gris con candado | Toast: "Caja Celular tiene $X. Necesitas $Y para liquidar" |
| Bloqueada futura | Sin ganancia liquidable pero `gananciaCelularFutura > 0` (recargas sin `pagado_proveedor=true`) | Card gris con candado | Toast: "Págale al proveedor primero" |
| Oculta | No hay ganancia de ningún tipo | — | — |

> El cálculo de las dos ganancias (`liquidable` + `futura`) se hace en una sola query con `gananciasService.calcularGananciasCelular()`.
> `gananciaCelularPendiente` = ganancia de filas con `pagado_proveedor=true AND ganancia_liquidada=false`.
> `gananciaCelularFutura` = ganancia de filas con `pagado_proveedor=false`.

**BUS — 3 estados:**

| Estado | Condición | Apariencia | Acción al click |
|---|---|---|---|
| Activa | `gananciasBusPendiente > 0 AND cajaBusSaldo >= gananciasBusPendiente` | Card verde, monto en badge | `AlertController` con confirmación |
| Bloqueada por saldo | `gananciasBusPendiente > 0 AND cajaBusSaldo < gananciasBusPendiente` | Card gris con candado | Toast: "Caja Bus tiene $X. Necesitas $Y para liquidar" |
| Oculta | Sin filas con `pagado_proveedor=false` | — | — |

> En BUS no existe el estado "futura" porque no hay paso intermedio: en cuanto se compra saldo, la ganancia ya está pendiente de liquidar.

**Ruta:** `/caja/recargas-virtuales`

---

### Pagar Deudas (`pages/pagar-deudas/`)

Wizard de 2 pasos para saldar deudas con el proveedor CELULAR:

- **Paso 1:** Lista de deudas pendientes con selección individual o total
- **Paso 2:** Confirmación con saldo antes/después y validación de fondos suficientes

**Ruta:** `/caja/pagar-deudas`

---

## Componentes Modales

### Registrar Recarga Modal (`components/registrar-recarga-modal/`)

Modal compartido para dos flujos según el `tipo` recibido:

- **CELULAR:** Registra una carga del proveedor → crea deuda pendiente (`pagado_proveedor=false`)
- **BUS:** Registra una compra de saldo → EGRESO inmediato de CAJA_BUS (`pagado_proveedor=false`, ganancia pendiente de liquidación)

---

### Pagar Deudas (integrado en página `recargas-virtuales`)

Lista deudas CELULAR pendientes con selección múltiple, integrada directamente en la página principal (sin modal separado). **Solo paga al proveedor** — descuenta `monto_a_pagar` de CAJA_CELULAR y marca `pagado_proveedor=true`. La ganancia queda en CAJA_CELULAR hasta que el dueño la liquide con la acción "Liquidar Ganancia Celular".

---

### Liquidación de ganancia (sin modal — `AlertController` directo)

CELULAR y BUS ya **no usan modales** para liquidar — la decisión es 100% automática. Al tocar la card "Liquidar Ganancia" se muestra un `AlertController` de confirmación tipo *"¿Confirmas transferir $X de Caja Bus → Varios?"*. Si confirma, se llama al RPC correspondiente.

| Servicio | RPC | Filtro BD | Origen | Destino |
|---|---|---|---|---|
| CELULAR | `fn_liquidar_ganancias('CELULAR', p_empleado_id)` (v2.2) | `pagado_proveedor=true AND ganancia_liquidada=false` | CAJA_CELULAR | VARIOS o CAJA según `caja_varios_activa` |
| BUS | `fn_liquidar_ganancias('BUS', p_empleado_id)` (v2.2) | `pagado_proveedor=true AND ganancia_liquidada=false` | CAJA_BUS | VARIOS o CAJA según `caja_varios_activa` |

Una sola función unificada maneja ambos servicios con el mismo filtro. Valida saldo origen suficiente, calcula la caja destino internamente y marca `ganancia_liquidada=true`. Operación atómica todo-o-nada.

---

### Historial Modal (`components/historial-modal/`)

Muestra las últimas 50 recargas del servicio activo (CELULAR o BUS). Tabla de 5 columnas:

| Columna | Contenido |
|---|---|
| Fecha | Fecha del registro |
| Saldo recibido / Depósito | `monto_virtual` (CELULAR) o `monto_a_pagar` (BUS) |
| Ganancia | `ganancia` en color si ya pagó proveedor, gris si pendiente |
| Proveedor | Badge "Pagado"/"Pendiente" (CELULAR) · "Comprado"/"Pendiente" (BUS) |
| Ganancia | Badge "Liquidado" (verde) / "Pendiente" (gris) |

**Totales en fila horizontal** al pie de la tabla:
- **Ya transferido** (verde) — suma de `ganancia` donde `ganancia_liquidada=true`
- **Por liquidar** (azul/naranja) — suma donde `ganancia_liquidada=false`
- **Total ganancia** (gris) — solo aparece si hay ambos tipos

El botón **"Transferir $X a Varios/Tienda"** muestra el monto exacto por liquidar y se habilita solo si `cajaSaldo >= totalPorLiquidar`. El monto se calcula directamente desde el historial cargado en el modal (no desde datos del padre) para garantizar sincronía con la BD.

---

## Rutas

```
/caja/recargas-virtuales  → RecargasVirtualesPage
/caja/pagar-deudas        → PagarDeudasPage
```

> Las rutas están definidas en `caja/caja.routes.ts`.

---

## Servicios

| Servicio | Ubicación | Descripción |
| --- | --- | --- |
| `RecargasVirtualesService` | `recargas-virtuales/services/recargas-virtuales.service.ts` | Saldo virtual, deudas, RPCs de registro y liquidación, historial |
| `GananciasService` | `recargas-virtuales/services/ganancias.service.ts` | Ganancia BUS pendiente y del mes actual |

### Métodos de saldo virtual — cuándo usar cada uno

| Método | Fórmula | Usar en |
|---|---|---|
| `getSaldoVirtualActual(servicio)` | Último snapshot + recargas posteriores al snapshot | Dashboard home, cierre diario, cuadre de caja, notificaciones, modal de compra BUS |
| `getSaldoUltimoCierre(servicio)` | Solo el `saldo_virtual_actual` del último snapshot en `recargas` | Uso interno — base de cálculo para `getSaldoVirtualActual()`. No usar directamente en UI. |

> Ambos servicios viven en el feature `recargas-virtuales/services/` — fueron movidos desde `core/` porque solo los usa este módulo y el dashboard de caja los accede via `inject()`.

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
| `ganancia` | `monto_virtual * 0.05` | `ROUND(monto_a_pagar * comision%, 2)` — calculada al insertar |
| `pagado_proveedor` | `false` al crear → `true` via `fn_pagar_proveedor_celular` | `true` desde el momento del registro (ya se pagó al banco) |
| `fecha_pago_proveedor` | NULL → se llena al ejecutar `fn_pagar_proveedor_celular` | Se llena al registrar la compra |
| `operacion_pago_id` | NULL → FK a `operaciones_cajas` al pagar al proveedor | NULL (no aplica — el EGRESO está en la operación de compra) |
| `ganancia_liquidada` | `false` → `true` al ejecutar `fn_liquidar_ganancias('CELULAR', ...)` | `false` al comprar → `true` al ejecutar `fn_liquidar_ganancias('BUS', ...)` |
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

> Función SQL dedicada: `fn_pagar_proveedor_celular`. La categoría usada es `'Pago Proveedor Recargas'` (creada en `fn_completar_onboarding`, `seleccionable=false`). La ganancia se queda en CAJA_CELULAR y se transfiere solo al ejecutar `fn_liquidar_ganancias('CELULAR')`.

### CELULAR — Liquidar ganancia

Después de haber pagado al proveedor, la ganancia sigue en CAJA_CELULAR. El usuario toca la card "Liquidar Ganancia" → `AlertController` confirma → se ejecuta el RPC. La caja destino es automática (Varios si está activa, sino Tienda):

```
recargas-virtuales.page.ts → confirmarLiquidacion('CELULAR')
  └─ AlertController: "¿Transferir $X de Caja Celular a {Varios|Tienda}?"
       └─ Confirma → ejecutarLiquidacion('CELULAR')
            └─ RPC: fn_liquidar_ganancias('CELULAR', p_empleado_id)
                 ├─ Calcula total = SUM(ganancia) WHERE tipo=CELULAR AND pagado_proveedor=true AND ganancia_liquidada=false
                 ├─ Valida CAJA_CELULAR.saldo >= total → si no, EXCEPTION (defensa: el frontend ya bloqueó la card)
                 ├─ Calcula caja destino: VARIOS si caja_varios_activa=true, sino CAJA
                 ├─ TRANSFERENCIA_SALIENTE CAJA_CELULAR → TRANSFERENCIA_ENTRANTE caja destino
                 └─ UPDATE recargas_virtuales: ganancia_liquidada=true, fecha_liquidacion_ganancia=hoy
```

> Atómico todo-o-nada. La card en el frontend ya valida el saldo antes de habilitarse — el usuario nunca debería ver la EXCEPTION.

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
            ├─ INSERT recargas_virtuales (pagado_proveedor=false, ganancia=0, monto_a_pagar=monto, created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS

            ── Modo con mini cierre (saldo_virtual_maquina ingresado y ventas > 0) ──
            ├─ Calcula: ventas_del_día = saldo_virtual_sistema - saldo_virtual_maquina
            ├─ Calcula: disponible = CAJA_BUS + ventas_del_día
            ├─ Valida: disponible >= monto (lanza EXCEPTION si no)
            ├─ INSERT recargas (snapshot/mini cierre): saldo_virtual_actual = saldo_virtual_maquina
            │    ON CONFLICT (turno_id, tipo_servicio_id) → acumula si ya hubo un mini cierre hoy
            ├─ INSERT operaciones_cajas INGRESO CAJA_BUS por ventas_del_día
            ├─ INSERT operaciones_cajas EGRESO CAJA_BUS por monto
            ├─ INSERT recargas_virtuales (pagado_proveedor=false, ganancia=0, monto_a_pagar=monto, created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS → nunca queda negativa
```

> **Mini cierre:** cuando hay ventas del día sin cerrar, la función las registra como INGRESO en CAJA_BUS antes del EGRESO (depósito). Así CAJA_BUS siempre refleja la realidad y nunca queda negativa. El cierre diario (`fn_ejecutar_cierre_diario`) detecta el mini cierre via `ON CONFLICT` y solo acumula las ventas restantes del resto del día.
>
> `clock_timestamp()` en `recargas_virtuales` garantiza que su `created_at` sea posterior al snapshot del mini cierre, para que `getSaldoVirtualActual` lo cuente correctamente.

### BUS — Liquidación de ganancia

Cuando el proveedor BUS acredita la ganancia, el dueño la liquida desde el modal "Movimientos Bus" → botón "Transferir $X a Varios". En BUS `pagado_proveedor=true` desde el momento del registro (al comprar el saldo ya se pagó al banco), por lo que solo falta marcar `ganancia_liquidada=true`:

```
HistorialModalComponent (tipo='BUS') → botón "Transferir $X a {Varios|Tienda}"
  └─ AlertController: "¿Transferir $X de Caja Bus a {Varios|Tienda}?"
       └─ Confirma → ejecutarLiquidacion()
            └─ RPC: fn_liquidar_ganancias('BUS', p_empleado_id)
                 ├─ Calcula total = SUM(ganancia) WHERE tipo=BUS AND pagado_proveedor=true AND ganancia_liquidada=false
                 ├─ Valida CAJA_BUS.saldo >= total → si no, EXCEPTION
                 ├─ Calcula caja destino: VARIOS si caja_varios_activa=true, sino CAJA
                 ├─ TRANSFERENCIA_SALIENTE CAJA_BUS → TRANSFERENCIA_ENTRANTE caja destino
                 └─ UPDATE recargas_virtuales: ganancia_liquidada=true, fecha_liquidacion_ganancia=hoy
                      WHERE tipo=BUS AND pagado_proveedor=true AND ganancia_liquidada=false
```

> Atómico todo-o-nada. El botón en el frontend ya valida el saldo antes de habilitarse.

---

## Notificaciones BUS en Home

Las notificaciones están centralizadas en `NotificacionesService`. `home.page.ts` llama a `notificacionesService.getNotificaciones()` al cargar y muestra el badge con el total de todas las notificaciones pendientes de la app.

Para BUS hay dos tipos de notificación con propósitos distintos:

### FACTURACION_BUS_PENDIENTE — ganancia BUS sin liquidar

Aparece cuando hay ganancia BUS sin liquidar (filas con `pagado_proveedor=false`). Persiste hasta que se complete la liquidación:

```
home.page.ts → cargarDatos()
  └─ notificacionesService.getNotificaciones()
       └─ gananciasService.calcularGananciaBusPendiente()
            → SUM(ganancia) WHERE tipo=BUS AND pagado_proveedor=false
            → Si > 0 → retorna number → notificación visible
            → Si = 0 → retorna null → no hay notificación

Al liquidar (desde card "Liquidar Ganancia"):
  └─ RPC: fn_liquidar_ganancias('BUS', p_empleado_id)
       → marca pagado_proveedor=true Y ganancia_liquidada=true en recargas_virtuales
       → la próxima llamada a calcularGananciaBusPendiente() retorna null → notificación desaparece
```

> La detección es **dinámica** — no usa ningún flag en BD aparte de `pagado_proveedor`. La condición es simplemente: "¿hay filas BUS con `pagado_proveedor=false`?".

### FACTURACION_BUS_PROXIMA — fin de mes

Recordatorio preventivo que aparece los últimos N días del mes actual si ya hay ganancias acumuladas. `N` viene de la clave `bus_dias_antes_facturacion` en `configuraciones`. Solo aparece si no hay `FACTURACION_BUS_PENDIENTE` activa (para no duplicar).

```
Si no hay FACTURACION_BUS_PENDIENTE y diasHastaFinMes <= bus_dias_antes_facturacion:
  └─ calcularGananciaBusMesActual() > 0
       → muestra: "Quedan N días — Ganancias acumuladas: $X"
```

### Claves de `configuraciones` relacionadas

| Clave | Notificación |
|---|---|
| `bus_alerta_saldo_bajo` | `SALDO_BAJO_BUS` — alerta cuando saldo virtual BUS <= este valor |
| `bus_dias_antes_facturacion` | `FACTURACION_BUS_PROXIMA` — días de anticipación al fin de mes |

---

## Funciones SQL

> 📄 `fn_registrar_recarga_proveedor_celular` → [sql/functions/fn_registrar_recarga_proveedor_celular.sql](sql/functions/fn_registrar_recarga_proveedor_celular.sql)

> 📄 `fn_pagar_proveedor_celular` → [sql/functions/fn_pagar_proveedor_celular.sql](sql/functions/fn_pagar_proveedor_celular.sql)

> 📄 `fn_registrar_compra_saldo_bus` → [sql/functions/fn_registrar_compra_saldo_bus.sql](sql/functions/fn_registrar_compra_saldo_bus.sql)

> 📄 `fn_liquidar_ganancias` (v2.2) → [sql/functions/fn_liquidar_ganancias.sql](sql/functions/fn_liquidar_ganancias.sql) — ambos servicios filtran `pagado_proveedor=true AND ganancia_liquidada=false`

---

## Notas de implementación

- `RecargasVirtualesService` usa `throw response.error` en métodos de lectura directa (`getPorcentajeComision`, `getSaldoVirtualActual`, `obtenerPendientes()`, etc.). Los callers tienen try/catch.
- `getSaldoVirtualActual(servicio)` tiene in-flight dedup: si home y `NotificacionesService` llaman simultáneamente con el mismo servicio, solo se lanza una query — ambos awaitan la misma `Promise`. El mapa `saldoInFlight` se limpia al resolver (`.finally()`). Mismo patrón que `ConfigService.loadingPromise`.
- `registrarRecargaProveedorCelular()` lanza `Error('respuesta vacía')` si `supabase.call()` retorna null. El `confirmar()` en `RegistrarRecargaModalComponent` tiene try/catch que lo captura y muestra `error.message`.
- El porcentaje de comisión viene de la tabla `tipos_servicio` (`porcentaje_comision`). Nunca está hardcodeado en el código TypeScript ni en las funciones SQL. Esto permite cambiar la comisión BUS sin tocar código.

---

## Estado del Proyecto

- ✅ Registro de recargas CELULAR (con deuda pendiente, `pagado_proveedor=false`)
- ✅ Pago al proveedor CELULAR — modal `PagarProveedorModalComponent` con selección múltiple via `IonCheckbox`, EGRESO atómico via `fn_pagar_proveedor_celular`
- ✅ Liquidación ganancia CELULAR — desde historial modal, filtra `pagado_proveedor=true AND ganancia_liquidada=false`
- ✅ Compra de saldo BUS (modo básico y extendido con mini cierre), `pagado_proveedor=true` desde el registro
- ✅ Liquidación ganancia BUS — desde historial modal, filtra `pagado_proveedor=true AND ganancia_liquidada=false`
- ✅ Historial modal con tabla de 5 columnas, totales en fila horizontal (ya transferido / por liquidar / total)
- ✅ Badge de notificación en Home cuando hay ganancia BUS pendiente
