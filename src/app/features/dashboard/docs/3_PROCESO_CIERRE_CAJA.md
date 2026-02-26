# Cierre Diario — Referencia Técnica (v4.7)

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

### Las 4 cajas

| Código         | UI      | Qué recibe en el cierre                                   |
| -------------- | ------- | --------------------------------------------------------- |
| `CAJA`         | Tienda  | Efectivo depositado (sobrante tras fondo y Varios)        |
| `CAJA_CHICA`   | Varios  | Transferencia fija diaria (máximo 1 vez por día — ver §3) |
| `CAJA_CELULAR` | Celular | Venta del turno de recargas celular                       |
| `CAJA_BUS`     | Bus     | Venta del turno de recargas bus                           |

---

## 2. Flujo del proceso

### Pre-condiciones (validadas en Home antes de navegar al cierre)

`TurnosCajaService.obtenerEstadoCaja()` devuelve uno de:

- `SIN_ABRIR` → sin turnos hoy
- `TURNO_EN_CURSO` → turno abierto (permite cierre)
- `CERRADA` → turno cerrado (ya se cerró el día)

Solo se puede llegar a la página de cierre desde `TURNO_EN_CURSO`. El turno activo se identifica por `hora_cierre IS NULL`.

### Datos que ingresa el usuario (Paso 1)

| Campo                      | Obligatorio | Descripción                                        |
| -------------------------- | ----------- | -------------------------------------------------- |
| `efectivoTotalRecaudado`   | Sí          | Todo el efectivo físico contado al final del turno |
| `saldoVirtualCelularFinal` | Sí          | Saldo que muestra la app de recargas celular ahora |
| `saldoVirtualBusFinal`     | Sí          | Saldo que muestra la máquina de bus ahora          |
| `observaciones`            | No          | Obligatorio usar si efectivo = $0                  |

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

Config: `fondo_fijo` = $40, `transferencia_diaria` = $20 (valores de ejemplo del negocio actual).

**Prioridades:** 1° fondo fijo → 2° Varios (todo o nada) → 3° Tienda (sobrante).

```
efectivo_disponible = efectivo_recaudado - fondo_fijo
```

| Caso                   | Condición                                 | Varios          | Tienda                                | Déficit guardado               |
| ---------------------- | ----------------------------------------- | --------------- | ------------------------------------- | ------------------------------ |
| **Normal** (1er turno) | `efectivo_disponible >= transferencia`    | completo        | `efectivo_disponible - transferencia` | $0                             |
| **Déficit parcial**    | `0 < efectivo_disponible < transferencia` | $0              | `efectivo_disponible`                 | `transferencia`                |
| **Déficit total**      | `efectivo_disponible <= 0`                | $0              | $0                                    | `transferencia`                |
| **Sin efectivo**       | `efectivo_recaudado == 0`                 | $0              | $0                                    | `transferencia` (si 1er turno) |
| **2do turno del día**  | `transferencia_ya_hecha == true`          | $0 (ya recibió) | `efectivo_disponible`                 | $0                             |

El campo `deficit_caja_chica` se guarda en `caja_fisica_diaria` para que el siguiente turno pueda repararlo.

---

## 3. Función SQL: `ejecutar_cierre_diario`

> 📄 Código fuente completo: [`docs/sql/ejecutar_cierre_diario.sql`](./sql/ejecutar_cierre_diario.sql)

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
4. Detecta si ya se transfirió a Varios hoy:
   
   ```sql
   SELECT EXISTS (
     SELECT 1 FROM operaciones_cajas
     WHERE caja_id = v_caja_chica_id
       AND tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
       AND (fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
   )
   ```
5. Aplica distribución de efectivo (ver tabla §2)
6. `INSERT INTO caja_fisica_diaria` (turno_id, efectivo_recaudado, deficit_caja_chica)
7. `INSERT INTO recargas` × 2 (celular y bus, con venta_dia calculada)
8. `INSERT INTO operaciones_cajas` × 3 o 4 (CAJA: INGRESO, CAJA_CHICA: TRANSFERENCIA_ENTRANTE si aplica, CAJA_CELULAR: INGRESO, CAJA_BUS: INGRESO)
9. `UPDATE cajas` × 4 (saldo_actual de las 4 cajas)
10. `UPDATE turnos_caja SET hora_cierre = NOW()` — cierra el turno automáticamente
11. Retorna JSON con resultado

### Función auxiliar: `verificar_transferencia_caja_chica_hoy`

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

La función SQL usa categorías `EG-012` (egreso de Tienda) e `IN-004` (ingreso a Varios) y **no valida saldo mínimo** en Tienda (el dinero existe físicamente aunque el saldo digital sea $0).

---

## 6. Queries de auditoría

### Cierres del día con resultado

```sql
SELECT
  t.numero_turno,
  e.nombre AS empleado,
  t.hora_apertura,
  t.hora_cierre,
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
  t.hora_apertura,
  t.hora_cierre,
  CASE WHEN t.hora_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado,
  CASE WHEN cf.id IS NOT NULL THEN 'SÍ' ELSE 'NO' END AS tiene_cierre
FROM turnos_caja t
JOIN empleados e ON t.empleado_id = e.id
LEFT JOIN caja_fisica_diaria cf ON t.id = cf.turno_id
WHERE t.fecha = '2026-02-07'
ORDER BY t.numero_turno;
```
