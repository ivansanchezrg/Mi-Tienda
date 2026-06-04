# Arquitectura del Sistema de Cajas — Mi Tienda (v6.2 — fondo libre)

> Documento de referencia para entender el modelo mental del flujo de dinero.
> Para patrones de código ver `CLAUDE.md`. Para el schema ver `docs/schema.sql`.

---

## Las 5 cajas

| Código BD    | UI       | Naturaleza  | `puede_tener_turno` | Rol                                                          |
|--------------|----------|-------------|---------------------|--------------------------------------------------------------|
| `CAJA`       | Tienda   | Efectivo    | `false`             | Bóveda. Recibe depósitos del cajón al cierre.                |
| `CAJA_CHICA` | Cajón    | Efectivo    | `true`              | Caja del día. Recibe ventas POS + recargas manuales. Se vacía a $0 digital al cierre. |
| `VARIOS`     | Varios   | Efectivo    | `false`             | Fondo de emergencia. Recibe transferencia diaria al cierre. |
| `CAJA_CELULAR` | Celular | Digital   | `false`             | Efectivo cobrado por recargas celular. Crece al cierre.      |
| `CAJA_BUS`   | Bus      | Digital     | `false`             | Efectivo cobrado por recargas bus. Crece al cierre.          |

> **`puede_tener_turno`** diferencia cajones operativos (con cajero asignado) de cajas contables/digitales. Solo `CAJA_CHICA` lo tiene en `true` en el modelo monocaja. Al implementar multicaja, los cajones adicionales también tendrán `true`.

---

## Flujo de dinero — visión general

```
VENTAS DEL DÍA
  ├─ Ventas POS en efectivo ──────────────────────────────► CAJÓN (automático, trigger SQL)
  ├─ Recargas celular cobradas ───────────────────────────► CELULAR (al cierre)
  └─ Recargas bus cobradas ───────────────────────────────► BUS (al cierre)

CIERRE DIARIO (fn_ejecutar_cierre_diario)
  CAJÓN físico contado
    ├─ 1° Transferencia fija ────────────────────────────► VARIOS
    ├─ 2° Fondo de apertura (queda físicamente en el cajón)
    └─ 3° Resto ─────────────────────────────────────────► TIENDA (depósito)
  CAJÓN digital → $0

APERTURA SIGUIENTE DÍA (empleado declara fondo libre)
  Sin déficit → fn_abrir_turno(empleado, fondoApertura)
                 ↳ INSERT turnos_caja con fondo_apertura
  Con déficit → fn_reparar_deficit_turno(empleado, deficitVarios, fondoApertura)
    TIENDA ──► EGRESO cat. DEF-RETIRAR (déficit VARIOS pendiente)
    VARIOS ──► INGRESO cat. DEF-REPONER (repone lo que le faltó ayer)
    INSERT turnos_caja con fondo_apertura — todo atómico
```

---

## Distribución del cajón al cierre — cascada "todo o nada"

El efectivo del cajón se distribuye con **prioridad estricta en cada nivel**. Si un nivel no alcanza, ese monto va íntegro a TIENDA. Sin montos parciales.

```
efectivo_fisico (contado por el empleado, incluye el fondo declarado al abrir)
      │
      ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ¿efectivo >= transferencia_diaria?                      │
  │   Sí → VARIOS recibe transferencia_diaria completa      │
  │   No → VARIOS recibe $0 (déficit VARIOS)                │
  └─────────────────────────────────────────────────────────┘
      │
      ▼
  ┌─────────────────────────────────────────────────────────┐
  │ ¿(efectivo - transf_varios) >= fondo_apertura?          │
  │   Sí → fondo declarado queda físicamente en cajón       │
  │   No → fondo no se mantiene, todo el restante va a CAJA │
  └─────────────────────────────────────────────────────────┘
      │
      ▼
  TIENDA recibe el resto (siempre ≥ 0)
  CAJÓN queda en $0 digital
```

> `fondo_apertura` es el monto que el empleado declaró libremente al abrir el turno (`turnos_caja.fondo_apertura`). No existe `fondo_cubierto` ni fondo fijo global.

### Los 3 escenarios

| efectivo_fisico | VARIOS | fondo en cajón | TIENDA |
|---|---|---|---|
| `>= transf + fondo_apertura` | completo | sí | resto |
| `>= transf` pero `< transf + fondo_apertura` | completo | no | resto |
| `< transf` | $0 | no | todo |

> En 2° turno (VARIOS ya cobró), el efectivo no se transfiere a VARIOS — el fondo declarado queda en cajón si alcanza y el resto va a Tienda.

---

## El fondo de apertura — libre y sin operación contable

`CAJA_CHICA` siempre cierra en **$0 digital**. El efectivo declarado al abrir permanece físicamente en el cajón pero no está reflejado en el saldo.

El cierre usa: `efectivo_esperado = saldo_digital + fondo_apertura`

Así el fondo queda "implícito" en la fórmula. Registrar un INGRESO por el fondo al abrir rompería la ecuación: el cierre siguiente esperaría doble del monto declarado → ajuste negativo siempre.

**Solo genera operación contable cuando hay déficit de VARIOS:** `fn_reparar_deficit_turno` registra el EGRESO de TIENDA + INGRESO a VARIOS por la transferencia pendiente del turno anterior.

---

## Detección de déficit al abrir

`TurnosCajaService.obtenerDeficitTurnoAnterior()` comprueba si VARIOS recibió su transferencia en el último día con cierre:

```
¿VARIOS ya cobró ese día?
  Busca en operaciones_cajas de VARIOS:
    - TRANSFERENCIA_ENTRANTE  (cierre normal)
    - INGRESO cat. DEF-REPONER (reparación anterior del mismo día)

deficitVarios = variosYaCobro ? 0 : caja_varios_transferencia_dia

Si deficitVarios = 0 → no hay déficit, abre directo con fondo libre
```

> Con fondo libre ya no existe "déficit de fondo" — el empleado decide libremente al abrir cuánto dejar.

---

## Deudas de empleados vs déficit operacional

| Origen | Responsable | Tabla | Se salda |
|---|---|---|---|
| `efectivo_fisico < efectivo_esperado` (faltante de conteo) | Empleado | `movimientos_empleados` (tipo `FALTANTE_CAJA`) | Automaticamente al pagar nomina (`fn_pagar_nomina_empleado`) |
| VARIOS no cobró (efectivo insuficiente) | Negocio | Ausencia de TRANSFERENCIA en VARIOS para ese día | Automaticamente al abrir con `fn_reparar_deficit_turno` |

---

## Funciones SQL del núcleo

| Función | Cuándo se llama | Qué hace |
|---|---|---|
| `fn_abrir_turno` | Apertura sin déficit | Valida + crea registro en `turnos_caja` con `fondo_apertura` libre — atómico |
| `fn_reparar_deficit_turno` | Apertura con déficit de VARIOS | EGRESO Tienda (DEF-RETIRAR) + INGRESO Varios (DEF-REPONER) + abre turno con fondo libre — todo atómico |
| `fn_ejecutar_cierre_diario` | Cierre | Ajuste conteo + distribución cascada + recargas + cierra turno — todo atómico |
| `fn_registrar_operacion_manual` | Ingreso/Egreso manual | INSERT operacion + UPDATE saldo caja — atómico |
| `fn_crear_transferencia` | Transferencia entre cajas | EGRESO origen + INGRESO destino — atómico |
| `fn_verificar_transferencia_caja_chica_hoy` | Pre-cierre | Booleano: ¿VARIOS ya recibió hoy? |

---

## Regla de oro: todo multi-tabla va en función SQL

Nunca se hacen dos `INSERT/UPDATE` sueltos desde TypeScript para operaciones relacionadas. Si falla a mitad camino, los saldos quedan inconsistentes.

```
TypeScript → supabase.rpc('fn_nombre', params) → PostgreSQL (transacción atómica)
```

Ver `CLAUDE.md §Funciones PostgreSQL` para convenciones de permisos y formato.

---

*Última actualización: 2026-05-29 — v6.2 (fondo libre)*
