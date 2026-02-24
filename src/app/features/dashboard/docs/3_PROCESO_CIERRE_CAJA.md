# Sistema de Control de Recargas y Cierre Diario (VERSIÓN 4.7)

**IMPORTANTE:** Este documento refleja la Versión 4.7 del sistema donde:

- ✅ **NUEVO v4.7:** 1 sola transferencia a Varios por día (sin importar cuántos turnos)
- ✅ **NUEVO v4.7:** UI coherente — Paso 2 muestra chip verde "ya recibió hoy" si es 2do turno
- ✅ **NUEVO v4.7:** Verificación timezone-safe con `(fecha AT TIME ZONE 'America/Guayaquil')::date`
- ✅ **NUEVO v4.7:** Función auxiliar `verificar_transferencia_caja_chica_hoy` para la UI
- ✅ **NUEVO v4.6:** Distribución inteligente de efectivo con registro de déficit
- ✅ **NUEVO v4.6:** Lógica "todo o nada" para transferencia a Caja Chica
- ✅ **NUEVO v4.6:** `deficit_caja_chica` en `caja_fisica_diaria`
- ✅ **NUEVO v4.6:** 3 casos manejados: normal / déficit parcial / déficit total
- ✅ **NUEVO v4.1:** Múltiples cierres por día (1 cierre por turno)
- ✅ **NUEVO v4.1:** Relación turno ↔ cierre (1:1)
- ✅ **NUEVO v4.1:** Recargas por turno (no por día)
- ✅ **NUEVO v4.5:** Fórmula de venta incluye agregado del proveedor
- ✅ **NUEVO v4.5:** `recargas_virtuales` integradas en el cálculo del cierre
- ✅ Ultra-simplificado: Solo 1 campo de entrada (efectivo_recaudado)
- ✅ Configuración centralizada: fondo_fijo desde configuraciones
- ✅ `caja_fisica_diaria` representa la **CAJA FÍSICA por turno**
- ✅ `CAJA` (tabla cajas) es la **caja de ACUMULACIÓN**

## Índice

1. [Introducción](#1-introducción)
2. [Cambios Versión 4.1](#2-cambios-versión-41)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Conceptos Clave](#4-conceptos-clave)
5. [Flujo Completo del Cierre por Turno](#5-flujo-completo-del-cierre-por-turno)
6. [Sistema de Trazabilidad](#6-sistema-de-trazabilidad)
7. [Validaciones del Sistema](#7-validaciones-del-sistema)
8. [Ejemplo Práctico Completo](#8-ejemplo-práctico-completo)
9. [Queries de Auditoría](#9-queries-de-auditoría)
10. [Función PostgreSQL Completa](#10-función-postgresql-completa)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Introducción

Este documento describe el **Sistema de Control de Recargas y Cierre por Turno v4.1** para Mi Tienda, un sistema ultra-simplificado de gestión de efectivo y saldos virtuales que maneja:

- ✅ **Múltiples turnos por día** (cada empleado puede abrir/cerrar su turno)
- ✅ **1 cierre contable por turno** (relación 1:1 turno ↔ cierre)
- ✅ Control de saldos virtuales (Bus y Celular)
- ✅ Gestión de 4 cajas de efectivo
- ✅ Cierre transaccional con rollback automático
- ✅ Trazabilidad 100% de operaciones
- ✅ Auditoría completa por turno

### Características Principales v4.1

| Característica                 | Descripción                                |
| ------------------------------ | ------------------------------------------ |
| **Múltiples Cierres/Día**      | Cada turno tiene su propio cierre contable |
| **Ultra-Simplificado**         | Solo requiere 1 campo: efectivo_recaudado  |
| **Turnos Independientes**      | Cada empleado abre/cierra su turno         |
| **Configuración Centralizada** | Fondo fijo y transferencia desde config    |
| **Transaccional**              | Rollback automático en caso de error       |
| **Trazable por Turno**         | Cada operación vinculada a su turno        |
| **Validado**                   | Múltiples capas de validación              |
| **Auditado**                   | Historial completo por turno               |

---

## 2. Cambios Versión 4.1

### 2.1. Múltiples Cierres por Día

#### Antes (v4.0)

- 1 solo cierre por día
- Validación: `UNIQUE(fecha)` en `caja_fisica_diaria`
- Todos los empleados acumulaban en el mismo cierre

#### Ahora (v4.1)

- **Múltiples cierres por día** (1 por turno)
- Validación: `UNIQUE(turno_id)` en `caja_fisica_diaria`
- Cada turno tiene su cierre independiente

```
DÍA 2026-02-07:
├─ Turno 1 (08:00-12:00) → Cierre 1
├─ Turno 2 (12:00-16:00) → Cierre 2
└─ Turno 3 (16:00-20:00) → Cierre 3
```

### 2.2. Tabla `turnos_caja` (Nueva)

Control independiente de turnos de caja:

```sql
CREATE TABLE turnos_caja (
    id UUID PRIMARY KEY,
    fecha DATE NOT NULL,
    numero_turno SMALLINT NOT NULL DEFAULT 1,
    empleado_id INTEGER NOT NULL,
    hora_apertura TIMESTAMP NOT NULL,
    hora_cierre TIMESTAMP,           -- NULL mientras está abierto
    observaciones TEXT,
    UNIQUE(fecha, numero_turno)      -- Múltiples turnos por día
);
```

### 2.3. Relación Turno ↔ Cierre (1:1)

**`caja_fisica_diaria` ahora incluye `turno_id`:**

```sql
CREATE TABLE caja_fisica_diaria (
    id UUID PRIMARY KEY,
    fecha DATE NOT NULL,                -- Ya no UNIQUE
    turno_id UUID NOT NULL REFERENCES turnos_caja(id) UNIQUE, -- 1:1
    empleado_id INTEGER NOT NULL,
    efectivo_recaudado DECIMAL(12,2) NOT NULL,
    observaciones TEXT
);
```

### 2.4. Recargas por Turno

**`recargas` ahora incluye `turno_id`:**

```sql
CREATE TABLE recargas (
    id UUID PRIMARY KEY,
    fecha DATE NOT NULL,
    turno_id UUID NOT NULL REFERENCES turnos_caja(id),
    tipo_servicio_id INTEGER NOT NULL,
    ...
    UNIQUE(turno_id, tipo_servicio_id) -- 1 registro por turno y servicio
);
```

**Cambio crítico:**

- **Antes:** `UNIQUE(fecha, tipo_servicio_id)` → 1 registro por día
- **Ahora:** `UNIQUE(turno_id, tipo_servicio_id)` → 1 registro por turno

### 2.5. Función SQL Actualizada

**Nuevos parámetros v4.1:**

```sql
CREATE FUNCTION ejecutar_cierre_diario(
  p_turno_id UUID,        -- ⬅️ NUEVO (primer parámetro)
  p_fecha DATE,
  p_empleado_id INTEGER,
  p_efectivo_recaudado DECIMAL(12,2),
  ...
)
```

**Nuevas validaciones:**

1. El turno debe existir
2. El turno no debe tener cierre previo
3. El turno debe estar abierto (sin hora_cierre)

**Nueva operación:**

- Cierra el turno específico automáticamente (`hora_cierre = NOW()`)

### 2.6. Servicio TypeScript Actualizado

**`getSaldosAnteriores()` ahora usa `created_at`:**

```typescript
// ANTES v4.0: Solo ordenaba por fecha
.order('fecha', { ascending: false })

// AHORA v4.1: Ordena por created_at (el más reciente)
.order('created_at', { ascending: false })
```

**`existeCierreDiario()` ahora valida por turno:**

```typescript
// ANTES v4.0: Validaba si existe cierre para la fecha
.eq('fecha', fechaBusqueda)

// AHORA v4.1: Valida si el turno activo tiene cierre
1. Busca turno activo (sin hora_cierre)
2. Si no hay turno activo → false
3. Si hay turno activo → verifica si ese turno tiene cierre
```

---

## 3. Arquitectura del Sistema

### 3.1. Las 4 Cajas del Sistema

El sistema maneja 4 cajas independientes con propósitos específicos:

#### 🏦 CAJA (Principal)

- **Propósito**: **Caja de ACUMULACIÓN** (como caja fuerte)
- **Recibe**: Depósitos del efectivo recaudado de cada turno
- **Nota**: NO recibe los $20 de transferencia (se toman físicamente del efectivo)
- **Tipo**: Efectivo acumulado (NO es la caja física del turno)

#### 💰 CAJA_CHICA

- **Propósito**: Gastos menores y operativos
- **Recibe**: $20 por turno cerrado (automático desde config)
- **Tipo**: Efectivo físico

#### 📱 CAJA_CELULAR

- **Propósito**: Control de efectivo de recargas celular
- **Recibe**: Efectivo de ventas de recargas celular por turno
- **Tipo**: Efectivo físico

#### 🚌 CAJA_BUS

- **Propósito**: Control de efectivo de recargas bus
- **Recibe**: Efectivo de ventas de recargas bus por turno
- **Tipo**: Efectivo físico

### 3.2. Tablas Principales v4.1

#### 🕐 `turnos_caja` (NUEVA)

Control de turnos de apertura/cierre de caja.

| Campo           | Descripción                           |
| --------------- | ------------------------------------- |
| `id`            | UUID único del turno                  |
| `fecha`         | Fecha del turno                       |
| `numero_turno`  | 1, 2, 3... (múltiples por día)        |
| `empleado_id`   | Quién trabaja el turno                |
| `hora_apertura` | Timestamp de apertura                 |
| `hora_cierre`   | Timestamp de cierre (NULL si abierto) |

#### 📋 `caja_fisica_diaria`

Representa la **CAJA FÍSICA por turno** (ultra-simplificada).

| Campo                       | Descripción                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `id`                        | UUID único del cierre                                         |
| `fecha`                     | Fecha del cierre                                              |
| **`turno_id`** 🆕           | **UUID del turno (relación 1:1)**                             |
| `empleado_id`               | Quién realizó el cierre                                       |
| **`efectivo_recaudado`** ⭐  | **¡ÚNICO CAMPO REQUERIDO!**                                   |
| **`deficit_caja_chica`** 🆕 | **Monto que faltó transferir a Caja Chica. 0 = turno normal** |
| `observaciones`             | Notas del cierre (opcional)                                   |

#### 📊 `recargas`

Control de saldo virtual por servicio **y turno**.

| Campo                    | Descripción             |
| ------------------------ | ----------------------- |
| `id`                     | UUID único del registro |
| `fecha`                  | Fecha del registro      |
| **`turno_id`** 🆕        | **UUID del turno**      |
| `tipo_servicio_id`       | CELULAR o BUS           |
| `venta_dia`              | Venta del turno         |
| `saldo_virtual_anterior` | Saldo antes del turno   |
| `saldo_virtual_actual`   | Saldo después del turno |

---

## 4. Conceptos Clave

### 4.1. Flujo de un Día con Múltiples Turnos

```
DÍA 2026-02-07:

08:00 → Empleado 1 abre caja (Turno 1)
        └─ INSERT turnos_caja (hora_apertura)

10:00 → Empleado 1 cierra turno
        ├─ Cuenta efectivo: $140
        ├─ ejecutar_cierre_diario(turno_1_id, ...)
        ├─ INSERT caja_fisica_diaria (turno_id = turno_1)
        ├─ INSERT recargas (turno_id = turno_1) x2
        ├─ INSERT operaciones_cajas x4
        └─ UPDATE turnos_caja SET hora_cierre = NOW()

12:00 → Empleado 2 abre caja (Turno 2)
        └─ INSERT turnos_caja (hora_apertura)

15:00 → Empleado 2 cierra turno
        ├─ Cuenta efectivo: $160
        ├─ ejecutar_cierre_diario(turno_2_id, ...)
        ├─ INSERT caja_fisica_diaria (turno_id = turno_2)
        ├─ INSERT recargas (turno_id = turno_2) x2
        │   └─ Usa saldo_anterior del turno 1 ✅
        ├─ INSERT operaciones_cajas x4
        └─ UPDATE turnos_caja SET hora_cierre = NOW()

Resultado: 2 cierres contables en el mismo día ✅
```

### 4.2. Continuidad de Saldos entre Turnos

**Clave:** Los saldos virtuales se pasan de turno a turno cronológicamente.

```typescript
// v4.1: Orden por created_at (no solo por fecha)
.order('created_at', { ascending: false })
```

**Ejemplo:**

```
08:00 - Turno 1 cierra:
  Celular: anterior $100 → venta $25 → actual $75
  (created_at: 2026-02-07 10:00:00)

12:00 - Turno 2 abre:
  getSaldosAnteriores() → Celular $75 ✅
  (toma el registro más reciente por created_at)

15:00 - Turno 2 cierra:
  Celular: anterior $75 → venta $30 → actual $45
  (created_at: 2026-02-07 15:00:00)

16:00 - Turno 3 abre:
  getSaldosAnteriores() → Celular $45 ✅
  (toma el registro más reciente por created_at)
```

### 4.3. Distribución Física del Efectivo (v4.6)

Config: `fondo_fijo_diario = $20`, `caja_chica_transferencia_diaria = $20`

**Prioridad de distribución:**

1. 💵 Fondo fijo → queda en caja física para dar vueltos mañana
2. 💼 Caja Chica → todo o nada (monto completo o $0)
3. 📦 Caja Principal → el sobrante (siempre ≥ $0)

#### CASO NORMAL — efectivo = $140

```
┌──────────────────────────────────────────────────────┐
│  Del efectivo contado ($140):                        │
│  📦 $100.00 → Funda CAJA PRINCIPAL                   │
│  💼 $20.00  → Funda CAJA CHICA     (completo ✅)     │
│  💵 $20.00  → Dejar en caja física (fondo mañana)    │
│  deficit_caja_chica = $0                             │
└──────────────────────────────────────────────────────┘
```

#### CASO DÉFICIT PARCIAL — efectivo = $30

```
┌──────────────────────────────────────────────────────┐
│  Del efectivo contado ($30):                         │
│  📦 $10.00  → Funda CAJA PRINCIPAL  (sobrante)       │
│  💼 $0.00   → Caja Chica (no alcanzó, todo o nada)   │
│  💵 $20.00  → Dejar en caja física (fondo mañana)    │
│  deficit_caja_chica = $20  ⚠️                        │
└──────────────────────────────────────────────────────┘
```

> El siguiente turno verá: "⚠️ Turno anterior quedó debiendo $20 a Caja Chica"

#### CASO DÉFICIT TOTAL — efectivo = $15

```
┌──────────────────────────────────────────────────────┐
│  Del efectivo contado ($15):                         │
│  📦 $0.00   → Caja Principal (nada que depositar)    │
│  💼 $0.00   → Caja Chica (no alcanzó, todo o nada)   │
│  💵 $15.00  → Dejar en caja física (fondo incompleto)│
│  deficit_caja_chica = $20  ⚠️                        │
└──────────────────────────────────────────────────────┘
```

> Fondo también queda incompleto ($15 de $20 requeridos)

#### CASO SIN EFECTIVO — efectivo = $0

```
┌──────────────────────────────────────────────────────┐
│  Del efectivo contado ($0):                          │
│  📦 $0.00   → Tienda (nada que depositar)            │
│  💼 $0.00   → Varios (no alcanzó, todo o nada)       │
│  💵 $0.00   → Caja física (fondo completamente vacío)│
│  deficit_caja_chica = $20  ⚠️  (si es 1er turno)    │
│  deficit_caja_chica = $0   ✅  (si Varios ya recibió)│
└──────────────────────────────────────────────────────┘
```

> El operador debe usar el campo **Observaciones** para explicar el turno sin efectivo (ej: "Turno sin ventas en efectivo"). El registro en `caja_fisica_diaria` con `efectivo_recaudado = 0` queda igualmente para trazabilidad.
> El siguiente turno deberá reponer el fondo ($40) y, si aplica, transferir a Varios ($20).

---

## 5. Flujo Completo del Cierre por Turno

### 5.1. Visión General v4.1

```mermaid
flowchart TD
    A[Usuario: Abrir Caja] --> B[INSERT turnos_caja]
    B --> C[Usuario trabaja...]
    C --> D[Usuario: Cerrar Día]
    D --> E{Validar turno activo}
    E -->|No hay turno| F[Error: Debes abrir caja]
    E -->|Turno abierto| G{Ya tiene cierre?}
    G -->|Sí| H[Error: Turno ya cerrado]
    G -->|No| I[Navegar a Cierre]
    I --> J[Ingresar Efectivo Contado]
    J --> K[Verificar Cálculos]
    K --> L[Confirmar]
    L --> M[Ejecutar Función PostgreSQL v4.1]
    M --> N{Transacción}
    N -->|Error| O[Rollback Automático]
    N -->|Éxito| P[INSERT + UPDATE atomico]
    P --> Q[Cierra turno automáticamente]
    Q --> R[Mostrar Éxito]
```

### 5.2. Paso a Paso Detallado

#### **Paso 0: Abrir Turno (NUEVO en v4.1)**

Usuario presiona "Abrir Caja":

```typescript
// TurnosCajaService.abrirTurno()
1. Valida que no haya turno abierto
2. Obtiene empleado actual
3. Calcula numero_turno (último + 1)
4. INSERT INTO turnos_caja (hora_apertura = NOW())
```

#### **Paso 1: Ingresar Datos (Ultra-Simplificado)**

Usuario solo ingresa:

- ✅ **Efectivo Total Contado**: El dinero en caja física al final del turno
- ✅ Saldo Virtual Celular Final
- ✅ Saldo Virtual Bus Final
- ⚪ Observaciones (opcional)

#### **Paso 2: Verificación del Sistema**

Sistema verifica:

```typescript
// existeCierreDiario() en v4.1
1. Busca turno activo (fecha = hoy AND hora_cierre IS NULL)
2. Si no hay turno activo → Error "Debes abrir caja primero"
3. Si hay turno activo → Verifica si ese turno tiene cierre
4. Si turno tiene cierre → Error "Turno ya cerrado"
5. Si turno sin cierre → Permite continuar ✅
```

#### **Paso 3: Ejecución Transaccional (v4.1)**

Se llama a la función PostgreSQL `ejecutar_cierre_diario` con `p_turno_id`:

```sql
SELECT ejecutar_cierre_diario(
  'uuid-turno-123',  -- ⬅️ NUEVO parámetro
  '2026-02-07',
  1,                 -- empleado_id
  140.00,            -- efectivo_recaudado
  ...
);
```

**La función ejecuta:**

1. **Valida el turno** (existencia, sin cierre previo, abierto)
2. **Obtiene configuración** del sistema
3. **Calcula** depósito automáticamente
4. **Crea** registro en `caja_fisica_diaria` (con turno_id)
5. **Crea** 2 registros en `recargas` (con turno_id)
6. **Crea** 4 operaciones en `operaciones_cajas`
7. **Actualiza** saldos en las 4 cajas
8. **Cierra el turno** (UPDATE turnos_caja SET hora_cierre = NOW())
9. **Retorna** resultado JSON

**Si cualquier paso falla → Rollback automático de TODO**

---

## 6. Sistema de Trazabilidad

### 6.1. Mapeo de Referencias v4.1

| Operación                | Tipo Referencia    | Referencia ID        | Tabla Origen         | Turno |
| ------------------------ | ------------------ | -------------------- | -------------------- | ----- |
| Depósito a CAJA          | CAJA_FISICA_DIARIA | UUID del cierre      | `caja_fisica_diaria` | ✅     |
| Transferencia CAJA_CHICA | CAJA_FISICA_DIARIA | UUID del cierre      | `caja_fisica_diaria` | ✅     |
| Ingreso celular          | RECARGAS           | UUID recarga celular | `recargas`           | ✅     |
| Ingreso bus              | RECARGAS           | UUID recarga bus     | `recargas`           | ✅     |

### 6.2. Trazabilidad por Turno

**Pregunta:** ¿De dónde vienen los $80 del Turno 2?

```sql
SELECT
  o.monto,
  tr.tabla AS origen,
  cf.efectivo_recaudado,
  cf.fecha,
  t.numero_turno,
  t.hora_apertura,
  t.hora_cierre,
  e.nombre AS empleado
FROM operaciones_cajas o
JOIN tipos_referencia tr ON o.tipo_referencia_id = tr.id
JOIN caja_fisica_diaria cf ON o.referencia_id = cf.id
JOIN turnos_caja t ON cf.turno_id = t.id
JOIN empleados e ON t.empleado_id = e.id
WHERE o.id = 'operacion-uuid';

-- Resultado:
-- monto: 80.00
-- origen: caja_fisica_diaria
-- efectivo_recaudado: 140.00
-- fecha: 2026-02-07
-- numero_turno: 2
-- hora_apertura: 12:00
-- hora_cierre: 15:00
-- empleado: Juan Pérez
```

---

## 7. Validaciones del Sistema

### 7.1. Validaciones del Turno (NUEVAS v4.1)

```sql
-- 1. El turno debe existir
IF NOT EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id) THEN
  RAISE EXCEPTION 'El turno especificado no existe';
END IF;

-- 2. El turno no debe tener cierre previo
IF EXISTS (SELECT 1 FROM caja_fisica_diaria WHERE turno_id = p_turno_id) THEN
  RAISE EXCEPTION 'El turno ya tiene un cierre registrado';
END IF;

-- 3. El turno debe estar abierto
IF EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND hora_cierre IS NOT NULL) THEN
  RAISE EXCEPTION 'El turno ya está cerrado';
END IF;
```

### 7.2. Distribución Inteligente de Efectivo (v4.6)

Ya **no se lanza excepción** por efectivo insuficiente. La función aplica distribución inteligente con política "todo o nada" para Caja Chica:

```sql
v_efectivo_disponible := p_efectivo_recaudado - v_fondo_fijo;

IF v_efectivo_disponible >= v_transferencia_diaria THEN
  -- NORMAL: transfiere completo
  v_transferencia_efectiva := v_transferencia_diaria;
  v_deficit_caja_chica     := 0;
  v_dinero_a_depositar     := v_efectivo_disponible - v_transferencia_diaria;
ELSIF v_efectivo_disponible > 0 THEN
  -- DÉFICIT PARCIAL: todo o nada → Caja Chica = $0, sobrante a Principal
  v_transferencia_efectiva := 0;
  v_deficit_caja_chica     := v_transferencia_diaria;
  v_dinero_a_depositar     := v_efectivo_disponible;
ELSE
  -- DÉFICIT TOTAL: ni el fondo alcanza
  v_transferencia_efectiva := 0;
  v_deficit_caja_chica     := v_transferencia_diaria;
  v_dinero_a_depositar     := 0;
END IF;
-- deficit_caja_chica se guarda en caja_fisica_diaria para trazabilidad
```

### 7.3. Validación de Configuración

```sql
IF fondo_fijo IS NULL OR transferencia_diaria IS NULL THEN
  RAISE EXCEPTION 'No se encontró configuración del sistema';
END IF;
```

---

## 8. Ejemplo Práctico Completo

### Contexto: Día con 2 Turnos

**Fecha:** 2026-02-07
**Configuración:**

- Fondo Fijo: $40.00
- Transferencia Caja Chica: $20.00

**Saldos Iniciales (08:00):**

- Saldo Virtual Celular: $100.00
- Saldo Virtual Bus: $285.00
- CAJA: $500.00
- CAJA_CHICA: $30.00
- CAJA_CELULAR: $200.00
- CAJA_BUS: $400.00

---

### TURNO 1 (08:00 - 10:00)

#### Apertura

```sql
INSERT INTO turnos_caja VALUES (
  'turno-1-id',
  '2026-02-07',
  1,                    -- numero_turno
  1,                    -- empleado_id (Ivan)
  '2026-02-07 08:00:00',
  NULL,                 -- hora_cierre (abierto)
  NULL
);
```

#### Cierre (10:00)

**Usuario ingresa:**

- Efectivo: $140.00
- Celular Final: $75.00
- Bus Final: $250.00

**Sistema calcula (v4.5):**

```
Depósito = $140 - $40 - $20 = $80
Venta Celular = ($100 + agregado_celular_hoy) - $75
             = ($100 + $0) - $75 = $25   (sin recarga del proveedor ese día)
Venta Bus = ($285 + agregado_bus_hoy) - $250
          = ($285 + $0) - $250 = $35
```

**Función ejecuta:**

```sql
-- 1. Cierre
INSERT INTO caja_fisica_diaria VALUES (
  'cierre-1-id', '2026-02-07', 'turno-1-id', 1, 140.00, NULL
);

-- 2. Recargas
INSERT INTO recargas VALUES
('rec-cel-1', '2026-02-07', 'turno-1-id', 1, 25.00, 100.00, 75.00, TRUE),
('rec-bus-1', '2026-02-07', 'turno-1-id', 2, 35.00, 285.00, 250.00, TRUE);

-- 3. Operaciones
INSERT INTO operaciones_cajas VALUES
('op-1', NOW(), 1, 1, 'INGRESO', 80.00, 500.00, 580.00, ...),
('op-2', NOW(), 2, 1, 'TRANSFERENCIA_ENTRANTE', 20.00, 30.00, 50.00, ...),
('op-3', NOW(), 3, 1, 'INGRESO', 25.00, 200.00, 225.00, ...),
('op-4', NOW(), 4, 1, 'INGRESO', 35.00, 400.00, 435.00, ...);

-- 4. Actualiza saldos
UPDATE cajas SET saldo_actual = 580.00 WHERE id = 1;
UPDATE cajas SET saldo_actual = 50.00 WHERE id = 2;
UPDATE cajas SET saldo_actual = 225.00 WHERE id = 3;
UPDATE cajas SET saldo_actual = 435.00 WHERE id = 4;

-- 5. Cierra turno
UPDATE turnos_caja SET hora_cierre = '2026-02-07 10:00:00' WHERE id = 'turno-1-id';
```

**Saldos después Turno 1:**

- CAJA: $580.00 (+$80)
- CAJA_CHICA: $50.00 (+$20)
- CAJA_CELULAR: $225.00 (+$25)
- CAJA_BUS: $435.00 (+$35)
- Saldo Virtual Celular: $75.00
- Saldo Virtual Bus: $250.00

---

### TURNO 2 (12:00 - 15:00)

#### Apertura

```sql
INSERT INTO turnos_caja VALUES (
  'turno-2-id',
  '2026-02-07',
  2,                    -- numero_turno
  2,                    -- empleado_id (María)
  '2026-02-07 12:00:00',
  NULL,
  NULL
);
```

#### Cierre (15:00)

**Usuario ingresa:**

- Efectivo: $160.00
- Celular Final: $50.00
- Bus Final: $220.00

**Sistema obtiene saldos anteriores:**

```typescript
// getSaldosAnteriores() - Ordena por created_at DESC
Celular: $75.00 (del turno 1) ✅
Bus: $250.00 (del turno 1) ✅
```

**Sistema calcula (v4.7):**

```
v_transferencia_ya_hecha = TRUE  (el Turno 1 ya transfirió $20 a Varios hoy)

Efectivo disponible = $160 - $40 = $120  (resta solo el fondo)
→ Como ya se transfirió hoy: v_transferencia_efectiva = 0, v_deficit_caja_chica = 0
→ Depósito a Tienda = $120 (todo el efectivo disponible)

Venta Celular = $75 - $50 = $25
Venta Bus = $250 - $220 = $30
```

**Función ejecuta:**

```sql
-- (v4.7) Verificación: ya existe TRANSFERENCIA_ENTRANTE en CAJA_CHICA para 2026-02-07
-- → v_transferencia_ya_hecha = TRUE → v_transferencia_efectiva = 0

-- 1. Cierre
INSERT INTO caja_fisica_diaria (fecha, turno_id, empleado_id, efectivo_recaudado, deficit_caja_chica)
VALUES ('2026-02-07', 'turno-2-id', 2, 160.00, 0);

-- 2. Recargas (con saldos del turno 1)
INSERT INTO recargas VALUES
('rec-cel-2', '2026-02-07', 'turno-2-id', 1, 25.00, 75.00, 50.00, TRUE),
('rec-bus-2', '2026-02-07', 'turno-2-id', 2, 30.00, 250.00, 220.00, TRUE);

-- 3. Operaciones (SIN TRANSFERENCIA a CAJA_CHICA — ya se hizo en Turno 1)
INSERT INTO operaciones_cajas VALUES
('op-5', NOW(), 1, 2, 'INGRESO', 120.00, 580.00, 700.00, ...),  -- $120 (todo el disponible)
-- op-6 NO existe: ya se transfirió hoy
('op-7', NOW(), 3, 2, 'INGRESO', 25.00, 225.00, 250.00, ...),
('op-8', NOW(), 4, 2, 'INGRESO', 30.00, 435.00, 465.00, ...);

-- 4. Actualiza saldos
UPDATE cajas SET saldo_actual = 700.00 WHERE id = 1;  -- CAJA: +120 (no -20 de transferencia)
UPDATE cajas SET saldo_actual = 50.00 WHERE id = 2;   -- CAJA_CHICA: sin cambio (ya recibió hoy)
UPDATE cajas SET saldo_actual = 250.00 WHERE id = 3;
UPDATE cajas SET saldo_actual = 465.00 WHERE id = 4;

-- 5. Cierra turno
UPDATE turnos_caja SET hora_cierre = '2026-02-07 15:00:00' WHERE id = 'turno-2-id';
```

**Saldos Finales del Día (v4.7):**

- CAJA: $700.00 (Turno 1: +$80, Turno 2: +$120 — sin descontar transferencia ya hecha)
- CAJA_CHICA: $50.00 (solo Turno 1: +$20 — **1 sola transferencia diaria** ✅)
- CAJA_CELULAR: $250.00 (Turno 1: +$25, Turno 2: +$25)
- CAJA_BUS: $465.00 (Turno 1: +$35, Turno 2: +$30)
- Saldo Virtual Celular: $50.00
- Saldo Virtual Bus: $220.00

**Resultado:** 2 cierres contables en el mismo día, con 1 sola transferencia a Varios ✅

---

## 9. Queries de Auditoría

### 9.1. Ver Cierres del Día (v4.1)

```sql
SELECT
  t.numero_turno,
  t.hora_apertura,
  t.hora_cierre,
  e.nombre AS empleado,
  cf.efectivo_recaudado,
  c.fondo_fijo_diario,
  c.caja_chica_transferencia_diaria,
  (cf.efectivo_recaudado - c.fondo_fijo_diario - c.caja_chica_transferencia_diaria) AS dinero_depositado
FROM caja_fisica_diaria cf
JOIN turnos_caja t ON cf.turno_id = t.id
JOIN empleados e ON t.empleado_id = e.id
CROSS JOIN configuraciones c
WHERE cf.fecha = '2026-02-07'
ORDER BY t.numero_turno;
```

### 9.2. Ver Operaciones por Turno

```sql
SELECT
  t.numero_turno,
  e.nombre AS empleado,
  c.nombre AS caja,
  o.tipo_operacion,
  o.monto,
  o.saldo_anterior,
  o.saldo_actual,
  o.descripcion
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
JOIN tipos_referencia tr ON o.tipo_referencia_id = tr.id
JOIN caja_fisica_diaria cf ON o.referencia_id = cf.id
JOIN turnos_caja t ON cf.turno_id = t.id
JOIN empleados e ON t.empleado_id = e.id
WHERE cf.fecha = '2026-02-07'
  AND tr.codigo = 'CAJA_FISICA_DIARIA'
ORDER BY t.numero_turno, o.fecha;
```

### 9.3. Ver Recargas por Turno

```sql
SELECT
  t.numero_turno,
  t.hora_apertura,
  t.hora_cierre,
  ts.nombre AS servicio,
  r.venta_dia,
  r.saldo_virtual_anterior,
  r.saldo_virtual_actual,
  r.created_at
FROM recargas r
JOIN turnos_caja t ON r.turno_id = t.id
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
WHERE r.fecha = '2026-02-07'
ORDER BY r.created_at;
```

### 9.4. Ver Turnos del Día

```sql
SELECT
  t.numero_turno,
  e.nombre AS empleado,
  t.hora_apertura,
  t.hora_cierre,
  CASE
    WHEN t.hora_cierre IS NULL THEN 'ABIERTO'
    ELSE 'CERRADO'
  END AS estado,
  CASE
    WHEN cf.id IS NOT NULL THEN 'SÍ'
    ELSE 'NO'
  END AS tiene_cierre
FROM turnos_caja t
JOIN empleados e ON t.empleado_id = e.id
LEFT JOIN caja_fisica_diaria cf ON t.id = cf.turno_id
WHERE t.fecha = '2026-02-07'
ORDER BY t.numero_turno;
```

---

## 10. Función PostgreSQL Completa

```sql
-- ==========================================
-- FUNCIÓN: ejecutar_cierre_diario (v4.7)
-- ==========================================
-- CAMBIOS v4.7:
--   - 1 sola transferencia a Varios por día (sin importar cuántos turnos)
--   - Si ya existe TRANSFERENCIA_ENTRANTE en CAJA_CHICA para p_fecha → skip
--   - En ese caso: v_transferencia_efectiva = 0, v_deficit_caja_chica = 0
--   - El efectivo disponible va todo a Tienda en el segundo turno
-- CAMBIOS v4.6:
--   - Distribución inteligente de efectivo (ya no lanza excepción por déficit)
--   - Lógica "todo o nada" para Caja Chica:
--       Si efectivo - fondo >= transferencia → transfiere completo
--       Si no                               → transfiere $0 (registra déficit)
--   - El sobrante SIEMPRE va a Caja Principal (nunca negativo)
--   - deficit_caja_chica guardado en caja_fisica_diaria para trazabilidad
--   - 3 casos manejados: normal / déficit parcial / déficit total
-- CAMBIOS v4.5:
--   - Fórmula corregida para venta_celular y venta_bus:
--       venta = (saldo_anterior + agregado_dia) - saldo_final
--   - Soporta recargas del proveedor CELULAR y compras de saldo BUS
--   - CRÍTICO: Filtro de recargas_virtuales por created_at > último_cierre_at
--       (NO por fecha = p_fecha) — captura recargas no aplicadas en cierres previos
-- ==========================================

CREATE OR REPLACE FUNCTION public.ejecutar_cierre_diario(  -- v4.7
  p_turno_id                    UUID,
  p_fecha                       DATE,
  p_empleado_id                 INTEGER,
  p_efectivo_recaudado          DECIMAL(12,2),
  p_saldo_celular_final         DECIMAL(12,2),
  p_saldo_bus_final             DECIMAL(12,2),
  p_saldo_anterior_celular      DECIMAL(12,2),
  p_saldo_anterior_bus          DECIMAL(12,2),
  p_saldo_anterior_caja         DECIMAL(12,2),
  p_saldo_anterior_caja_chica   DECIMAL(12,2),
  p_saldo_anterior_caja_celular DECIMAL(12,2),
  p_saldo_anterior_caja_bus     DECIMAL(12,2),
  p_observaciones               TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- IDs de cajas (por código para evitar hardcodeo)
  v_caja_id          INTEGER;
  v_caja_chica_id    INTEGER;
  v_caja_celular_id  INTEGER;
  v_caja_bus_id      INTEGER;

  -- IDs de servicios y referencias
  v_tipo_servicio_celular_id  INTEGER;
  v_tipo_servicio_bus_id      INTEGER;
  v_tipo_ref_caja_fisica_id   INTEGER;
  v_tipo_ref_recargas_id      INTEGER;

  -- Configuración
  v_fondo_fijo           DECIMAL(12,2);
  v_transferencia_diaria DECIMAL(12,2);

  -- Recargas virtuales pendientes (v4.5)
  v_agregado_celular  DECIMAL(12,2);
  v_agregado_bus      DECIMAL(12,2);
  v_ultimo_cierre_at  TIMESTAMP; -- Timestamp del último cierre (para filtrar recargas no aplicadas)

  -- Distribución inteligente de efectivo (v4.6)
  v_efectivo_disponible        DECIMAL(12,2); -- Efectivo tras apartar el fondo
  v_transferencia_efectiva     DECIMAL(12,2); -- Lo que realmente va a Caja Chica (puede ser 0)
  v_deficit_caja_chica         DECIMAL(12,2); -- Lo que faltó para Caja Chica (0 si turno normal)
  v_dinero_a_depositar         DECIMAL(12,2); -- Lo que va a Caja Principal (>= 0 siempre)
  v_transferencia_ya_hecha     BOOLEAN := FALSE; -- (v4.7) ¿Ya se transfirió a Varios hoy?

  -- Saldos finales
  v_saldo_final_caja           DECIMAL(12,2);
  v_saldo_final_caja_chica     DECIMAL(12,2);
  v_venta_celular              DECIMAL(12,2);
  v_venta_bus                  DECIMAL(12,2);
  v_saldo_final_caja_celular   DECIMAL(12,2);
  v_saldo_final_caja_bus       DECIMAL(12,2);

  -- IDs generados
  v_cierre_id          UUID;
  v_recarga_celular_id UUID;
  v_recarga_bus_id     UUID;
  v_turno_cerrado      BOOLEAN := FALSE;
BEGIN
  -- ==========================================
  -- 1. VALIDACIONES DE TURNO
  -- ==========================================

  IF NOT EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id) THEN
    RAISE EXCEPTION 'El turno especificado no existe';
  END IF;

  IF EXISTS (SELECT 1 FROM caja_fisica_diaria WHERE turno_id = p_turno_id) THEN
    RAISE EXCEPTION 'El turno ya tiene un cierre registrado';
  END IF;

  IF EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND hora_cierre IS NOT NULL) THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  -- ==========================================
  -- 2. OBTENER IDs POR CÓDIGO
  -- ==========================================

  SELECT id INTO v_caja_id          FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_caja_chica_id    FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_caja_celular_id  FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id      FROM cajas WHERE codigo = 'CAJA_BUS';

  SELECT id INTO v_tipo_servicio_celular_id FROM tipos_servicio  WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_servicio_bus_id     FROM tipos_servicio  WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_caja_fisica_id  FROM tipos_referencia WHERE codigo = 'CAJA_FISICA_DIARIA';
  SELECT id INTO v_tipo_ref_recargas_id     FROM tipos_referencia WHERE codigo = 'RECARGAS';

  -- ==========================================
  -- 3. OBTENER CONFIGURACIÓN
  -- ==========================================

  SELECT fondo_fijo_diario, caja_chica_transferencia_diaria
  INTO v_fondo_fijo, v_transferencia_diaria
  FROM configuraciones
  LIMIT 1;

  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema';
  END IF;

  -- ==========================================
  -- 4. OBTENER TIMESTAMP DEL ÚLTIMO CIERRE
  -- ==========================================

  -- Busca el cierre más reciente (cualquier turno) para saber hasta dónde
  -- ya se incorporaron las recargas virtuales
  SELECT MAX(created_at)
  INTO v_ultimo_cierre_at
  FROM caja_fisica_diaria;

  -- ==========================================
  -- 5. RECARGAS VIRTUALES PENDIENTES (v4.5 CORREGIDO)
  -- ==========================================
  -- IMPORTANTE: Filtra por created_at > último cierre, NO por fecha = hoy
  -- Esto captura todas las recargas no incorporadas en cierres previos,
  -- incluso si tienen fecha anterior (ej: recarga del 21 cerrada el 23)

  SELECT COALESCE(SUM(monto_virtual), 0)
  INTO v_agregado_celular
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_servicio_celular_id
    AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at);

  SELECT COALESCE(SUM(monto_virtual), 0)
  INTO v_agregado_bus
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_servicio_bus_id
    AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at);

  -- ==========================================
  -- 6. DISTRIBUCIÓN INTELIGENTE DE EFECTIVO (v4.7)
  --
  -- Regla de negocio: solo 1 transferencia a Varios por día.
  -- Si ya se transfirió en un turno anterior del mismo día → skip.
  --
  -- Prioridades (cuando no se ha transferido aún):
  --   1° Fondo fijo (para dar vueltos mañana)
  --   2° Caja Chica: todo o nada (si no alcanza el monto completo → $0)
  --   3° Caja Principal: lo que sobre (siempre >= 0)
  --
  -- Casos:
  --   YA TRANSFERIDO HOY: chica = $0, deficit = $0, principal = efectivo - fondo
  --   NORMAL:          efectivo >= fondo + transferencia
  --                    → chica = transferencia (completo), principal = efectivo - fondo - transferencia
  --   DÉFICIT PARCIAL: fondo <= efectivo < fondo + transferencia
  --                    → chica = $0 (todo o nada), principal = efectivo - fondo, deficit = transferencia
  --   DÉFICIT TOTAL:   efectivo < fondo
  --                    → chica = $0, principal = $0, deficit = transferencia
  --                    → fondo queda incompleto (el efectivo disponible es lo que hay)
  -- ==========================================

  -- Efectivo disponible tras apartar el fondo (puede ser negativo si ni el fondo alcanza)
  v_efectivo_disponible := p_efectivo_recaudado - v_fondo_fijo;

  -- (v4.7) Verificar si ya se hizo la transferencia a Varios hoy
  -- Usar columna `fecha` (TIMESTAMP WITH TIME ZONE, campo real de la tabla)
  -- con timezone local para evitar desfase UTC en cierres nocturnos
  SELECT EXISTS (
    SELECT 1 FROM operaciones_cajas
    WHERE caja_id        = v_caja_chica_id
      AND tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
      AND (fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
  ) INTO v_transferencia_ya_hecha;

  IF v_transferencia_ya_hecha THEN
    -- Ya se transfirió hoy en otro turno: Varios no recibe nada, sin déficit
    v_transferencia_efectiva := 0;
    v_deficit_caja_chica     := 0;
    v_dinero_a_depositar     := GREATEST(0, v_efectivo_disponible);
  ELSIF v_efectivo_disponible >= v_transferencia_diaria THEN
    -- CASO NORMAL: alcanza para transferencia completa
    v_transferencia_efectiva := v_transferencia_diaria;
    v_deficit_caja_chica     := 0;
    v_dinero_a_depositar     := v_efectivo_disponible - v_transferencia_diaria;
  ELSIF v_efectivo_disponible > 0 THEN
    -- CASO DÉFICIT PARCIAL: hay algo pero no alcanza para la transferencia completa
    -- Por política "todo o nada": Caja Chica recibe $0, el sobrante va a Principal
    v_transferencia_efectiva := 0;
    v_deficit_caja_chica     := v_transferencia_diaria;
    v_dinero_a_depositar     := v_efectivo_disponible; -- el sobrante tras el fondo va a Principal
  ELSE
    -- CASO DÉFICIT TOTAL: ni el fondo alcanza
    v_transferencia_efectiva := 0;
    v_deficit_caja_chica     := v_transferencia_diaria;
    v_dinero_a_depositar     := 0;
  END IF;

  -- ==========================================
  -- 7. CALCULAR VENTAS VIRTUALES (v4.5)
  -- ==========================================

  v_venta_celular := (p_saldo_anterior_celular + v_agregado_celular) - p_saldo_celular_final;
  v_venta_bus     := (p_saldo_anterior_bus     + v_agregado_bus)     - p_saldo_bus_final;

  -- Validar ventas negativas (indican falta de registro en Recargas Virtuales)
  IF v_venta_celular < 0 THEN
    RAISE EXCEPTION 'Venta celular negativa ($%). Registrá la recarga del proveedor en Recargas Virtuales antes de cerrar.', v_venta_celular;
  END IF;

  IF v_venta_bus < 0 THEN
    RAISE EXCEPTION 'Venta bus negativa ($%). Registrá la compra de saldo virtual en Recargas Virtuales antes de cerrar.', v_venta_bus;
  END IF;

  -- ==========================================
  -- 8. CALCULAR SALDOS FINALES
  -- ==========================================

  v_saldo_final_caja           := p_saldo_anterior_caja         + v_dinero_a_depositar;
  v_saldo_final_caja_chica     := p_saldo_anterior_caja_chica   + v_transferencia_efectiva;
  v_saldo_final_caja_celular   := p_saldo_anterior_caja_celular + v_venta_celular;
  v_saldo_final_caja_bus       := p_saldo_anterior_caja_bus     + v_venta_bus;

  -- ==========================================
  -- 9. INSERTAR caja_fisica_diaria (con deficit_caja_chica)
  -- ==========================================

  INSERT INTO caja_fisica_diaria (
    id, fecha, turno_id, empleado_id,
    efectivo_recaudado, deficit_caja_chica, observaciones, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id,
    p_efectivo_recaudado, v_deficit_caja_chica, p_observaciones, NOW()
  )
  RETURNING id INTO v_cierre_id;

  -- ==========================================
  -- 10. OPERACIÓN EN CAJA PRINCIPAL
  -- Solo si hay algo que depositar
  -- ==========================================

  IF v_dinero_a_depositar > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_id, p_empleado_id, 'INGRESO', v_dinero_a_depositar,
      p_saldo_anterior_caja, v_saldo_final_caja,
      'Depósito del turno ' || p_fecha,
      v_tipo_ref_caja_fisica_id, v_cierre_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 11. TRANSFERENCIA A CAJA_CHICA
  -- Solo si la transferencia es efectiva (no en déficit)
  -- ==========================================

  IF v_transferencia_efectiva > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_chica_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', v_transferencia_efectiva,
      p_saldo_anterior_caja_chica, v_saldo_final_caja_chica,
      'Transferencia diaria desde caja física - turno ' || p_fecha,
      v_tipo_ref_caja_fisica_id, v_cierre_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 12. RECARGAS CELULAR
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, turno_id, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id, v_tipo_servicio_celular_id,
    v_venta_celular, p_saldo_anterior_celular, p_saldo_celular_final,
    (v_venta_celular + p_saldo_celular_final) = (p_saldo_anterior_celular + v_agregado_celular),
    NOW()
  )
  RETURNING id INTO v_recarga_celular_id;

  IF v_venta_celular > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_celular_id, p_empleado_id, 'INGRESO', v_venta_celular,
      p_saldo_anterior_caja_celular, v_saldo_final_caja_celular,
      'Venta celular del turno ' || p_fecha,
      v_tipo_ref_recargas_id, v_recarga_celular_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 13. RECARGAS BUS
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, turno_id, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id, v_tipo_servicio_bus_id,
    v_venta_bus, p_saldo_anterior_bus, p_saldo_bus_final,
    (v_venta_bus + p_saldo_bus_final) = (p_saldo_anterior_bus + v_agregado_bus),
    NOW()
  )
  RETURNING id INTO v_recarga_bus_id;

  IF v_venta_bus > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_bus_id, p_empleado_id, 'INGRESO', v_venta_bus,
      p_saldo_anterior_caja_bus, v_saldo_final_caja_bus,
      'Venta bus del turno ' || p_fecha,
      v_tipo_ref_recargas_id, v_recarga_bus_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 14. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================

  UPDATE cajas SET saldo_actual = v_saldo_final_caja,          updated_at = NOW() WHERE id = v_caja_id;
  UPDATE cajas SET saldo_actual = v_saldo_final_caja_chica,    updated_at = NOW() WHERE id = v_caja_chica_id;
  UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular,  updated_at = NOW() WHERE id = v_caja_celular_id;
  UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus,      updated_at = NOW() WHERE id = v_caja_bus_id;

  -- ==========================================
  -- 15. CERRAR TURNO
  -- ==========================================

  UPDATE turnos_caja SET hora_cierre = NOW() WHERE id = p_turno_id;
  v_turno_cerrado := TRUE;

  -- ==========================================
  -- 16. RETORNAR RESUMEN
  -- ==========================================

  RETURN json_build_object(
    'success',       true,
    'cierre_id',     v_cierre_id,
    'turno_id',      p_turno_id,
    'fecha',         p_fecha,
    'turno_cerrado', v_turno_cerrado,
    'version',       '4.7',
    'configuracion', json_build_object(
      'fondo_fijo',           v_fondo_fijo,
      'transferencia_diaria', v_transferencia_diaria
    ),
    'distribucion_efectivo', json_build_object(
      'efectivo_recaudado',      p_efectivo_recaudado,
      'fondo_fisico',            GREATEST(p_efectivo_recaudado, v_fondo_fijo) - GREATEST(p_efectivo_recaudado - v_fondo_fijo, 0),
      'transferencia_caja_chica', v_transferencia_efectiva,
      'deposito_caja_principal', v_dinero_a_depositar,
      'deficit_caja_chica',      v_deficit_caja_chica,
      'turno_con_deficit',       (v_deficit_caja_chica > 0)
    ),
    'recargas_virtuales_dia', json_build_object(
      'celular', v_agregado_celular,
      'bus',     v_agregado_bus
    ),
    'saldos_finales', json_build_object(
      'caja',         v_saldo_final_caja,
      'caja_chica',   v_saldo_final_caja_chica,
      'caja_celular', v_saldo_final_caja_celular,
      'caja_bus',     v_saldo_final_caja_bus
    ),
    'ventas', json_build_object(
      'celular', v_venta_celular,
      'bus',     v_venta_bus
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error en cierre diario v4.7: %', SQLERRM;
END;
$function$;

-- Permisos explícitos (evita problemas de caché en PostgREST)
GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO anon;

-- Refrescar caché de PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.ejecutar_cierre_diario IS
'Cierre diario v4.7 — 1 sola transferencia a Varios por día + distribución inteligente de efectivo con registro de déficit en caja_fisica_diaria.';
```

### 10.2. Función Auxiliar: `verificar_transferencia_caja_chica_hoy` (v4.7)

Usada por la UI (`recargas.service.ts`) al pasar del Paso 1 al Paso 2 del cierre.
Retorna `TRUE` si ya existe una `TRANSFERENCIA_ENTRANTE` en `CAJA_CHICA` para la fecha indicada.

```sql
CREATE OR REPLACE FUNCTION public.verificar_transferencia_caja_chica_hoy(p_fecha DATE)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM operaciones_cajas oc
    JOIN cajas c ON c.id = oc.caja_id
    WHERE c.codigo = 'CAJA_CHICA'
      AND oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
      AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
  );
$function$;

GRANT EXECUTE ON FUNCTION public.verificar_transferencia_caja_chica_hoy(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_transferencia_caja_chica_hoy(DATE) TO anon;

NOTIFY pgrst, 'reload schema';
```

---

## 11. Troubleshooting

### 11.1. Error: "El turno especificado no existe"

**Causa:** El `turno_id` pasado a la función no existe en la tabla `turnos_caja`.

**Solución:**

1. Verificar que se haya abierto un turno antes de cerrar
2. Verificar que el turno_id sea correcto

```sql
-- Ver turnos del día
SELECT * FROM turnos_caja WHERE fecha = CURRENT_DATE;
```

### 11.2. Error: "El turno ya tiene un cierre registrado"

**Causa:** Ya existe un registro en `caja_fisica_diaria` con ese `turno_id`.

**Solución:**

1. Verificar si el turno ya fue cerrado
2. Abrir un nuevo turno si deseas hacer otro cierre

```sql
-- Ver si el turno tiene cierre
SELECT
  t.*,
  cf.id AS cierre_id
FROM turnos_caja t
LEFT JOIN caja_fisica_diaria cf ON t.id = cf.turno_id
WHERE t.fecha = CURRENT_DATE;
```

### 11.3. Error: "El turno ya está cerrado"

**Causa:** El turno tiene `hora_cierre` diferente de NULL.

**Solución:**

- Abrir un nuevo turno para hacer otro cierre

```sql
-- Ver estado del turno
SELECT
  *,
  CASE
    WHEN hora_cierre IS NULL THEN 'ABIERTO'
    ELSE 'CERRADO'
  END AS estado
FROM turnos_caja
WHERE fecha = CURRENT_DATE;
```

### 11.4. Error: "Ya existe un cierre registrado para el día de hoy" (TypeScript)

**Causa:** La validación TypeScript no está actualizada a v4.1.

**Solución:**

- Asegurarse que `existeCierreDiario()` valida por turno activo (no por fecha)

```typescript
// Debe validar:
1. Buscar turno activo (sin hora_cierre)
2. Si no hay turno activo → false
3. Si hay turno activo → verificar si tiene cierre
```

### 11.5. Continuidad de saldos incorrecta entre turnos

**Causa:** `getSaldosAnteriores()` no está usando `order by created_at`.

**Solución:**

```typescript
// Debe ordenar por created_at (no solo por fecha)
.order('created_at', { ascending: false })
```

---

## Resumen

### Flujo en 4 Pasos (v4.1)

1. ✅ **Abrir Turno** - INSERT en turnos_caja
2. ✅ **Trabajar** - Usuario opera durante su turno
3. ✅ **Ingresar** - Solo 1 campo: efectivo contado
4. ✅ **Confirmar** - Función transaccional PostgreSQL + cierre de turno

### Ventajas Versión 4.1

- 🔄 **Múltiples turnos**: Varios empleados pueden cerrar el mismo día
- ✨ **Ultra-simple**: Solo 1 campo de entrada
- ⚡ **Rápido**: Menos datos = cierre más rápido
- 🎯 **Sin errores**: Sistema calcula automáticamente
- 🔧 **Configurable**: Fondo fijo desde config
- 📊 **Trazable por turno**: Cada operación vinculada a su turno
- 🔗 **Continuidad garantizada**: Saldos se pasan correctamente entre turnos

### Garantías del Sistema

- 🔒 **Transaccional**: Rollback automático
- 🔍 **Trazable**: Origen de cada operación por turno
- ✅ **Validado**: Múltiples capas de validación
- 📊 **Auditable**: Historial completo por turno
- ⚙️ **Configuración centralizada**: Cambios globales desde config
- 🕐 **Turnos independientes**: Cada turno con su cierre

### Archivos Relacionados

**Base de Datos:**

- 🗄️ [Schema de Base de Datos v4.1](../../../../doc/schema_inicial_completo.sql)
- ⚙️ [Función PostgreSQL v4.1](funcion_cierre_diario_v4.sql)

**Código Frontend:**

- 💻 [Cierre Diario Page (TS)](../pages/cierre-diario/cierre-diario.page.ts)
- 🎨 [Cierre Diario Page (HTML)](../pages/cierre-diario/cierre-diario.page.html)
- 🔧 [Recargas Service](../services/recargas.service.ts)
- 🕐 [Turnos Caja Service](../services/turnos-caja.service.ts)

**Documentación:**

- 📖 [Dashboard README](./DASHBOARD-README.md)
- 📖 [Actualización UI sin Recarga](./ACTUALIZACION-UI-SIN-RECARGA.md)

---

## 📝 HISTORIAL DE VERSIONES

### Versión 4.7 (2026-02-20 → 2026-02-21)

**PostgreSQL (`ejecutar_cierre_diario`):**

- ✅ **1 sola transferencia a Varios por día** — si ya existe `TRANSFERENCIA_ENTRANTE` en `CAJA_CHICA` para `p_fecha`, el turno actual no transfiere nada
- ✅ Variable `v_transferencia_ya_hecha` — verifica con `(fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha` (timezone-safe)
- ✅ En turno sin transferir aún: comportamiento idéntico a v4.6 (lógica "todo o nada")
- ✅ En turno con transferencia ya hecha: `v_transferencia_efectiva = 0`, `v_deficit_caja_chica = 0`, sobrante todo a Tienda
- ✅ Sin cambio en el schema — usa columna `fecha` existente en `operaciones_cajas`
- ✅ Delimitador cambiado a `$function$` para compatibilidad con editor de Supabase

**Nueva función auxiliar (`verificar_transferencia_caja_chica_hoy`):**

- ✅ Función SQL simple que retorna `BOOLEAN` — usada por la UI antes de mostrar el Paso 2
- ✅ Misma lógica timezone-safe que `ejecutar_cierre_diario`

**TypeScript (`cierre-diario.page.ts`):**

- ✅ Propiedad `transferenciaCajaChicaYaHecha = false` — flag que refleja el estado real de la BD
- ✅ `siguientePaso()` consulta `verificarTransferenciaYaHecha()` antes de avanzar al Paso 2
- ✅ Getter `transferenciaEfectivaCajaChica` → retorna 0 si ya se hizo hoy
- ✅ Getter `deficitCajaChica` → retorna 0 si ya se hizo (no es déficit)
- ✅ Getter `dineroADepositar` → si ya se hizo, todo el efectivo disponible va a Tienda

**TypeScript (`recargas.service.ts`):**

- ✅ Nuevo método `verificarTransferenciaYaHecha()` → llama a RPC `verificar_transferencia_caja_chica_hoy`

**UI (`cierre-diario.page.html` / `.scss`):**

- ✅ Paso 2 desglose: línea "Varios" muestra chip verde `✅ ya recibió hoy` y valor `$0` en verde
- ✅ Verificación de cajas: VARIOS muestra chip verde + borde izquierdo verde
- ✅ Instrucciones físicas: 5 bloques mutuamente excluyentes (sin superposición):
  1. **Normal 1er turno** — acciones estándar con transferencia a Varios
  2. **Normal 2do turno** — "Varios ya recibió hoy, no separar nada"
  3. **Déficit parcial** — Varios no recibe, resto a Tienda
  4. **Déficit total** — ni fondo ni Varios; condicional por `transferenciaCajaChicaYaHecha`
  5. **Sin efectivo ($0)** — condicional por `transferenciaCajaChicaYaHecha`: muestra chip verde si ya recibió, o "faltaron $20" si no; nota omite "reponer a Varios" cuando ya se hizo
- ✅ Bloque "sin efectivo": usa `transferenciaDiariaCajaChica` (el valor de config $20) en lugar de `deficitCajaChica` ($0 cuando ya hecha) — evita mostrar "faltaron $0.00"
- ✅ Todos los textos "CAJA CHICA" → **"VARIOS"**, "CAJA PRINCIPAL" → **"TIENDA"** (coherente con UI labels)
- ✅ Estilos `.ya-hecha-badge` con `@extend .deficit-badge` + colores verdes

### Versión 4.6 (2026-02-20)

- ✅ **Distribución inteligente de efectivo** — ya no lanza excepción por déficit
- ✅ **Política "todo o nada"** para transferencia a Caja Chica
- ✅ **`deficit_caja_chica`** en `caja_fisica_diaria` (trazabilidad del faltante)
- ✅ **3 casos manejados:** normal / déficit parcial / déficit total
- ✅ Sobrante siempre va a Caja Principal (nunca negativo)
- ✅ INGRESO en CAJA PRINCIPAL y TRANSFERENCIA en CAJA CHICA solo se registran si monto > 0
- ✅ Función con `SECURITY DEFINER` + `GRANT EXECUTE` + `NOTIFY pgrst` (patrón estable)

### Versión 4.5 (2026-02-11)

- ✅ **Fórmula de venta incluye agregado del proveedor**
- ✅ `recargas_virtuales` integradas en el cálculo del cierre
- ✅ `venta = (saldo_anterior + agregado_hoy) - saldo_final`
- ✅ Tabla `recargas_virtuales` (CELULAR: crédito / BUS: depósito directo)
- ✅ Módulo "Saldo Virtual" para registrar cargas del proveedor
- ✅ Comisión CELULAR: `monto_a_pagar = monto_virtual * 0.95`
- ✅ `getSaldoVirtualActual()` muestra cierre + cargas posteriores no aplicadas
- ✅ **CRÍTICO:** Filtro de `recargas_virtuales` por `created_at > último_cierre_at` (NO por `fecha = p_fecha`)
  - Captura recargas no incorporadas en cierres previos, sin importar su fecha
  - Evita error "Venta negativa" cuando hay recargas con fecha anterior pendientes de aplicar
  - Ejemplo: recarga del 21/02 puede aplicarse en cierre del 23/02 si no hubo cierre el 22/02

### Versión 4.1 (2026-02-07)

- ✅ **Múltiples cierres por día** (1 cierre por turno)
- ✅ Tabla `turnos_caja` agregada
- ✅ Campo `turno_id` en `caja_fisica_diaria` y `recargas`
- ✅ UNIQUE(turno_id, tipo_servicio_id) en recargas
- ✅ Validaciones de turno en función SQL
- ✅ Cierre automático de turno en función SQL
- ✅ `getSaldosAnteriores()` actualizado (order by created_at)
- ✅ `existeCierreDiario()` actualizado (valida por turno)
- ✅ Continuidad de saldos entre turnos garantizada

### Versión 4.0 (2026-02-05)

- ✅ Ultra-simplificado: Solo 1 campo de entrada
- ✅ Configuración centralizada (fondo_fijo_diario)
- ✅ Fórmula simplificada: depósito = efectivo - fondo - transferencia
- ✅ Eliminados campos: saldo_inicial, egresos_del_dia, fondo_siguiente_dia, transferencia_caja_chica
- ✅ UI mejorada con guía visual "¿Qué hacer con el dinero?"

### Versión 3.0

- ✅ Renombrado cierres_diarios → caja_fisica_diaria
- ✅ Ajustes en función PostgreSQL

### Versión 2.0

- ✅ Separación caja física vs acumulación
- ✅ Nuevos campos: saldo_inicial, egresos_del_dia, fondo_siguiente_dia

### Versión 1.0

- ✅ Implementación inicial

---

**Fecha de Actualización:** 2026-02-21
**Versión:** 4.7 (1 sola transferencia a Varios por día + Distribución inteligente de efectivo + Registro de déficit Caja Chica + 5 casos UI mutuamente excluyentes)
**Autor:** Sistema Mi Tienda
