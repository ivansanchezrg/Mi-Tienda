# Pendientes técnicos — backlog

> Índice único de trabajo pendiente, para revisar ítem por ítem.
>
> **Reglas de mantenimiento (no negociables):**
> 1. Al completar un ítem → **BORRARLO de este archivo** (git guarda la historia). Nunca marcar "hecho" y dejarlo.
> 2. Si el detalle vive en otro documento → aquí va **solo el puntero**, no duplicar contenido.
> 3. Todo ítem lleva: qué es, archivos involucrados, dónde está el detalle, fecha de origen.

---

## 🟠 Funcional (corto plazo)

### Ejecutar en Supabase los RPCs de creación con favorito (switch en crear producto)
- **Qué:** los formularios de crear producto ahora tienen un switch "Favorito" que se pasa a
  los RPCs de creación como `p_favorito BOOLEAN DEFAULT FALSE`. Hay que re-ejecutar las dos
  funciones para que acepten el parámetro (tienen `DROP FUNCTION ... CASCADE`, seguro re-ejecutar).
  Sin esto, crear un producto con el switch activado no marca el favorito (el resto del feature
  —estrella en modal POS, switch en editar, toggle de template— funciona sin tocar SQL, usa
  UPDATE directo). Detalle: `docs/inventario/INVENTARIO-README.md` → "Favorito".
  Ejecutar en el SQL Editor:
  1. `docs/inventario/sql/functions/fn_crear_producto_simple.sql`
  2. `docs/inventario/sql/functions/fn_crear_producto_con_variantes.sql`
- **Origen:** 2026-07-21.

### Ejecutar en Supabase el fix de transferencias a Varios (turno abierto varios días)
- **Qué:** corrige dos bugs del cierre relacionados con la transferencia diaria a Varios.
  (1) Bug de dinero real: al reparar un déficit al día siguiente, la reposición se
  atribuía por fecha del asiento → el cierre de ese día veía "Varios ya cobró" y perdía
  la transferencia del día en curso, de forma permanente. Ahora los asientos `DEF-REPONER`/
  `DEF-RETIRAR` referencian el turno reparado y los checks atribuyen por `referencia_id`.
  (2) UX: si el turno estuvo abierto varios días, el aviso ahora informa monto/días/rango
  exactos y ofrece compensar con 1 tap (traspaso Tienda → Varios). Detalle: `docs/caja/3_PROCESO_CIERRE_CAJA.md` (v6.5) + `8_PROCESO_ABRIR_CAJA.md`.
  Ejecutar en el SQL Editor, en este orden:
  1. `docs/setup/04_categorias_sistema.sql` (agrega `COMP-DIA-RETIRAR`/`COMP-DIA-REPONER`, UUIDs `...014`/`...015`; es `ON CONFLICT DO NOTHING`, seguro re-ejecutar).
  2. `docs/caja/sql/functions/fn_reparar_deficit_turno.sql` (v4.3).
  3. `docs/caja/sql/functions/fn_ejecutar_cierre_diario_v5.sql` (v6.5).
  4. `docs/caja/sql/functions/fn_obtener_deficit_turno_anterior.sql` (v1.1).
  5. `docs/caja/sql/functions/fn_datos_cierre_diario.sql` (v1.2).
  6. `docs/caja/sql/functions/fn_compensar_varios_pendiente.sql` (nueva, v1.0).
- **Archivos front:** `saldos-anteriores.model.ts`, `turnos-caja.service.ts` (`compensarVariosPendiente()` + mapeo `variosPendiente`), `share-cierre.service.ts`, `cierre-diario.page.*` (card Paso 2), `home.page.ts` (alert cuantificado + botón), `cierre-turno-detalle-modal.component.ts`.
- Origen: 2026-07-18.

### Ejecutar en Supabase la función de editar plantilla (grupo de variantes)
- **Qué:** nueva función para editar los datos generales de un producto con variantes
  (nombre, categoría e imagen general del template). Habilita agregar/cambiar la imagen
  representante del grupo cuando no se subió al crear el producto.
  Ejecutar en el SQL Editor:
  1. `docs/inventario/sql/functions/fn_actualizar_template.sql` (v1.0).
- **Archivos front:** `template-editar.page.*` (nueva página `/inventario/template/:id`),
  `ProductoService.actualizarTemplate()`, botón lápiz en la tarjeta agrupada de `inventario.page.html`.
- Origen: 2026-07-13.

### Ejecutar en Supabase el SQL de orden de categorías + productos favoritos
- **Qué:** dos features nuevas — orden manual de categorías (drag & drop en Configuración →
  Categorías de Producto) y productos favoritos (estrella en Inventario y long-press en el
  catálogo POS, solo productos simples sin presentaciones). Código frontend y archivos SQL
  fuente ya están en el repo (`docs/setup/schema.sql` ya tiene ambas columnas); falta ejecutar
  en el SQL Editor de Supabase, en este orden:
  1. `ALTER TABLE categorias_productos ADD COLUMN orden` + `ALTER TABLE productos ADD COLUMN favorito` (ver `docs/setup/schema.sql` líneas ~519-526 y ~596 para la definición exacta).
  2. Backfill de `orden` (numera categorías existentes por orden alfabético actual).
  3. `docs/inventario/sql/functions/fn_reordenar_categorias.sql` (función nueva).
  4. `docs/pos/sql/functions/fn_catalogo_productos_pos.sql` (v1.2 — agrega `favorito`).
  5. `docs/inventario/sql/functions/fn_listar_productos.sql` (v2.2 — agrega `favorito`).
- **Archivos front:** `categorias-productos.page.*` (drag & drop), `inventario.page.*` (estrella),
  `pos.page.*` (tab Favoritos + long-press), `InventarioService.reordenarCategorias()`,
  `ProductoService.toggleFavorito()`.
- Origen: 2026-07-16.

### Ejecutar en Supabase el SQL de la auditoría POS 2026-07-11
- **Qué:** la revisión completa del módulo POS actualizó dos funciones y eliminó una muerta.
  Ejecutar en el SQL Editor, en este orden:
  1. `docs/pos/sql/functions/fn_registrar_venta_pos.sql` (v3.2 — valida que cada
     `presentacion_id` pertenezca al negocio Y al producto del ítem; antes una presentación
     ajena distorsionaba stock/kardex vía el trigger).
  2. `docs/pos/sql/functions/fn_catalogo_productos_pos.sql` (v1.1 — presentaciones con
     `ORDER BY factor_conversion` para orden estable en el modal de variantes).
  3. `DROP FUNCTION IF EXISTS public.fn_buscar_productos_pos(TEXT);` (RPC muerta — el POS
     filtra el grid client-side desde 2026-05; su archivo y la cadena Angular ya se eliminaron).
- Origen: auditoría POS 2026-07-11.

### Pulido diferido de la auditoría POS 2026-07-11 (baja prioridad)
- **Qué:** (a) el badge de stock tri-estado (¡último! / quedan N / N disp.) está repetido 5×
  entre `pos.page.html` y `variante-selector-modal.component.html` con clases CSS distintas —
  candidato a mini-componente compartido; (b) `.upselling-hint` (footer mobile) y
  `.panel-upselling` (panel desktop) en `pos.page.scss` duplican estilos casi idénticos;
  (c) `podarHuerfanos` de `ImagenLocalService` no es multi-negocio: al alternar sucursales se
  purgan y re-descargan los binarios del otro negocio (solo churn de red, no fuga de datos).
- **Archivos:** `pos.page.html`, `pos.page.scss`, `variante-selector-modal.component.html`, `imagen-local.service.ts`.
- Origen: auditoría POS 2026-07-11.

### Verificar en dispositivo real el fix de candado POS/sidebar tras reposo
- **Qué:** bug intermitente reportado — tras un reposo largo del teléfono, el tab POS
  quedaba con candado y el sidebar sin menú aunque el Home ya mostraba "caja abierta".
  Causa: `main-layout.page.ts` y `sidebar.component.ts` se suscribían a `esMiTurno$`/`config$`
  DESPUÉS de un `await` de hidratación que podía colgarse con el TTL de config vencido (1h)
  + red lenta al despertar. Fix: suscripciones movidas a ANTES del await (los BehaviorSubjects
  entregan su último valor al suscribir). Confirmar en dispositivo real: abrir turno, poner el
  teléfono en reposo >1h (o desactivar red al despertar), reabrir la app y verificar que el
  tab POS y el sidebar se desbloquean de inmediato, sin esperar a que la config termine de
  refrescarse contra el servidor.
- **Detalle:** `docs/layout/LAYOUT-README.md` → "Candado del tab POS y del sidebar — orden de suscripción obligatorio".
- **Archivos:** `main-layout.page.ts`, `sidebar.component.ts`.
- Origen: 2026-07-12.

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

### Bloqueo técnico por dispositivo e IA según plan (plan MAX)
- **Qué:** el plan MAX muestra bloques visuales de Multisucursal, Multiplataforma e IA como marketing. **Multisucursal ya tiene bloqueo técnico real implementado** (`max_negocios` en `planes`, validado en `fn_completar_onboarding`). Faltan:
  - **Multiplataforma:** detectar `Capacitor.isNativePlatform()`, verificar feature key `movil: true` en `planes.features`, redirigir a suscripción si no la tiene.
  - **IA:** feature key `ia: true` ya en el JSON de features; implementar cuando el módulo esté construido.
- **Archivos:** `suscripcion.guard.ts`, `suscripcion.service.ts` (`tieneFeature()`), `suscripcion.page.html` (bloques `susc-plan__extra-bloque`).
- **Detalle:** `docs/suscripcion/SUSCRIPCION-README.md` sección "Diferenciadores del plan MAX — roadmap de bloqueo técnico".
- Origen: 2026-06-15 (bloques visuales implementados; bloqueo técnico diferido hasta tener plan MAX en producción). Multisucursal completado 2026-06-16.

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
