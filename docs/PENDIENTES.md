# Pendientes técnicos — backlog

> Índice único de trabajo pendiente, para revisar ítem por ítem.
>
> **Reglas de mantenimiento (no negociables):**
> 1. Al completar un ítem → **BORRARLO de este archivo** (git guarda la historia). Nunca marcar "hecho" y dejarlo.
> 2. Si el detalle vive en otro documento → aquí va **solo el puntero**, no duplicar contenido.
> 3. Todo ítem lleva: qué es, archivos involucrados, dónde está el detalle, fecha de origen.

---

## 🟠 Funcional (corto plazo)

### Verificar en dispositivo real la mejora del arranque tras reposo
- **Qué:** se instrumentó el arranque Y el resume (logs "Fast path local en Xms", "Primera
  navegación resuelta en Xms", "App reanudada con proceso vivo tras Xs", "Sesión renovada en Xms"),
  se sacó el refresh de token del camino crítico del guard (§12) y se adelantó al constructor de
  `SupabaseService` para que corra en paralelo con el boot (§14). Confirmar con logcat que la
  reapertura tras reposo largo bajó de ~4s a ~2-2.5s; los logs dicen exactamente dónde se va el
  tiempo y si el reposo mata el proceso o no.
- **Detalle:** `docs/guides/PERFORMANCE-STARTUP.md` §12 y §14.
- Origen: 2026-07-03.

### Verificar consulta de precio con la pistola de escaneo física
- **Qué:** el flujo web/desktop quedó implementado y es verificable con teclado (la pistola HID
  es equivalente: escribe el código + Enter). Cuando llegue la pistola: confirmar que viene en
  modo teclado (HID) con sufijo Enter (config de fábrica habitual) y probar el flujo completo.
- **Archivos:** `shared/components/consulta-precio-modal/*` (modo manual), `main-layout.page.ts`
  (rama `!scanner.isAvailable`), `sidebar.component.html` (acción rápida "Precio").
- Origen: 2026-06-11 (solo falta el hardware — no hay trabajo de código pendiente).

---

## 🟡 Modelo de BD (diseño, sin urgencia)

### `usuarios` / `usuario_negocios` sin política RESTRICTIVE `superadmin_no_write`
- **Qué:** a diferencia de las otras 21 tablas mutables, estas dos no bloquean escritura directa del superadmin vía RLS. No es un olvido trivial: el auto-registro (`AuthService` línea ~214, `INSERT INTO usuarios` con `email = user.email`) lo ejecuta CUALQUIER usuario en su primer login OAuth, incluido el superadmin — un `superadmin_no_write` copiado tal cual del patrón de las otras tablas rompería su propio registro. Requiere una política más matizada (ej: permitir al superadmin escribir solo su propia fila `email = get_email()`, bloquear el resto).
- **Archivos:** `docs/setup/02_rls.sql` (tablas `usuarios`, `usuario_negocios`), `src/app/features/auth/services/auth.service.ts` (auto-registro).
- Origen: detectado al investigar el 400 de `fn_actualizar_membresia` 2026-06-24 (no es la causa de ese bug — esa ya se corrigió en la función).

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
| Modo offline "vendedor de calle" — Fases 0/A/B/C planificadas (clientes offline, ventas del día offline, sellos de frescura). Sin cambios de BD | `docs/guides/PLAN-OFFLINE-CALLE-2026-07-03.md` |
| 6 pendientes SQL de severidad baja (FOR UPDATE pago fiado, validación categoría en operación manual, CTEs, etc.) | `docs/guides/RESUMEN-AUDITORIA-SQL-2026-05-30.md` §Pendientes documentados |
| Refactors post-release: `pos.page.ts` (M-4), `auth.service.ts` (M-5), tests ~0% (M-6) | `docs/guides/AUDITORIA-PRODUCCION-2026-05-07.md` §Mejoras recomendadas |
| Burst de `createSignedUrl` × N productos + miniaturas reales al subir (solo si el catálogo crece) | `docs/guides/PLAN-OFFLINE-POS-2026-06-08.md` §13.4 (marcado "no implementar aún") |
| Micro-optimización del guard (`Network.getStatus()` → valor en memoria, ganancia marginal) | `docs/guides/PERFORMANCE-STARTUP.md` §Deuda técnica |
| Multicaja (Fases 3-9) + realidades post-plan que debe incorporar (offline, fn_home_dashboard) | `docs/guides/PLAN-MULTICAJA.md` |
| Checklist de go-live (keystore producción, Play Console, política de privacidad) | `docs/guides/AUDITORIA-PRODUCCION-2026-05-07.md` §Checklist Final |
