# Arquitectura del Sistema de Cajas — Mi Tienda (v5)

> Documento de referencia para entender el modelo mental del flujo de dinero.
> Para patrones de código ver `CLAUDE.md`. Para el schema ver `docs/schema.sql`.

---

## Las 5 cajas

| Código BD    | UI       | Naturaleza  | Rol                                                          |
|--------------|----------|-------------|--------------------------------------------------------------|
| `CAJA`       | Tienda   | Efectivo    | Bóveda. Recibe depósitos del cajón al cierre.                |
| `CAJA_CHICA` | Cajón    | Efectivo    | Caja del día. Recibe ventas POS + recargas manuales. Se vacía a $0 digital al cierre. |
| `VARIOS`     | Varios   | Efectivo    | Fondo fijo de emergencia. Recibe transferencia diaria al cierre. |
| `CAJA_CELULAR` | Celular | Digital    | Efectivo cobrado por recargas celular. Crece al cierre.      |
| `CAJA_BUS`   | Bus      | Digital     | Efectivo cobrado por recargas bus. Crece al cierre.          |

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
    ├─ 2° Fondo fijo (queda físicamente en el cajón)
    └─ 3° Resto ─────────────────────────────────────────► TIENDA (depósito)
  CAJÓN digital → $0

APERTURA SIGUIENTE DÍA
  Sin déficit → fn_abrir_turno (solo crea registro en turnos_caja)
  Con déficit → fn_reparar_deficit_turno
    TIENDA ──► EGRESO (déficit VARIOS + fondo faltante)
    VARIOS ──► INGRESO IN-004 (repone lo que le faltó ayer)
    Abre el turno en la misma transacción atómica
```

---

## Distribución del cajón al cierre — cascada "todo o nada"

El efectivo del cajón se distribuye con **prioridad estricta en cada nivel**. Si un nivel no alcanza, ese monto va íntegro a TIENDA. Sin montos parciales.

```
efectivo_fisico (contado por el empleado, incluye fondo)
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
  │ ¿(efectivo - transf_varios) >= fondo_fijo?              │
  │   Sí → fondo queda en cajón (fondo_cubierto = TRUE)     │
  │   No → fondo = $0 en cajón (fondo_cubierto = FALSE)     │
  └─────────────────────────────────────────────────────────┘
      │
      ▼
  TIENDA recibe el resto (siempre ≥ 0)
  CAJÓN queda en $0 digital
```

### Los 4 escenarios

| efectivo_fisico | VARIOS | fondo en cajón | TIENDA | fondo_cubierto |
|---|---|---|---|---|
| `>= transf + fondo` | completo | sí | resto | TRUE |
| `>= transf` pero `< transf + fondo` | completo | no | resto | FALSE |
| `< transf` | $0 | no | todo | FALSE |
| 2° turno (VARIOS ya cobró) | $0 | sí si alcanza | resto | TRUE/FALSE |

---

## El fondo fijo — por qué no genera operación al abrir

`CAJA_CHICA` siempre cierra en **$0 digital**. El fondo físico ($20 por ej.) permanece en el cajón pero no está reflejado en el saldo.

El cierre usa: `efectivo_esperado = saldo_digital + fondo_fijo`

Así el fondo queda "implícito" en la fórmula. Registrar un INGRESO por el fondo en cada apertura rompería la ecuación: el cierre siguiente esperaría `$20 (ingreso) + $20 (constante) = $40` → ajuste negativo de $20 siempre.

**Solo genera operación cuando hay déficit:** `fn_reparar_deficit_turno` registra el EGRESO de TIENDA que representa el dinero físico que sale para reponer el cajón.

---

## Detección de déficit al abrir

`TurnosCajaService.obtenerDeficitTurnoAnterior()` comprueba el último turno cerrado:

```
¿VARIOS ya cobró hoy?
  Busca en operaciones_cajas de VARIOS:
    - TRANSFERENCIA_ENTRANTE  (cierre normal)
    - INGRESO cat. IN-004     (reparación anterior del mismo día)

déficitVarios  = variosYaCobro ? 0 : caja_varios_transferencia_dia
fondoFaltante  = (fondo_cubierto === false) ? caja_fondo_fijo_diario : 0

Si ambos = 0 → no hay déficit, abre directo
```

---

## Deudas de empleados vs déficit operacional

| Origen | Responsable | Tabla | Se salda |
|---|---|---|---|
| `efectivo_fisico < efectivo_esperado` (faltante de conteo) | Empleado | `movimientos_empleados` (tipo `FALTANTE_CAJA`) | Automaticamente al pagar nomina (`fn_pagar_nomina_empleado`) |
| VARIOS no cobró (efectivo insuficiente) | Negocio | Solo `fondo_cubierto = FALSE` + ausencia de TRANSFERENCIA | Automaticamente al abrir con `fn_reparar_deficit_turno` |
| Fondo no cubierto | Negocio | `fondo_cubierto = FALSE` | Automaticamente al abrir |

---

## Funciones SQL del núcleo

| Función | Cuándo se llama | Qué hace |
|---|---|---|
| `fn_abrir_turno` | Apertura sin déficit | Valida + crea registro en `turnos_caja` — atómico, elimina race condition |
| `fn_reparar_deficit_turno` | Apertura con déficit | EGRESO Tienda + INGRESO Varios (IN-004) + abre turno — todo atómico |
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

*Última actualización: 2026-03-10 — v5*
