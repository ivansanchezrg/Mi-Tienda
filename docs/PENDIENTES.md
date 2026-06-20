# Pendientes técnicos — backlog

> Índice único de trabajo pendiente, para revisar ítem por ítem.
>
> **Reglas de mantenimiento (no negociables):**
> 1. Al completar un ítem → **BORRARLO de este archivo** (git guarda la historia). Nunca marcar "hecho" y dejarlo.
> 2. Si el detalle vive en otro documento → aquí va **solo el puntero**, no duplicar contenido.
> 3. Todo ítem lleva: qué es, archivos involucrados, dónde está el detalle, fecha de origen.

---

## 🔴 Bloqueante de release

### C-1 — Credenciales de Supabase trackeadas en git
- **Qué:** `environment.ts` y `environment.prod.ts` siguen trackeados (el `.gitignore` no des-trackea lo ya commiteado). Anon key expuesta en repo + historial.
- **Acción:** rotar anon key en Supabase → `git rm --cached` → `git filter-repo` → force push coordinado.
- **Detalle:** `docs/guides/AUDITORIA-PRODUCCION-2026-05-07.md` (hallazgo C-1, paso a paso) + nota en `docs/guides/ANDROID-BUILD.md` §Credenciales.
- Origen: auditoría 2026-05-07 · verificado vigente 2026-06-10.

---

## 🟠 Funcional (corto plazo)

### Resumen del período veraz en operaciones de caja (RPC)
- **Qué:** los totales Ingresos/Egresos del balance card suman solo las páginas cargadas — con filtro Mes/Todo son parciales hasta scrollear todo. Crear `fn_resumen_operaciones_caja(p_caja_id, p_desde)` con `SUM ... FILTER` y llamarla en paralelo con la primera página.
- **Archivos:** `src/app/features/caja/pages/operaciones-caja/operaciones-caja.page.ts` (`calcularResumen`), `operaciones-caja.service.ts`, función SQL nueva en `docs/caja/sql/functions/`.
- **Detalle:** `docs/caja/1_OPERACIONES-CAJA.md` §Agrupación por fecha.
- Origen: revisión 2026-06-10 (aprobado en concepto, diferido por el usuario).

### Verificar consulta de precio con la pistola de escaneo física
- **Qué:** el flujo web/desktop quedó implementado y es verificable con teclado (la pistola HID
  es equivalente: escribe el código + Enter). Cuando llegue la pistola: confirmar que viene en
  modo teclado (HID) con sufijo Enter (config de fábrica habitual) y probar el flujo completo.
- **Archivos:** `shared/components/consulta-precio-modal/*` (modo manual), `main-layout.page.ts`
  (rama `!scanner.isAvailable`), `sidebar.component.html` (acción rápida "Precio").
- Origen: 2026-06-11 (solo falta el hardware — no hay trabajo de código pendiente).

### Paginación del historial de cierres de turno (baja prioridad)
- **Qué:** `HistorialTurnosPage` carga todo el rango de una vez y `fn_listar_cierres_turno` no tiene `LIMIT` — con el filtro "Todo", a 1-2 cierres/día el payload crece sin tope (~1,000 filas × 30 campos en 2 años). Paginar (RPC con `LIMIT/OFFSET` + infinite scroll) o capear el filtro "Todo" a N meses.
- **Archivos:** `src/app/features/caja/pages/historial-turnos/historial-turnos.page.ts`, `docs/caja/sql/functions/fn_listar_cierres_turno.sql`.
- Origen: revisión de implementación 2026-06-11 (hoy es aceptable; revisar cuando haya un año de datos).

### Regla "otros" de descripción obligatoria → flag explícito
- **Qué:** `requiereDescripcion` decide por regex `/otros?/i` sobre el NOMBRE de la categoría — frágil ante renombres/creaciones del usuario. Migrar a flag en `categorias_operaciones` (ej: `requiere_descripcion BOOLEAN`).
- **Archivos:** `operacion-modal.component.ts`, schema + migración, CRUD de categorías.
- **Detalle:** `docs/caja/2_PROCESO_INGRESO_EGRESO.md` §3 (regla documentada tal cual es hoy).
- Origen: revisión 2026-06-10.

---

## 🟡 Modelo de BD (diseño, sin urgencia)

### `usuario_negocios.updated_at` como base del sueldo proporcional
- **Qué:** el cálculo de días trabajados usa `updated_at - created_at`, pero `updated_at` se resetea con CUALQUIER update (ej: cambio de rol a mitad de mes corrompe el cálculo de transferencia). Crear columna dedicada `fecha_ingreso`.
- **Archivos:** `docs/setup/schema.sql` (tabla 3, comentario), `fn_transferir_empleado`.
- Origen: revisión del modelo 2026-06-10.

### `kardex_inventario.referencia_id` sin tipo
- **Qué:** UUID sin FK ni `tipo_referencia_id` (operaciones_cajas sí lo tiene) — la tabla a la que apunta se infiere por `tipo_movimiento`. Agregar `tipo_referencia_id` cuando se toque inventario.
- **Archivos:** `docs/setup/schema.sql` (tabla 27) + funciones que insertan kardex.
- Origen: revisión del modelo 2026-06-10.

---

## 🟢 Producto (aspiracional, sin diseño)

### Tour de primera vez post-onboarding
- **Qué:** tras crear el primer negocio, el usuario aterriza en `/caja` solo con un toast de celebración. Un tour guiado de 3-4 highlights (abrir caja, registrar venta, ver movimientos) completaría la activación. Sin diseño aún.
- **Archivos:** `home.page.ts` (detección primera visita), componente de tour nuevo.
- Origen: revisión UX del onboarding 2026-06-11 (se implementó la versión mínima: toast "¡{nombre} está listo! 🎉").

### Backup automático de datos
- **Qué:** respaldo programado/exportable de los datos del negocio. Sin diseño aún.
- Origen: backlog histórico de `DASHBOARD-README.md` (movido aquí 2026-06-11).

### Reportes y estadísticas avanzadas
- **Qué:** análisis más allá del resumen diario integrado en Ventas. El módulo `reportes` fue eliminado (2026-03-26) — cualquier reporte nuevo nace como feature puntual, no como módulo.
- Origen: backlog histórico de `DASHBOARD-README.md` (movido aquí 2026-06-11).

---

### Bloqueo técnico por dispositivo y multisucursal según plan (plan MAX)
- **Qué:** el plan MAX muestra bloques visuales de Multisucursal, Multiplataforma e IA como marketing puro — sin bloqueo técnico real. Implementar cuando MAX esté en producción con clientes reales:
  - **Multiplataforma:** detectar `Capacitor.isNativePlatform()`, verificar feature key `movil: true` en `planes.features`, redirigir a suscripción si no la tiene.
  - **Multisucursal:** agregar campo `max_negocios` a tabla `planes`, validar en `fn_completar_onboarding` que `COUNT(negocios del propietario) < max_negocios`, y ocultar "Nueva sucursal" en el sidebar si se alcanzó el límite.
  - **IA:** feature key `ia: true` ya en el JSON de features; implementar cuando el módulo esté construido.
- **Archivos:** `suscripcion.guard.ts`, `suscripcion.service.ts` (`tieneFeature()`), `suscripcion.page.html` (bloques `susc-plan__extra-bloque`), `fn_completar_onboarding.sql`, `selector-negocio-modal.component.ts`, seed de `planes`.
- **Detalle:** `docs/PLAN-PLANES-SUSCRIPCION.md` §Restricción por dispositivo.
- Origen: 2026-06-15 (bloques visuales implementados; bloqueo técnico diferido hasta tener plan MAX en producción).

---

## 🔵 Punteros a pendientes documentados en otros archivos

| Tema | Dónde está el detalle |
|---|---|
| 6 pendientes SQL de severidad baja (FOR UPDATE pago fiado, validación categoría en operación manual, CTEs, etc.) | `docs/guides/RESUMEN-AUDITORIA-SQL-2026-05-30.md` §Pendientes documentados |
| Refactors post-release: `pos.page.ts` (M-4), `auth.service.ts` (M-5), tests ~0% (M-6) | `docs/guides/AUDITORIA-PRODUCCION-2026-05-07.md` §Mejoras recomendadas |
| Burst de `createSignedUrl` × N productos + miniaturas reales al subir (solo si el catálogo crece) | `docs/guides/PLAN-OFFLINE-POS-2026-06-08.md` §13.4 (marcado "no implementar aún") |
| Frescura del home al volver del background + micro-optimización del guard | `docs/guides/PERFORMANCE-STARTUP.md` §Deuda técnica |
| Multicaja (Fases 3-9) + realidades post-plan que debe incorporar (offline, fn_home_dashboard) | `docs/guides/PLAN-MULTICAJA.md` |
| Checklist de go-live (keystore producción, Play Console, política de privacidad) | `docs/guides/AUDITORIA-PRODUCCION-2026-05-07.md` §Checklist Final |
