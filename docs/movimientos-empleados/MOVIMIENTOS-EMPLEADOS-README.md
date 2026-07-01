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
    empleado_id         UUID NOT NULL REFERENCES usuarios(id),
    fecha               TIMESTAMPTZ DEFAULT NOW(),
    tipo_movimiento     tipo_movimiento_empleado_enum NOT NULL,
    monto               DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    turno_id            UUID REFERENCES turnos_caja(id),
    descripcion         TEXT,
    estado_liquidacion  VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    liquidado_en        UUID REFERENCES movimientos_empleados(id),
    creado_por          UUID REFERENCES usuarios(id),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

**Inmutabilidad:** los movimientos no se pueden borrar ni modificar una vez creados. Los triggers `trg_bloquear_delete_movimiento` (`fn_bloquear_delete_movimiento`) y `trg_proteger_movimiento_empleado` (`fn_proteger_movimiento_empleado`) lo garantizan — solo `estado_liquidacion` y `liquidado_en` son editables post-INSERT. Cualquier corrección se hace creando un movimiento de ajuste. La única excepción es la purga administrativa de un negocio vencido (`fn_purgar_negocio`), que activa `app.purga_en_curso = 'true'` para que los triggers cedan.

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

Ambas categorías son de sistema — viven en `categorias_sistema` (tabla global sin `negocio_id`) y no aparecen en el dropdown del modal de operacion manual.

| Codigo semántico | Nombre | Tabla | Usado por |
|---|---|---|---|
| `SALARIOS` | Salarios | `categorias_sistema` | `fn_pagar_nomina_empleado` |
| `ADELANTO` | Adelanto Sueldo Empleado | `categorias_sistema` | `fn_registrar_adelanto_sueldo` |

---

## 5. Flujo de pago de nomina

```
Admin abre detalle del empleado
  → Menu ⋮ → "Pagar nomina"
    → Paso 1: Sueldo bruto
        - Precargado de config.nomina_sueldo_base
        - Si el empleado fue transferido desde este negocio (activo=FALSE),
          se calcula el proporcional automaticamente (ver seccion 5.1)
        - El admin puede editar el monto sugerido antes de continuar
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

### 5.1 Calculo proporcional para empleados transferidos

Cuando un empleado se transfiere a otro negocio a mitad de mes, cada negocio paga solo los dias que el empleado trabajo ahi.

**Como funciona el calculo:**

`usuario_negocios` tiene `created_at` (cuando entro al negocio) y `updated_at` (ultima modificacion — se actualiza via trigger en cada cambio de `activo` o `rol`).

Cuando el admin de Tienda A abre "Pagar nomina" para Maria (ya transferida, `activo=FALSE`):
1. El servicio lee `created_at` y `updated_at` de la membresia de Maria en Tienda A
2. Calcula `dias_trabajados = DATE_PART('day', updated_at - created_at)`
3. Sugiere `sueldo_proporcional = ROUND((sueldo_base / 30.0) * dias_trabajados, 2)`
4. Muestra el calculo al admin con el periodo cubierto: "15 dias (01/04 — 15/04)"
5. El admin puede ajustar el monto si lo considera necesario

**Ejemplo:**
```
Maria — sueldo base $400/mes
Tienda A: created_at=01/04, updated_at=15/04 (transferida ese dia)
  dias_trabajados = 14
  sueldo_proporcional = ROUND((400 / 30.0) * 14, 2) = $186.67
  → El admin ve: "Sueldo sugerido: $186.67 (14 dias, 01/04 — 15/04)"

Tienda B: created_at=15/04, activo=TRUE (sigue aca)
  → El admin ve el sueldo_base completo de config ($400) para ajustar manualmente
    segun los dias restantes del mes
```

**Query del servicio para obtener el proporcional:**
```typescript
// En calcularPreviewNomina() — solo si el empleado esta inactivo en este negocio
const { data: membresia } = await this.supabase.client
  .from('usuario_negocios')
  .select('created_at, updated_at, activo')
  .eq('usuario_id', empleadoId)
  .eq('negocio_id', negocioId)  // negocio actual del JWT
  .maybeSingle();

if (membresia && !membresia.activo) {
  const dias = differenceInDays(new Date(membresia.updated_at), new Date(membresia.created_at));
  const proporcional = Math.round((sueldoBase / 30) * dias * 100) / 100;
  // mostrar sugerencia en el wizard
}
```

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
