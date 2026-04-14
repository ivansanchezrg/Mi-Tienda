# Movimientos Empleados — Referencia Tecnica (v1.0 — 2026-04-13)

## 1. Concepto

Sistema de **cuenta corriente por empleado**. Reemplaza la tabla `deudas_empleados` (que solo registraba faltantes de caja) con un modelo completo que soporta:

- Sueldos devengados (`SUELDO_BASE`) — insertado atomicamente por `fn_pagar_nomina_empleado`
- Bonos y comisiones (`BONO_COMISION`)
- Faltantes de caja (`FALTANTE_CAJA`) — automatico al cierre diario
- Adelantos de sueldo (`ADELANTO_SUELDO`) — egreso atomico de caja
- Pago de nomina (`PAGO_NOMINA`) — liquida toda la cuenta
- Ajustes manuales (`AJUSTE`) — cargo o abono

**No requiere turno abierto.** Adelantos y pagos de nomina operan sobre VARIOS y CAJA (cajas permanentes), no sobre CAJA_CHICA (cajon diario). Solo se necesita el usuario logueado (admin).

El saldo se calcula en tiempo real desde la vista `v_saldos_empleados`:
- `saldo > 0` → el negocio le debe al empleado
- `saldo < 0` → el empleado le debe al negocio
- `saldo = 0` → al dia

---

## 2. Archivos del modulo

### Frontend (`src/app/features/movimientos-empleados/`)

| Archivo | Rol |
|---|---|
| `models/movimiento-empleado.model.ts` | Tipos, interfaces, config de labels/colores |
| `services/movimientos-empleados.service.ts` | Queries directas + 2 RPCs |
| `movimientos-empleados.routes.ts` | Rutas: lista + detalle por empleado |
| `pages/lista/` | Lista de empleados con saldo |
| `pages/detalle/` | Historial de movimientos + menu de acciones |
| `components/adelanto-modal/` | Fullscreen con instrucciones fisicas |
| `components/pagar-nomina-modal/` | Wizard 3 pasos con preview de descuentos. Precarga `nomina_sueldo_base` de config. |

### Backend SQL (`docs/movimientos-empleados/sql/functions/`)

| Funcion | Toca | Cuando |
|---|---|---|
| `fn_registrar_adelanto_sueldo` | `operaciones_cajas` + `cajas` + `movimientos_empleados` | Admin da adelanto desde detalle |
| `fn_pagar_nomina_empleado` | `movimientos_empleados` x3 + `operaciones_cajas` + `cajas` | Admin paga nomina desde detalle |

### Funcion modificada

| Funcion | Cambio |
|---|---|
| `fn_ejecutar_cierre_diario` (v5.6) | Step 7: INSERT en `movimientos_empleados` con tipo `FALTANTE_CAJA` (antes era `deudas_empleados`) |

---

## 3. Tabla `movimientos_empleados`

```sql
CREATE TABLE movimientos_empleados (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empleado_id         INTEGER NOT NULL REFERENCES usuarios(id),
    fecha               TIMESTAMPTZ DEFAULT NOW(),
    tipo_movimiento     tipo_movimiento_empleado_enum NOT NULL,
    monto               DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    turno_id            UUID REFERENCES turnos_caja(id),
    descripcion         TEXT,
    estado_liquidacion  VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    liquidado_en        UUID REFERENCES movimientos_empleados(id),
    creado_por          INTEGER REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

**Signo por tipo:**

| Tipo | Signo |
|---|---|
| `SUELDO_BASE` | + |
| `BONO_COMISION` | + |
| `FALTANTE_CAJA` | - |
| `ADELANTO_SUELDO` | - |
| `PAGO_NOMINA` | - |
| `AJUSTE_ABONO` | + |
| `AJUSTE_CARGO` | - |

---

## 4. Categorias de operacion

| Codigo | Nombre | `seleccionable` | Usado por |
|---|---|---|---|
| `EG-007` | Salarios | `FALSE` | `fn_pagar_nomina_empleado` |
| `EG-014` | Adelanto Sueldo Empleado | `FALSE` | `fn_registrar_adelanto_sueldo` |

Ambas categorias son de sistema — no aparecen en el dropdown del modal de operacion manual.

---

## 5. Flujo de pago de nomina

```
Admin abre detalle del empleado
  → Menu ⋮ → "Pagar nomina"
    → Paso 1: Sueldo bruto (precargado de config.nomina_sueldo_base, editable)
    → Paso 2: Preview automatico:
        Sueldo bruto:       +$500
        Faltante caja:       -$5
        Adelanto 12/abr:    -$20
        ─────────────────────────
        Liquido a pagar:    $475
    → Paso 3: Instrucciones fisicas:
        1. Toma $80 de la funda Varios
        2. Toma $395 de la funda Tienda
        3. Entrega $475 a Maria
        [ Ya lo hice — Confirmar ]
    → fn_pagar_nomina_empleado:
        - INSERT SUELDO_BASE
        - Calcula descuentos
        - EGRESO(s) de VARIOS/CAJA
        - INSERT PAGO_NOMINA
        - UPDATE todos PENDIENTE → LIQUIDADO
```

**Orden de cajas:** VARIOS primero, luego CAJA (Tienda). CAJA_CHICA excluida (se resetea diariamente).

---

## 6. Acceso

- Ruta: `/movimientos-empleados` (lista) y `/movimientos-empleados/:empleadoId` (detalle)
- Guard: `roleGuard(['ADMIN'])` — solo administradores
- Sidebar: grupo "Admin", entrada "Cuentas Empleados" con icono `wallet-outline`
- No requiere turno abierto (opera sobre VARIOS y CAJA, no CAJA_CHICA)

---

## 7. Queries del servicio

| Metodo | Tipo | Tabla/Vista |
|---|---|---|
| `obtenerResumenCuentas()` | Query directa | `v_saldos_empleados` |
| `obtenerSaldoEmpleado()` | Query directa | `v_saldos_empleados` |
| `obtenerHistorialEmpleado()` | Query directa | `movimientos_empleados` |
| `ajustarCuenta()` | INSERT directo | `movimientos_empleados` |
| `calcularPreviewNomina()` | 2 queries paralelas (lectura) | `movimientos_empleados` + `cajas` |
| `registrarAdelanto()` | RPC atomica | `fn_registrar_adelanto_sueldo` |
| `pagarNomina()` | RPC atomica | `fn_pagar_nomina_empleado` |
