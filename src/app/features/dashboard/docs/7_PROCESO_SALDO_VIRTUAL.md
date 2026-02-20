# PROCESO: Saldo Virtual (Recargas Virtuales)

**Versión:** 1.5
**Fecha:** 2026-02-20
**Módulo:** Saldo Virtual (`/home/recargas-virtuales`)

---

## 1. Conceptos Clave

### 1.1 Dos servicios, dos modelos de negocio distintos

|                    | CELULAR                              | BUS                          |
| ------------------ | ------------------------------------ | ---------------------------- |
| **Modelo**         | Crédito (a cuenta)                   | Compra directa               |
| **El proveedor**   | Acredita saldo → se le paga después  | Se deposita previamente      |
| **Flujo de caja**  | Sin movimiento inmediato             | EGRESO inmediato de CAJA_BUS |
| **Estado inicial** | `pagado = false`                     | `pagado = true`              |
| **Ganancia**       | `monto_virtual - monto_a_pagar` (5%) | 0 (precio exacto)            |

### 1.2 Tablas involucradas

| Tabla                | Propósito                                                              |
| -------------------- | ---------------------------------------------------------------------- |
| `recargas_virtuales` | Registra TODAS las cargas/compras de saldo virtual (CELULAR y BUS)     |
| `recargas`           | Snapshot del cierre diario — almacena `saldo_virtual_actual` al cerrar |
| `cajas`              | Saldos actuales de CAJA_CELULAR y CAJA_BUS                             |
| `operaciones_cajas`  | Historial de movimientos de efectivo en cada caja                      |
| `tipos_servicio`     | Configuración del servicio: código, `porcentaje_comision`              |

### 1.3 Cajas del módulo

- **CAJA_CELULAR**: acumula ingresos por ventas de recargas celulares (via cierre diario). Se descuenta cuando se paga al proveedor. La ganancia (5%) queda permanentemente en esta caja — es la diferencia entre lo vendido y lo pagado al proveedor.
- **CAJA_BUS**: acumula ingresos por ventas de recargas de bus. Se descuenta cuando se compra saldo al proveedor.

---

## 2. Fórmula de Comisión CELULAR

El proveedor acredita un monto virtual mayor al que se le paga. La diferencia es la ganancia del negocio.

```
monto_a_pagar = monto_virtual * (1 - comision / 100)
ganancia      = monto_virtual - monto_a_pagar
```

**Ejemplo con 5%:**

```
monto_virtual = 210.53
monto_a_pagar = 210.53 * 0.95 = 200.00   ← lo que se le paga al proveedor
ganancia      = 210.53 - 200.00 = 10.53   ← ganancia del negocio
```

> **IMPORTANTE:** La fórmula correcta es `* (1 - pct/100)` — descuento sobre el virtual.
> NO es `/ (1 + pct/100)` — eso daría un resultado incorrecto ($200.50 en vez de $200.00).

### 2.1 Porcentaje dinámico desde BD

El porcentaje NO está hardcodeado. Se lee de `tipos_servicio.porcentaje_comision` con código `'CELULAR'`.

```typescript
// recargas-virtuales.service.ts
async getPorcentajeComision(servicio: 'CELULAR' | 'BUS'): Promise<number> {
  const response = await this.supabase.client
    .from('tipos_servicio')
    .select('porcentaje_comision')
    .eq('codigo', servicio)
    .single();
  return response.data?.porcentaje_comision ?? 5;
}
```

---

## 3. Cálculo de Saldo Virtual Actual

### 3.1 El problema

El saldo virtual no se puede obtener solo de `recargas` (cierre diario), porque:

- Las cargas del proveedor van a `recargas_virtuales`, no a `recargas`.
- Entre cierres, el saldo aumenta cada vez que el proveedor carga.
- Si solo se lee `recargas`, el saldo no se actualiza hasta el próximo cierre.

### 3.2 La solución: fórmula en dos partes

```
saldo_actual = saldo_ultimo_cierre + SUM(recargas_virtuales.monto_virtual WHERE created_at > cierre.created_at)
```

1. **Último cierre**: `recargas.saldo_virtual_actual` del registro más reciente de ese servicio.
2. **Recargas posteriores**: suma de `recargas_virtuales.monto_virtual` registradas DESPUÉS del último cierre.

### 3.3 Por qué `created_at` y no `fecha`

- `fecha` es la **fecha de negocio** — puede ser de un día pasado (ej: registrar algo del día anterior).
- `created_at` es el **timestamp real de inserción** — indica si ya fue incorporado al cierre o no.
- Si se usara `fecha`, registros con fecha anterior al cierre pero insertados después se perderían.

### 3.4 Implementación en servicio

```typescript
// recargas-virtuales.service.ts
async getSaldoVirtualActual(servicio: 'CELULAR' | 'BUS'): Promise<number> {
  // 1. Último cierre diario
  const ultimoCierre = await this.supabase.client
    .from('recargas')
    .select('saldo_virtual_actual, created_at, tipos_servicio!inner(codigo)')
    .eq('tipos_servicio.codigo', servicio)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultimoCierre.error) throw ultimoCierre.error;
  const saldoCierre: number = ultimoCierre.data?.saldo_virtual_actual ?? 0;
  const fechaUltimoCierre: string | null = ultimoCierre.data?.created_at ?? null;

  // 2. Recargas registradas DESPUÉS del último cierre (no incorporadas aún)
  let query = this.supabase.client
    .from('recargas_virtuales')
    .select('monto_virtual, tipos_servicio!inner(codigo)')
    .eq('tipos_servicio.codigo', servicio);

  if (fechaUltimoCierre) {
    query = query.gt('created_at', fechaUltimoCierre);
  }

  const recargasNuevas = await query;
  if (recargasNuevas.error) throw recargasNuevas.error;

  const sumaNueva: number = (recargasNuevas.data ?? [])
    .reduce((acc: number, r: any) => acc + Number(r.monto_virtual), 0);

  return saldoCierre + sumaNueva;
}
```

---

## 4. Flujos de Negocio

### 4.1 Flujo CELULAR — Carga del Proveedor (v2.0 - Solo crea deuda)

**Cuándo ocurre:** El proveedor acredita saldo virtual a crédito (se paga después).

```
Usuario registra monto virtual
        ↓
registrar_recarga_proveedor_celular_completo(fecha, empleado_id, monto_virtual)
        ↓
[TRANSACCIÓN ATÓMICA - TODO O NADA]
├─ Calcula: monto_a_pagar = monto_virtual * 0.95
│           ganancia      = monto_virtual - monto_a_pagar
├─ INSERT en recargas_virtuales (pagado = false)
├─ CALCULAR saldo_virtual_actual
└─ OBTENER deudas_pendientes
        ↓
Retorna JSON completo:
  - recarga_id, monto_virtual, monto_a_pagar, ganancia
  - saldo_virtual_celular (calculado)
  - deudas_pendientes: { cantidad, total, lista }
```

**Efecto:**

- ✅ Crea la deuda en `recargas_virtuales` (pagado = false)
- ✅ NO mueve efectivo de CAJA_CELULAR (no hay saldo que mover aún)
- ✅ Retorna saldo virtual actualizado y lista de deudas
- ✅ Rollback automático si falla cualquier paso

**¿Dónde queda la ganancia?**

La ganancia NO se transfiere a ninguna caja en este momento. El ciclo completo es:

```
1. Proveedor carga $210.53 virtual → recargas_virtuales (pagado=false, ganancia=$10.53)
2. Día a día: vendes recargas → Cierre Diario → CAJA_CELULAR += ventas del día
3. Pagas al proveedor $200.00 → CAJA_CELULAR -= $200.00
4. Resultado: CAJA_CELULAR retiene $10.53 = ganancia acumulada
```

La ganancia es simplemente el **saldo que queda en CAJA_CELULAR** después de pagar al proveedor. La dueña decide cuándo y cuánto retirar.

---

### 4.2 Flujo CELULAR — Pago al Proveedor (v2.0 - Con transferencia de ganancia)

**Cuándo ocurre:** Se paga al proveedor lo que se le debe.

```
Usuario selecciona una o más deudas (pagado = false)
        ↓
registrar_pago_proveedor_celular(empleado_id, deuda_ids[], notas)
        ↓
Valida: deudas existen, son CELULAR, no están pagadas
Calcula: total_a_pagar = SUM(monto_a_pagar) de las deudas seleccionadas
Calcula: total_ganancia = SUM(ganancia) de las deudas seleccionadas (de recargas_virtuales.ganancia)
Valida: CAJA_CELULAR tiene saldo >= total_a_pagar + total_ganancia
        ↓
INSERT en operaciones_cajas (EGRESO, CAJA_CELULAR)          ← pago al proveedor
INSERT en operaciones_cajas (TRANSFERENCIA_SALIENTE, CAJA_CELULAR)  ← ganancia sale
INSERT en operaciones_cajas (TRANSFERENCIA_ENTRANTE, CAJA_CHICA)    ← ganancia entra
UPDATE recargas_virtuales SET pagado=true, fecha_pago, operacion_pago_id
UPDATE cajas CAJA_CELULAR: saldo -= (total_a_pagar + total_ganancia)
UPDATE cajas CAJA_CHICA:   saldo += total_ganancia
        ↓
Retorna: operacion_id, deudas_pagadas, total_pagado, total_ganancia,
         saldo_celular_anterior, saldo_celular_nuevo,
         saldo_chica_anterior, saldo_chica_nuevo
```

**Efecto:** Descuenta `total_a_pagar + total_ganancia` de CAJA_CELULAR. Transfiere `total_ganancia` a CAJA_CHICA. Cierra las deudas seleccionadas.

**¿Por qué la ganancia se mueve aquí y no al crear la deuda?**

La ganancia NO existe como efectivo hasta que se cobra a los clientes (via cierre diario → CAJA_CELULAR). Al momento de registrar la deuda con el proveedor, CAJA_CELULAR puede estar en $0. Solo después de varios cierres diarios, CAJA_CELULAR acumula lo suficiente para: pagar al proveedor + transferir la ganancia.

---

### 4.3 Flujo BUS — Compra de Saldo

**Cuándo ocurre:** Se realizó un depósito bancario al proveedor de bus para comprar saldo.

```
Usuario registra monto depositado (+ notas opcionales)
        ↓
registrar_compra_saldo_bus(fecha, empleado_id, monto, notas)
        ↓
Valida: CAJA_BUS tiene saldo suficiente
        ↓
INSERT en recargas_virtuales (pagado = true, monto_a_pagar = monto, ganancia = monto * 1%)
INSERT en operaciones_cajas (EGRESO, CAJA_BUS)
UPDATE cajas SET saldo_actual = saldo_anterior - monto (CAJA_BUS)
        ↓
Retorna: recarga_id, operacion_id, monto, saldo_anterior, saldo_nuevo
```

**Efecto:** Descuenta `monto` de CAJA_BUS inmediatamente. No queda deuda pendiente.

---

## 5. Frontend (Angular)

### 5.1 Servicio Principal

**Archivo:** `src/app/features/dashboard/services/recargas-virtuales.service.ts`

| Método                                             | Propósito                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `getPorcentajeComision(servicio)`                  | Lee comisión desde `tipos_servicio`                                                    |
| `getSaldoVirtualActual(servicio)`                  | Calcula saldo = cierre + recargas post-cierre                                          |
| `getSaldoCajaActual(codigoCaja)`                   | Lee saldo de cualquier caja                                                            |
| `obtenerDeudasPendientesCelular()`                 | Lista recargas con `pagado=false` de CELULAR                                           |
| `obtenerHistorial(servicio)`                       | Últimas 50 recargas virtuales del servicio                                             |
| `registrarRecargaProveedorCelularCompleto(params)` | Llama RPC `registrar_recarga_proveedor_celular_completo` (transaccional, retorna todo) |
| `registrarPagoProveedorCelular(params)`            | Llama RPC `registrar_pago_proveedor_celular`                                           |
| `registrarCompraSaldoBus(params)`                  | Llama RPC `registrar_compra_saldo_bus`                                                 |
| `obtenerEmpleadoActual()`                          | Obtiene empleado por email de sesión activa                                            |
| `getFechaLocal()`                                  | Fecha local en formato `YYYY-MM-DD` (nunca UTC)                                        |

### 5.2 Modales

#### RegistrarRecargaModalComponent

- **Archivo:** `components/registrar-recarga-modal/registrar-recarga-modal.component.ts`
- **Uso:** Un solo modal para CELULAR y BUS
- **Input:** `@Input() tipo: 'CELULAR' | 'BUS'`
- **CELULAR:** Muestra preview de monto a pagar y ganancia (con `comisionPct` dinámico desde BD)
- **BUS:** Muestra monto y ganancia estimada (1% del monto, que el proveedor liquidará al fin del mes)

#### PagarDeudasModalComponent

- **Uso:** Solo CELULAR — pagar deudas pendientes al proveedor
- **Funcionalidad:** Lista deudas con `pagado=false`, permite selección múltiple, calcula total
- **Acción:** Llama `registrarPagoProveedorCelular()` con los IDs seleccionados

#### HistorialModalComponent

- **Uso:** Ver historial de recargas virtuales por servicio
- **Datos:** Últimas 50 recargas de `recargas_virtuales` (todas, pagadas y pendientes)

### 5.3 Pantalla Principal

**Archivo:** `src/app/features/dashboard/pages/recargas-virtuales/recargas-virtuales.page.ts`

Muestra para cada servicio (CELULAR / BUS):

- Saldo virtual actual (calculado con `getSaldoVirtualActual()`)
- Saldo de caja (CAJA_CELULAR / CAJA_BUS)
- Deudas pendientes CELULAR (si aplica)
- Botones para abrir modales

### 5.4 Notificación en campana del Home

Cuando existen deudas pendientes con el proveedor CELULAR, el home las refleja en la campana del header (badge numérico rojo estilo Facebook).

**Archivo:** `src/app/features/dashboard/pages/home/home.page.ts`

- `cargarDatos()` llama `obtenerDeudasPendientesCelular()` en el `Promise.all` inicial
- Si `deudasPendientes.length > 0` → se muestra el badge con el número de deudas
- Al tocar la campana → `NotificacionesModalComponent` muestra: cantidad, total en $ y botón para ir a Recargas Virtuales
- Al pagar las deudas y volver al home, el pull-to-refresh actualiza y desaparece el badge

---

## 6. Funciones SQL

### 6.1 `registrar_pago_proveedor_celular`

Registra el pago al proveedor CELULAR de forma atómica: marca deudas como pagadas, descuenta de CAJA_CELULAR y transfiere la ganancia acumulada a CAJA_CHICA.

```sql
-- ==========================================
-- FUNCIÓN: registrar_pago_proveedor_celular
-- VERSIÓN: 2.0
-- FECHA: 2026-02-20
-- ==========================================
-- Registra el pago al proveedor CELULAR de forma atómica:
--   1. Valida deudas y calcula totales (monto_a_pagar + ganancia)
--   2. Crea EGRESO en operaciones_cajas (CAJA_CELULAR) — pago al proveedor
--   3. Crea TRANSFERENCIA_SALIENTE en CAJA_CELULAR — ganancia sale
--   4. Crea TRANSFERENCIA_ENTRANTE en CAJA_CHICA — ganancia entra
--   5. Marca deudas como pagadas
--   6. Actualiza saldo CAJA_CELULAR (saldo -= monto_a_pagar + ganancia)
--   7. Actualiza saldo CAJA_CHICA (saldo += ganancia)
--
-- La ganancia (v_total_ganancia) se obtiene de recargas_virtuales.ganancia
-- de cada deuda — NO es un valor hardcodeado.
--
-- Parámetros:
--   p_empleado_id   INT      Empleado que registra el pago
--   p_deuda_ids     UUID[]   Array de IDs de recargas_virtuales a pagar
--   p_notas         TEXT     Notas opcionales del pago
-- ==========================================

DROP FUNCTION IF EXISTS registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT);

CREATE OR REPLACE FUNCTION registrar_pago_proveedor_celular(
  p_empleado_id  INTEGER,
  p_deuda_ids    UUID[],
  p_notas        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_celular_id        INTEGER;
  v_caja_chica_id          INTEGER;
  v_tipo_ref_id            INTEGER;
  v_categoria_eg010_id     INTEGER;
  v_categoria_tr_id        INTEGER;
  v_total_a_pagar          NUMERIC;
  v_total_ganancia         NUMERIC;
  v_total_egreso           NUMERIC;
  v_saldo_celular_ant      NUMERIC;
  v_saldo_celular_nuevo    NUMERIC;
  v_saldo_chica_ant        NUMERIC;
  v_saldo_chica_nuevo      NUMERIC;
  v_operacion_pago_id      UUID;
  v_operacion_sal_id       UUID;
  v_operacion_ent_id       UUID;
  v_fecha_hoy              DATE;
  v_deudas_count           INTEGER;
BEGIN
  v_fecha_hoy := CURRENT_DATE;

  -- ==========================================
  -- 1. OBTENER IDs NECESARIOS
  -- ==========================================
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_chica_id   FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_tipo_ref_id     FROM tipos_referencia WHERE codigo = 'RECARGAS_VIRTUALES';
  SELECT id INTO v_categoria_eg010_id FROM categorias_operaciones WHERE codigo = 'EG-010';
  SELECT id INTO v_categoria_tr_id    FROM categorias_operaciones WHERE codigo = 'TR-001';

  IF v_caja_celular_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CELULAR no encontrada';
  END IF;

  IF v_caja_chica_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CHICA no encontrada';
  END IF;

  -- ==========================================
  -- 2. VALIDAR DEUDAS
  -- ==========================================
  SELECT COUNT(*) INTO v_deudas_count
  FROM recargas_virtuales
  WHERE id = ANY(p_deuda_ids)
    AND pagado = false
    AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR');

  IF v_deudas_count != array_length(p_deuda_ids, 1) THEN
    RAISE EXCEPTION 'Algunas deudas no existen, ya están pagadas o no son de tipo CELULAR';
  END IF;

  -- ==========================================
  -- 3. CALCULAR TOTALES DESDE LAS DEUDAS
  -- Los valores vienen de recargas_virtuales — NO son hardcodeados
  -- ==========================================
  SELECT
    COALESCE(SUM(monto_a_pagar), 0),
    COALESCE(SUM(ganancia), 0)
  INTO v_total_a_pagar, v_total_ganancia
  FROM recargas_virtuales
  WHERE id = ANY(p_deuda_ids);

  IF v_total_a_pagar <= 0 THEN
    RAISE EXCEPTION 'El total a pagar debe ser mayor a cero';
  END IF;

  -- Total que debe salir de CAJA_CELULAR = pago al proveedor + ganancia a transferir
  v_total_egreso := v_total_a_pagar + v_total_ganancia;

  -- ==========================================
  -- 4. VALIDAR SALDO CAJA_CELULAR
  -- ==========================================
  SELECT saldo_actual INTO v_saldo_celular_ant
  FROM cajas WHERE id = v_caja_celular_id;

  IF v_saldo_celular_ant < v_total_egreso THEN
    RAISE EXCEPTION 'Saldo insuficiente en CAJA_CELULAR. Disponible: $%, Requerido: $% (pago: $% + ganancia: $%)',
      v_saldo_celular_ant, v_total_egreso, v_total_a_pagar, v_total_ganancia;
  END IF;

  SELECT saldo_actual INTO v_saldo_chica_ant
  FROM cajas WHERE id = v_caja_chica_id;

  -- ==========================================
  -- 5. CALCULAR SALDOS NUEVOS
  -- ==========================================
  v_saldo_celular_nuevo := v_saldo_celular_ant - v_total_egreso;
  v_saldo_chica_nuevo   := v_saldo_chica_ant + v_total_ganancia;

  v_operacion_pago_id := gen_random_uuid();
  v_operacion_sal_id  := gen_random_uuid();
  v_operacion_ent_id  := gen_random_uuid();

  -- ==========================================
  -- 6. EGRESO: Pago al proveedor (CAJA_CELULAR)
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id,
    descripcion, created_at
  ) VALUES (
    v_operacion_pago_id, NOW(), v_caja_celular_id, p_empleado_id,
    'EGRESO', v_total_a_pagar,
    v_saldo_celular_ant, v_saldo_celular_ant - v_total_a_pagar,
    v_categoria_eg010_id, v_tipo_ref_id,
    COALESCE(p_notas, 'Pago al proveedor celular — ' || array_length(p_deuda_ids, 1) || ' deuda(s)'),
    NOW()
  );

  -- ==========================================
  -- 7. TRANSFERENCIA_SALIENTE: Ganancia sale de CAJA_CELULAR
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id,
    descripcion, created_at
  ) VALUES (
    v_operacion_sal_id, NOW(), v_caja_celular_id, p_empleado_id,
    'TRANSFERENCIA_SALIENTE', v_total_ganancia,
    v_saldo_celular_ant - v_total_a_pagar, v_saldo_celular_nuevo,
    v_categoria_tr_id, v_tipo_ref_id,
    'Ganancia celular → Caja Chica',
    NOW()
  );

  -- ==========================================
  -- 8. TRANSFERENCIA_ENTRANTE: Ganancia entra a CAJA_CHICA
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id,
    descripcion, created_at
  ) VALUES (
    v_operacion_ent_id, NOW(), v_caja_chica_id, p_empleado_id,
    'TRANSFERENCIA_ENTRANTE', v_total_ganancia,
    v_saldo_chica_ant, v_saldo_chica_nuevo,
    v_categoria_tr_id, v_tipo_ref_id,
    'Ganancia celular recibida desde Caja Celular',
    NOW()
  );

  -- ==========================================
  -- 9. MARCAR DEUDAS COMO PAGADAS
  -- ==========================================
  UPDATE recargas_virtuales
  SET pagado            = true,
      fecha_pago        = v_fecha_hoy,
      operacion_pago_id = v_operacion_pago_id
  WHERE id = ANY(p_deuda_ids);

  -- ==========================================
  -- 10. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================
  UPDATE cajas
  SET saldo_actual = v_saldo_celular_nuevo, updated_at = NOW()
  WHERE id = v_caja_celular_id;

  UPDATE cajas
  SET saldo_actual = v_saldo_chica_nuevo, updated_at = NOW()
  WHERE id = v_caja_chica_id;

  -- ==========================================
  -- 11. RETORNAR RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',               true,
    'operacion_pago_id',     v_operacion_pago_id,
    'deudas_pagadas',        array_length(p_deuda_ids, 1),
    'total_pagado',          v_total_a_pagar,
    'total_ganancia',        v_total_ganancia,
    'saldo_celular_anterior', v_saldo_celular_ant,
    'saldo_celular_nuevo',   v_saldo_celular_nuevo,
    'saldo_chica_anterior',  v_saldo_chica_ant,
    'saldo_chica_nuevo',     v_saldo_chica_nuevo,
    'message',               'Pago registrado: $' || v_total_a_pagar || ' — Ganancia $' || v_total_ganancia || ' transferida a Caja Chica'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar pago proveedor celular: %', SQLERRM;
END;
$$;

-- ==========================================
-- COMENTARIOS Y PERMISOS
-- ==========================================

COMMENT ON FUNCTION registrar_pago_proveedor_celular IS
'v2.0 - Registra pago al proveedor CELULAR. Crea EGRESO en CAJA_CELULAR (monto_a_pagar)
y transfiere la ganancia acumulada (de recargas_virtuales.ganancia) a CAJA_CHICA.
Ganancia NO hardcodeada: se lee de cada deuda seleccionada.';

GRANT EXECUTE ON FUNCTION registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
```

---

### 6.2 `registrar_compra_saldo_bus`

Registra la compra de saldo virtual BUS (compra directa con depósito bancario). El efectivo ya salió, por eso se crea EGRESO inmediato. Calcula y guarda la ganancia del 1% para su uso en el reporte mensual.

```sql
-- ==========================================
-- FUNCIÓN: registrar_compra_saldo_bus
-- ==========================================
-- Registra la compra de saldo virtual BUS (compra directa con depósito bancario).
-- El efectivo YA salió (fue un depósito bancario), por lo que se crea EGRESO inmediato.
-- Guarda ganancia = monto * 1% para que al fin del mes el proveedor liquide esa diferencia.
--
-- Parámetros:
--   p_fecha         DATE     Fecha del depósito/compra
--   p_empleado_id   INT      Empleado que registra
--   p_monto         NUMERIC  Monto comprado/depositado (ej: 500.00)
--   p_notas         TEXT     Notas opcionales (ej: número de depósito)
-- ==========================================

DROP FUNCTION IF EXISTS registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION registrar_compra_saldo_bus(
  p_fecha       DATE,
  p_empleado_id INTEGER,
  p_monto       NUMERIC,
  p_notas       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_caja_bus_id        INTEGER;
  v_tipo_bus_id        INTEGER;
  v_tipo_ref_id        INTEGER;
  v_categoria_eg011_id INTEGER;
  v_comision_pct       NUMERIC;
  v_ganancia           NUMERIC;
  v_saldo_anterior     NUMERIC;
  v_saldo_nuevo        NUMERIC;
  v_operacion_id       UUID;
  v_recarga_id         UUID;
BEGIN
  -- Obtener IDs necesarios y comisión BUS
  SELECT id INTO v_caja_bus_id        FROM cajas WHERE codigo = 'CAJA_BUS';
  SELECT id, porcentaje_comision INTO v_tipo_bus_id, v_comision_pct
    FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_id        FROM tipos_referencia WHERE codigo = 'RECARGAS_VIRTUALES';
  SELECT id INTO v_categoria_eg011_id FROM categorias_operaciones WHERE codigo = 'EG-011';

  IF v_caja_bus_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_BUS no encontrada';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de compra debe ser mayor a cero';
  END IF;

  -- Calcular ganancia: el proveedor liquida 1% del monto comprado al fin del mes
  v_ganancia := ROUND(p_monto * (v_comision_pct / 100.0), 2);

  -- Obtener saldo actual de CAJA_BUS
  SELECT saldo_actual INTO v_saldo_anterior
  FROM cajas WHERE id = v_caja_bus_id;

  IF v_saldo_anterior < p_monto THEN
    RAISE EXCEPTION 'Saldo insuficiente en CAJA_BUS. Disponible: $%, Requerido: $%',
      v_saldo_anterior, p_monto;
  END IF;

  v_saldo_nuevo  := v_saldo_anterior - p_monto;
  v_operacion_id := uuid_generate_v4();
  v_recarga_id   := uuid_generate_v4();

  -- Crear EGRESO en operaciones_cajas PRIMERO
  -- (debe existir antes de recargas_virtuales por FK constraint operacion_pago_id)
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id, referencia_id,
    descripcion, created_at
  ) VALUES (
    v_operacion_id, NOW(), v_caja_bus_id, p_empleado_id,
    'EGRESO', p_monto,
    v_saldo_anterior, v_saldo_nuevo,
    v_categoria_eg011_id, v_tipo_ref_id, v_recarga_id,
    COALESCE(p_notas, 'Compra saldo virtual Bus — ' || p_fecha),
    NOW()
  );

  -- Registrar compra en recargas_virtuales DESPUÉS (referencia v_operacion_id que ya existe)
  -- ganancia = 1% del monto (liquidación futura del proveedor)
  INSERT INTO recargas_virtuales (
    id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado, fecha_pago, operacion_pago_id,
    notas, created_at
  ) VALUES (
    v_recarga_id, p_fecha, v_tipo_bus_id, p_empleado_id,
    p_monto, p_monto, v_ganancia,
    true, p_fecha, v_operacion_id,
    p_notas, NOW()
  );

  -- Actualizar saldo CAJA_BUS
  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  RETURN json_build_object(
    'success',        true,
    'recarga_id',     v_recarga_id,
    'operacion_id',   v_operacion_id,
    'monto',          p_monto,
    'ganancia',       v_ganancia,
    'saldo_anterior', v_saldo_anterior,
    'saldo_nuevo',    v_saldo_nuevo,
    'message',        'Compra de saldo Bus registrada: $' || p_monto || ' — Ganancia a liquidar: $' || v_ganancia
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar compra saldo bus: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION registrar_compra_saldo_bus IS
'Registra compra directa de saldo virtual BUS (depósito bancario). Crea EGRESO inmediato en CAJA_BUS. Guarda ganancia=1% para liquidación mensual del proveedor.';
```

---

### 6.3 `registrar_recarga_proveedor_celular_completo`

**Versión unificada y transaccional** que ejecuta TODO el proceso de registro de recarga CELULAR en una sola operación atómica.

#### ¿Por qué esta función?

**Problema anterior (v1.2):**

- Movía ganancia de CAJA_CELULAR → CAJA_CHICA en el momento del registro de la deuda
- Validaba saldo de CAJA_CELULAR antes de crear la deuda → error si CAJA_CELULAR estaba en $0
- Esto era incorrecto: CAJA_CELULAR se llena con las ventas diarias, no existe saldo al momento de crear la deuda

**Solución v2.0:**

```
UNA sola función SQL transaccional que hace:
  1. INSERT en recargas_virtuales (crear deuda, pagado=false)
  2. CALCULAR saldo virtual actualizado
  3. OBTENER lista de deudas pendientes
  4. RETORNAR todo en un solo JSON
```

Sin validar saldo de CAJA_CELULAR. Sin mover ganancia. Solo crea la deuda.

#### Beneficios

| Aspecto                    | v1.2 (incorrecto)                   | v2.0 (correcto)         | Mejora                    |
| -------------------------- | ----------------------------------- | ----------------------- | ------------------------- |
| **Lógica de negocio**      | ❌ Mueve ganancia al registrar deuda | ✅ Solo crea la deuda    | Modelo correcto (crédito) |
| **Validación innecesaria** | ❌ Falla si CAJA_CELULAR = $0        | ✅ Sin validación        | Funciona con caja vacía   |
| **Operaciones DB**         | INSERT + 2 INSERT + 2 UPDATE        | INSERT                  | Mucho más simple          |
| **Transaccionalidad**      | ✅ 1 transacción atómica             | ✅ 1 transacción atómica | Sin cambios               |
| **Actualización UI**       | Datos del resultado                 | Datos del resultado     | Sin cambios               |

#### Firma de la función

```sql
CREATE OR REPLACE FUNCTION registrar_recarga_proveedor_celular_completo(
  p_fecha         DATE,
  p_empleado_id   INTEGER,
  p_monto_virtual NUMERIC
)
RETURNS JSON
```

#### JSON de retorno

```json
{
  "success": true,
  "recarga_id": "<uuid>",
  "monto_virtual": 210.53,
  "monto_a_pagar": 200.00,
  "ganancia": 10.53,
  "message": "Recarga del proveedor registrada",
  "saldo_virtual_celular": 310.53,
  "deudas_pendientes": {
    "cantidad": 3,
    "total": 600.00,
    "lista": [
      {
        "id": "<uuid>",
        "fecha": "2026-02-11",
        "monto_virtual": 210.53,
        "monto_a_pagar": 200.00,
        "ganancia": 10.53,
        "created_at": "2026-02-11T14:30:00Z"
      }
    ]
  }
}
```

#### Código Completo de la Función

```sql
-- ==========================================
-- FUNCIÓN: registrar_recarga_proveedor_celular_completo
-- VERSIÓN: 2.0
-- FECHA: 2026-02-20
-- ==========================================
-- Registra la deuda con el proveedor CELULAR de forma transaccional.
-- Solo crea la deuda — NO mueve efectivo entre cajas.
--
-- MODELO DE NEGOCIO CELULAR (crédito):
--   El proveedor carga saldo virtual a crédito. La ganancia (5%) queda
--   en CAJA_CELULAR como diferencia entre ventas cobradas y monto pagado.
--   No hay transferencia al registrar la deuda.
--
-- BENEFICIOS v2.0:
--   ✅ No valida saldo de CAJA_CELULAR (correcto: no hay saldo al crear deuda)
--   ✅ No mueve efectivo entre cajas (correcto: modelo crédito)
--   ✅ Más simple y robusto
--   ✅ Transacción atómica (todo o nada)
--
-- Parámetros:
--   p_fecha          DATE     Fecha del evento
--   p_empleado_id    INT      Empleado que registra
--   p_monto_virtual  NUMERIC  Monto virtual cargado por el proveedor (ej: 210.53)
--
-- Retorna JSON con:
--   - success, recarga_id, monto_virtual, monto_a_pagar, ganancia
--   - saldo_virtual_celular (calculado)
--   - deudas_pendientes: { cantidad, total, lista }
-- ==========================================

DROP FUNCTION IF EXISTS registrar_recarga_proveedor_celular_completo(DATE, INTEGER, NUMERIC);

CREATE OR REPLACE FUNCTION registrar_recarga_proveedor_celular_completo(
  p_fecha         DATE,
  p_empleado_id   INTEGER,
  p_monto_virtual NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- IDs de servicios
  v_tipo_celular_id           INTEGER;
  v_comision_pct              NUMERIC;

  -- Cálculos
  v_monto_a_pagar             NUMERIC;
  v_ganancia                  NUMERIC;

  -- ID generado
  v_recarga_id                UUID;

  -- Saldo virtual actualizado
  v_saldo_ultimo_cierre       NUMERIC;
  v_suma_recargas_post_cierre NUMERIC;
  v_saldo_virtual_actual      NUMERIC;
  v_fecha_ultimo_cierre       TIMESTAMP;

  -- Deudas pendientes
  v_deudas_pendientes         JSON;
  v_cantidad_deudas           INTEGER;
  v_total_deudas              NUMERIC;
BEGIN
  -- ==========================================
  -- 1. VALIDACIONES INICIALES
  -- ==========================================

  SELECT id, porcentaje_comision
  INTO v_tipo_celular_id, v_comision_pct
  FROM tipos_servicio WHERE codigo = 'CELULAR';

  IF v_tipo_celular_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio CELULAR no encontrado';
  END IF;

  IF p_monto_virtual <= 0 THEN
    RAISE EXCEPTION 'El monto virtual debe ser mayor a cero';
  END IF;

  -- ==========================================
  -- 2. CÁLCULOS DE MONTOS
  -- ==========================================

  -- monto_a_pagar = monto_virtual * (1 - comision/100)
  -- Ejemplo: 210.53 * 0.95 = 200.00
  v_monto_a_pagar := ROUND(p_monto_virtual * (1 - v_comision_pct / 100.0), 2);
  v_ganancia      := p_monto_virtual - v_monto_a_pagar;

  -- ==========================================
  -- 3. INSERT EN recargas_virtuales (CREAR DEUDA)
  -- ==========================================

  INSERT INTO recargas_virtuales (
    id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, v_tipo_celular_id, p_empleado_id,
    p_monto_virtual, v_monto_a_pagar, v_ganancia,
    false, NOW()
  )
  RETURNING id INTO v_recarga_id;

  -- ==========================================
  -- 4. CALCULAR SALDO VIRTUAL ACTUAL
  -- Fórmula: último_cierre + SUM(recargas_virtuales posteriores)
  -- ==========================================

  SELECT COALESCE(saldo_virtual_actual, 0), created_at
  INTO v_saldo_ultimo_cierre, v_fecha_ultimo_cierre
  FROM recargas
  WHERE tipo_servicio_id = v_tipo_celular_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_saldo_ultimo_cierre IS NULL THEN
    v_saldo_ultimo_cierre := 0;
    v_fecha_ultimo_cierre := '1900-01-01'::timestamp;
  END IF;

  SELECT COALESCE(SUM(monto_virtual), 0)
  INTO v_suma_recargas_post_cierre
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_celular_id
    AND rv.created_at > v_fecha_ultimo_cierre;

  v_saldo_virtual_actual := v_saldo_ultimo_cierre + v_suma_recargas_post_cierre;

  -- ==========================================
  -- 5. OBTENER LISTA DE DEUDAS PENDIENTES
  -- ==========================================

  SELECT json_agg(
    json_build_object(
      'id', rv.id,
      'fecha', rv.fecha,
      'monto_virtual', rv.monto_virtual,
      'monto_a_pagar', rv.monto_a_pagar,
      'ganancia', rv.ganancia,
      'created_at', rv.created_at
    ) ORDER BY rv.fecha ASC
  )
  INTO v_deudas_pendientes
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_celular_id
    AND rv.pagado = false;

  SELECT COUNT(*), COALESCE(SUM(monto_a_pagar), 0)
  INTO v_cantidad_deudas, v_total_deudas
  FROM recargas_virtuales
  WHERE tipo_servicio_id = v_tipo_celular_id
    AND pagado = false;

  -- ==========================================
  -- 6. RETORNAR JSON COMPLETO
  -- ==========================================

  RETURN json_build_object(
    'success',              true,
    'recarga_id',           v_recarga_id,
    'monto_virtual',        p_monto_virtual,
    'monto_a_pagar',        v_monto_a_pagar,
    'ganancia',             v_ganancia,
    'message',              'Recarga del proveedor registrada',
    'saldo_virtual_celular', v_saldo_virtual_actual,
    'deudas_pendientes', json_build_object(
      'cantidad', v_cantidad_deudas,
      'total',    v_total_deudas,
      'lista',    COALESCE(v_deudas_pendientes, '[]'::json)
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar recarga proveedor celular completo: %', SQLERRM;
END;
$$;

-- ==========================================
-- COMENTARIOS Y PERMISOS
-- ==========================================

COMMENT ON FUNCTION registrar_recarga_proveedor_celular_completo IS
'v2.0 - Registra deuda con proveedor CELULAR. Solo crea la deuda (pagado=false).
Sin transferencia de ganancia: la ganancia queda en CAJA_CELULAR como diferencia entre ventas y pago.';

GRANT EXECUTE ON FUNCTION registrar_recarga_proveedor_celular_completo(DATE, INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION registrar_recarga_proveedor_celular_completo(DATE, INTEGER, NUMERIC) TO anon;

NOTIFY pgrst, 'reload schema';
```

#### Operaciones que ejecuta

1. **Validaciones iniciales**
   
   - Verificar que tipo_servicio CELULAR existe
   - Validar monto_virtual > 0
   - Obtener porcentaje_comision de tipos_servicio

2. **Cálculos**
   
   ```sql
   v_monto_a_pagar := ROUND(p_monto_virtual * (1 - v_comision_pct / 100.0), 2);
   v_ganancia      := p_monto_virtual - v_monto_a_pagar;
   ```

3. **INSERT en recargas_virtuales** (crear deuda con `pagado = false`)

4. **Calcular saldo virtual actual**
   
   ```sql
   -- Fórmula: último_cierre + SUM(recargas_virtuales posteriores)
   v_saldo_virtual_actual := v_saldo_ultimo_cierre + v_suma_recargas_post_cierre;
   ```

5. **Obtener lista de deudas pendientes** (todas con `pagado = false`)

6. **Calcular totales de deudas** (cantidad y suma de `monto_a_pagar`)

7. **Retornar JSON completo** con todos los datos actualizados

8. **Exception handler** con rollback automático

#### Uso en TypeScript

**Servicio:** `recargas-virtuales.service.ts`

```typescript
async registrarRecargaProveedorCelularCompleto(params: {
  fecha: string;
  empleado_id: number;
  monto_virtual: number;
}): Promise<RegistroRecargaCompletoResult> {
  return this.supabase.call(
    this.supabase.client.rpc('registrar_recarga_proveedor_celular_completo', {
      p_fecha:         params.fecha,
      p_empleado_id:   params.empleado_id,
      p_monto_virtual: params.monto_virtual
    })
  );
}
```

**Modal:** `registrar-recarga-modal.component.ts`

```typescript
const resultado = await this.service.registrarRecargaProveedorCelularCompleto({
  fecha: this.service.getFechaLocal(),
  empleado_id: empleado.id,
  monto_virtual: this.montoVirtual
});

// Cerrar modal con TODOS los datos actualizados
this.modalCtrl.dismiss({
  success: true,
  data: resultado  // Incluye saldos, deudas, etc.
});
```

**Página:** `recargas-virtuales.page.ts`

```typescript
const { data } = await modal.onWillDismiss();

if (data?.success && data?.data) {
  const resultado = data.data;

  // Actualizar UI SIN queries adicionales
  this.saldoVirtualCelular = resultado.saldo_virtual_celular;
  this.deudasPendientes = resultado.deudas_pendientes.lista;

  // Solo recargar BUS y ganancia (no relacionadas con CELULAR)
  const [saldoBus, gananciaBus] = await Promise.all([
    this.service.getSaldoVirtualActual('BUS'),
    this.gananciasService.calcularGananciaBusMesAnterior()
  ]);
}
```

#### Validaciones

- ✅ Monto virtual = 0 → `RAISE EXCEPTION 'El monto virtual debe ser mayor a cero'`
- ✅ Monto virtual negativo → Same error
- ✅ Tipo servicio CELULAR no existe → `'Tipo de servicio CELULAR no encontrado'`
- ❌ ~~CAJA_CELULAR con saldo insuficiente~~ — eliminado en v2.0 (no aplica al modelo crédito)

#### Migración Completada

**Estado:**

- ✅ Nueva función SQL desplegada (`registrar_recarga_proveedor_celular_completo`)
- ✅ Frontend actualizado para usar nueva función transaccional
- ✅ Método deprecado eliminado del código TypeScript
- ✅ Importaciones innecesarias removidas (`CajasService` en modal)
- ✅ Documentación actualizada

**Función antigua eliminada:**

- ❌ `registrar_recarga_virtual_celular` — ya no se usa
- ❌ Método TypeScript deprecado eliminado
- ⚠️ La función SQL antigua puede permanecer en BD sin afectar, pero puede eliminarse si se desea

---

## 7. Resumen de Diferencias CELULAR vs BUS

```
CELULAR (crédito):
  Proveedor carga → [recargas_virtuales: pagado=false, ganancia almacenada]
                 → Cierre diario acumula ventas → CAJA_CELULAR sube
                 → Pagar proveedor → [EGRESO CAJA_CELULAR: monto_a_pagar]
                                  → [TRANSFERENCIA_SALIENTE CAJA_CELULAR: ganancia]
                                  → [TRANSFERENCIA_ENTRANTE CAJA_CHICA: ganancia]
  Ganancia: leída de recargas_virtuales.ganancia por deuda — transferida a CAJA_CHICA al pagar
  CAJA_CELULAR: sube con cierres, baja (pago + ganancia) al pagar proveedor

BUS (directo):
  Depositar al banco → registrar → [recargas_virtuales: pagado=true, ganancia=1%] + [operaciones_cajas: EGRESO CAJA_BUS]
  Saldo CAJA_BUS: baja inmediatamente al registrar la compra
  Ganancia: 1% del monto queda en recargas_virtuales.ganancia — el proveedor la liquida al fin de mes
```

---

## 8. Historial de Versiones

| Versión | Fecha      | Cambios                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-02-11 | Creación inicial — documenta módulo Saldo Virtual completo con las 3 funciones SQL embebidas                                                                                                                                                                                                                                                                                                                               |
| 1.1     | 2026-02-11 | `registrar_compra_saldo_bus` — ahora calcula y guarda `ganancia = monto * 1%` en vez de 0                                                                                                                                                                                                                                                                                                                                  |
| 1.2     | 2026-02-11 | ✨ **Nueva función transaccional completa**: `registrar_recarga_proveedor_celular_completo` — Unifica TODO el proceso en una transacción atómica (deuda + transferencia + saldos + retorno de datos). Depreca `registrar_recarga_virtual_celular` para uso con transferencia separada. Reduce queries de 6 a 3 (~50% mejora performance).                                                                                   |
| 1.3     | 2026-02-19 | 🔔 **Notificación campana en Home**: las deudas pendientes CELULAR ahora aparecen como badge numérico en la campana del header (`home.page.ts`). Reemplaza el sistema anterior de notificaciones BUS (ganancias pendientes). Ver sección 5.4.                                                                                                                                                                              |
| 1.4     | 2026-02-20 | 🐛 **Fix `registrar_recarga_proveedor_celular_completo` v2.0**: Eliminada la validación de saldo en CAJA_CELULAR y la transferencia CAJA_CELULAR → CAJA_CHICA. La función ahora solo crea la deuda (`pagado=false`). La ganancia no se mueve: queda en CAJA_CELULAR como diferencia entre ventas acumuladas y monto pagado al proveedor. JSON de retorno simplificado (sin `transferencia` ni `saldos_actualizados`).      |
| 1.5     | 2026-02-20 | ✨ **`registrar_pago_proveedor_celular` v2.0**: Al pagar al proveedor, la ganancia acumulada (`SUM(recargas_virtuales.ganancia)` de las deudas pagadas) se transfiere automáticamente de CAJA_CELULAR a CAJA_CHICA. Se agregan TRANSFERENCIA_SALIENTE (CAJA_CELULAR) y TRANSFERENCIA_ENTRANTE (CAJA_CHICA). Validación actualizada: CAJA_CELULAR debe tener `monto_a_pagar + ganancia`. JSON retorna saldos de ambas cajas. |
