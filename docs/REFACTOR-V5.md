# Refactor v5 — Nueva Arquitectura de Caja Chica Diaria

> **Leyenda:** `[ ]` pendiente · `[x]` completado · `[-]` omitido/no aplica

---

## Contexto

El sistema original no tenía POS. El efectivo del día se calculaba manualmente
(`efectivo_recaudado` en `caja_fisica_diaria`). Con el POS implementado, las ventas
en efectivo ya se registran automáticamente, generando un **doble conteo en `CAJA`**.

Se rediseña la arquitectura para reflejar la realidad del negocio:
- `CAJA_CHICA` (nueva) = cajón físico diario → recibe ventas efectivo + egresos del día
- `VARIOS` (antes `CAJA_CHICA`) = fondo de emergencia
- Al cierre: empleado cuenta físico → ajuste si difiere → transferencia a VARIOS + depósito a CAJA
- `caja_fisica_diaria` y `gastos_diarios` se eliminan

### Cajas resultantes (5 total)

| Código BD     | UI         | Rol                                          |
|---------------|------------|----------------------------------------------|
| `CAJA_CHICA`  | Caja Chica | **NUEVA** — cajón físico diario              |
| `CAJA`        | Tienda     | Bóveda/principal — recibe depósito al cierre |
| `VARIOS`      | Varios     | Fondo emergencia (antes `CAJA_CHICA`)        |
| `CAJA_CELULAR`| Celular    | Sin cambio                                   |
| `CAJA_BUS`    | Bus        | Sin cambio                                   |

---

## FASE 1 — Base de Datos: Migración de cajas y tablas
> SQL puro — ejecutar en **Supabase SQL Editor**
> Archivos: `docs/schema.sql`, `docs/dashboard/sql/migrations/v5_migracion_cajas.sql`

- [x] **1a.** Renombrar `CAJA_CHICA` → `VARIOS`
- [x] **1b.** Crear nueva `CAJA_CHICA` (cajón diario)
- [x] **1c.** Eliminar tablas obsoletas (`gastos_diarios`, `categorias_gastos`, `caja_fisica_diaria`)
- [x] **1d.** Limpiar `tipos_referencia` obsoletos
- [x] **1e.** Agregar categorías de ajuste para reconciliación física (EG-013, IN-005)
- [x] **1f.** Actualizar `docs/schema.sql` → v5.0 (16 tablas, 5 cajas, 18 categorías)

**✅ Verificación fase 1:** Ejecutar `docs/dashboard/sql/migrations/v5_migracion_cajas.sql` en Supabase SQL Editor. Confirmar 5 cajas, tablas eliminadas, categorías EG-013/IN-005 presentes.

---

## FASE 2 — SQL: Trigger de ventas actualizado
> SQL puro — ejecutar en **Supabase SQL Editor**
> Script incluido en: `docs/dashboard/sql/migrations/v5_migracion_cajas.sql` (Paso 2)

- [x] **2a.** Actualizar trigger `fn_actualizar_saldo_caja_venta` → redirigir de `CAJA` a `CAJA_CHICA`
- [-] **2b.** `fn_actualizar_stock_venta` — sin cambios (solo maneja stock)

**✅ Verificación fase 2:** Venta EFECTIVO de prueba → INGRESO registrado en `CAJA_CHICA`, no en `CAJA`.

---

## FASE 3 — SQL: Funciones PostgreSQL nuevas/actualizadas
> SQL puro — ejecutar en **Supabase SQL Editor**
> Archivos: `docs/dashboard/sql/functions/`

- [x] **3a.** Crear `fn_ejecutar_cierre_diario_v5.sql` → **v5.0** (nuevo input: `p_efectivo_fisico`, sin `caja_fisica_diaria`)
- [x] **3b.** Actualizar `fn_reparar_deficit_turno.sql` → **v1.2** (busca código `VARIOS` en vez de `CAJA_CHICA`)
- [x] **3c.** Actualizar `fn_verificar_transferencia_caja_chica_hoy.sql` → **v1.2** (detecta en VARIOS, no CAJA_CHICA)

**✅ Verificación fase 3:** DROP función v4.9 → ejecutar `fn_ejecutar_cierre_diario_v5.sql` → ejecutar las otras dos funciones. Cierre de prueba → `CAJA_CHICA` queda en $0, `VARIOS` recibe transferencia, `CAJA` recibe depósito.

---

## FASE 4 — TypeScript: Modelos y Servicios
> Código Angular — VS Code

- [x] **4a.** Actualizar `saldos-anteriores.model.ts`
- [x] **4b.** Actualizar `CajasService` (`cajas.service.ts`) — 5 cajas, nueva interfaz
- [x] **4c.** Actualizar `TurnosCajaService` (`turnos-caja.service.ts`)
- [-] **4d.** Eliminar `GastosDiariosService` (`gastos-diarios.service.ts`) — se elimina junto con la carpeta completa en FASE 7
- [x] **4e.** Confirmar `PosService` sin cambios (solo comentario de trigger actualizado)

**✅ Verificación fase 4:** `npm run build` sin errores TypeScript.

---

## FASE 5 — UI: Dashboard — Home y Modal Apertura
> Código Angular — VS Code

- [x] **5a.** Actualizar `home.page.ts` / `home.page.html` — 5 cajas, mapeos `VARIOS`
- [x] **5b.** Actualizar `verificar-fondo-modal.component.ts` — sin cambios necesarios (TurnosCajaService ya actualizado)

**✅ Verificación fase 5:** Flujo completo de apertura con déficit y sin déficit funciona correctamente.

---

## FASE 6 — UI: Cierre Diario Rediseñado
> Código Angular — VS Code

- [x] **6a.** Reescribir `cierre-diario.page.ts` — wizard 3 pasos (virtuales → conteo físico → resumen)
- [x] **6b.** Eliminar getters de distribución en UI (los calcula SQL v5 — solo preview simplificado queda)

**✅ Verificación fase 6:** Cierre con ajuste · sin ajuste · con déficit de VARIOS — los 3 escenarios funcionan.

---

## FASE 7 — UI: Eliminar módulo Gastos Diarios
> Código Angular — VS Code

- [x] **7a.** Eliminar carpeta `src/app/features/gastos-diarios/` completa
- [x] **7b.** Eliminar ruta del módulo en el router principal
- [x] **7c.** Quitar ítem "Gastos Diarios" del sidebar
- [x] **7d.** `operacion-modal.component` — CAJA_CHICA + VARIOS disponibles para operaciones manuales

**✅ Verificación fase 7:** Egreso en `CAJA_CHICA` registrado correctamente y visible en historial.

---

## FASE 8 — Documentación

- [-] **8a.** `docs/schema.sql` — pendiente actualización manual (schema vive en Supabase)
- [x] **8b.** `docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql` — ya existía (FASE 3)
- [x] **8c.** `docs/dashboard/3_PROCESO_CIERRE_CAJA.md` — reescrito para v5
- [x] **8d.** `docs/dashboard/DASHBOARD-README.md` — actualizado (wizard 3p, sin gastos-diarios)
- [x] **8e.** `docs/gastos-diarios/GASTOS-DIARIOS-README.md` — marcado como DEPRECADO
- [x] **8f.** `CLAUDE.md` — 5 cajas, módulo gastos-diarios eliminado
- [x] **8g.** `README.md` — 5 cajas, sin gastos-diarios en estructura

**✅ Verificación fase 8:** Toda la doc refleja arquitectura v5. Sin referencias a tablas eliminadas.
