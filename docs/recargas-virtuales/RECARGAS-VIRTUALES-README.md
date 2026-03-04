# Recargas Virtuales

Feature independiente para la gestión de saldo virtual de CELULAR y BUS. Permite registrar recargas del proveedor, pagar deudas, comprar saldo Bus y liquidar ganancias mensuales.

**Punto de entrada:** Sidebar → Recargas Virtuales → `/home/recargas-virtuales`

---

## ¿Qué es?

La tienda vende recargas de celular y pasajes de bus usando **saldo virtual** de dos proveedores distintos. Cada servicio tiene un modelo de negocio diferente:

| | CELULAR | BUS |
|---|---|---|
| **Cómo funciona** | El proveedor carga saldo virtual a la cuenta. La tienda lo usa para vender recargas. Después le paga al proveedor. | La tienda deposita plata en la cuenta del proveedor y recibe saldo virtual equivalente. |
| **Modelo** | Crédito — primero se usa, después se paga | Compra directa — se deposita primero |
| **Flujo de caja** | Sin movimiento inmediato al registrar la deuda | EGRESO inmediato de CAJA_BUS |
| **Estado en BD** | `pagado = false` (deuda pendiente) | `pagado = false` al comprar → `pagado = true` al liquidar el mes |
| **Ganancia** | 5% — `monto_virtual - monto_a_pagar` | % configurable — calculada al liquidar: `ROUND(SUM(monto_a_pagar) * comision%, 2)` |
| **Caja involucrada** | CAJA_CELULAR | CAJA_BUS |

---

## Páginas

### Recargas Virtuales (`pages/recargas-virtuales/`)

Panel principal con dos tabs (CELULAR / BUS):

| Tab | Muestra | Acciones |
| --- | --- | --- |
| CELULAR | Saldo virtual actual + lista de deudas pendientes | Registrar recarga, Pagar deudas, Ver historial |
| BUS | Saldo virtual actual + card de liquidación (3 estados) | Comprar saldo, Liquidar ganancia, Ver historial |

**Card de liquidación BUS — 3 estados:**

| Estado | Condición | Comportamiento |
|---|---|---|
| **Habilitado** | `gananciaBusMesAnterior > 0` | Card clickeable, muestra `$X` pendiente, abre modal de liquidación |
| **Deshabilitado** | `gananciaBusMesActual > 0` (pero nada del mes anterior) | Card bloqueado con 🔒, muestra "Disponible el 1 de [mes]" y acumulado del mes en curso |
| **Oculto** | Sin actividad BUS | No se muestra ningún card |

**Ruta:** `/home/recargas-virtuales`

---

### Pagar Deudas (`pages/pagar-deudas/`)

Wizard de 2 pasos para saldar deudas con el proveedor CELULAR:

- **Paso 1:** Lista de deudas pendientes con selección individual o total
- **Paso 2:** Confirmación con saldo antes/después y validación de fondos suficientes

**Ruta:** `/home/pagar-deudas`

---

## Componentes Modales

### Registrar Recarga Modal (`components/registrar-recarga-modal/`)

Modal compartido para dos flujos según el `tipo` recibido:

- **CELULAR:** Registra una carga del proveedor → crea deuda pendiente (`pagado=false`)
- **BUS:** Registra una compra de saldo → EGRESO inmediato de CAJA_BUS (`pagado=false`, ganancia pendiente de liquidación mensual)

---

### Pagar Deudas Modal (`components/pagar-deudas-modal/`)

Lista deudas CELULAR pendientes con selección múltiple. Al confirmar llama a `registrar_pago_proveedor_celular` que descuenta de CAJA_CELULAR y transfiere la ganancia a CAJA_CHICA.

---

### Liquidación Bus Modal (`components/liquidacion-bus-modal/`)

Registra la ganancia mensual acreditada por el proveedor BUS. La ganancia se calcula dinámicamente como `ROUND(SUM(monto_a_pagar) * porcentaje_comision%, 2)` sobre los registros BUS del mes anterior con `pagado=false`. Llama al RPC `liquidar_ganancias_bus` que, en una sola transacción atómica, marca los registros como `pagado=true` y transfiere la ganancia a Varios (CAJA_CHICA).

---

### Historial Modal (`components/historial-modal/`)

Muestra las últimas 50 recargas del servicio activo (CELULAR o BUS). Cada fila incluye:

- **Icono de estado con color**: ✅ verde (pagado/liquidado), ⚠️ amarillo (CELULAR pendiente de cobro), 🚌 azul (BUS sin liquidar)
- **Fecha** + detalles del monto
- **Empleado** que realizó el registro (`por: nombre`)
- **Badge de estado**: "Pagado"/"Pendiente" para CELULAR · "Liquidado"/"Sin liquidar" para BUS

---

## Rutas

```
/home/recargas-virtuales  → RecargasVirtualesPage
/home/pagar-deudas        → PagarDeudasPage
```

> Las rutas están definidas en `dashboard/dashboard.routes.ts` (el routing sigue siendo del dashboard).

---

## Servicios

| Servicio | Ubicación | Descripción |
| --- | --- | --- |
| `RecargasVirtualesService` | `core/services/recargas-virtuales.service.ts` | Saldo virtual, deudas, RPCs de registro y pago, historial |
| `GananciasService` | `core/services/ganancias.service.ts` | Ganancia BUS del mes anterior y mes actual, verificación de liquidación, RPC de liquidación |

> `RecargasVirtualesService` y `GananciasService` están en `core/` porque también los usan `dashboard` (Home, CuadreCaja, CierreDiario).

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
| `ganancia` | `monto_virtual * 0.05` | `0` — ganancia real: `ROUND(SUM(monto_a_pagar) * comision%, 2)` al liquidar |
| `pagado` | `false` al crear → `true` al pagar | `false` al comprar → `true` al liquidar el mes |
| `fecha_pago` | NULL → se llena al pagar | NULL → se llena al liquidar |
| `operacion_pago_id` | NULL → FK a `operaciones_cajas` al pagar | NULL → FK a la operación de liquidación al liquidar |

---

## Saldo virtual — fórmula de cálculo

```
saldo_virtual_actual = último_cierre.saldo_virtual_actual
                     + SUM(recargas_virtuales.monto_virtual
                           WHERE created_at > último_cierre.created_at)
```

**Por qué `created_at` y no `fecha`:** `fecha` es la fecha del negocio (puede ser hoy o días anteriores). Lo que determina si una recarga ya fue incorporada al snapshot es cuándo se creó el registro (`created_at`). Si se creó después del último snapshot (cierre o mini cierre), todavía no está contada.

**Por qué `clock_timestamp()` en el INSERT de `recargas_virtuales` (mini cierre):** `NOW()` es estable dentro de una transacción PostgreSQL — todas las llamadas devuelven el mismo valor. Si el snapshot (`recargas`) y la compra (`recargas_virtuales`) se insertan en la misma transacción con `NOW()`, quedan con `created_at` idéntico. El filtro `created_at > snapshot.created_at` no contaría la compra. `clock_timestamp()` avanza en tiempo real y garantiza que `recargas_virtuales.created_at` sea estrictamente posterior al snapshot.

Implementado en: `RecargasVirtualesService.getSaldoVirtualActual()` (TypeScript) y dentro de `registrar_compra_saldo_bus` (SQL, vía `clock_timestamp()` en el INSERT de `recargas_virtuales`).

---

## Flujos

### CELULAR — Registrar recarga del proveedor

Cuando el proveedor carga saldo virtual a la cuenta (ej: carga $210.53):

```
RegistrarRecargaModalComponent (tipo='CELULAR')
  ├─ ngOnInit: getPorcentajeComision('CELULAR') → 5% (de tipos_servicio)
  │    Muestra preview: monto_a_pagar=$200.00, ganancia=$10.53
  └─ confirmar()
       └─ RPC: registrar_recarga_proveedor_celular(fecha, empleado_id, monto_virtual)
            ├─ Calcula monto_a_pagar = monto_virtual * 0.95
            ├─ INSERT recargas_virtuales (pagado=false)  ← crea la deuda
            ├─ Calcula saldo_virtual_celular actualizado (fórmula de arriba)
            ├─ Obtiene lista de deudas pendientes actualizadas
            └─ Retorna JSON completo → UI actualiza sin queries adicionales
```

> La función retorna todo lo necesario para actualizar la UI en una sola llamada (saldo + deudas). No hay queries adicionales desde TypeScript después del RPC.

### CELULAR — Pagar al proveedor

Cuando se le paga en efectivo al proveedor (sale de CAJA_CELULAR):

```
PagarDeudasModalComponent
  ├─ Carga deudas pendientes + saldo CAJA_CELULAR
  ├─ Usuario selecciona qué deudas pagar (puede ser parcial)
  └─ confirmarPago()
       └─ RPC: registrar_pago_proveedor_celular(empleado_id, deuda_ids[], notas?)
            ├─ Valida: todas las deudas existen, no pagadas, son de tipo CELULAR
            ├─ Calcula: total_a_pagar (SUM monto_a_pagar) + total_ganancia (SUM ganancia)
            ├─ Valida: CAJA_CELULAR >= total_a_pagar + total_ganancia (lanza EXCEPTION si no)
            ├─ EGRESO CAJA_CELULAR por total_a_pagar
            ├─ TRANSFERENCIA_SALIENTE CAJA_CELULAR → TRANSFERENCIA_ENTRANTE CAJA_CHICA por ganancia
            ├─ UPDATE recargas_virtuales: pagado=true, fecha_pago=hoy
            └─ UPDATE saldos cajas
```

> La ganancia del celular se transfiere a CAJA_CHICA **al momento del pago**, no al registrar la deuda.

### BUS — Comprar saldo virtual

Cuando la tienda deposita en el banco para recargar la cuenta del proveedor:

```
RegistrarRecargaModalComponent (tipo='BUS')
  ├─ ngOnInit: getSaldoCajaActual('CAJA_BUS') + getSaldoVirtualActual('BUS')
  │    Muestra: saldo disponible, saldo_virtual del sistema, ventas calculadas del día
  └─ confirmar()
       └─ RPC: registrar_compra_saldo_bus(fecha, empleado_id, monto, notas?, saldo_virtual_maquina?)

            ── Modo básico (sin saldo_virtual_maquina) ──
            ├─ Valida: CAJA_BUS >= monto
            ├─ INSERT operaciones_cajas EGRESO CAJA_BUS
            ├─ INSERT recargas_virtuales (pagado=false, ganancia=0, monto_a_pagar=monto, created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS

            ── Modo con mini cierre (saldo_virtual_maquina ingresado y ventas > 0) ──
            ├─ Calcula: ventas_del_día = saldo_virtual_sistema - saldo_virtual_maquina
            ├─ Calcula: disponible = CAJA_BUS + ventas_del_día
            ├─ Valida: disponible >= monto (lanza EXCEPTION si no)
            ├─ INSERT recargas (snapshot/mini cierre): saldo_virtual_actual = saldo_virtual_maquina
            │    ON CONFLICT (turno_id, tipo_servicio_id) → acumula si ya hubo un mini cierre hoy
            ├─ INSERT operaciones_cajas INGRESO CAJA_BUS por ventas_del_día
            ├─ INSERT operaciones_cajas EGRESO CAJA_BUS por monto
            ├─ INSERT recargas_virtuales (pagado=false, ganancia=0, monto_a_pagar=monto, created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS → nunca queda negativa
```

> **Mini cierre:** cuando hay ventas del día sin cerrar, la función las registra como INGRESO en CAJA_BUS antes del EGRESO (depósito). Así CAJA_BUS siempre refleja la realidad y nunca queda negativa. El cierre diario (`ejecutar_cierre_diario`) detecta el mini cierre via `ON CONFLICT` y solo acumula las ventas restantes del resto del día.
>
> `clock_timestamp()` en `recargas_virtuales` garantiza que su `created_at` sea posterior al snapshot del mini cierre, para que `getSaldoVirtualActual` lo cuente correctamente.

### BUS — Liquidación mensual de ganancia

Al fin de cada mes el proveedor BUS acredita la ganancia sobre las compras del mes anterior. La ganancia se calcula dinámicamente usando `porcentaje_comision` de la tabla `tipos_servicio`:

```
recargas-virtuales.page.ts
  └─ gananciasService.verificarGananciasPendientes()
       → ROUND(SUM(monto_a_pagar) * comision%,2) WHERE tipo=BUS AND pagado=false AND mes=anterior
       → Si > 0: habilita card "Liquidar Ganancia $X" (estado 1)
  └─ gananciasService.calcularGananciaBusMesActual()
       → ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE tipo=BUS AND mes=actual
       → Si > 0 y no hay pendiente del mes anterior: muestra card bloqueado "Disponible el 1 de [mes]" (estado 2)

LiquidacionBusModalComponent
  └─ confirmar()
       └─ RPC: liquidar_ganancias_bus(mes, empleado_id)
            ├─ Calcula ganancia: ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE tipo=BUS AND pagado=false AND mes
            ├─ TRANSFERENCIA_SALIENTE CAJA_BUS → TRANSFERENCIA_ENTRANTE CAJA_CHICA (Varios) por ganancia
            ├─ UPDATE recargas_virtuales: pagado=true, fecha_pago=hoy WHERE tipo=BUS AND pagado=false AND mes
            └─ UPDATE saldos cajas → operación atómica, todo o nada
```

> `gananciasService.yaSeTransfirio()` verifica si ya hay registros BUS con `pagado=true` en el mes a liquidar — si existen, la liquidación ya se realizó y no se permite hacerla de nuevo.

---

## Notificaciones BUS en Home

Las notificaciones están centralizadas en `NotificacionesService`. `home.page.ts` llama a `notificacionesService.getNotificaciones()` al cargar y muestra el badge con el total de todas las notificaciones pendientes de la app.

Para BUS hay dos tipos de notificación con propósitos distintos:

### FACTURACION_BUS_PENDIENTE — inicio de mes

Aparece al inicio de cada mes cuando hay ganancias BUS del mes anterior sin liquidar. Persiste hasta que se complete la liquidación:

```
home.page.ts → cargarDatos()
  └─ notificacionesService.getNotificaciones()
       └─ gananciasService.verificarGananciasPendientes()
            ├─ getMesAnterior() → 'YYYY-MM'
            ├─ yaSeTransfirio(mes)
            │    → COUNT(*) FROM recargas_virtuales WHERE tipo=BUS AND pagado=true AND fecha IN mes
            │    → false si count=0 → pendiente de liquidar
            ├─ calcularGananciaMes('BUS', mes) → ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE pagado=false
            └─ Si ganancia > 0 y no se liquidó → retorna GananciasPendientes
                 → notificación visible hasta que se liquide

Al liquidar (LiquidacionBusModalComponent):
  └─ RPC: liquidar_ganancias_bus(mes, empleado_id)
       → marca pagado=true en recargas_virtuales → yaSeTransfirio() pasa a retornar true → notificación desaparece
```

> La detección es **dinámica** — no usa ningún flag en BD. Se verifica en tiempo real buscando la transferencia en `operaciones_cajas`.

### FACTURACION_BUS_PROXIMA — fin de mes

Recordatorio preventivo que aparece los últimos N días del mes actual si ya hay ganancias acumuladas. `N` viene de `configuraciones.bus_dias_antes_facturacion`. Solo aparece si no hay `FACTURACION_BUS_PENDIENTE` activa (para no duplicar).

```
Si no hay FACTURACION_BUS_PENDIENTE y diasHastaFinMes <= bus_dias_antes_facturacion:
  └─ calcularGananciaBusMesActual() > 0
       → muestra: "Quedan N días — Ganancias acumuladas: $X"
```

### Columnas de `configuraciones` relacionadas

| Columna | Notificación |
|---|---|
| `bus_alerta_saldo_bajo` | `SALDO_BAJO_BUS` — alerta cuando saldo virtual BUS <= este valor |
| `bus_dias_antes_facturacion` | `FACTURACION_BUS_PROXIMA` — días de anticipación al fin de mes |

---

## Funciones SQL

> 📄 `registrar_recarga_proveedor_celular` → [sql/functions/registrar_recarga_proveedor_celular.sql](sql/functions/registrar_recarga_proveedor_celular.sql)

> 📄 `registrar_pago_proveedor_celular` → [sql/functions/registrar_pago_proveedor_celular.sql](sql/functions/registrar_pago_proveedor_celular.sql)

> 📄 `registrar_compra_saldo_bus` → [sql/functions/registrar_compra_saldo_bus.sql](sql/functions/registrar_compra_saldo_bus.sql)

> 📄 `liquidar_ganancias_bus` → [sql/functions/liquidar_ganancias_bus.sql](sql/functions/liquidar_ganancias_bus.sql)

---

## Notas de implementación

- `RecargasVirtualesService` usa `throw response.error` en métodos de lectura directa (`getPorcentajeComision`, `getSaldoVirtualActual`, `obtenerDeudasPendientesCelular`, etc.). Los callers tienen try/catch.
- `registrarRecargaProveedorCelularCompleto()` lanza `Error('respuesta vacía')` si `supabase.call()` retorna null. El `confirmar()` en `RegistrarRecargaModalComponent` tiene try/catch que lo captura y muestra `error.message`.
- El porcentaje de comisión viene de la tabla `tipos_servicio` (`porcentaje_comision`). Nunca está hardcodeado en el código TypeScript ni en las funciones SQL. Esto permite cambiar la comisión BUS sin tocar código.

---

## Estado del Proyecto

- ✅ Registro de recargas CELULAR (con deuda pendiente)
- ✅ Pago al proveedor CELULAR (selección múltiple)
- ✅ Compra de saldo BUS (modo básico y extendido con mini cierre)
- ✅ Liquidación mensual de ganancia BUS (RPC atómico, comisión dinámica desde DB)
- ✅ Historial de recargas por servicio (con estado de color, empleado y badges CELULAR/BUS diferenciados)
- ✅ Card BUS con 3 estados: liquidar / bloqueado (mes en curso) / oculto
- ✅ Badge de notificación en Home cuando hay ganancia BUS pendiente
