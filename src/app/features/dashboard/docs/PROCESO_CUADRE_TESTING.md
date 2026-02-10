# Cuadre con Registro en BD (Testing Temporal)

**Versión:** Testing 1.0
**Fecha:** 2026-02-09
**Estado:** TEMPORAL - Solo para verificar cálculos

---

## ⚠️ IMPORTANTE

Este proceso es **TEMPORAL** y solo para **TESTING**. Después de verificar que los cálculos son correctos, se debe revertir el Cuadre a su estado original (solo calculadora visual sin guardar en BD).

---

## 1. Propósito

Modificar temporalmente el **Cuadre de Caja** para que:
- ✅ Calcule las ventas (como ya lo hace)
- ✅ **ADEMÁS** guarde las recargas en la base de datos
- ✅ Actualice los saldos de las cajas virtuales (CAJA_CELULAR y CAJA_BUS)
- ✅ Cree operaciones de INGRESO en operaciones_cajas

Esto permite verificar que:
1. Los cálculos de venta son correctos
2. Las recargas se guardan bien en la tabla `recargas`
3. Los saldos de cajas se actualizan correctamente
4. Las operaciones se registran bien

---

## 2. Flujo del Proceso

```
Usuario en Cuadre de Caja
    ↓
Ingresa saldos actuales (Celular y Bus)
    ↓
Sistema calcula ventas (en memoria)
    ↓
Muestra resultado + botón "Confirmar Recargas"
    ↓
Usuario hace clic en "Confirmar Recargas"
    ↓
Sistema ejecuta función PostgreSQL
    ↓
Se guardan 2 recargas + 2 operaciones + actualizan 2 cajas
    ↓
Muestra confirmación y navega a Home
```

---

## 3. Operaciones de Base de Datos

### 3.1. Datos de Entrada

```typescript
interface ParamsCuadreTesting {
  fecha: string;                    // Fecha actual (YYYY-MM-DD)
  empleado_id: number;              // ID del empleado actual

  // Celular
  saldo_anterior_celular: number;   // Saldo anterior de celular
  saldo_actual_celular: number;     // Saldo actual ingresado
  venta_celular: number;            // Calculado: anterior - actual

  // Bus
  saldo_anterior_bus: number;       // Saldo anterior de bus
  saldo_actual_bus: number;         // Saldo actual ingresado
  venta_bus: number;                // Calculado: anterior - actual
}
```

### 3.2. Operaciones SQL

La función PostgreSQL debe ejecutar **6 operaciones en transacción**:

#### 1. Insertar recarga de CELULAR
```sql
INSERT INTO recargas (
  fecha,
  tipo_servicio_id,
  venta_dia,
  saldo_virtual_anterior,
  saldo_virtual_actual,
  empleado_id,
  validado
) VALUES (
  p_fecha,
  (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR'),
  p_venta_celular,  -- IMPORTANTE: Incluir venta_dia
  p_saldo_anterior_celular,
  p_saldo_actual_celular,
  p_empleado_id,
  (p_venta_celular + p_saldo_actual_celular) = p_saldo_anterior_celular  -- Validación
)
RETURNING id;  -- Necesitamos el ID para las operaciones
```

#### 2. Insertar recarga de BUS
```sql
INSERT INTO recargas (
  fecha,
  tipo_servicio_id,
  venta_dia,
  saldo_virtual_anterior,
  saldo_virtual_actual,
  empleado_id,
  validado
) VALUES (
  p_fecha,
  (SELECT id FROM tipos_servicio WHERE codigo = 'BUS'),
  p_venta_bus,  -- IMPORTANTE: Incluir venta_dia
  p_saldo_anterior_bus,
  p_saldo_actual_bus,
  p_empleado_id,
  (p_venta_bus + p_saldo_actual_bus) = p_saldo_anterior_bus  -- Validación
)
RETURNING id;  -- Necesitamos el ID para las operaciones
```

#### 3. Crear operación INGRESO para CAJA_CELULAR
```sql
-- IMPORTANTE: tipo_referencia_id debe ser 'RECARGAS' (no 'CAJA_FISICA_DIARIA')
-- IMPORTANTE: referencia_id debe ser el UUID de la recarga de celular
INSERT INTO operaciones_cajas (
  caja_id,
  tipo_operacion,
  monto,
  fecha,
  empleado_id,
  descripcion,
  saldo_anterior,
  saldo_actual,
  tipo_referencia_id,
  referencia_id
) VALUES (
  (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR'),
  'INGRESO',
  p_venta_celular,
  p_fecha,
  p_empleado_id,
  'Venta del día ' || p_fecha,
  (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CELULAR'),
  (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CELULAR') + p_venta_celular,
  (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'),
  v_recarga_celular_id  -- UUID de la recarga insertada
);
```

#### 4. Crear operación INGRESO para CAJA_BUS
```sql
-- IMPORTANTE: tipo_referencia_id debe ser 'RECARGAS' (no 'CAJA_FISICA_DIARIA')
-- IMPORTANTE: referencia_id debe ser el UUID de la recarga de bus
INSERT INTO operaciones_cajas (
  caja_id,
  tipo_operacion,
  monto,
  fecha,
  empleado_id,
  descripcion,
  saldo_anterior,
  saldo_actual,
  tipo_referencia_id,
  referencia_id
) VALUES (
  (SELECT id FROM cajas WHERE codigo = 'CAJA_BUS'),
  'INGRESO',
  p_venta_bus,
  p_fecha,
  p_empleado_id,
  'Venta del día ' || p_fecha,
  (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_BUS'),
  (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_BUS') + p_venta_bus,
  (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'),
  v_recarga_bus_id  -- UUID de la recarga insertada
);
```

#### 5. Actualizar saldo CAJA_CELULAR
```sql
UPDATE cajas
SET saldo_actual = saldo_actual + p_venta_celular,
    updated_at = NOW()
WHERE codigo = 'CAJA_CELULAR';
```

#### 6. Actualizar saldo CAJA_BUS
```sql
UPDATE cajas
SET saldo_actual = saldo_actual + p_venta_bus,
    updated_at = NOW()
WHERE codigo = 'CAJA_BUS';
```

---

## 4. Función PostgreSQL

**Nombre:** `registrar_recargas_testing`

**Ubicación:** `supabase/functions/registrar_recargas_testing.sql`

```sql
CREATE OR REPLACE FUNCTION registrar_recargas_testing(
  p_fecha DATE,
  p_empleado_id INTEGER,
  p_saldo_anterior_celular NUMERIC,
  p_saldo_actual_celular NUMERIC,
  p_venta_celular NUMERIC,
  p_saldo_anterior_bus NUMERIC,
  p_saldo_actual_bus NUMERIC,
  p_venta_bus NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo_celular_id INTEGER;
  v_tipo_bus_id INTEGER;
  v_tipo_ref_recargas_id INTEGER;
  v_caja_celular_id INTEGER;
  v_caja_bus_id INTEGER;
  v_recarga_celular_id UUID;
  v_recarga_bus_id UUID;
  v_saldo_celular_anterior NUMERIC;
  v_saldo_bus_anterior NUMERIC;
  v_saldo_celular_nuevo NUMERIC;
  v_saldo_bus_nuevo NUMERIC;
BEGIN
  -- Obtener IDs
  SELECT id INTO v_tipo_celular_id FROM tipos_servicio WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_bus_id FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE codigo = 'RECARGAS';
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';

  -- Validaciones
  IF v_tipo_celular_id IS NULL OR v_tipo_bus_id IS NULL THEN
    RAISE EXCEPTION 'Tipos de servicio no encontrados';
  END IF;

  IF v_caja_celular_id IS NULL OR v_caja_bus_id IS NULL THEN
    RAISE EXCEPTION 'Cajas no encontradas';
  END IF;

  IF p_venta_celular < 0 OR p_venta_bus < 0 THEN
    RAISE EXCEPTION 'Las ventas no pueden ser negativas';
  END IF;

  -- 1. Insertar recarga CELULAR
  INSERT INTO recargas (
    fecha, tipo_servicio_id, venta_dia, saldo_virtual_anterior,
    saldo_virtual_actual, empleado_id, validado
  )
  VALUES (
    p_fecha, v_tipo_celular_id, p_venta_celular, p_saldo_anterior_celular,
    p_saldo_actual_celular, p_empleado_id,
    (p_venta_celular + p_saldo_actual_celular) = p_saldo_anterior_celular
  )
  RETURNING id INTO v_recarga_celular_id;

  -- 2. Insertar recarga BUS
  INSERT INTO recargas (
    fecha, tipo_servicio_id, venta_dia, saldo_virtual_anterior,
    saldo_virtual_actual, empleado_id, validado
  )
  VALUES (
    p_fecha, v_tipo_bus_id, p_venta_bus, p_saldo_anterior_bus,
    p_saldo_actual_bus, p_empleado_id,
    (p_venta_bus + p_saldo_actual_bus) = p_saldo_anterior_bus
  )
  RETURNING id INTO v_recarga_bus_id;

  -- Obtener saldos anteriores y calcular nuevos
  SELECT saldo_actual INTO v_saldo_celular_anterior FROM cajas WHERE id = v_caja_celular_id;
  SELECT saldo_actual INTO v_saldo_bus_anterior FROM cajas WHERE id = v_caja_bus_id;

  v_saldo_celular_nuevo := v_saldo_celular_anterior + p_venta_celular;
  v_saldo_bus_nuevo := v_saldo_bus_anterior + p_venta_bus;

  -- 3. Crear operación CELULAR (referencia a recarga)
  INSERT INTO operaciones_cajas (
    caja_id, tipo_operacion, monto, fecha, empleado_id, descripcion,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id
  )
  VALUES (
    v_caja_celular_id, 'INGRESO', p_venta_celular, p_fecha, p_empleado_id,
    'Venta del día ' || p_fecha,
    v_saldo_celular_anterior, v_saldo_celular_nuevo,
    v_tipo_ref_recargas_id, v_recarga_celular_id
  );

  -- 4. Crear operación BUS (referencia a recarga)
  INSERT INTO operaciones_cajas (
    caja_id, tipo_operacion, monto, fecha, empleado_id, descripcion,
    saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id
  )
  VALUES (
    v_caja_bus_id, 'INGRESO', p_venta_bus, p_fecha, p_empleado_id,
    'Venta del día ' || p_fecha,
    v_saldo_bus_anterior, v_saldo_bus_nuevo,
    v_tipo_ref_recargas_id, v_recarga_bus_id
  );

  -- 5 y 6. Actualizar saldos
  UPDATE cajas SET saldo_actual = v_saldo_celular_nuevo, updated_at = NOW()
  WHERE id = v_caja_celular_id;

  UPDATE cajas SET saldo_actual = v_saldo_bus_nuevo, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  -- Retornar resultado
  RETURN json_build_object(
    'success', true,
    'message', 'Recargas registradas correctamente',
    'venta_celular', p_venta_celular,
    'venta_bus', p_venta_bus,
    'saldo_celular_nuevo', v_saldo_celular_nuevo,
    'saldo_bus_nuevo', v_saldo_bus_nuevo
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar recargas: %', SQLERRM;
END;
$$;
```

---

## 5. Cambios en el Frontend

### 5.1. HTML - Agregar Botón

En `cuadre-caja.page.html`, después del resultado:

```html
@if (mostrarResultado) {
  <ion-card class="result-card">
    <!-- ... resultado existente ... -->
  </ion-card>

  <!-- NUEVO: Botón de confirmación -->
  <button
    type="button"
    class="primary-btn"
    (click)="confirmarRecargas()">
    Confirmar Recargas (Testing)
  </button>
}
```

### 5.2. TypeScript - Agregar Método

En `cuadre-caja.page.ts`:

```typescript
async confirmarRecargas() {
  // Validar
  if (!this.mostrarResultado) {
    await this.ui.showError('Completa los campos primero');
    return;
  }

  // Confirmar con usuario
  const confirmar = await this.ui.showConfirm(
    'Confirmar Recargas',
    '¿Guardar estas recargas en la base de datos? (Testing)',
    'Confirmar',
    'Cancelar'
  );

  if (!confirmar) return;

  // Loading
  await this.ui.showLoading('Guardando recargas...');

  try {
    // Obtener empleado actual
    const empleado = await this.recargasService.obtenerEmpleadoActual();
    if (!empleado) {
      throw new Error('No se pudo obtener el empleado actual');
    }

    // Preparar parámetros
    const params = {
      fecha: this.recargasService.getFechaLocal(),
      empleado_id: empleado.id,
      saldo_anterior_celular: this.saldoAnteriorCelular,
      saldo_actual_celular: this.saldoCelularActual,
      venta_celular: this.ventaCelular,
      saldo_anterior_bus: this.saldoAnteriorBus,
      saldo_actual_bus: this.saldoBusActual,
      venta_bus: this.ventaBus
    };

    // Ejecutar función PostgreSQL
    const resultado = await this.recargasService.registrarRecargasTesting(params);

    await this.ui.hideLoading();
    await this.ui.showSuccess('Recargas guardadas correctamente');

    // Navegar a Home con refresh
    await this.router.navigate(['/home'], { queryParams: { refresh: true } });

  } catch (error) {
    console.error('Error al confirmar recargas:', error);
    await this.ui.hideLoading();
    await this.ui.showError('Error al guardar las recargas');
  }
}
```

### 5.3. Service - Agregar Método

En `recargas.service.ts`:

```typescript
/**
 * TEMPORAL: Registra recargas para testing (Cuadre con guardado en BD)
 * @param params Parámetros de las recargas
 */
async registrarRecargasTesting(params: any): Promise<any> {
  const resultado = await this.supabase.call(
    this.supabase.client.rpc('registrar_recargas_testing', {
      p_fecha: params.fecha,
      p_empleado_id: params.empleado_id,
      p_saldo_anterior_celular: params.saldo_anterior_celular,
      p_saldo_actual_celular: params.saldo_actual_celular,
      p_venta_celular: params.venta_celular,
      p_saldo_anterior_bus: params.saldo_anterior_bus,
      p_saldo_actual_bus: params.saldo_actual_bus,
      p_venta_bus: params.venta_bus
    })
  );

  return resultado;
}
```

---

## 6. Testing

### Escenario de Prueba

**Saldos anteriores:**
- Celular: $100.00
- Bus: $285.00

**Saldos actuales ingresados:**
- Celular: $75.00
- Bus: $250.00

**Ventas calculadas:**
- Celular: $25.00
- Bus: $35.00

**Resultado esperado en BD:**
1. ✅ 2 registros nuevos en `recargas`
2. ✅ 2 operaciones nuevas en `operaciones_cajas` (INGRESO)
3. ✅ Saldo CAJA_CELULAR aumenta en $25.00
4. ✅ Saldo CAJA_BUS aumenta en $35.00

### Verificación

```sql
-- Ver últimas recargas
SELECT * FROM recargas ORDER BY created_at DESC LIMIT 2;

-- Ver últimas operaciones
SELECT * FROM operaciones_cajas ORDER BY created_at DESC LIMIT 2;

-- Ver saldos actuales de cajas
SELECT codigo, saldo_actual FROM cajas
WHERE codigo IN ('CAJA_CELULAR', 'CAJA_BUS');
```

---

## 7. Reversión (Después del Testing)

Una vez verificado que todo funciona correctamente:

### 7.1. Eliminar del Frontend
- Eliminar botón "Confirmar Recargas" del HTML
- Eliminar método `confirmarRecargas()` del TypeScript

### 7.2. Mantener en Service (Comentado)
```typescript
/**
 * DESHABILITADO: Era solo para testing
 * async registrarRecargasTesting(params: any): Promise<any> { ... }
 */
```

### 7.3. Función PostgreSQL
- Dejar la función en Supabase (no la eliminamos, puede ser útil después)
- Agregar comentario: `-- FUNCIÓN DE TESTING - NO USAR EN PRODUCCIÓN`

---

## 8. Archivos Afectados

```
src/app/features/dashboard/
├── docs/
│   └── PROCESO_CUADRE_TESTING.md (NUEVO)
├── pages/
│   └── cuadre-caja/
│       ├── cuadre-caja.page.ts (MODIFICAR temporalmente)
│       └── cuadre-caja.page.html (MODIFICAR temporalmente)
└── services/
    └── recargas.service.ts (AGREGAR método temporal)

supabase/functions/
└── registrar_recargas_testing.sql (NUEVO)
```

---

## 9. Notas Importantes

⚠️ **Este proceso NO reemplaza el Cierre Diario**
- El Cierre Diario hace mucho más (fondo fijo, transferencias, caja principal, etc.)
- Este solo guarda recargas individuales
- Solo es para testing de cálculos

⚠️ **No usar en producción**
- Después del testing, revertir los cambios
- Dejar el Cuadre como calculadora visual (sin guardar en BD)

⚠️ **Atomicidad garantizada**
- La función PostgreSQL usa transacciones automáticas
- Si algo falla, todo se revierte (rollback)

---

**Autor:** Sistema Mi Tienda
**Versión:** Testing 1.0
**Fecha:** 2026-02-09
