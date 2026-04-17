# Plan de Implementacion — Movimientos Empleados (Cuenta Corriente)

> **Estado:** APROBADO
> **Fecha:** 2026-04-13
> **Reemplaza:** tabla `deudas_empleados` + servicio `DeudasEmpleadosService` (codigo muerto)

---

## 1. Resumen Ejecutivo

Reemplazar la tabla `deudas_empleados` (que solo registra faltantes de caja) por un sistema de **cuenta corriente por empleado** (`movimientos_empleados`). Esto permite:

- Registrar sueldos devengados, faltantes, adelantos y pagos de nomina
- Calcular automaticamente el liquido a pagar (sueldo - descuentos)
- Auditar cada movimiento con trazabilidad cruzada a turnos y operaciones de caja
- Liquidar todo en un solo flujo transaccional

### Ejemplo de flujo completo

```
Empleado: Maria | Sueldo: $500/mes

Dia 5:  FALTANTE_CAJA    -$5.00   (cierre diario automatico)
Dia 12: ADELANTO_SUELDO  -$20.00  (egreso de CAJA_CHICA, ella pidio adelanto)
Dia 30: SUELDO_BASE      +$500.00 (admin devenga el sueldo del mes)

Saldo pendiente: $500 - $5 - $20 = $475.00 liquido a pagar

Dia 30: PAGO_NOMINA      -$475.00 (egreso de caja + liquidacion)
         -> Todos los registros pasan a LIQUIDADO
         -> Cuenta en cero
```

---

## 2. Cambios en Base de Datos (schema.sql)

### 2.1 Eliminar

| Elemento | Accion |
|---|---|
| Tabla `deudas_empleados` | `DROP TABLE` |
| Indice `idx_deudas_empleado` | Se borra con el DROP |
| Indice `idx_deudas_estado` | Se borra con el DROP |
| Indice `idx_deudas_turno` | Se borra con el DROP |

### 2.2 Agregar — Enum

```sql
CREATE TYPE tipo_movimiento_empleado_enum AS ENUM (
    'SUELDO_BASE',       -- (+) Sueldo devengado del periodo
    'BONO_COMISION',     -- (+) Extras a favor del empleado
    'FALTANTE_CAJA',     -- (-) Faltante de conteo fisico al cierre
    'ADELANTO_SUELDO',   -- (-) Anticipo/prestamo en efectivo
    'PAGO_NOMINA',       -- (-) Pago final del periodo (liquida todo)
    'AJUSTE'             -- (+/-) Correccion manual del admin
);
```

**Signo logico por tipo:**

| Tipo | Signo | Descripcion |
|---|---|---|
| `SUELDO_BASE` | + | El negocio le debe al empleado |
| `BONO_COMISION` | + | Extra a favor del empleado |
| `FALTANTE_CAJA` | - | El empleado debe al negocio (descuento) |
| `ADELANTO_SUELDO` | - | Anticipo que se descuenta del sueldo |
| `PAGO_NOMINA` | - | Liquidacion: sale efectivo de caja |
| `AJUSTE` | +/- | El campo `es_cargo` define la direccion |

### 2.3 Agregar — Tabla `movimientos_empleados`

```sql
-- Reemplaza deudas_empleados — cuenta corriente completa por empleado
-- Registra todo lo que el negocio le debe al empleado y viceversa.
-- El saldo se calcula sumando los movimientos (no se almacena):
--   saldo > 0 → el negocio le debe al empleado
--   saldo < 0 → el empleado le debe al negocio
--   saldo = 0 → al dia
CREATE TABLE IF NOT EXISTS movimientos_empleados (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empleado_id         INTEGER NOT NULL REFERENCES usuarios(id),
    fecha               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_movimiento     tipo_movimiento_empleado_enum NOT NULL,
    monto               DECIMAL(12,2) NOT NULL CHECK (monto > 0),  -- siempre positivo, signo lo da el tipo

    -- Trazabilidad cruzada (nullable — no todo movimiento viene de otra tabla)
    turno_id            UUID REFERENCES turnos_caja(id),            -- FALTANTE_CAJA viene del cierre

    descripcion         TEXT,

    -- Liquidacion: indica si este movimiento ya fue incluido en un pago de nomina
    estado_liquidacion  VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                          CHECK (estado_liquidacion IN ('PENDIENTE', 'LIQUIDADO')),
    liquidado_en        UUID REFERENCES movimientos_empleados(id),  -- apunta al PAGO_NOMINA que lo liquido

    creado_por          INTEGER REFERENCES usuarios(id),            -- quien registro el movimiento
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2.4 Agregar — Indices

```sql
-- Calculo de saldo: filtra PENDIENTE por empleado
CREATE INDEX IF NOT EXISTS idx_mov_empleados_saldo
  ON movimientos_empleados(empleado_id, estado_liquidacion);

-- Historial cronologico por empleado
CREATE INDEX IF NOT EXISTS idx_mov_empleados_fecha
  ON movimientos_empleados(empleado_id, fecha DESC);

-- Lookup por turno (para el cierre diario)
CREATE INDEX IF NOT EXISTS idx_mov_empleados_turno
  ON movimientos_empleados(turno_id) WHERE turno_id IS NOT NULL;
```

### 2.5 Agregar — Vista `v_saldos_empleados`

```sql
-- Vista que calcula el saldo actual de cada empleado a partir de sus movimientos PENDIENTES
-- Uso: sidebar badge, pagina de cuentas empleados, calculo de liquido a pagar
CREATE OR REPLACE VIEW v_saldos_empleados AS
SELECT
  u.id AS empleado_id,
  u.nombre,
  COALESCE(SUM(
    CASE
      WHEN m.tipo_movimiento IN ('SUELDO_BASE', 'BONO_COMISION') THEN m.monto
      WHEN m.tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'PAGO_NOMINA') THEN -m.monto
      WHEN m.tipo_movimiento = 'AJUSTE' THEN
        CASE WHEN m.es_cargo THEN -m.monto ELSE m.monto END
    END
  ), 0) AS saldo
FROM usuarios u
LEFT JOIN movimientos_empleados m
  ON m.empleado_id = u.id
  AND m.estado_liquidacion = 'PENDIENTE'
WHERE u.activo = TRUE
  AND u.rol IN ('ADMIN', 'EMPLEADO')
GROUP BY u.id, u.nombre;

-- Interpretacion:
--   saldo > 0 → el negocio le debe al empleado (sueldo pendiente)
--   saldo < 0 → el empleado le debe al negocio (faltantes/adelantos netos)
--   saldo = 0 → al dia
```

### 2.6 Nueva categoria de operacion

```sql
-- EG-014: Adelanto de sueldo (seleccionable=FALSE, solo desde flujo de adelanto)
INSERT INTO categorias_operaciones (tipo, nombre, descripcion, seleccionable) VALUES
('EGRESO', 'Adelanto Sueldo Empleado', 'Anticipo de sueldo entregado al empleado en efectivo', FALSE);
```

> **Nota**: La categoria existente `EG-007 Salarios` pasa a `seleccionable=FALSE` (solo via flujo de nomina).

---

## 3. Funciones SQL y Queries

> **Criterio**: solo se crea funcion SQL cuando la operacion toca 2+ tablas y necesita ser atomica.
> Las operaciones de 1 sola tabla se hacen con query directa desde el servicio TypeScript.

### 3.1 Modificar — `fn_ejecutar_cierre_diario` (Step 7) ✅ YA HECHO

Reemplazado `INSERT INTO deudas_empleados` por `INSERT INTO movimientos_empleados` con tipo `FALTANTE_CAJA`.
Version: v5.6. Archivo: `docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql`

### 3.2 Nueva funcion SQL — `fn_registrar_adelanto_sueldo`

```
Ubicacion: docs/movimientos-empleados/sql/functions/fn_registrar_adelanto_sueldo.sql
```

**Por que funcion SQL:** Toca 3+ tablas atomicamente (operaciones_cajas + cajas + movimientos_empleados).

**Responsabilidad:** Registrar un adelanto de sueldo como transaccion atomica.
El sistema elige automaticamente de que caja sacar (VARIOS primero, luego CAJA).

**Flujo:**
1. Validar turno abierto
2. Distribuir monto entre cajas (VARIOS primero, luego CAJA):
   a. `monto_de_varios = LEAST(p_monto, saldo_varios)`
   b. `monto_de_caja = p_monto - monto_de_varios`
   c. Si fondos insuficientes → RAISE EXCEPTION
3. Registrar ADELANTO_SUELDO en `movimientos_empleados` (primero, para obtener el UUID)
4. Registrar EGRESO(s) en `operaciones_cajas` con categoria `EG-014`, `referencia_id = movimiento.id`
5. Actualizar saldos de las cajas tocadas
6. Retornar JSON con instrucciones fisicas

**Parametros:**
```sql
p_turno_id        UUID,
p_empleado_id     INTEGER,        -- quien opera (admin del turno)
p_beneficiario_id INTEGER,        -- a quien se le da el adelanto
p_monto           DECIMAL(12,2),
p_descripcion     TEXT DEFAULT NULL,
p_comprobante_url TEXT DEFAULT NULL
```

### 3.3 Nueva funcion SQL — `fn_pagar_nomina_empleado`

```
Ubicacion: docs/movimientos-empleados/sql/functions/fn_pagar_nomina_empleado.sql
```

**Por que funcion SQL:** Toca 4+ tablas atomicamente (movimientos_empleados x3 + operaciones_cajas + cajas).

**Responsabilidad:** Liquidar la cuenta corriente de un empleado como transaccion atomica.
El sistema elige automaticamente de que cajas sacar el efectivo (VARIOS primero, luego CAJA).

**Flujo:**
1. Registrar SUELDO_BASE en `movimientos_empleados`
2. Calcular descuentos pendientes (FALTANTE_CAJA + ADELANTO_SUELDO con estado PENDIENTE)
3. Calcular liquido = sueldo_base - descuentos
4. Si `liquido <= 0` → los descuentos absorben todo el sueldo:
   - Marcar movimientos como LIQUIDADO
   - Retornar JSON con `liquido_pagado: 0` y mensaje "Sueldo absorbido por descuentos"
   - **NO se toca ninguna caja** (no hay efectivo que entregar)
5. Si `liquido > 0` → distribuir automaticamente entre cajas:
   a. Obtener saldo de VARIOS (FOR UPDATE)
   b. `monto_de_varios = LEAST(liquido, saldo_varios)`
   c. `monto_de_caja = liquido - monto_de_varios`
   d. Si `monto_de_caja > saldo_caja` → RAISE EXCEPTION (fondos insuficientes)
   e. Registrar EGRESO(s) en `operaciones_cajas`:
      - Si `monto_de_varios > 0` → EGRESO de VARIOS con categoria EG-007
      - Si `monto_de_caja > 0` → EGRESO de CAJA con categoria EG-007
   f. Actualizar saldos de las cajas tocadas
6. Registrar PAGO_NOMINA en `movimientos_empleados` por `liquido`
7. Marcar TODOS los movimientos PENDIENTE del empleado como `LIQUIDADO`
8. Retornar JSON con desglose completo:
    ```json
    {
      "sueldo_bruto": 500.00,
      "total_descuentos": 25.00,
      "detalle_descuentos": [
        { "tipo": "FALTANTE_CAJA", "monto": 5.00, "fecha": "2026-04-05" },
        { "tipo": "ADELANTO_SUELDO", "monto": 20.00, "fecha": "2026-04-12" }
      ],
      "liquido_pagado": 475.00,
      "instrucciones_fisicas": [
        { "caja": "Varios", "monto": 80.00 },
        { "caja": "Tienda", "monto": 395.00 }
      ],
      "operaciones_ids": ["uuid-egreso-varios", "uuid-egreso-caja"]
    }
    ```

> **Orden de prioridad de cajas:** VARIOS → CAJA (Tienda). CAJA_CHICA no se usa para pagos de nomina
> porque se resetea diariamente en el cierre. Varios es el fondo de emergencia y es el primero en usarse.

**Parametros:**
```sql
p_turno_id        UUID,
p_empleado_id     INTEGER,        -- quien opera (admin del turno)
p_beneficiario_id INTEGER,        -- a quien se le paga
p_sueldo_base     DECIMAL(12,2),  -- sueldo del periodo (se inserta como SUELDO_BASE)
p_descripcion     TEXT DEFAULT NULL,
p_comprobante_url TEXT DEFAULT NULL
```

### 3.4 Queries directas desde servicio TS (sin funcion SQL)

Las siguientes operaciones son de 1 sola tabla y no requieren atomicidad:

| Operacion | Query | Tabla |
|---|---|---|
| **Calcular preview de nomina** | SELECT movimientos PENDIENTE del empleado + saldos de cajas | `movimientos_empleados` + `cajas` (solo lectura) |
| **Devengar sueldo** | INSERT tipo SUELDO_BASE | `movimientos_empleados` |
| **Ajustar cuenta** | INSERT tipo AJUSTE | `movimientos_empleados` |
| **Obtener resumen** | SELECT * FROM v_saldos_empleados | Vista `v_saldos_empleados` |
| **Historial empleado** | SELECT con paginacion y order | `movimientos_empleados` |
| **Saldo de un empleado** | SELECT saldo FROM v_saldos_empleados WHERE empleado_id = X | Vista `v_saldos_empleados` |

---

## 4. Cambios en Frontend

### 4.1 Eliminar (codigo muerto)

| Archivo | Accion |
|---|---|
| `src/app/features/dashboard/models/deuda-empleado.model.ts` | Eliminar |
| `src/app/features/dashboard/services/deudas-empleados.service.ts` | Eliminar |

### 4.2 Nuevo modulo — `features/movimientos-empleados/`

```
src/app/features/movimientos-empleados/
├── models/
│   └── movimiento-empleado.model.ts
├── services/
│   └── movimientos-empleados.service.ts
├── pages/
│   ├── lista/
│   │   ├── movimientos-empleados-lista.page.ts
│   │   ├── movimientos-empleados-lista.page.html
│   │   └── movimientos-empleados-lista.page.scss
│   └── detalle/
│       ├── movimientos-empleado-detalle.page.ts
│       ├── movimientos-empleado-detalle.page.html
│       └── movimientos-empleado-detalle.page.scss
├── components/
│   ├── devengar-sueldo-modal/
│   │   ├── devengar-sueldo-modal.component.ts
│   │   ├── devengar-sueldo-modal.component.html
│   │   └── devengar-sueldo-modal.component.scss
│   ├── adelanto-modal/
│   │   ├── adelanto-modal.component.ts
│   │   ├── adelanto-modal.component.html
│   │   └── adelanto-modal.component.scss
│   └── pagar-nomina-modal/
│       ├── pagar-nomina-modal.component.ts
│       ├── pagar-nomina-modal.component.html
│       └── pagar-nomina-modal.component.scss
└── movimientos-empleados.routes.ts
```

### 4.3 Modelo TypeScript

```typescript
// movimiento-empleado.model.ts

export type TipoMovimientoEmpleado =
  | 'SUELDO_BASE'
  | 'BONO_COMISION'
  | 'FALTANTE_CAJA'
  | 'ADELANTO_SUELDO'
  | 'PAGO_NOMINA'
  | 'AJUSTE';

export type EstadoLiquidacion = 'PENDIENTE' | 'LIQUIDADO';

export interface MovimientoEmpleado {
  id: string;
  empleado_id: number;
  fecha: string;
  tipo_movimiento: TipoMovimientoEmpleado;
  monto: number;
  turno_id?: string;
  descripcion?: string;
  estado_liquidacion: EstadoLiquidacion;
  liquidado_en?: string;
  creado_por?: number;
  created_at: string;
}

export interface ResumenCuentaEmpleado {
  empleado_id: number;
  nombre: string;
  saldo: number;             // + negocio le debe, - empleado debe
  total_a_favor: number;
  total_en_contra: number;
  movimientos_pendientes: number;
  fecha_ultimo_movimiento: string;
}

export interface InstruccionFisica {
  caja: string;          // nombre UI: 'Varios', 'Tienda'
  monto: number;
}

export interface ResultadoPagoNomina {
  sueldo_bruto: number;
  total_descuentos: number;
  detalle_descuentos: { tipo: string; monto: number; fecha: string }[];
  liquido_pagado: number;
  instrucciones_fisicas: InstruccionFisica[];  // de donde sacar el efectivo
  operaciones_ids: string[];                    // IDs de los egresos generados
}
```

### 4.4 Servicio

```typescript
// movimientos-empleados.service.ts
// Metodos principales:

// ── Queries directas (1 tabla, sin funcion SQL) ──

obtenerResumenCuentas(): Promise<ResumenCuentaEmpleado[]>
  // → from('v_saldos_empleados').select('*')

obtenerSaldoEmpleado(empleadoId: number): Promise<number>
  // → from('v_saldos_empleados').select('saldo').eq('empleado_id', ...).single()

obtenerHistorialEmpleado(empleadoId: number, page: number, pageSize: number): Promise<MovimientoEmpleado[]>
  // → from('movimientos_empleados').select('*').eq('empleado_id', ...).order('fecha', desc).range()

devengarSueldo(beneficiarioId: number, monto: number, descripcion?: string): Promise<void>
  // → from('movimientos_empleados').insert({ tipo_movimiento: 'SUELDO_BASE', ... })

ajustarCuenta(beneficiarioId: number, monto: number, esCargo: boolean, descripcion: string): Promise<void>
  // → from('movimientos_empleados').insert({ tipo_movimiento: 'AJUSTE', es_cargo, ... })

calcularPreviewNomina(beneficiarioId: number, sueldoBase: number): Promise<PreviewNomina>
  // → 2 queries paralelas: movimientos PENDIENTE + saldos de VARIOS y CAJA
  // Calculo en TypeScript: liquido = sueldo - descuentos, distribucion VARIOS → CAJA
  // Solo lectura — preview para el wizard antes de confirmar

// ── RPCs atomicas (2+ tablas, necesitan transaccion) ──

registrarAdelanto(params: { turnoId, beneficiarioId, monto, descripcion?, comprobanteUrl? }): Promise<ResultadoPagoNomina>
  // → rpc('fn_registrar_adelanto_sueldo', { ... })

pagarNomina(params: { turnoId, beneficiarioId, sueldoBase, descripcion?, comprobanteUrl? }): Promise<ResultadoPagoNomina>
  // → rpc('fn_pagar_nomina_empleado', { ... })
```

### 4.5 Pagina lista — `movimientos-empleados-lista`

**Vista:** Cards por empleado mostrando:
- Nombre del empleado
- Saldo actual (color: verde si negocio debe, rojo si empleado debe)
- Cantidad de movimientos pendientes
- Fecha del ultimo movimiento
- Boton FAB: "+ Devengar sueldo" (abre modal)

**Patron:** Reutiliza el mismo patron visual de `cuentas-cobrar` (lista de cards con saldo).

**Tap en card:** Navega a pagina de detalle del empleado.

### 4.6 Pagina detalle — `movimientos-empleado-detalle`

**Vista:**
- Header con nombre del empleado y saldo actual (grande, coloreado)
- Resumen: total a favor / total en contra (mismo patron de balance-card de operaciones-caja)
- Lista de movimientos pendientes agrupados por fecha (mismo patron de operaciones-caja)
- Cada movimiento muestra: tipo (con icono/color), monto, descripcion, fecha/hora
- Botones de accion en el header (menu `...`):
  - "Dar adelanto" → abre `adelanto-modal`
  - "Pagar nomina" → abre `pagar-nomina-modal`
  - "Ajustar cuenta" → abre modal simple
  - "Ver historial liquidado" → toggle para mostrar movimientos ya LIQUIDADO

**Patron visual:** Reutiliza `.op-row`, `.op-icon-wrap`, `.op-divider` de operaciones-caja.

### 4.7 Modales

#### `devengar-sueldo-modal`
- Selector de empleado (si se abre desde la lista)
- Campo monto (con CurrencyInput)
- Campo descripcion (opcional)
- Patron: `bottom-sheet-modal`
- Llama a `fn_devengar_sueldo`

#### `adelanto-modal`
- Campo monto (con CurrencyInput)
- Campo descripcion (opcional)
- Foto comprobante (requerido — mismo patron que operacion-modal EGRESO)
- Al confirmar: llama a `fn_registrar_adelanto_sueldo` (el sistema elige la caja automaticamente)
- **Pantalla de resultado** (patron `verificar-fondo-modal`):
  ```
  Haz esto ahora fisicamente:
  1. Toma $50 de la funda VARIOS
  2. Entrega $50 a Maria
  ```
- Patron: modal fullscreen (tiene scroll por la foto)

#### `pagar-nomina-modal`
Wizard multi-paso (mismo patron que `verificar-fondo-modal` y cierre diario):

- **Paso 1**: Ingresar sueldo bruto del periodo
- **Paso 2**: Resumen automatico de descuentos:
  ```
  Sueldo bruto:          $500.00
  (-) Faltante caja:     -$5.00
  (-) Adelanto 12/abr:   -$20.00
  ─────────────────────────────
  Liquido a pagar:       $475.00
  ```
- **Paso 3**: Instrucciones fisicas (generadas por la funcion SQL):
  ```
  Haz esto ahora fisicamente:
  1. Toma $80 de la funda VARIOS
  2. Toma $395 de la funda TIENDA
  3. Entrega $475 a Maria

  [ Ya lo hice — Confirmar y registrar ]
  ```
  Al confirmar: llama a `fn_pagar_nomina_empleado` que ejecuta todo atomico
  (egresos de cajas + PAGO_NOMINA + liquidacion de pendientes)
- Patron: modal fullscreen

> **Nota UX:** El paso 3 muestra ANTES de confirmar de que cajas saldra el dinero,
> para que el admin sepa fisicamente que sobres/cajones abrir. Mismo patron que
> `verificar-fondo-modal` donde se le dice "Toma $X de TIENDA, pon $Y en VARIOS".
> El admin no elige la caja — el sistema la elige y le instruye.

### 4.8 Sidebar — nueva entrada

```html
<!-- En sidebar.component.html, dentro del grupo de menu -->
@if (esAdmin) {
  <ion-item button (click)="navegar('/movimientos-empleados')" [class.active]="rutaActiva === '/movimientos-empleados'">
    <ion-icon name="people-outline" slot="start"></ion-icon>
    <ion-label>Cuentas empleados</ion-label>
    @if (totalDeudaEmpleados > 0) {
      <ion-badge color="warning" slot="end">{{ totalDeudaEmpleados }}</ion-badge>
    }
  </ion-item>
}
```

**Badge:** Muestra la cantidad de empleados con `saldo != 0` (pendiente de liquidar). Se obtiene desde `v_saldos_empleados` al cargar el sidebar.

### 4.9 Routing y Guard

```typescript
// movimientos-empleados.routes.ts
export const MOVIMIENTOS_EMPLEADOS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/lista/movimientos-empleados-lista.page')
      .then(m => m.MovimientosEmpleadosListaPage)
  },
  {
    path: ':empleadoId',
    loadComponent: () => import('./pages/detalle/movimientos-empleado-detalle.page')
      .then(m => m.MovimientosEmpleadoDetallePage)
  }
];
```

**Guard:** Reutilizar el guard de rol existente (si existe) o crear `adminGuard` que verifica `AuthService.currentUser.rol === 'ADMIN'`.

```typescript
// En layout.routes.ts
{
  path: 'movimientos-empleados',
  loadChildren: () => import('../movimientos-empleados/movimientos-empleados.routes')
    .then(m => m.MOVIMIENTOS_EMPLEADOS_ROUTES),
  canActivate: [adminGuard]
}
```

### 4.10 Modificar — `OperacionModalComponent`

**Cambio:** `EG-007 (Salarios)` ya es `seleccionable=FALSE` en el schema, por lo que no aparecera
en el dropdown de categorias del modal de operacion. No hace falta bloquear nada en codigo — el seed
ya lo excluye del listado que ve el usuario.

---

## 5. Documentacion a actualizar

| Archivo | Cambio |
|---|---|
| `docs/schema.sql` | ✅ YA HECHO — Eliminar `deudas_empleados`, agregar `movimientos_empleados` + enum + vista + indices + EG-014 |
| `docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql` | ✅ YA HECHO — Step 7 actualizado (v5.6) |
| `docs/dashboard/3_PROCESO_CIERRE_CAJA.md` | ✅ YA HECHO — Referencia actualizada |
| `docs/dashboard/8_PROCESO_ABRIR_CAJA.md` | ✅ YA HECHO — Nota actualizada |
| `docs/ARQUITECTURA.md` | ✅ YA HECHO — Tabla de deudas actualizada |
| `docs/dashboard/sql/functions/fn_reparar_deficit_turno.sql` | ✅ YA HECHO — Comentarios actualizados |
| `CLAUDE.md` | Agregar modulo `movimientos-empleados` a la tabla de modulos |
| `docs/ESTRUCTURA-PROYECTO.md` | Agregar la nueva feature |
| `docs/movimientos-empleados/MOVIMIENTOS-EMPLEADOS-README.md` | Crear doc principal del modulo |

---

## 6. Orden de Implementacion

### Fase 1 — Backend SQL ✅ COMPLETO

| # | Tarea | Estado |
|---|---|---|
| 1.1 | Enum + tabla + indices + vista en schema.sql | ✅ Hecho |
| 1.2 | Categoria EG-014 + EG-007 a seleccionable=FALSE | ✅ Hecho |
| 1.3 | Eliminar tabla `deudas_empleados` de schema.sql | ✅ Hecho |
| 1.4 | Actualizar `fn_ejecutar_cierre_diario` step 7 (v5.6) | ✅ Hecho |
| 1.5 | Actualizar docs relacionados (cierre, apertura, arquitectura) | ✅ Hecho |
| 1.6 | Crear `fn_registrar_adelanto_sueldo` (atomica, caja automatica) | ✅ Hecho |
| 1.7 | Crear `fn_pagar_nomina_empleado` (atomica, caja automatica) | ✅ Hecho |
| 1.8 | Actualizar resumen de schema.sql | ✅ Hecho |

### Fase 2 — Frontend ✅ COMPLETO

| # | Tarea | Estado |
|---|---|---|
| 2.1 | Eliminar modelo y servicio muerto de deudas | ✅ Hecho |
| 2.2 | Crear modelo `movimiento-empleado.model.ts` | ✅ Hecho |
| 2.3 | Crear servicio (queries directas + 2 RPCs) | ✅ Hecho |
| 2.4 | Crear pagina lista | ✅ Hecho |
| 2.5 | Crear pagina detalle | ✅ Hecho |
| 2.6 | Crear modal devengar sueldo | ✅ Hecho |
| 2.7 | Crear modal adelanto | ✅ Hecho |
| 2.8 | Crear modal pagar nomina | ✅ Hecho |
| 2.9 | Agregar guard ADMIN + ruta en layout.routes.ts | ✅ Hecho |
| 2.10 | Agregar entrada en sidebar | ✅ Hecho |
| 2.11 | Agregar routes file | ✅ Hecho |
| 2.12 | Agregar paginacion config | ✅ Hecho |
| 2.13 | Registrar iconos en OptionsModalComponent | ✅ Hecho |

### Fase 3 — Documentacion ✅ COMPLETO

| # | Tarea | Estado |
|---|---|---|
| 3.1 | Actualizar `docs/dashboard/DASHBOARD-README.md` | ✅ Verificado (no requiere cambios — deudas en dashboard son de recargas, no empleados) |
| 3.2 | Crear `docs/movimientos-empleados/MOVIMIENTOS-EMPLEADOS-README.md` | ✅ Hecho |
| 3.3 | Actualizar `CLAUDE.md` (tabla de modulos + tabla de docs) | ✅ Hecho |
| 3.4 | Actualizar `docs/ESTRUCTURA-PROYECTO.md` | ✅ Hecho |

---

## 8. Decisiones de diseno tomadas

| Decision | Razon |
|---|---|
| Monto siempre positivo, signo por tipo | Consistente con `operaciones_cajas` donde monto es siempre > 0 y el tipo indica direccion |
| `es_cargo` solo para AJUSTE | Los demas tipos tienen signo fijo. Evita ambiguedad |
| `estado_liquidacion` en vez de `estado` | Mas claro semanticamente. Un FALTANTE no se "salda" — se "liquida" al incluirlo en un pago |
| `liquidado_en` apunta al PAGO_NOMINA | Trazabilidad completa: desde cualquier movimiento puedo ver en que pago se incluyo |
| Vista `v_saldos_empleados` | Evita almacenar saldo (se desincroniza). La vista calcula en tiempo real |
| EG-007 bloqueado en operacion-modal | Fuerza al admin a usar el flujo correcto que liquida automaticamente |
| EG-014 nueva para adelantos | Separa conceptualmente "pago de salario" (EG-007) de "adelanto" (EG-014) en el historial de caja |
| Modulo separado (no en dashboard/) | Dominio propio con suficiente complejidad para justificarlo |
| **Caja automatica (VARIOS → CAJA)** | El admin no elige de donde sacar — el sistema elige y le instruye fisicamente. Mismo patron que `verificar-fondo-modal` y `fn_reparar_deficit_turno`. Simplifica UX: todo se hace desde "Cuentas empleados" sin ir al modal de operaciones |
| **Instrucciones fisicas antes de confirmar** | El sistema muestra de que sobres/cajones sacar dinero ANTES de confirmar, no despues. El admin sabe exactamente que hacer con el efectivo fisico. Sin sorpresas al cierre |
| **CAJA_CHICA excluida de pagos de nomina** | Se resetea diariamente en el cierre. VARIOS es el fondo de emergencia y el primero en usarse, CAJA (Tienda) es el respaldo |

---

## 9. Preguntas resueltas

| Pregunta | Respuesta |
|---|---|
| Sale la diferencia o el total de caja? | Sale el **liquido** (sueldo - descuentos). Es lo que fisicamente se entrega |
| Quien puede pagar salarios? | Solo ADMIN (guard + rol check en SQL) |
| Devengar es manual o automatico? | **Manual** en Fase 1. El admin aprieta boton y dice cuanto. Cron opcional en futuro |
| Donde vive la pagina? | Modulo propio `features/movimientos-empleados/`, accesible desde sidebar solo para ADMIN |
| Que pasa con operacion-modal EG-007? | Se bloquea con nota que redirija a "Cuentas empleados" |
| Quien elige la caja para el pago? | **El sistema** — VARIOS primero, luego CAJA. El admin recibe instrucciones fisicas de que sobres abrir |
| Puede el admin elegir otra caja? | No. El orden es fijo (VARIOS → CAJA). Simplifica y evita errores |
| Que pasa si VARIOS + CAJA no alcanzan? | La funcion SQL retorna error. El admin debe registrar un ingreso en alguna caja primero |
