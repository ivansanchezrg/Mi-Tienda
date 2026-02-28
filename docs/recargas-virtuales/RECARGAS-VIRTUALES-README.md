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
| **Estado en BD** | `pagado = false` (deuda pendiente) | `pagado = true` (ya pagado con el depósito) |
| **Ganancia** | 5% — `monto_virtual - monto_a_pagar` | 1% mensual — el proveedor acredita al fin del mes |
| **Caja involucrada** | CAJA_CELULAR | CAJA_BUS |

---

## Páginas

### Recargas Virtuales (`pages/recargas-virtuales/`)

Panel principal con dos tabs (CELULAR / BUS):

| Tab | Muestra | Acciones |
| --- | --- | --- |
| CELULAR | Saldo virtual actual + lista de deudas pendientes | Registrar recarga, Pagar deudas, Ver historial |
| BUS | Saldo virtual actual + botón de liquidación si hay ganancia del mes anterior | Comprar saldo, Liquidar ganancia, Ver historial |

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
- **BUS:** Registra una compra de saldo → EGRESO inmediato de CAJA_BUS (`pagado=true`)

---

### Pagar Deudas Modal (`components/pagar-deudas-modal/`)

Lista deudas CELULAR pendientes con selección múltiple. Al confirmar llama a `registrar_pago_proveedor_celular` que descuenta de CAJA_CELULAR y transfiere la ganancia a CAJA_CHICA.

---

### Liquidación Bus Modal (`components/liquidacion-bus-modal/`)

Registra el saldo acreditado por el proveedor BUS al fin de cada mes (1% de comisión) y transfiere la ganancia calculada a CAJA_CHICA.

---

### Historial Modal (`components/historial-modal/`)

Muestra las últimas 50 recargas del servicio activo (CELULAR o BUS).

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
| `RecargasVirtualesService` | `core/services/recargas-virtuales.service.ts` | Saldo virtual, deudas, RPCs de registro y pago |
| `GananciasService` | `core/services/ganancias.service.ts` | Ganancia BUS del mes anterior + verificación de liquidación |
| `CajasService` | `dashboard/services/cajas.service.ts` | Transferencia de ganancia BUS a CAJA_CHICA (liquidación) |

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
| `ganancia` | `monto_virtual * 0.05` | `monto * 0.01` (liquida el proveedor al mes siguiente) |
| `pagado` | `false` al crear → `true` al pagar | `true` desde el inicio |
| `fecha_pago` | NULL → se llena al pagar | Fecha del depósito |
| `operacion_pago_id` | NULL → FK a `operaciones_cajas` al pagar | FK a la operación EGRESO |

---

## Saldo virtual — fórmula de cálculo

```
saldo_virtual_actual = último_cierre.saldo_virtual_actual
                     + SUM(recargas_virtuales.monto_virtual
                           WHERE created_at > último_cierre.created_at)
```

**Por qué `created_at` y no `fecha`:** `fecha` es la fecha del negocio (puede ser hoy o días anteriores). Lo que determina si una recarga ya fue incorporada al snapshot es cuándo se creó el registro (`created_at`). Si se creó después del último snapshot (cierre o mini cierre), todavía no está contada.

**Por qué `clock_timestamp()` en el INSERT de `recargas_virtuales` (mini cierre):** `NOW()` es estable dentro de una transacción PostgreSQL — todas las llamadas devuelven el mismo valor. Si el snapshot (`recargas`) y la compra (`recargas_virtuales`) se insertan en la misma transacción con `NOW()`, quedan con `created_at` idéntico. El filtro `created_at > snapshot.created_at` no contaría la compra. `clock_timestamp()` avanza en tiempo real y garantiza que `recargas_virtuales.created_at` sea estrictamente posterior al snapshot.

Implementado en: `RecargasVirtualesService.getSaldoVirtualActual()` (TypeScript) y dentro de `registrar_recarga_proveedor_celular_completo` (SQL).

---

## Flujos

### CELULAR — Registrar recarga del proveedor

Cuando el proveedor carga saldo virtual a la cuenta (ej: carga $210.53):

```
RegistrarRecargaModalComponent (tipo='CELULAR')
  ├─ ngOnInit: getPorcentajeComision('CELULAR') → 5% (de tipos_servicio)
  │    Muestra preview: monto_a_pagar=$200.00, ganancia=$10.53
  └─ confirmar()
       └─ RPC: registrar_recarga_proveedor_celular_completo(fecha, empleado_id, monto_virtual)
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
            ├─ INSERT recargas_virtuales (pagado=true, ganancia=monto*1%, created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS

            ── Modo con mini cierre (saldo_virtual_maquina ingresado y ventas > 0) ──
            ├─ Calcula: ventas_del_día = saldo_virtual_sistema - saldo_virtual_maquina
            ├─ Calcula: disponible = CAJA_BUS + ventas_del_día
            ├─ Valida: disponible >= monto (lanza EXCEPTION si no)
            ├─ INSERT recargas (snapshot/mini cierre): saldo_virtual_actual = saldo_virtual_maquina
            │    ON CONFLICT (turno_id, tipo_servicio_id) → acumula si ya hubo un mini cierre hoy
            ├─ INSERT operaciones_cajas INGRESO CAJA_BUS por ventas_del_día
            ├─ INSERT operaciones_cajas EGRESO CAJA_BUS por monto
            ├─ INSERT recargas_virtuales (pagado=true, ganancia=monto*1%, created_at=clock_timestamp())
            └─ UPDATE saldo CAJA_BUS → nunca queda negativa
```

> **Mini cierre:** cuando hay ventas del día sin cerrar, la función las registra como INGRESO en CAJA_BUS antes del EGRESO (depósito). Así CAJA_BUS siempre refleja la realidad y nunca queda negativa. El cierre diario (`ejecutar_cierre_diario`) detecta el mini cierre via `ON CONFLICT` y solo acumula las ventas restantes del resto del día.
>
> `clock_timestamp()` en `recargas_virtuales` garantiza que su `created_at` sea posterior al snapshot del mini cierre, para que `getSaldoVirtualActual` lo cuente correctamente.

### BUS — Liquidación mensual de ganancia

Al fin de cada mes el proveedor BUS acredita el 1% de las compras del mes anterior como saldo virtual:

```
recargas-virtuales.page.ts
  └─ gananciasService.calcularGananciaBusMesAnterior()
       → SUM(recargas_virtuales.ganancia WHERE tipo=BUS AND mes=anterior)
       → Si > 0: muestra botón "Liquidar Ganancia $X"

LiquidacionBusModalComponent
  └─ confirmar()
       ├─ registrarCompraSaldoBus(monto=montoAcreditado)  ← registra el saldo que acreditó el proveedor
       └─ cajasService.crearTransferencia(CAJA_BUS → CAJA_CHICA, monto=gananciaBusCalculada)
```

> `gananciasService.yaSeTransfirio()` verifica si ya existe una TRANSFERENCIA_SALIENTE con descripción `"Ganancia 1% YYYY-MM"` para evitar liquidar dos veces el mismo mes.

---

## Badge de notificaciones en Home

`gananciasService.verificarGananciasPendientes()` es llamado desde `home.page.ts` al cargar. Si hay ganancia BUS del mes anterior sin liquidar, muestra un badge en el ícono de recargas virtuales. El flujo:

```
home.page.ts → cargarDatos()
  └─ gananciasService.verificarGananciasPendientes()
       ├─ getMesAnterior() → 'YYYY-MM'
       ├─ yaSeTransfirio(mes) → revisa operaciones_cajas con descripción "Ganancia 1% YYYY-MM"
       └─ Si no se transfirió y ganancia > 0 → retorna GananciasPendientes
  └─ notificacionesPendientes = gananciasPendientes ? 1 : 0
```

---

## Funciones SQL

> 📄 `registrar_recarga_proveedor_celular_completo` → [sql/functions/registrar_recarga_proveedor_celular_completo.sql](sql/functions/registrar_recarga_proveedor_celular_completo.sql)

> 📄 `registrar_pago_proveedor_celular` → [sql/functions/registrar_pago_proveedor_celular.sql](sql/functions/registrar_pago_proveedor_celular.sql)

> 📄 `registrar_compra_saldo_bus` → [sql/functions/registrar_compra_saldo_bus.sql](sql/functions/registrar_compra_saldo_bus.sql)

---

## Notas de implementación

- `RecargasVirtualesService` usa `throw response.error` en métodos de lectura directa (`getPorcentajeComision`, `getSaldoVirtualActual`, `obtenerDeudasPendientesCelular`, etc.). Los callers tienen try/catch.
- `registrarRecargaProveedorCelularCompleto()` lanza `Error('respuesta vacía')` si `supabase.call()` retorna null. El `confirmar()` en `RegistrarRecargaModalComponent` tiene try/catch que lo captura y muestra `error.message`.
- El porcentaje de comisión (5% CELULAR, 1% BUS) viene de la tabla `tipos_servicio`, no está hardcodeado en el código.

---

## Estado del Proyecto

- ✅ Registro de recargas CELULAR (con deuda pendiente)
- ✅ Pago al proveedor CELULAR (selección múltiple)
- ✅ Compra de saldo BUS (modo básico y extendido)
- ✅ Liquidación mensual de ganancia BUS
- ✅ Historial de recargas por servicio
- ✅ Badge de notificación en Home cuando hay ganancia BUS pendiente
