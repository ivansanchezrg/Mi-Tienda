# Cierre Diario — Referencia Técnica (v4.9)

## 1. Arquitectura

### Tablas involucradas

| Tabla                | Rol                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `turnos_caja`        | Un turno por sesión de trabajo. El cierre cierra el turno automáticamente.                                     |
| `caja_fisica_diaria` | 1 registro por turno (`UNIQUE turno_id`). Guarda efectivo_recaudado y deficit_caja_chica.                      |
| `recargas`           | 1 registro por servicio por turno (`UNIQUE turno_id, tipo_servicio_id`). Guarda saldo_virtual antes y después. |
| `recargas_virtuales` | Recargas del proveedor (aumentan saldo virtual). Se filtran por `created_at > último_cierre_at`.               |
| `operaciones_cajas`  | Trazabilidad: cada movimiento contable con saldo anterior/posterior.                                           |
| `cajas`              | Saldos actuales de las 4 cajas (se actualizan al cierre).                                                      |
| `configuraciones`    | `fondo_fijo_diario` y `caja_chica_transferencia_diaria`. Fuente de verdad.                                     |

### Las 4 cajas y sus fundas físicas

Cada caja del sistema corresponde a un **sobre/funda físico** que el operador maneja de forma independiente. Este es el principio fundamental del modelo:

| Código         | UI      | Funda física | Qué contiene la funda                               | Qué recibe en el cierre del sistema                 |
| -------------- | ------- | ------------ | --------------------------------------------------- | --------------------------------------------------- |
| `CAJA`         | Tienda  | 💵 Tienda    | Efectivo de ventas generales de la tienda           | Sobrante tras fondo y transferencia a Varios        |
| `CAJA_CHICA`   | Varios  | 💼 Varios    | Efectivo para gastos menores                        | Transferencia fija diaria (máximo 1 vez por día)    |
| `CAJA_CELULAR` | Celular | 📱 Celular   | Efectivo cobrado a clientes por recargas de celular | Venta del turno (INGRESO)                           |
| `CAJA_BUS`     | Bus     | 🚌 Bus       | Efectivo cobrado a clientes por recargas de bus     | Venta del turno (INGRESO)                           |

> **Regla crítica:** el `efectivoRecaudado` del cierre es **únicamente el dinero de la funda Tienda**. El efectivo de celular y bus se cuenta y guarda en sus fundas separadas — si se mezclara, los saldos quedarían duplicados.

### Flujo del efectivo por funda

**Funda Tienda (`CAJA`):**
- Acumula ventas generales del turno.
- Al cierre se distribuye: `fondo_fijo` queda en la caja física, `transferencia_diaria` va a funda Varios, el sobrante va al depósito de Tienda.

**Funda Varios (`CAJA_CHICA`):**
- Recibe una transferencia fija diaria ($20) desde la funda Tienda, **máximo 1 vez por día** aunque haya varios turnos.
- Se usa para gastos menores de la tienda (insumos, servicios, etc.).

**Funda Celular (`CAJA_CELULAR`) — modelo crédito:**
- Cada venta de recarga celular: el cliente paga → efectivo va a la funda Celular.
- El cierre registra la `venta_celular` como INGRESO a `CAJA_CELULAR`.
- Periódicamente se paga al proveedor (95% de lo vendido) con el efectivo de esa funda, y el 5% de comisión se transfiere a funda Varios.

**Funda Bus (`CAJA_BUS`) — modelo depósito anticipado:**
- La empresa compra crédito virtual al proveedor **antes** de las ventas (EGRESO de funda Bus).
- Cada venta de recarga bus: el cliente paga → efectivo va a la funda Bus.
- El cierre registra la `venta_bus` como INGRESO a `CAJA_BUS`, reconciliando el depósito anticipado.
- Comisión del 1% mensual: el proveedor la acredita como crédito virtual extra.

---

## 2. Flujo del proceso

### Pre-condiciones (validadas en Home antes de navegar al cierre)

`TurnosCajaService.obtenerEstadoCaja()` devuelve uno de:

- `SIN_ABRIR` → sin turnos hoy
- `TURNO_EN_CURSO` → turno abierto (permite cierre)
- `CERRADA` → turno cerrado (ya se cerró el día)

Solo se puede llegar a la página de cierre desde `TURNO_EN_CURSO`. El turno activo se identifica por `hora_fecha_cierre IS NULL`.

### Datos que ingresa el usuario (Paso 1)

| Campo                      | Obligatorio | Descripción                                                                                                                                    |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `efectivoTotalRecaudado`   | Sí          | **Solo el efectivo de la funda Tienda** (caja física de tienda). ⚠️ NO incluir el efectivo de celular ni bus — esos van en fundas separadas. |
| `saldoVirtualCelularFinal` | Sí          | Saldo que muestra la app del proveedor de recargas celular en este momento.                                                                    |
| `saldoVirtualBusFinal`     | Sí          | Saldo que muestra la máquina de bus en este momento.                                                                                           |
| `observaciones`            | No          | Obligatorio usar si efectivo = $0. Describir el motivo.                                                                                        |

### Cálculo del saldo virtual actual (lo que el sistema espera encontrar)

Lo hace `RecargasVirtualesService.getSaldoVirtualActual()`:

```
saldo_actual = saldo_virtual_actual (último registro en `recargas`)
             + SUM(monto_virtual de `recargas_virtuales` con created_at > último_cierre_at)
```

> **Crítico:** se filtra por `created_at`, no por `fecha`. Una recarga del proveedor del día 21 puede aplicarse en el cierre del día 23 si no hubo cierre el 22.

### Cálculo de ventas del turno

```
venta_celular = saldo_virtual_actual_celular - saldo_celular_final_ingresado
venta_bus     = saldo_virtual_actual_bus     - saldo_bus_final_ingresado
```

Si cualquiera resulta **negativa**: falta registrar una recarga del proveedor en Recargas Virtuales. El botón "Siguiente" queda deshabilitado hasta corregirlo.

### Distribución de efectivo (v4.7)

> Este cálculo aplica **únicamente al efectivo de la funda Tienda**. Las fundas Celular y Bus no participan en esta distribución — cada una gestiona su propio efectivo.

Config: `fondo_fijo` = $40, `transferencia_diaria` = $20 (valores de ejemplo del negocio actual).

**Prioridades:** 1° fondo fijo → 2° funda Varios (todo o nada) → 3° funda Tienda (sobrante).

```
efectivo_disponible = efectivo_recaudado (funda Tienda) - fondo_fijo
```

| Caso                              | Condición                                                     | Funda Varios    | Funda Tienda                          | Déficit guardado               |
| --------------------------------- | ------------------------------------------------------------- | --------------- | ------------------------------------- | ------------------------------ |
| **Normal** (1er turno)            | `efectivo_disponible >= transferencia`                        | completo ($20)  | `efectivo_disponible - transferencia` | $0                             |
| **Déficit parcial**               | `0 < efectivo_disponible < transferencia`                     | $0              | `efectivo_disponible`                 | `transferencia`                |
| **Déficit total**                 | `efectivo_disponible < 0`                                     | $0              | $0                                    | `transferencia`                |
| **Sin efectivo**                  | `efectivo_recaudado == 0`                                     | $0              | $0                                    | `transferencia` (si 1er turno) |
| **2do turno del día**             | `transferencia_ya_hecha == true` (TRANSFERENCIA_ENTRANTE hoy) | $0 (ya recibió) | `efectivo_disponible`                 | $0                             |
| **Ajuste apertura hecho hoy**     | `transferencia_ya_hecha == true` (INGRESO IN-004 hoy)         | $0 (ya recibió) | `efectivo_disponible`                 | $0                             |

> **v4.9 — Ajuste de apertura como transferencia diaria:** Si al abrir caja se reparó el déficit de ayer (INGRESO IN-004 a Varios), ese ingreso **cuenta como la transferencia diaria de hoy**. El cierre del mismo día no intenta dar otro $20 a Varios. Esto evita duplicar el envío y mantiene la regla de 1 sola transferencia diaria a Varios.

El campo `deficit_caja_chica` se guarda en `caja_fisica_diaria` para que el siguiente turno pueda repararlo.

---

## 3. Función SQL: `ejecutar_cierre_diario`

> 📄 Código fuente completo: [`docs/sql/functions/ejecutar_cierre_diario.sql`](./sql/functions/ejecutar_cierre_diario.sql)

Llamada vía `supabase.rpc('ejecutar_cierre_diario', params)`. Todo ocurre en una transacción atómica — si falla cualquier paso, se hace rollback completo.

**Para actualizar la función en Supabase:**

- Si solo cambia el cuerpo → editá el `.sql` y ejecutalo directamente (`CREATE OR REPLACE` reemplaza sola).
- Si cambia la firma (parámetros o tipo de retorno) → descomentá el bloque `DROP` al inicio del `.sql`, ejecutalo, volvé a comentarlo y hacé commit.

### Firma

```typescript
// RecargasService.ejecutarCierreDiario(params)
{
  p_turno_id,                   // UUID del turno activo
  p_fecha,                      // fecha local (getFechaLocal(), NO toISOString())
  p_empleado_id,
  p_efectivo_recaudado,
  p_saldo_celular_final,
  p_saldo_bus_final,
  p_saldo_anterior_celular,     // último saldo_virtual_actual en tabla recargas
  p_saldo_anterior_bus,
  p_saldo_anterior_caja,        // saldo_actual de cada caja antes del cierre
  p_saldo_anterior_caja_chica,
  p_saldo_anterior_caja_celular,
  p_saldo_anterior_caja_bus,
  p_observaciones               // nullable
}
```

### Lo que ejecuta (en orden)

1. Valida el turno: existe, no tiene cierre previo, no está cerrado
2. Carga configuración (`fondo_fijo`, `transferencia_diaria`). Error si es NULL.
3. Obtiene `MAX(created_at)` de `caja_fisica_diaria` → filtra `recargas_virtuales` pendientes
4. Detecta si Varios ya recibió su transferencia diaria hoy (v4.9):

   ```sql
   SELECT EXISTS (
     SELECT 1 FROM operaciones_cajas oc
     WHERE oc.caja_id = v_caja_chica_id
       AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
       AND (
         oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'         -- cierre normal anterior
         OR (
           oc.tipo_operacion = 'INGRESO'
           AND EXISTS (
             SELECT 1 FROM categorias_operaciones co
             WHERE co.id = oc.categoria_id AND co.codigo = 'IN-004'
           )
         )                                                    -- ajuste de apertura hoy
       )
   )
   ```
5. Aplica distribución de efectivo (ver tabla §2)
6. `INSERT INTO caja_fisica_diaria` (turno_id, efectivo_recaudado, deficit_caja_chica)
7. `INSERT INTO recargas` × 2 (celular y bus, con venta_dia calculada)
8. `INSERT INTO operaciones_cajas` × 3 o 4 (CAJA: INGRESO, CAJA_CHICA: TRANSFERENCIA_ENTRANTE si aplica, CAJA_CELULAR: INGRESO, CAJA_BUS: INGRESO)
9. `UPDATE cajas` × 4 (saldo_actual de las 4 cajas)
10. `UPDATE turnos_caja SET hora_fecha_cierre = NOW()` — cierra el turno automáticamente
11. Retorna JSON con resultado

### Función auxiliar: `verificar_transferencia_caja_chica_hoy`

> 📄 Código fuente completo: [`docs/sql/functions/verificar_transferencia_caja_chica_hoy.sql`](./sql/functions/verificar_transferencia_caja_chica_hoy.sql)

Usada desde TypeScript en `siguientePaso()` para mostrar la UI correcta en Paso 2 **antes** de ejecutar el cierre:

```typescript
// RecargasService.verificarTransferenciaYaHecha()
await supabase.rpc('verificar_transferencia_caja_chica_hoy', { p_fecha: fechaHoy })
// → boolean
```

---

## 4. Caso especial: Depósito anticipado Bus

Cuando se registra una compra de saldo Bus con el parámetro `saldo_virtual_maquina` (ver `7_PROCESO_SALDO_VIRTUAL.md`), la función permite que `CAJA_BUS` quede **temporalmente negativa**. Esto ocurre porque se deposita el efectivo físico antes de registrar las ventas del turno.

El cierre lo corrige: suma la `venta_bus` a ese saldo negativo y deja la caja en positivo.

Detección en TypeScript:

```typescript
get tieneDepositoAnticipadoBus(): boolean {
  return this.saldoAnteriorCajaBus < 0;
}
```

Cuando es true, el Paso 2 muestra una card explicativa con compras, ventas y diferencia, para que el operador no confunda el negativo con un error.

---

## 5. Reparación de déficit (turno siguiente)

Al abrir caja, `TurnosCajaService.obtenerDeficitTurnoAnterior()` consulta el último registro de `caja_fisica_diaria` y devuelve:

```typescript
{
  deficitCajaChica: number,  // lo que faltó transferir a Varios
  fondoFaltante:    number,  // max(0, fondo_fijo - efectivo_recaudado_anterior)
  efectivoRecaudado: number
}
```

Si hay déficit, el Home muestra un banner y el usuario puede ejecutar la reparación. Esto llama a:

```typescript
// TurnosCajaService.repararDeficit(deficitCajaChica, fondoFaltante)
// → rpc('reparar_deficit_turno', { p_deficit_caja_chica, p_fondo_faltante, ... })
```

La función SQL usa categorías `EG-012` (egreso de Tienda) e `IN-004` (ingreso a Varios) y **sí valida que Tienda tenga saldo suficiente** — si no, retorna error con mensaje para el operador.

> **v4.9 — Efecto sobre el cierre del mismo día:** tras ejecutar `reparar_deficit_turno`, el INGRESO IN-004 queda registrado en `CAJA_CHICA` con la fecha local de hoy. Cuando ese día se ejecuta el cierre, `ejecutar_cierre_diario` detecta ese INGRESO y trata a Varios como "ya recibió hoy" → no registra `deficit_caja_chica` ni intenta otra transferencia.

---

## 6. Queries de auditoría

### Cierres del día con resultado

```sql
SELECT
  t.numero_turno,
  e.nombre AS empleado,
  t.hora_fecha_apertura,
  t.hora_fecha_cierre,
  cf.efectivo_recaudado,
  cf.deficit_caja_chica,
  (cf.efectivo_recaudado - c.fondo_fijo_diario - c.caja_chica_transferencia_diaria) AS deposito_tienda
FROM caja_fisica_diaria cf
JOIN turnos_caja t ON cf.turno_id = t.id
JOIN empleados e ON t.empleado_id = e.id
CROSS JOIN configuraciones c
WHERE cf.fecha = '2026-02-07'
ORDER BY t.numero_turno;
```

### Operaciones de un día por turno

```sql
SELECT
  t.numero_turno,
  e.nombre,
  ca.nombre AS caja,
  o.tipo_operacion,
  o.monto,
  o.saldo_anterior,
  o.saldo_actual
FROM operaciones_cajas o
JOIN cajas ca ON o.caja_id = ca.id
JOIN tipos_referencia tr ON o.tipo_referencia_id = tr.id
JOIN caja_fisica_diaria cf ON o.referencia_id = cf.id
JOIN turnos_caja t ON cf.turno_id = t.id
JOIN empleados e ON t.empleado_id = e.id
WHERE cf.fecha = '2026-02-07'
  AND tr.codigo = 'CAJA_FISICA_DIARIA'
ORDER BY t.numero_turno, o.fecha;
```

### Recargas virtuales por turno

```sql
SELECT
  t.numero_turno,
  ts.nombre AS servicio,
  r.saldo_virtual_anterior,
  r.venta_dia,
  r.saldo_virtual_actual,
  r.created_at
FROM recargas r
JOIN turnos_caja t ON r.turno_id = t.id
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
WHERE r.fecha = '2026-02-07'
ORDER BY r.created_at;
```

### Turnos del día con estado

```sql
SELECT
  t.numero_turno,
  e.nombre,
  t.hora_fecha_apertura,
  t.hora_fecha_cierre,
  CASE WHEN t.hora_fecha_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado,
  CASE WHEN cf.id IS NOT NULL THEN 'SÍ' ELSE 'NO' END AS tiene_cierre
FROM turnos_caja t
JOIN empleados e ON t.empleado_id = e.id
LEFT JOIN caja_fisica_diaria cf ON t.id = cf.turno_id
WHERE (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = '2026-02-07'
ORDER BY t.numero_turno;
```
