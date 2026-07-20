# Cierre Diario — Referencia Técnica (v6.5 — 2026-07-18 — atribución de reposición por turno + pendiente cuantificado)

## 1. Arquitectura

### Tablas involucradas

| Tabla | Rol |
| --- | --- |
| `turnos_caja` | Un turno por sesión. El cierre escribe `hora_fecha_cierre = NOW()`. La columna `fondo_apertura` (escrita al abrir) se lee como referencia del fondo declarado por el empleado. |
| `recargas` | 1 registro por servicio por turno (`UNIQUE turno_id, tipo_servicio_id`). Guarda saldo_virtual antes y después. |
| `recargas_virtuales` | Recargas del proveedor. Se filtran por `created_at > último_cierre_at` para evitar duplicados entre turnos. |
| `operaciones_cajas` | Trazabilidad completa: cada movimiento contable con saldo anterior/posterior. |
| `cajas` | Saldos actuales de las 5 cajas. Se actualizan al cierre. |
| `configuraciones` | `caja_varios_transferencia_dia` (clave/valor). El fondo es libre, declarado al abrir cada turno. |

> **v6.3 (2026-05-30):** Distribución simplificada. El fondo declarado al abrir (`turnos_caja.fondo_apertura`) **ya no se retiene en el cajón al cerrar** — todo el efectivo contado se deposita completo. VARIOS recibe su transferencia diaria si alcanza; el resto va íntegro a CAJA. El fondo del próximo turno lo declara el empleado al abrir.
>
> **v6.2 (legacy):** Eliminadas `fondo_cubierto` de `turnos_caja` y la clave `caja_fondo_fijo_diario` de `configuraciones`. Fondo libre por turno.

### Las 5 cajas

| Código | UI | Rol | Qué recibe en el cierre |
| --- | --- | --- | --- |
| `CAJA` | Tienda | Bóveda de depósitos acumulados | Todo el efectivo del cajón menos la transferencia a VARIOS (INGRESO con tipo `CIERRE`) |
| `CAJA_CHICA` | Cajón | Efectivo del día: ventas POS + recargas manuales | Se vacía completo → queda en **$0 digital** |
| `VARIOS` | Varios | Fondo de emergencia para gastos imprevistos | Transferencia fija diaria (si el efectivo alcanza) |
| `CAJA_CELULAR` | Celular | Efectivo cobrado por recargas celular | Venta del turno (INGRESO) |
| `CAJA_BUS` | Bus | Efectivo cobrado por recargas de bus | Venta del turno (INGRESO) |

> **Flujo clave (v6.3):** Las ventas POS en efectivo van automáticamente a `CAJA_CHICA` (trigger `trg_actualizar_caja_por_venta`). Al cierre, el empleado cuenta el físico del cajón; el sistema ajusta la diferencia y distribuye: `transferenciaDiaria` va a VARIOS si el efectivo alcanza, el resto íntegro a CAJA. El fondo del próximo turno lo declara el empleado al abrir (`fondo_apertura` en `turnos_caja`).

---

## 2. Flujo del proceso (UI — wizard 2 pasos)

### Pre-condiciones (validadas en `onCerrarCaja()` antes de navegar)

`obtenerEstadoCaja()` devuelve uno de:

- `SIN_ABRIR` → sin turnos hoy
- `TURNO_EN_CURSO` → turno abierto (permite cierre)
- `CERRADA` → ya se cerró el día

`onCerrarCaja()` ejecuta las siguientes validaciones **en orden** antes de navegar a `/caja/cierre-diario`:

| # | Validación | Resultado si falla |
| --- | --- | --- |
| 1 | `estadoCaja.estado === 'TURNO_EN_CURSO'` | Toast warning: "No hay un turno activo en este momento." |
| 2 | `existeCierreDiario()` — verifica en BD que no exista ya un cierre para este turno | Error de conexión → toast error. Cierre ya registrado → toast warning. |
| 3 | `turnoEmpleadoId === empleadoActualId` — el empleado logueado es quien abrió el turno | Error: "Solo [nombre] puede realizar el cierre de este turno." |

Solo si las 3 pasan → `router.navigate(['/caja/cierre-diario'])` sin overlay activo (evita colisión con el ciclo de vida de `ionViewWillEnter`).

En `cargarDatosIniciales()` se hace **una sola RPC** `fn_datos_cierre_diario()` que retorna todo en un único round-trip:

| Campo retornado | Uso en la página |
|---|---|
| `turno_activo` | Turno abierto con empleado JOIN |
| `saldos_virtuales` | `snapshot + agregado` = total actual — se muestra como "Virtual: $X" en Paso 1 |
| `snapshot_virtuales` | Solo el `saldo_virtual_actual` del último registro en `recargas` — se envía como `p_saldo_anterior_*` al SQL del cierre |
| `agregado_virtual_hoy` | Informativo — recargas posteriores al snapshot (no se suma en UI ni se envía al SQL) |
| `saldos_cajas` | Saldos de CAJA_CHICA, CAJA_CELULAR, CAJA_BUS |
| `saldos_antes_cierre` | Saldos de CAJA y VARIOS para preview antes→después en Paso 2 |
| `transferencia_diaria_varios` | Monto configurado para VARIOS |
| `transferencia_ya_hecha` | `true` si VARIOS ya recibió hoy |
| `resumen_turno` | Ventas POS efectivo + egresos del cajón en el turno |
| `configuracion` | Flags de módulos activos |

---

### Paso 1 — Datos del Turno (3 inputs)

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `saldoVirtualCelularFinal` | Solo si `recargas_celular_habilitada` | Saldo que muestra la app del proveedor celular en este momento. El input ni aparece si el módulo está desactivado (validators dinámicos en `cargarDatosIniciales()`). |
| `saldoVirtualBusFinal` | Solo si `recargas_bus_habilitada` | Saldo que muestra la máquina de bus en este momento. Ídem. |
| `efectivoFisico` | Sí (siempre) | Total físico contado en el cajón, **incluyendo el fondo declarado al abrir**. Campo `.destacado`. |

**Feedback en tiempo real:**
- Ventas negativas → alerta roja; bloquea "Ver Resumen"
- Diferencia en conteo físico → alerta naranja (faltante) o azul (sobrante)
- Conteo exacto → alerta verde

**Cálculo de ventas (en UI — solo para mostrar feedback):**
```
venta_celular = saldoVirtualActualCelular - saldoVirtualCelularFinal
venta_bus     = saldoVirtualActualBus     - saldoVirtualBusFinal
```

`saldoVirtualActualCelular` = `snapshot_virtuales.celular + agregado_virtual_hoy.celular` (total actual).

**Cálculo de ventas (en SQL — el que afecta saldos reales):**
```
v_venta_celular = (p_saldo_anterior_celular + v_agregado_celular) - p_saldo_celular_final
```

`p_saldo_anterior_celular` = `snapshot_virtuales.celular` (solo el snapshot, sin el agregado).
`v_agregado_celular` = calculado internamente por el SQL desde `recargas_virtuales`.

> **Por qué dos cálculos:** la UI usa el total visible para dar feedback al empleado. El SQL recalcula desde el snapshot para evitar doble conteo — si se enviara el total (snapshot + agregado) como `p_saldo_anterior`, el SQL lo volvería a sumar con `v_agregado_celular` y la venta quedaría inflada.

Venta negativa indica que falta registrar una recarga del proveedor en Recargas Virtuales.

> **Bug histórico (2026-06-05, resuelto):** La v1.0 de `fn_datos_cierre_diario` no devolvía `snapshot_virtuales`. El front recibía `undefined`, el mapeo lo convertía a `0`, y el cierre calculaba `(0 + agregado) − conteo` dando venta negativa falsa aunque el conteo fuera correcto. Solución: `fn_datos_cierre_diario` v1.1 agrega el campo `snapshot_virtuales` explícitamente.

> **Riesgo latente:** si el empleado registra una recarga de proveedor **entre** cargar el Paso 1 y confirmar el Paso 2, el agregado que recalcula el SQL difiere del que mostró el wizard. En la práctica es muy improbable (el wizard se completa en segundos), pero si ocurriera el cierre mostraría una venta distinta a la del Paso 1. Solución definitiva si se convierte en problema frecuente: que `fn_ejecutar_cierre_diario` reciba el saldo virtual total directamente en lugar de recalcular el agregado.

**Referencia para el conteo físico:**
```
efectivoEsperado = saldoCajaChicaDigital + fondoApertura
diferencia       = efectivoFisico - efectivoEsperado
```

---

### Paso 2 — Resumen y Confirmación (v6.3 — fondo libre)

Preview de distribución calculado en el frontend:

```
transferenciaVarios = efectivoFisico >= transferenciaDiaria ? transferenciaDiaria : 0
depositoCaja        = efectivoFisico - transferenciaVarios   // todo lo demás va a CAJA
```

| Caso | VARIOS | CAJA | Cajón digital | Notas |
| --- | --- | --- | --- | --- |
| Normal | `transferenciaDiaria` | resto del efectivo | $0 | El fondo del próximo turno se declara al abrir |
| Déficit (`efectivo < transferenciaDiaria`) | $0 | todo el efectivo | $0 | VARIOS no recibe hoy — se repondrá al abrir el próximo turno |
| 2° turno (VARIOS ya recibió) | $0 (ya recibió) | todo el efectivo | $0 | Solo 1 transferencia diaria a VARIOS |
| Varios desactivada | $0 | todo el efectivo | $0 | Cuando `caja_varios_activa = false` |

**v6.3 vs v6.2:** Eliminada la retención del fondo en el cajón. Antes el `fondoApertura` quedaba físicamente en CAJA_CHICA al cerrar; ahora **todo el efectivo se deposita** y el fondo del siguiente turno se declara libremente al abrir.

**Card 1 del Paso 2 — Cajón Físico:**
- Movimientos del turno (solo si hubo): ventas POS efectivo, ingresos manuales, gastos
- Conteo esperado: acumulado en cajón + fondo de apertura = "deberías tener"
- Resultado del conteo: verde (cuadrado), rojo (faltante), azul (sobrante)

**Card 2 del Paso 2 — Saldos al Cierre:**
- Tienda: antes → después (depósito del cajón)
- Varios (si activa): antes → después o "sin cambio" / "déficit"
- Celular / Bus (si habilitados): antes → después de las ventas virtuales

**Modo sin cuadre (`esModoSinPos = true`):** se activa cuando el cajón no tuvo ningún movimiento durante el turno — sin ventas POS, sin ingresos manuales y sin egresos. En ese caso el Paso 2 muestra solo "Fondo inicial" y "Total contado", sin el bloque de resultado (cuadrado / faltante / sobrante). Si hubo **cualquier movimiento** — incluso solo ingresos manuales sin POS — el sistema conoce el esperado real y activa el cuadre completo. Aplica tanto al wizard de cierre como al historial de turnos (`CierreTurnoDetalleModalComponent`) y al resumen de WhatsApp (`ShareCierreService`).

> **Fix del historial de cierres — `fn_listar_cierres_turno` v2.3/v2.4 (2026-07-01):** el historial **reconstruye** el resumen de cada turno desde el ledger, y tenía tres bugs que mostraban datos falsos en `CierreTurnoDetalleModalComponent`:
> - **`diferencia` siempre daba 0** (mostraba "Cajón cuadrado" aunque hubiera faltante real): filtraba el ajuste de conteo por `categoria_id`, pero `fn_ejecutar_cierre_diario` lo inserta con `categoria_sistema_id`. **v2.3** corrige la columna y, mejor aún, lee el **faltante desde `movimientos_empleados`** (`FALTANTE_CAJA`) — la misma fuente de verdad de la deuda del empleado — y el sobrante desde `operaciones_cajas` (`AJU-CONTEO-IN`).
> - **"Ingresos manuales" fantasma + modo cuadre indebido** (`usa_pos`/`otros_ingresos` falsos positivos): se derivaban de una resta algebraica que interpretaba cualquier excedente entre depósito y fondo como "ingreso manual", aunque no hubiera ninguna operación real. **v2.4** los basa en `EXISTS` de operaciones reales en `CAJA_CHICA` durante el turno (misma condición que `v_hubo_movimientos_caja_chica` del cierre); si no hubo, `otros_ingresos = 0` y `usa_pos = false`.
> - En el modal, `cierre.efectivo_fisico` es `deposito_caja + transferencia_varios` (dinero ya distribuido), **no** el conteo del empleado. El componente ahora deriva "Acumulado en cajón" y "Debía tener" de `ventas_pos_efectivo + otros_ingresos − egresos` (igual que el wizard en vivo), y reconstruye el conteo real con `efectivoEsperado + diferencia` para el bloque de resultado y el resumen de WhatsApp.
>
> Ejecutar `docs/caja/sql/functions/fn_listar_cierres_turno.sql` en Supabase para aplicar.

**Botón "Cerrar Caja":** alert de confirmación → ejecuta `fn_ejecutar_cierre_diario`.

**Después del cierre exitoso:** la página guarda los datos del cierre con `ShareCierreService.guardarPendiente(datos)` y navega al home. Es el home quien detecta el pendiente con `ShareCierreService.consumirPendiente()`. El texto plano lo construye `ShareCierreService.enviarResumenWhatsApp(datos)`. Los datos incluyen `esModoSinPos` y `observaciones`.

**Feedback de éxito/error — overlay, no toast (2026-07-18):** justo antes de navegar al home, la página muestra `FeedbackOverlayService.success({ titulo: 'Cierre registrado', subtitulo: 'Turno #N cerrado correctamente' })` **sin monto destacado** — el desglose completo (efectivo contado, reparto Varios/Tienda, saldos antes→después) ya se mostró en el Paso 2 antes de confirmar; repetir una cifra aquí sería redundante y ambiguo (¿cuál de todas?). Duración corta (2s) para que se disipe antes de que el modal "Enviar resumen" (solo EMPLEADO) tome protagonismo — el overlay tiene mayor `z-index` que ese modal.

En error, la clasificación sigue el mismo contrato que abrir caja (ver `8_PROCESO_ABRIR_CAJA.md` §11): `ejecutarCierreDiario()` usa `{ timeoutMs: TIMING.turnoMutacionTimeoutMs, silentError: true }`, así que un timeout o una excepción real del RPC (`RAISE EXCEPTION`, ej. "El turno ya está cerrado", "Venta celular negativa...") llegan al `catch` de `ejecutarCierre()` en vez de perderse:

```typescript
catch (error: any) {
  if (this.supabase.debeSilenciarErrorOffline(error)) return;   // banner global ya avisa
  const esFalloDeRed = error instanceof TimeoutError || this.supabase.esErrorDeTransporte(error);
  this.feedback.error({
    titulo: 'No se pudo cerrar el turno',
    subtitulo: esFalloDeRed
      ? 'El servidor no respondió. Verifica tu conexión e intenta de nuevo.'
      : (error?.message || 'Intenta de nuevo'),
  });
}
```

El caso `resultado === null` (sin `throw`) solo ocurre cuando `call()` detecta "sin red" — ahí no se muestra overlay (redundante con el banner), solo se cierra el loading.

> **Modal de compartir solo para EMPLEADO (2026-07-01):** el modal "Enviar resumen / Omitir" **solo aparece si quien cierra tiene rol `EMPLEADO`** (`authService.usuarioActualValue?.rol === 'EMPLEADO'` en `home.ionViewWillEnter`). Razón: el ADMIN/dueño ya sabe lo que pasó (cerró él mismo) y no necesita notificarse a sí mismo por WhatsApp — para eso está el historial de cierres, que además tiene su propio botón "Compartir". El empleado sí necesita avisar al dueño ausente en tiempo real. El botón "Compartir" del historial (`CierreTurnoDetalleModalComponent`) sigue disponible para todos, siempre. El aviso de "Transferencia a Varios pendiente" se separó a su propio método (`avisarDeficitVariosSiAplica`) y se muestra **siempre** tras un cierre que lo requiera, independiente del rol.

**Turno abierto varios días (`varios_pendiente`) — v6.5 (2026-07-18):** `fn_datos_cierre_diario` v1.2 calcula, día por día, cuántas transferencias diarias a Varios quedaron sin realizarse mientras el turno estuvo abierto. Retorna `varios_pendiente { dias, monto, desde, hasta }` — itera los días locales en `[fecha_apertura, hoy)` y cuenta los que no cobraron (ni `TRANSFERENCIA_ENTRANTE` ese día, ni un `DEF-REPONER` cuyo turno referenciado cerró ese día). `monto = dias × caja_varios_transferencia_dia`. Excluye días previos a `cajas.created_at` de VARIOS (módulo recién activado). En el caso normal (abierto y cerrado el mismo día) `dias = 0` y no se muestra nada.

Con este dato, tres puntos de la UI informan el pendiente **cuantificado**:
- **Wizard Paso 2** — card `varios-pendiente-card` con monto, número de días y rango de fechas, antes de confirmar el cierre (el empleado no se sorprende con el alert después). Es solo informativa: el pendiente **no** se suma a este cierre.
- **Alert post-cierre (home)** — `avisarDeficitVariosSiAplica` muestra monto + días + rango y ofrece **[Después] [Registrar traspaso]**. El segundo botón ejecuta `TurnosCajaService.compensarVariosPendiente()`.
- **Resumen WhatsApp** — línea con las cifras exactas (`ShareCierreService`).

**La compensación es una acción explícita del usuario, no automática** (decisión de 2026-06-11 conservada): la transferencia a Varios es "una por cierre, máximo una por día" — el cierre no la acumula ni la cobra retroactivamente (el dinero no se pierde, queda en Tienda). Lo que cambió en v6.5 es que el aviso pasó de vago a cuantificado y accionable con 1 tap.

> **Por qué la compensación NO usa `fn_crear_transferencia`:** una `TRANSFERENCIA_ENTRANTE` en VARIOS la interpretarían los checks "¿Varios cobró hoy?" como la cuota del día en curso, reintroduciendo el bug de "la reposición cuenta como la transferencia de hoy" por otra vía. `fn_compensar_varios_pendiente` usa categorías propias (`COMP-DIA-RETIRAR`/`COMP-DIA-REPONER`, UUIDs `...014`/`...015`) que **ningún** check de cuota diaria observa. Códigos abstractos a propósito — no nombran "Varios"/"Tienda" (cajas renombrables); el nombre real se resuelve de `cajas.nombre` para las descripciones del ledger.

---

## 3. Función SQL: `fn_ejecutar_cierre_diario` (v6.3)

> 📄 Código fuente completo: [`docs/caja/sql/functions/fn_ejecutar_cierre_diario_v5.sql`](./sql/functions/fn_ejecutar_cierre_diario_v5.sql)

Llamada vía `supabase.rpc('fn_ejecutar_cierre_diario', params)`. Todo en una transacción atómica.

### Firma

```typescript
// RecargasService.ejecutarCierreDiario(params)
{
  p_turno_id,                    // UUID del turno activo
  p_fecha,                       // fecha local (getFechaLocal(), NO toISOString())
  p_empleado_id,                 // UUID — leído del JWT
  p_efectivo_fisico,             // efectivo contado físicamente en el cajón (incluye fondo)
  p_saldo_celular_final,
  p_saldo_bus_final,
  p_saldo_anterior_celular,      // último saldo_virtual_actual en tabla recargas (CELULAR)
  p_saldo_anterior_bus,          // último saldo_virtual_actual en tabla recargas (BUS)
  p_saldo_anterior_caja_celular,
  p_saldo_anterior_caja_bus,
  p_observaciones                // nullable
}
```

El `negocio_id` **no se pasa como parámetro** — la función lo lee internamente de `public.get_negocio_id()` (JWT). Todas las queries filtran por `negocio_id` porque `SECURITY DEFINER` no aplica RLS.

### Lo que ejecuta (en orden)

1. `PERFORM public.fn_assert_no_superadmin()` — bloquea ejecución si es superadmin
2. Lee `negocio_id` del JWT (`get_negocio_id()`)
3. Valida: turno existe para ese negocio, no tiene `hora_fecha_cierre`, empleado coincide, `p_efectivo_fisico >= 0`
4. Obtiene IDs de cajas, categorías, tipos de servicio y referencia por código
5. Lee fondo del turno (`turnos_caja.fondo_apertura`) y configuración: `caja_varios_activa`, `caja_varios_transferencia_dia`
6. **Cutoff de recargas virtuales:** obtiene `MAX(recargas.created_at)` separado por servicio (`v_ultimo_snapshot_celular`, `v_ultimo_snapshot_bus`) — mismo cutoff que `getAgregadoVirtualHoy()` en frontend
7. Suma `recargas_virtuales` pendientes desde ese cutoff para CELULAR y BUS (`v_agregado_celular`, `v_agregado_bus`)
8. Lee saldos actuales de `CAJA_CHICA`, `CAJA` y `VARIOS` con `FOR UPDATE` (lock de consistencia)
9. Ajuste de conteo físico — solo si hubo movimientos en `CAJA_CHICA` durante el turno:
   - `diferencia > 0` → `INSERT INGRESO` con `categoria_sistema_id = AJU-CONTEO-IN` en CAJA_CHICA
   - `diferencia < 0` → `INSERT EGRESO` con `categoria_sistema_id = AJU-CONTEO-EG` en CAJA_CHICA + `INSERT FALTANTE_CAJA` en `movimientos_empleados`
10. **Detecta si VARIOS ya recibió hoy** — busca `TRANSFERENCIA_ENTRANTE` o `INGRESO` con `categoria_sistema_id = DEF-REPONER` en VARIOS para `p_fecha`
11. Calcula distribución en cascada **VARIOS → Fondo → CAJA** (ver §2)
12. Calcula ventas virtuales: `venta = (saldo_anterior + agregado_pendiente) - saldo_final`
    - Si cualquier venta < 0 → `RAISE EXCEPTION` (bloquea el cierre)
13. Si `v_dinero_a_depositar > 0` → `INSERT CIERRE` en CAJA con `categoria_sistema_id = CIE-CON-POS` (si el turno tuvo ventas POS en efectivo) o `CIE-SIN-POS` (si no)
14. Si `v_transferencia_efectiva > 0` → `INSERT TRANSFERENCIA_ENTRANTE` en VARIOS
15. `UPDATE cajas`: CAJA + depósito, VARIOS + transferencia, CAJA_CHICA → $0
16. Si `venta_celular > 0` → `INSERT recargas` (CELULAR) + `INSERT INGRESO` en CAJA_CELULAR + `UPDATE CAJA_CELULAR`
17. `INSERT recargas` BUS con `ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE` (soporta mini cierre previo) + si `venta_bus > 0` → `INSERT INGRESO` en CAJA_BUS + `UPDATE CAJA_BUS`
18. `UPDATE turnos_caja SET hora_fecha_cierre = NOW()` (sin tocar `fondo_apertura`, que se mantiene como registro histórico del fondo declarado)
19. Retorna JSON con resultado detallado (ver §3.1)

> **Por qué `MAX(recargas.created_at)` y no `MAX(hora_fecha_cierre)`:** el mini cierre de BUS (`fn_registrar_compra_saldo_bus`) inserta en `recargas` con `created_at = NOW()` y en `recargas_virtuales` con `created_at = clock_timestamp()` (ligeramente posterior). Si entre el mini cierre y el cierre final hubo un turno completo cerrado, `MAX(hora_fecha_cierre)` podía quedar entre esos dos timestamps → `v_agregado_bus = 0` → venta bus negativa. El snapshot por `recargas.created_at` es idéntico al cutoff del frontend y siempre es consistente.

### 3.1 Retorno del cierre

```json
{
  "success": true,
  "turno_id": "uuid",
  "fecha": "2026-05-21",
  "turno_cerrado": true,
  "version": "6.3",
  "configuracion": {
    "fondo_apertura": 40.00,
    "transferencia_diaria": 20.00
  },
  "conteo_fisico": {
    "efectivo_fisico": 60.00,
    "saldo_digital_antes": 40.00,
    "efectivo_esperado": 60.00,
    "diferencia": 0,
    "ajuste_aplicado": false
  },
  "distribucion_efectivo": {
    "transferencia_varios": 20.00,
    "deposito_tienda": 20.00,
    "deficit_varios": 0,
    "turno_con_deficit": false,
    "monto_reposicion_apertura": 0
  },
  "recargas_virtuales_dia": {
    "celular": 150.00,
    "bus": 80.00
  },
  "saldos_finales": {
    "caja_chica": 0,
    "caja": 1020.00,
    "varios": 120.00,
    "caja_celular": 45.00,
    "caja_bus": 30.00
  },
  "ventas": {
    "celular": 150.00,
    "bus": 80.00
  }
}
```

---

## 4. Verificación pre-cierre: "¿VARIOS ya recibió hoy?"

> ⚠️ **La función `fn_verificar_transferencia_caja_chica_hoy` fue eliminada (2026-06-11).**
> Su lógica vive ahora **inline en `fn_datos_cierre_diario`** (variable `v_varios_ya_cobro`),
> que retorna el flag `transferencia_ya_hecha` como parte del snapshot consolidado del wizard.
> El frontend no hace ninguna llamada separada. Si la función vieja sigue existiendo en
> Supabase, es huérfana: `DROP FUNCTION IF EXISTS public.fn_verificar_transferencia_caja_chica_hoy(DATE);`

**Cubre dos casos** (ventana del día en UTC calculada desde la fecha local Ecuador):
1. `TRANSFERENCIA_ENTRANTE` en VARIOS hoy → cierre normal anterior del día
2. `INGRESO` con `categoria_sistema_id = DEF-REPONER` en VARIOS **cuyo turno referenciado cerró hoy** → reparación de un déficit generado hoy mismo (reapertura el mismo día)

> **Fix v6.5 (2026-07-18) — atribución por turno, no por fecha:** antes el caso 2 se atribuía por la **fecha del asiento** `DEF-REPONER`. Como la reparación se ejecuta al abrir el turno siguiente (típicamente al día siguiente del cierre deficitario), un déficit de ayer reparado esta mañana quedaba fechado hoy → el cierre de hoy veía "Varios ya cobró" y **no transfería lo del día en curso**, perdiendo esa transferencia de forma permanente. Ahora `fn_reparar_deficit_turno` v4.3 graba el `DEF-REPONER` con `tipo_referencia_id = turnos_caja` + `referencia_id = <turno reparado>`, y el check solo lo cuenta como "cobró hoy" si ese turno **cerró hoy**. Fallback por fecha para filas `DEF-REPONER` viejas sin referencia. Mismo criterio aplicado en `fn_ejecutar_cierre_diario`, `fn_datos_cierre_diario` y `fn_obtener_deficit_turno_anterior`.

Si `transferencia_ya_hecha = true`, el cierre muestra `transferenciaCajaChicaYaHecha = true`: el valor de VARIOS en la distribución aparece como "$0.00 — ✅ Ya recibió hoy" en gris (`.muted`), y la alerta de déficit no se muestra.

---

## 5. Caso especial: depósito anticipado Bus

Cuando se registra una compra de saldo Bus con `saldo_virtual_maquina`, `CAJA_BUS` puede quedar **temporalmente negativa**. El cierre lo corrige sumando `venta_bus`.

Cuando `saldoCajaBus < 0`, el Paso 1 muestra una card explicativa para evitar confusión con un error.

---

## 6. Registro automático de faltante del empleado

> **Distinción clave:** el déficit de VARIOS es un **costo operacional del negocio** — el cajón no alcanzó por el flujo del día, no porque el empleado haya tomado dinero. Esto NO genera deuda del empleado.

Lo que SÍ genera deuda es cuando el **conteo físico es menor que lo esperado** — el cajón tiene menos efectivo del que el sistema calcula que debería haber:

```
efectivo_esperado = saldo_digital + fondo_apertura
diferencia        = efectivo_fisico - efectivo_esperado
```

Si `diferencia < 0` (el empleado tiene menos efectivo del esperado), `fn_ejecutar_cierre_diario` inserta automáticamente un registro en `movimientos_empleados`:

```sql
-- Dentro del bloque ELSIF v_diferencia < 0 (paso 7, ajuste de conteo)
INSERT INTO movimientos_empleados (empleado_id, turno_id, tipo_movimiento, monto, descripcion, creado_por)
VALUES (p_empleado_id, p_turno_id, 'FALTANTE_CAJA', ABS(v_diferencia), '...', p_empleado_id);
```

| Campo | Valor |
| --- | --- |
| `empleado_id` | El empleado que cerró |
| `tipo_movimiento` | `FALTANTE_CAJA` |
| `monto` | `ABS(v_diferencia)` — cuánto faltó en el cajón |
| `estado_liquidacion` | `PENDIENTE` hasta que se incluya en un pago de nómina |

**Cómo se salda:** al pagar la nómina del empleado desde "Cuentas empleados", `fn_pagar_nomina_empleado` descuenta automáticamente los faltantes pendientes del sueldo bruto. El saldo del empleado se calcula con la vista `v_saldos_empleados`.

---

## 7. Reparación de déficit (turno siguiente)

Cuando el cierre termina sin haber podido transferir a VARIOS (`deficit_varios > 0`), el déficit queda implícito en la ausencia de `TRANSFERENCIA_ENTRANTE` en VARIOS para esa fecha.

Al **abrir caja al día siguiente**, `TurnosCajaService.obtenerDeficitTurnoAnterior()` detecta esto y presenta el aviso en el modal de apertura. Ver referencia completa en [`docs/caja/8_PROCESO_ABRIR_CAJA.md`](./8_PROCESO_ABRIR_CAJA.md) §4 y §5.

La función que ejecuta la reparación:

> 📄 [`docs/caja/sql/functions/fn_reparar_deficit_turno.sql`](./sql/functions/fn_reparar_deficit_turno.sql) — v4.0 (categorías en `categorias_sistema`)

En una transacción atómica (v4.3):
1. **EGRESO** de CAJA por `deficit_varios` — categoría `DEF-RETIRAR` (`categorias_sistema`), con `tipo_referencia_id = turnos_caja` + `referencia_id = <turno reparado>`
2. **INGRESO** a VARIOS por `deficit_varios` — categoría `DEF-REPONER` (`categorias_sistema`), con la misma referencia al turno reparado
3. **INSERT** en `turnos_caja` con `fondo_apertura` libre — abre el nuevo turno

El INGRESO `DEF-REPONER` es lo que `obtenerDeficitTurnoAnterior()` detecta para no re-detectar el déficit del turno reparado. **Desde v4.3 la detección es por `referencia_id` (el turno reparado), no por la fecha del asiento** — así una reparación ejecutada días después del cierre deficitario sigue marcando ese turno como saldado, y no interfiere con la cuota diaria del día en que se ejecuta. Las descripciones usan `cajas.nombre` real (no el literal "Varios"/"Tienda"), ya que esas cajas son renombrables.

---

## 8. Queries de auditoría

### Turnos del día con estado

```sql
SELECT
  t.numero_turno,
  e.nombre,
  t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS apertura_local,
  t.hora_fecha_cierre   AT TIME ZONE 'America/Guayaquil' AS cierre_local,
  t.fondo_apertura,
  CASE WHEN t.hora_fecha_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado
FROM turnos_caja t
JOIN usuarios e ON t.empleado_id = e.id
WHERE (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY t.numero_turno;
```

### Operaciones del día (con categoría resuelta usuario/sistema)

```sql
-- Categoría unificada: COALESCE entre categorias_operaciones (manuales)
-- y categorias_sistema (cierre, fondo, ajustes — categoria_sistema_id)
SELECT
  c.nombre AS caja,
  oc.tipo_operacion,
  COALESCE(co.codigo, cs.codigo) AS categoria,
  oc.monto,
  oc.saldo_anterior,
  oc.saldo_actual,
  e.nombre AS empleado,
  oc.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local
FROM operaciones_cajas oc
JOIN cajas c ON oc.caja_id = c.id
LEFT JOIN categorias_operaciones co ON oc.categoria_id = co.id
LEFT JOIN categorias_sistema     cs ON oc.categoria_sistema_id = cs.id
LEFT JOIN usuarios e ON oc.empleado_id = e.id
WHERE (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY oc.fecha;
```

### Saldos de cajas actuales

```sql
SELECT codigo, nombre, saldo_actual
FROM cajas
ORDER BY CASE codigo
  WHEN 'CAJA'         THEN 1
  WHEN 'CAJA_CHICA'   THEN 2
  WHEN 'VARIOS'       THEN 3
  WHEN 'CAJA_CELULAR' THEN 4
  WHEN 'CAJA_BUS'     THEN 5
END;
```

### Verificar si VARIOS ya recibió hoy (debug)

```sql
-- Busca los dos tipos de operación que cuentan como "VARIOS ya cobró"
SELECT
  oc.tipo_operacion,
  co.codigo AS categoria,
  oc.monto,
  oc.descripcion,
  oc.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local
FROM operaciones_cajas oc
JOIN cajas c ON c.id = oc.caja_id AND c.codigo = 'VARIOS'
WHERE (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
  AND (
    oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
    OR (oc.tipo_operacion = 'INGRESO'
        AND oc.categoria_sistema_id = 'a1000001-0000-0000-0000-000000000005')  -- DEF-REPONER
  )
ORDER BY oc.fecha;
```

### Recargas del turno actual

```sql
SELECT
  ts.nombre AS servicio,
  r.saldo_virtual_anterior,
  r.venta_dia,
  r.saldo_virtual_actual
FROM recargas r
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
JOIN turnos_caja t ON r.turno_id = t.id
WHERE t.hora_fecha_cierre IS NULL
  AND (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE;
```
