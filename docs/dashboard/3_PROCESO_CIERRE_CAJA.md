# Cierre Diario — Referencia Técnica (v5.3 — 2026-03-12)

## 1. Arquitectura

### Tablas involucradas

| Tabla | Rol |
| --- | --- |
| `turnos_caja` | Un turno por sesión. El cierre escribe `hora_fecha_cierre = NOW()` y `fondo_cubierto`. |
| `recargas` | 1 registro por servicio por turno (`UNIQUE turno_id, tipo_servicio_id`). Guarda saldo_virtual antes y después. |
| `recargas_virtuales` | Recargas del proveedor. Se filtran por `created_at > último_cierre_at` para evitar duplicados entre turnos. |
| `operaciones_cajas` | Trazabilidad completa: cada movimiento contable con saldo anterior/posterior. |
| `cajas` | Saldos actuales de las 5 cajas. Se actualizan al cierre. |
| `configuraciones` | `fondo_fijo_diario` y `varios_transferencia_diaria`. Fuente de verdad. |

> **v5:** Las tablas `caja_fisica_diaria` y `gastos_diarios` fueron **eliminadas**. El cierre no escribe en `caja_fisica_diaria`. El turno cerrado se detecta por `hora_fecha_cierre IS NOT NULL` en `turnos_caja`. El déficit del turno queda registrado en `fondo_cubierto` (columna de `turnos_caja`).

### Las 5 cajas en v5

| Código | UI | Rol | Qué recibe en el cierre |
| --- | --- | --- | --- |
| `CAJA` | Tienda | Bóveda de depósitos acumulados | Sobrante del cajón (INGRESO) |
| `CAJA_CHICA` | Cajón | Efectivo del día: ventas POS + recargas manuales | Se vacía → queda en **$0 digital** |
| `VARIOS` | Varios | Fondo de emergencia para gastos imprevistos | Transferencia fija diaria desde el cajón |
| `CAJA_CELULAR` | Celular | Efectivo cobrado por recargas celular | Venta del turno (INGRESO) |
| `CAJA_BUS` | Bus | Efectivo cobrado por recargas de bus | Venta del turno (INGRESO) |

> **Flujo clave:** Las ventas POS en efectivo van automáticamente a `CAJA_CHICA` (trigger `trg_actualizar_caja_por_venta`). Al cierre, el empleado cuenta el físico del cajón; el sistema ajusta la diferencia y distribuye en cascada: `fondoFijo` queda físicamente en el cajón, `transferenciaDiaria` va a VARIOS, el resto a CAJA. El cajón queda en **$0 digital** (el fondo físico permanece en el cajón para el día siguiente).

---

## 2. Flujo del proceso (UI — wizard 2 pasos)

### Pre-condiciones (validadas en `onCerrarCaja()` antes de navegar)

`obtenerEstadoCaja()` devuelve uno de:

- `SIN_ABRIR` → sin turnos hoy
- `TURNO_EN_CURSO` → turno abierto (permite cierre)
- `CERRADA` → ya se cerró el día

`onCerrarCaja()` ejecuta las siguientes validaciones **en orden** antes de navegar a `/home/cierre-diario`:

| # | Validación | Resultado si falla |
| --- | --- | --- |
| 1 | `estadoCaja.estado === 'TURNO_EN_CURSO'` | Toast warning: "No hay un turno activo en este momento." |
| 2 | `existeCierreDiario()` — verifica en BD que no exista ya un cierre para este turno | Error de conexión → toast error. Cierre ya registrado → toast warning. |
| 3 | `turnoEmpleadoId === empleadoActualId` — el empleado logueado es quien abrió el turno | Error: "Solo [nombre] puede realizar el cierre de este turno." |

Solo si las 3 pasan → `router.navigate(['/home/cierre-diario'])` sin overlay activo (evita colisión con el ciclo de vida de `ionViewWillEnter`).

En `cargarDatosIniciales()` se carga en paralelo:
- Saldos virtuales actuales (CELULAR + BUS) desde `RecargasVirtualesService`
- Datos del cierre (saldos de cajas, fondo fijo) desde `RecargasService`
- Flag `transferenciaCajaChicaYaHecha` desde `RecargasService.verificarTransferenciaYaHecha()` — ver §4
- Saldos de CAJA y VARIOS para la verificación antes→después

---

### Paso 1 — Datos del Turno (3 inputs)

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `saldoVirtualCelularFinal` | Sí | Saldo que muestra la app del proveedor celular en este momento. |
| `saldoVirtualBusFinal` | Sí | Saldo que muestra la máquina de bus en este momento. |
| `efectivoFisico` | Sí | Total físico contado en el cajón, **incluyendo el fondo fijo**. Campo `.destacado`. |

**Feedback en tiempo real:**
- Ventas negativas → alerta roja; bloquea "Ver Resumen"
- Diferencia en conteo físico → alerta naranja (faltante) o azul (sobrante)
- Conteo exacto → alerta verde

**Cálculo de ventas:**
```
venta_celular = saldoActualCelular - saldoVirtualCelularFinal
venta_bus     = saldoActualBus     - saldoVirtualBusFinal
```

Venta negativa indica que falta registrar una recarga del proveedor en Recargas Virtuales.

**Referencia para el conteo físico:**
```
efectivoEsperado = saldoCajaChicaDigital + fondoFijo
diferencia       = efectivoFisico - efectivoEsperado
```

---

### Paso 2 — Resumen y Confirmación

Preview de distribución calculado en el frontend:

```
transferenciaVarios = efectivoFisico >= transferenciaDiaria ? transferenciaDiaria : 0
fondoEnCajon        = (efectivoFisico - transferenciaVarios) >= fondoFijo
depositoCaja        = efectivoFisico - transferenciaVarios - (fondoEnCajon ? fondoFijo : 0)
```

| Caso | VARIOS | `fondoFijo` | CAJA | Cajón digital |
| --- | --- | --- | --- | --- |
| Normal | `transferenciaDiaria` | queda | resto | $0 |
| Déficit fondo (`efectivo >= transferencia` pero no alcanza para fondo) | `transferenciaDiaria` | no queda | resto | $0 |
| Déficit total (`efectivo < transferencia`) | $0 | no queda | todo | $0 |
| 2° turno (VARIOS ya recibió hoy) | $0 (ya recibió) | queda si alcanza | resto | $0 |

**Secciones del Paso 2:**
1. Ventas del turno (celular y bus)
2. Distribución del cajón — desglose de efectivo con colores por estado
3. Alerta naranja si `hayDeficitPreview = true` (VARIOS no recibe hoy)
4. Verificación de saldos — todas las cajas con antes→después
5. Observaciones (opcional)
6. Botón "Cerrar Caja" — alert de confirmación antes de ejecutar

**Color del valor de VARIOS en la distribución:**
- Normal: neutro (sin clase especial)
- Déficit (VARIOS no recibe): naranja (`.deficit`)
- Ya recibió hoy (2° turno): gris (`.muted`)

---

## 3. Función SQL: `ejecutar_cierre_diario` (v5)

> 📄 Código fuente completo: [`docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql`](./sql/functions/fn_ejecutar_cierre_diario_v5.sql)

Llamada vía `supabase.rpc('ejecutar_cierre_diario', params)`. Todo en una transacción atómica.

### Firma

```typescript
// RecargasService.ejecutarCierreDiario(params)
{
  p_turno_id,                    // UUID del turno activo
  p_fecha,                       // fecha local (getFechaLocal(), NO toISOString())
  p_empleado_id,
  p_efectivo_fisico,             // efectivo contado físicamente en el cajón (incluye fondo)
  p_saldo_celular_final,
  p_saldo_bus_final,
  p_saldo_anterior_celular,      // último saldo_virtual_actual en tabla recargas
  p_saldo_anterior_bus,
  p_saldo_anterior_caja_celular,
  p_saldo_anterior_caja_bus,
  p_observaciones                // nullable
}
```

### Lo que ejecuta (en orden)

1. Valida: turno existe, no tiene `hora_fecha_cierre`, `p_efectivo_fisico >= 0`
2. Lee `fondo_fijo_diario` y `varios_transferencia_diaria` de `configuraciones`
3. Obtiene `MAX(hora_fecha_cierre)` de `turnos_caja` → filtra `recargas_virtuales` pendientes desde ese timestamp
4. Lee saldos actuales de `CAJA_CHICA`, `CAJA` y `VARIOS` con `FOR UPDATE` (lock de consistencia en las 3 cajas que cambian por el cierre)
5. **Detecta si VARIOS ya recibió su transferencia diaria hoy** — busca en `operaciones_cajas` para `p_fecha` cualquiera de:
   - `tipo_operacion = 'TRANSFERENCIA_ENTRANTE'` en VARIOS (cierre normal anterior)
   - `tipo_operacion = 'INGRESO'` + categoría `IN-004` en VARIOS (reparación de déficit al abrir)
6. Calcula distribución en cascada con prioridad **VARIOS → Fondo → CAJA** (ver §2)
7. Si diferencia de conteo ≠ 0 → `INSERT` ajuste (`INGRESO` o `EGRESO`) en `CAJA_CHICA` — categorías `IN-005` / `EG-013`
8. Si `v_dinero_a_depositar > 0` → `INSERT INGRESO` en CAJA (depósito del cajón)
9. Si `v_transferencia_efectiva > 0` → `INSERT TRANSFERENCIA_ENTRANTE` en VARIOS
10. `UPDATE cajas` × 3 — CAJA, VARIOS y CAJA_CHICA → $0 (actualizadas juntas en un bloque)
11. `INSERT INTO recargas` celular + si `venta_celular > 0` → `INSERT INGRESO` en `CAJA_CELULAR` + `UPDATE CAJA_CELULAR`
12. `INSERT INTO recargas` bus (con `ON CONFLICT` para mini cierre) + si `venta_bus > 0` → `INSERT INGRESO` en `CAJA_BUS` + `UPDATE CAJA_BUS`
13. `UPDATE turnos_caja SET hora_fecha_cierre = NOW(), fondo_cubierto = v_fondo_en_cajon`
14. Retorna JSON con resultado detallado (ver §3.1)

### 3.1 Retorno del cierre

```json
{
  "success": true,
  "turno_cerrado": true,
  "version": "5.0",
  "conteo_fisico": {
    "efectivo_fisico": 60.00,
    "saldo_digital_antes": 40.00,
    "efectivo_esperado": 60.00,
    "diferencia": 0,
    "ajuste_aplicado": false
  },
  "distribucion_efectivo": {
    "fondo_en_cajon": true,
    "transferencia_varios": 20.00,
    "deposito_tienda": 20.00,
    "deficit_varios": 0,
    "turno_con_deficit": false,
    "monto_reposicion_apertura": 0
  },
  "saldos_finales": {
    "caja_chica": 0,
    "caja": 1020.00,
    "varios": 120.00,
    "caja_celular": 45.00,
    "caja_bus": 30.00
  }
}
```

---

## 4. Verificación pre-cierre: `fn_verificar_transferencia_caja_chica_hoy` (v1.2)

> 📄 Código fuente: [`docs/dashboard/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql`](./sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql)

```typescript
await supabase.rpc('verificar_transferencia_caja_chica_hoy', { p_fecha: fechaHoy })
// → boolean: true si VARIOS ya recibió su transferencia hoy
```

Usada en `RecargasService.verificarTransferenciaYaHecha()` durante `cargarDatosIniciales()` del cierre.

**Cubre dos casos (v1.2):**
1. `TRANSFERENCIA_ENTRANTE` en VARIOS para `p_fecha` → cierre normal anterior del día
2. `INGRESO` categoría `IN-004` en VARIOS para `p_fecha` → reparación de déficit ejecutada al abrir hoy

Si retorna `true`, el cierre muestra `transferenciaCajaChicaYaHecha = true`: el valor de VARIOS en la distribución aparece como "$0.00 — ✅ Ya recibió hoy" en gris (`.muted`), y la alerta de déficit no se muestra.

> ⚠️ La función SQL en Supabase debe estar en versión **1.2** (incluye el `OR INGRESO IN-004`). Si está en v1.0 o v1.1 puede no detectar reparaciones como "ya recibidas" y mostrar déficit falsos.

---

## 5. Caso especial: depósito anticipado Bus

Cuando se registra una compra de saldo Bus con `saldo_virtual_maquina`, `CAJA_BUS` puede quedar **temporalmente negativa**. El cierre lo corrige sumando `venta_bus`.

Cuando `saldoCajaBus < 0`, el Paso 1 muestra una card explicativa para evitar confusión con un error.

---

## 6. Registro automático de faltante del empleado

> **Distinción clave:** el déficit de VARIOS y del fondo son **costos operacionales del negocio** — el cajón no alcanzó por el flujo del día, no porque el empleado haya tomado dinero. Estos NO generan deuda del empleado.

Lo que SÍ genera deuda es cuando el **conteo físico es menor que lo esperado** — el cajón tiene menos efectivo del que el sistema calcula que debería haber:

```
efectivo_esperado = saldo_digital + fondo_fijo
diferencia        = efectivo_fisico - efectivo_esperado
```

Si `diferencia < 0` (el empleado tiene menos efectivo del esperado), `fn_ejecutar_cierre_diario` inserta automáticamente un registro en `deudas_empleados`:

```sql
-- Dentro del bloque ELSIF v_diferencia < 0 (paso 7, ajuste de conteo)
INSERT INTO deudas_empleados (empleado_id, turno_id, fecha, monto_faltante, estado)
VALUES (p_empleado_id, p_turno_id, p_fecha, ABS(v_diferencia), 'PENDIENTE');
```

| Campo | Valor |
| --- | --- |
| `empleado_id` | El empleado que cerró |
| `monto_faltante` | `ABS(v_diferencia)` — cuánto faltó en el cajón |
| `estado` | `PENDIENTE` hasta que el empleado reponga el dinero |

**Cómo se salda:** el empleado entrega el efectivo (se registra un INGRESO manual en Cajón) y alguien marca la deuda como `SALDADA` desde la UI (módulo Reportes, pendiente de implementar). **No se salda automáticamente.**

---

## 8. Reparación de déficit (turno siguiente)

Cuando el cierre termina sin haber podido transferir a VARIOS (`deficit_varios > 0`), el déficit queda registrado implícitamente en `turnos_caja`:
- `fondo_cubierto = FALSE` si el efectivo no alcanzó ni para el fondo (déficit total)
- `fondo_cubierto = TRUE` si el fondo estuvo pero no alcanzó para VARIOS (déficit VARIOS)
- La ausencia de `TRANSFERENCIA_ENTRANTE` en VARIOS para esa fecha indica que no cobró

Al **abrir caja al día siguiente**, `TurnosCajaService.obtenerDeficitTurnoAnterior()` detecta esto y presenta el modal de reparación. Ver referencia completa en [`docs/dashboard/8_PROCESO_ABRIR_CAJA.md`](./8_PROCESO_ABRIR_CAJA.md) §4 y §5.

La función que ejecuta la reparación:

> 📄 [`docs/dashboard/sql/functions/fn_reparar_deficit_turno.sql`](./sql/functions/fn_reparar_deficit_turno.sql) — v1.4

En una transacción atómica:
1. **EGRESO** de CAJA por `deficitVarios + fondoFaltante` — categoría `EG-012`
2. **INGRESO** a VARIOS por `deficitVarios` (si > 0) — categoría `IN-004`
3. **INSERT** en `turnos_caja` — abre el nuevo turno

El INGRESO IN-004 es lo que tanto `fn_verificar_transferencia_caja_chica_hoy` como `obtenerDeficitTurnoAnterior()` detectan para no re-detectar el déficit el mismo día.

---

## 9. Queries de auditoría

### Turnos del día con estado

```sql
SELECT
  t.numero_turno,
  e.nombre,
  t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS apertura_local,
  t.hora_fecha_cierre   AT TIME ZONE 'America/Guayaquil' AS cierre_local,
  t.fondo_cubierto,
  CASE WHEN t.hora_fecha_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado
FROM turnos_caja t
JOIN usuarios e ON t.empleado_id = e.id
WHERE (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY t.numero_turno;
```

### Operaciones del cierre por turno

```sql
SELECT
  t.numero_turno,
  e.nombre AS empleado,
  c.nombre AS caja,
  oc.tipo_operacion,
  co.codigo AS categoria,
  oc.monto,
  oc.saldo_anterior,
  oc.saldo_actual,
  oc.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local
FROM operaciones_cajas oc
JOIN cajas c ON oc.caja_id = c.id
LEFT JOIN categorias_operaciones co ON oc.categoria_id = co.id
JOIN turnos_caja t ON oc.tipo_referencia_id IS NOT NULL -- filtra op con referencia al turno
JOIN usuarios e ON oc.empleado_id = e.id
WHERE (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY t.numero_turno, oc.fecha;
```

### Saldos de cajas actuales

```sql
SELECT codigo, nombre, saldo_actual
FROM cajas
ORDER BY CASE codigo
  WHEN 'CAJA'         THEN 1
  WHEN 'CAJA_CHICA'   THEN 2
  WHEN 'VARIOS'       THEN 3
  WHEN 'CAJA_CELULAR' THEN 4
  WHEN 'CAJA_BUS'     THEN 5
END;
```

### Verificar si VARIOS ya recibió hoy (debug)

```sql
-- Busca los dos tipos de operación que cuentan como "VARIOS ya cobró"
SELECT
  oc.tipo_operacion,
  co.codigo AS categoria,
  oc.monto,
  oc.descripcion,
  oc.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local
FROM operaciones_cajas oc
JOIN cajas c ON c.id = oc.caja_id AND c.codigo = 'VARIOS'
LEFT JOIN categorias_operaciones co ON co.id = oc.categoria_id
WHERE (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
  AND (
    oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
    OR (oc.tipo_operacion = 'INGRESO' AND co.codigo = 'IN-004')
  )
ORDER BY oc.fecha;
```

### Recargas del turno actual

```sql
SELECT
  ts.nombre AS servicio,
  r.saldo_virtual_anterior,
  r.venta_dia,
  r.saldo_virtual_actual
FROM recargas r
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
JOIN turnos_caja t ON r.turno_id = t.id
WHERE t.hora_fecha_cierre IS NULL
  AND (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE;
```
