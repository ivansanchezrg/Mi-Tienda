# Implementación: Modelo Proveedor CELULAR

## Problema

El modelo actual usa `venta_dia = saldo_anterior - saldo_actual`.
Cuando el proveedor recarga saldo virtual, `saldo_actual > saldo_anterior` → **venta negativa incorrecta**.

Para CELULAR esto es incorrecto porque la recarga del proveedor **NO mueve efectivo** —
es un préstamo que crea una deuda. El efectivo solo se mueve cuando el proveedor cobra.

---

## Flujo Real del Negocio CELULAR

```
Proveedor carga $210 virtual ($200 base + $10 comisión tuya)
    → Saldo virtual sube
    → Se crea DEUDA de $200 (no sale efectivo todavía)

Durante la semana: clientes compran recargas
    → Saldo virtual baja
    → Efectivo ENTRA → INGRESO a CAJA_CELULAR

Proveedor viene a cobrar (normalmente el lunes)
    → Paga $200 (o $400 si dejó acumular)
    → Efectivo SALE → EGRESO de CAJA_CELULAR
```

### Fórmula corregida

```
venta_dia = (saldo_anterior + recarga_proveedor_del_dia) - saldo_actual
```

**Ejemplo con recarga:**
- Saldo anterior: $90
- Proveedor cargó hoy: $210
- Saldo actual al cerrar: $285 (vendiste $15)
- Venta = (90 + 210) - 285 = **$15** ✓ (solo lo vendido, no lo prestado)

---

## Cambios en Base de Datos

### 1. Nueva tabla: `recargas_proveedor`

Registra cada vez que el proveedor carga saldo virtual (el préstamo).

```sql
CREATE TABLE recargas_proveedor (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha               DATE NOT NULL,
  tipo_servicio_id    INT NOT NULL REFERENCES tipos_servicio(id),
  monto_virtual       NUMERIC(10,2) NOT NULL,   -- $210 (lo que cargó en virtual)
  monto_base          NUMERIC(10,2) NOT NULL,   -- $200 (lo que debes pagar)
  comision_ganada     NUMERIC(10,2) NOT NULL,   -- $10  (tu ganancia)
  pagado              BOOLEAN DEFAULT false,
  fecha_pago          DATE,
  operacion_pago_id   UUID REFERENCES operaciones_cajas(id),
  empleado_id         INT NOT NULL REFERENCES empleados(id),
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Nuevo valor en `tipos_referencia`

```sql
INSERT INTO tipos_referencia (codigo, nombre)
VALUES ('PAGO_PROVEEDOR', 'Pago a Proveedor');
```

Necesario para registrar el EGRESO cuando se paga al proveedor.

### 3. Sin cambios en `recargas`

No se agrega ningún campo. El cierre diario consulta `recargas_proveedor` internamente.

### 4. Modificar función PostgreSQL `ejecutar_cierre_diario`

Agregar lógica para consultar recargas del proveedor del día y corregir la fórmula:

```sql
-- Obtener total de recarga del proveedor del día (puede ser 0)
SELECT COALESCE(SUM(monto_virtual), 0)
INTO v_recarga_proveedor_celular
FROM recargas_proveedor
WHERE fecha = p_fecha
  AND tipo_servicio_id = v_tipo_celular_id;

-- Fórmula corregida
v_venta_celular := (p_saldo_anterior_celular + v_recarga_proveedor_celular)
                   - p_saldo_celular_final;
```

### 5. Nueva función PostgreSQL `registrar_pago_proveedor`

Registra el pago al proveedor de forma atómica:
- Marca deudas como `pagado = true`
- Crea EGRESO en `operaciones_cajas`
- Actualiza saldo de CAJA_CELULAR

---

## Nuevas Páginas

### Página: `proveedor-celular`

Una sola página con **2 secciones** (tabs o scroll):

#### Sección 1: "Nueva Recarga"
Registrar cuando el proveedor carga saldo virtual.

**Campos:**
| Campo | Tipo | Descripción |
|-------|------|-------------|
| Monto virtual cargado | Número | Lo que subió en virtual (ej: $210) |
| Fecha | Auto | Fecha local de hoy |

**Sistema calcula automáticamente:**
- `monto_base` = monto_virtual / (1 + comision_pct/100) = $210 / 1.05 = **$200**
- `comision_ganada` = monto_virtual - monto_base = **$10**

**Al confirmar:**
1. INSERT en `recargas_proveedor` (pendiente de pago)
2. Mostrar resumen: "Deuda registrada: $200 · Ganancia: $10"

> **Nota:** No afecta CAJA_CELULAR ni saldos de cajas.

---

#### Sección 2: "Deudas Pendientes"
Lista de recargas del proveedor no pagadas.

**Vista de cada deuda:**
```
📅 3 Feb 2026
Virtual cargado:  $210.00
A pagar:          $200.00    ← deuda real
Ganancia tuya:     $10.00
```

**Si hay múltiples deudas** (ej: 2 semanas acumuladas):
- Muestra cada una listada
- Checkbox para seleccionar cuáles pagar
- Total calculado automáticamente (ej: $400)

**Al confirmar pago:**
1. INSERT en `operaciones_cajas` (EGRESO de CAJA_CELULAR)
2. UPDATE `recargas_proveedor` → `pagado = true`, `operacion_pago_id = UUID`
3. UPDATE `cajas` → saldo de CAJA_CELULAR reducido

---

## Páginas Modificadas

### Cierre Diario

**Sin cambios en UI.** El backend (`ejecutar_cierre_diario`) automáticamente
consulta si hubo recarga del proveedor ese día y corrige la fórmula.

El empleado solo hace lo de siempre: ingresar saldo virtual actual.

---

## Navegación

Agregar al sidebar:

```
Dashboard
├── Inicio
├── Cierre Diario
├── Cuadre de Caja
├── Recargas             (historial)
├── Proveedor Celular    ← NUEVO
├── Operaciones
└── Configuración
```

---

## Archivos a Crear/Modificar

### Nuevos
```
src/app/features/dashboard/pages/proveedor-celular/
├── proveedor-celular.page.ts
├── proveedor-celular.page.html
└── proveedor-celular.page.scss

supabase/functions/registrar_pago_proveedor.sql
```

### Modificados
```
docs/schema_inicial_completo.sql
  → Agregar tabla recargas_proveedor
  → Agregar tipo_referencia PAGO_PROVEEDOR

docs/funcion_cierre_diario_v4.sql (o el existente)
  → Corregir fórmula venta_celular

src/app/features/dashboard/dashboard.routes.ts
  → Agregar ruta proveedor-celular

src/app/shared/components/sidebar/sidebar.component.ts
  → Agregar item de menú
```

### Servicio (nuevo método)
```typescript
// En recargas.service.ts o nuevo proveedor.service.ts:
registrarRecargaProveedor(params): Promise<void>
obtenerDeudasPendientes(tipoServicio): Promise<DeudaProveedor[]>
registrarPagoProveedor(deudaIds[], montoTotal): Promise<void>
```

---

## Resumen de impacto

| Componente | Cambio | Complejidad |
|-----------|--------|-------------|
| Schema BD | Nueva tabla + 1 tipo_referencia | Baja |
| `ejecutar_cierre_diario` | Corregir fórmula celular | Baja |
| Nueva función PostgreSQL | `registrar_pago_proveedor` | Media |
| Nueva página | `proveedor-celular` (2 secciones) | Media |
| Sidebar | +1 item | Mínima |
| Cierre diario UI | Sin cambios | Ninguna |

---

## Lo que NO cambia

- Flujo del cierre diario (UI igual)
- Cuadre de Caja (sigue siendo calculadora visual)
- Historial de Recargas (sin cambios)
- Proceso BUS (se analiza por separado)
