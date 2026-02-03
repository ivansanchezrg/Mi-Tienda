# Función PostgreSQL: ejecutar_cierre_diario

## Descripción

Función que ejecuta el cierre diario completo en una **transacción atómica**. Si alguna operación falla, PostgreSQL hace rollback automático de todas las operaciones, garantizando la consistencia de los datos.

## Características

- ✅ **Transacción atómica**: Todo o nada (rollback automático en caso de error)
- ✅ **Validación de duplicados**: Previene cierres duplicados para la misma fecha
- ✅ **6 operaciones en cajas**: Registra todas las operaciones del día (incluye CIERRE de turno)
- ✅ **2 registros de recargas**: Celular y Bus
- ✅ **4 actualizaciones de saldos**: Actualiza todas las cajas
- ✅ **Respuesta JSON**: Retorna información detallada del resultado

## Parámetros de Entrada

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `p_fecha` | DATE | Fecha del cierre (YYYY-MM-DD) |
| `p_empleado_id` | INTEGER | ID del empleado que realiza el cierre |
| `p_saldo_celular_final` | DECIMAL(12,2) | Saldo virtual final de celular |
| `p_saldo_bus_final` | DECIMAL(12,2) | Saldo virtual final de bus |
| `p_efectivo_recaudado` | DECIMAL(12,2) | Efectivo total recaudado del día |
| `p_saldo_anterior_celular` | DECIMAL(12,2) | Saldo virtual anterior de celular |
| `p_saldo_anterior_bus` | DECIMAL(12,2) | Saldo virtual anterior de bus |
| `p_saldo_anterior_caja` | DECIMAL(12,2) | Saldo anterior de CAJA principal |
| `p_saldo_anterior_caja_chica` | DECIMAL(12,2) | Saldo anterior de CAJA_CHICA |
| `p_saldo_anterior_caja_celular` | DECIMAL(12,2) | Saldo anterior de CAJA_CELULAR |
| `p_saldo_anterior_caja_bus` | DECIMAL(12,2) | Saldo anterior de CAJA_BUS |
| `p_observaciones` | TEXT | Observaciones opcionales del cierre |

## Valor de Retorno

Retorna un objeto JSON con la siguiente estructura:

```json
{
  "success": true,
  "mensaje": "Cierre diario ejecutado correctamente",
  "fecha": "2026-02-02",
  "ventas": {
    "celular": 59.15,
    "bus": 154.80,
    "efectivo": 500.00
  },
  "saldos_finales": {
    "caja": 480.00,
    "caja_chica": 20.00,
    "caja_celular": 218.35,
    "caja_bus": 419.65
  }
}
```

## Flujo de Ejecución

1. **Validación**: Verifica que no exista un cierre para la fecha especificada
2. **Obtención de IDs**: Obtiene IDs de tipos de servicio y cajas
3. **Tipos de Referencia**: Obtiene IDs de tipos_referencia (RECARGAS y CIERRES_DIARIOS)
4. **Configuración**: Obtiene monto de transferencia diaria a caja chica
5. **Cálculos**: Calcula ventas y saldos finales
6. **Cierre Diario**: Crea registro maestro en `cierres_diarios` y captura UUID
7. **Recargas**: Inserta 2 registros en tabla `recargas` y captura sus UUIDs
8. **Operaciones**: Inserta 6 registros en tabla `operaciones_cajas` con referencias (incluye CIERRE de turno)
9. **Actualización**: Actualiza saldos en tabla `cajas`
10. **Resultado**: Retorna JSON con información del cierre

Si **cualquier operación falla**, PostgreSQL hace **rollback automático** de todo.

### Trazabilidad Completa

**Operaciones de efectivo y transferencias:**
- Efectivo de ventas → Referencia a `cierres_diarios`
- Transferencias → Referencia a `cierres_diarios`

**Operaciones de recargas:**
- CAJA_CELULAR → Referencia a `recargas` (celular)
- CAJA_BUS → Referencia a `recargas` (bus)

**100% de operaciones rastreables a su origen.**

## Script SQL

```sql
-- ==========================================
-- FUNCIÓN: ejecutar_cierre_diario
-- ==========================================
-- Ejecuta el cierre diario completo en una transacción atómica
-- Si alguna operación falla, se hace rollback automático de todo
-- ==========================================

CREATE OR REPLACE FUNCTION ejecutar_cierre_diario(
  p_fecha DATE,
  p_empleado_id INTEGER,
  p_saldo_celular_final DECIMAL(12,2),
  p_saldo_bus_final DECIMAL(12,2),
  p_efectivo_recaudado DECIMAL(12,2),
  p_saldo_anterior_celular DECIMAL(12,2),
  p_saldo_anterior_bus DECIMAL(12,2),
  p_saldo_anterior_caja DECIMAL(12,2),
  p_saldo_anterior_caja_chica DECIMAL(12,2),
  p_saldo_anterior_caja_celular DECIMAL(12,2),
  p_saldo_anterior_caja_bus DECIMAL(12,2),
  p_observaciones TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo_celular_id INTEGER;
  v_tipo_bus_id INTEGER;
  v_caja_id INTEGER;
  v_caja_chica_id INTEGER;
  v_caja_celular_id INTEGER;
  v_caja_bus_id INTEGER;
  v_tipo_ref_recargas_id INTEGER;
  v_tipo_ref_cierres_id INTEGER;
  v_cierre_diario_id UUID;
  v_recarga_celular_id UUID;
  v_recarga_bus_id UUID;
  v_transferencia_diaria DECIMAL(12,2);
  v_venta_celular DECIMAL(12,2);
  v_venta_bus DECIMAL(12,2);
  v_saldo_final_caja DECIMAL(12,2);
  v_saldo_final_caja_chica DECIMAL(12,2);
  v_saldo_final_caja_celular DECIMAL(12,2);
  v_saldo_final_caja_bus DECIMAL(12,2);
  v_saldo_intermedio_caja DECIMAL(12,2);
  v_existe_cierre INTEGER;
BEGIN
  -- 1. Verificar si ya existe un cierre para esta fecha
  SELECT COUNT(*) INTO v_existe_cierre
  FROM recargas
  WHERE fecha = p_fecha;

  IF v_existe_cierre > 0 THEN
    RAISE EXCEPTION 'Ya existe un cierre registrado para la fecha %', p_fecha;
  END IF;

  -- 2. Obtener IDs de tipos de servicio
  SELECT id INTO v_tipo_celular_id FROM tipos_servicio WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_bus_id FROM tipos_servicio WHERE codigo = 'BUS';

  -- 3. Obtener IDs de cajas
  SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_caja_chica_id FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';

  -- 4. Obtener IDs de tipos de referencia para trazabilidad
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE codigo = 'RECARGAS';
  SELECT id INTO v_tipo_ref_cierres_id FROM tipos_referencia WHERE codigo = 'CIERRES_DIARIOS';

  -- 5. Obtener configuración de transferencia diaria
  SELECT caja_chica_transferencia_diaria INTO v_transferencia_diaria
  FROM configuraciones
  LIMIT 1;

  -- 6. Calcular ventas
  v_venta_celular := p_saldo_anterior_celular - p_saldo_celular_final;
  v_venta_bus := p_saldo_anterior_bus - p_saldo_bus_final;

  -- 7. Calcular saldos finales
  v_saldo_intermedio_caja := p_saldo_anterior_caja + p_efectivo_recaudado;
  v_saldo_final_caja := v_saldo_intermedio_caja - v_transferencia_diaria;
  v_saldo_final_caja_chica := p_saldo_anterior_caja_chica + v_transferencia_diaria;
  v_saldo_final_caja_celular := p_saldo_anterior_caja_celular + v_venta_celular;
  v_saldo_final_caja_bus := p_saldo_anterior_caja_bus + v_venta_bus;

  -- 8. Crear registro maestro del cierre diario
  INSERT INTO cierres_diarios (
    fecha, empleado_id, efectivo_recaudado, transferencia_caja_chica, observaciones
  ) VALUES (
    p_fecha, p_empleado_id, p_efectivo_recaudado, v_transferencia_diaria, p_observaciones
  ) RETURNING id INTO v_cierre_diario_id;

  -- 9. Insertar registros de recargas y capturar sus UUIDs para trazabilidad
  INSERT INTO recargas (
    fecha, tipo_servicio_id, empleado_id, venta_dia,
    saldo_virtual_anterior, saldo_virtual_actual, validado, observacion
  ) VALUES
  (p_fecha, v_tipo_celular_id, p_empleado_id, v_venta_celular,
   p_saldo_anterior_celular, p_saldo_celular_final, TRUE, p_observaciones)
  RETURNING id INTO v_recarga_celular_id;

  INSERT INTO recargas (
    fecha, tipo_servicio_id, empleado_id, venta_dia,
    saldo_virtual_anterior, saldo_virtual_actual, validado, observacion
  ) VALUES
  (p_fecha, v_tipo_bus_id, p_empleado_id, v_venta_bus,
   p_saldo_anterior_bus, p_saldo_bus_final, TRUE, p_observaciones)
  RETURNING id INTO v_recarga_bus_id;

  -- 10. Registrar operaciones en cajas con trazabilidad completa

  -- CAJA: INGRESO (efectivo recaudado) - Referencia al cierre diario
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion
  ) VALUES (
    v_caja_id, p_empleado_id, 'INGRESO', p_efectivo_recaudado,
    p_saldo_anterior_caja, v_saldo_intermedio_caja,
    v_tipo_ref_cierres_id, v_cierre_diario_id,
    'Efectivo de ventas de tienda'
  );

  -- CAJA: TRANSFERENCIA_SALIENTE (a caja chica) - Referencia al cierre diario
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion
  ) VALUES (
    v_caja_id, p_empleado_id, 'TRANSFERENCIA_SALIENTE', v_transferencia_diaria,
    v_saldo_intermedio_caja, v_saldo_final_caja,
    v_tipo_ref_cierres_id, v_cierre_diario_id,
    'Transferencia diaria a caja chica'
  );

  -- CAJA_CHICA: TRANSFERENCIA_ENTRANTE (desde caja principal) - Referencia al cierre diario
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion
  ) VALUES (
    v_caja_chica_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', v_transferencia_diaria,
    p_saldo_anterior_caja_chica, v_saldo_final_caja_chica,
    v_tipo_ref_cierres_id, v_cierre_diario_id,
    'Transferencia desde caja principal'
  );

  -- CAJA_CELULAR: INGRESO (venta de recargas) - Referencia al registro de recarga celular
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion
  ) VALUES (
    v_caja_celular_id, p_empleado_id, 'INGRESO', v_venta_celular,
    p_saldo_anterior_caja_celular, v_saldo_final_caja_celular,
    v_tipo_ref_recargas_id, v_recarga_celular_id,
    'Venta de recargas celular'
  );

  -- CAJA_BUS: INGRESO (venta de recargas) - Referencia al registro de recarga bus
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion
  ) VALUES (
    v_caja_bus_id, p_empleado_id, 'INGRESO', v_venta_bus,
    p_saldo_anterior_caja_bus, v_saldo_final_caja_bus,
    v_tipo_ref_recargas_id, v_recarga_bus_id,
    'Venta de recargas bus'
  );

  -- CAJA: CIERRE (cierre de turno) - Referencia al cierre diario
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion
  ) VALUES (
    v_caja_id, p_empleado_id, 'CIERRE', 0,
    v_saldo_final_caja, v_saldo_final_caja,
    v_tipo_ref_cierres_id, v_cierre_diario_id,
    'Cierre de turno'
  );

  -- 11. Actualizar saldos en cajas
  UPDATE cajas SET saldo_actual = v_saldo_final_caja, updated_at = NOW()
  WHERE id = v_caja_id;

  UPDATE cajas SET saldo_actual = v_saldo_final_caja_chica, updated_at = NOW()
  WHERE id = v_caja_chica_id;

  UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular, updated_at = NOW()
  WHERE id = v_caja_celular_id;

  UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  -- 12. Retornar resultado exitoso
  RETURN json_build_object(
    'success', TRUE,
    'mensaje', 'Cierre diario ejecutado correctamente',
    'fecha', p_fecha,
    'ventas', json_build_object(
      'celular', v_venta_celular,
      'bus', v_venta_bus,
      'efectivo', p_efectivo_recaudado
    ),
    'saldos_finales', json_build_object(
      'caja', v_saldo_final_caja,
      'caja_chica', v_saldo_final_caja_chica,
      'caja_celular', v_saldo_final_caja_celular,
      'caja_bus', v_saldo_final_caja_bus
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    -- En caso de error, PostgreSQL hace rollback automático
    RAISE EXCEPTION 'Error al ejecutar cierre diario: %', SQLERRM;
END;
$$;

-- Comentario de la función
COMMENT ON FUNCTION ejecutar_cierre_diario IS 'Ejecuta el cierre diario completo en una transacción atómica. Si alguna operación falla, se hace rollback automático de todas las operaciones.';
```

## Instrucciones de Instalación

1. Abre **Supabase** → **SQL Editor**
2. Copia el script SQL completo
3. Pégalo en el editor
4. Haz clic en **"Run"**
5. Verifica que se ejecute sin errores

## Ejemplo de Uso desde TypeScript

```typescript
// En RecargasService
async ejecutarCierreDiario(params: {
  fecha: string;
  empleado_id: number;
  saldo_celular_final: number;
  saldo_bus_final: number;
  efectivo_recaudado: number;
  saldo_anterior_celular: number;
  saldo_anterior_bus: number;
  saldo_anterior_caja: number;
  saldo_anterior_caja_chica: number;
  saldo_anterior_caja_celular: number;
  saldo_anterior_caja_bus: number;
  observaciones?: string;
}): Promise<any> {
  const resultado = await this.supabase.call(
    this.supabase.client.rpc('ejecutar_cierre_diario', {
      p_fecha: params.fecha,
      p_empleado_id: params.empleado_id,
      p_saldo_celular_final: params.saldo_celular_final,
      p_saldo_bus_final: params.saldo_bus_final,
      p_efectivo_recaudado: params.efectivo_recaudado,
      p_saldo_anterior_celular: params.saldo_anterior_celular,
      p_saldo_anterior_bus: params.saldo_anterior_bus,
      p_saldo_anterior_caja: params.saldo_anterior_caja,
      p_saldo_anterior_caja_chica: params.saldo_anterior_caja_chica,
      p_saldo_anterior_caja_celular: params.saldo_anterior_caja_celular,
      p_saldo_anterior_caja_bus: params.saldo_anterior_caja_bus,
      p_observaciones: params.observaciones || null
    })
  );

  return resultado;
}
```

## Manejo de Errores

Si ocurre un error, la función lanzará una excepción con el mensaje descriptivo:

```
Error al ejecutar cierre diario: [descripción del error]
```

PostgreSQL automáticamente hace **rollback de TODAS las operaciones**, garantizando que la base de datos quede en estado consistente.

## Ventajas sobre el Método Anterior

| Aspecto | Método Anterior | Con Función PostgreSQL |
|---------|----------------|------------------------|
| Transacciones | ❌ No | ✅ Sí (atómicas) |
| Rollback automático | ❌ No | ✅ Sí |
| Llamadas HTTP | 12+ llamadas | 1 sola llamada |
| Performance | Lento | Rápido |
| Consistencia | Riesgo alto | Garantizada |
| Seguridad | Media | Alta |
| Trazabilidad | ❌ No | ✅ Completa |

## Consultas de Trazabilidad

### Ver operaciones con su origen

```sql
SELECT
  o.fecha,
  c.nombre AS caja,
  o.tipo_operacion,
  o.monto,
  tr.tabla AS origen_tabla,
  o.referencia_id AS origen_registro_id,
  o.descripcion
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
LEFT JOIN tipos_referencia tr ON o.tipo_referencia_id = tr.id
WHERE DATE(o.fecha) = '2026-02-02'
ORDER BY o.fecha;
```

### Ver operaciones de una caja específica con detalle de recarga

```sql
SELECT
  o.fecha,
  o.tipo_operacion,
  o.monto,
  o.saldo_anterior,
  o.saldo_actual,
  tr.tabla,
  r.venta_dia AS venta_recarga,
  ts.nombre AS tipo_servicio
FROM operaciones_cajas o
LEFT JOIN tipos_referencia tr ON o.tipo_referencia_id = tr.id
LEFT JOIN recargas r ON o.referencia_id = r.id
LEFT JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
WHERE o.caja_id = (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR')
ORDER BY o.fecha DESC
LIMIT 10;
```

### Auditoría completa de un día

```sql
SELECT
  c.nombre AS caja,
  o.tipo_operacion,
  o.monto,
  CASE
    WHEN tr.tabla = 'recargas' THEN
      'Recarga: ' || ts.nombre || ' ($' || r.venta_dia || ')'
    ELSE 'Sin referencia'
  END AS origen,
  o.descripcion
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
LEFT JOIN tipos_referencia tr ON o.tipo_referencia_id = tr.id
LEFT JOIN recargas r ON o.referencia_id = r.id AND tr.tabla = 'recargas'
LEFT JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
WHERE DATE(o.fecha) = CURRENT_DATE
ORDER BY c.nombre, o.fecha;
```

## Archivos Relacionados

**Documentacion del Dashboard:**
- 📖 [Proceso de Cierre de Cajas](./proceso_cierre_cajas.md) - Documentacion completa del proceso de negocio
- 💻 [Dashboard README](./DASHBOARD-README.md) - Documentacion tecnica de componentes

**Base de Datos:**
- 🗄️ [Schema Completo](../../../../doc/schema_inicial_completo.sql) - Estructura de tablas e indices

---

**Fecha de creación:** 2026-02-02
**Última actualización:** 2026-02-02
**Versión:** 3.0 (con tabla cierres_diarios y trazabilidad 100%)
**Autor:** Sistema Mi Tienda
