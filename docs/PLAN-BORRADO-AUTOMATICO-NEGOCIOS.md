# Plan de Implementación — Borrado Automático de Negocios Vencidos

> Estado: ✅ Completado — 2026-06-30
> Creado: 2026-06-24 — Implementación: 2026-06-27 — Validación end-to-end: 2026-06-30
> Relacionado: [docs/suscripcion/SUSCRIPCION-README.md](suscripcion/SUSCRIPCION-README.md), [docs/PLAN-PLANES-SUSCRIPCION.md](PLAN-PLANES-SUSCRIPCION.md)

## Contexto y objetivo

Hoy un negocio cuyo trial o suscripción vence **nunca se borra**: queda bloqueado indefinidamente (`fn_estado_suscripcion` deriva `TRIAL_VENCIDO`/`VENCIDA`, el guard bloquea el acceso), pero sus datos viven para siempre en la BD y en Storage. A medida que se registren negocios que prueban la app y no continúan, esto acumula "data basura" sin límite.

Este plan agrega un **periodo de gracia + purga diferida**, el patrón estándar de SaaS (Notion, Linear, etc.): nunca se borra en caliente, siempre hay aviso previo, y el borrado real ocurre días después del vencimiento.

### Decisiones ya tomadas (no rediscutir)

1. **Facturación por propietario, no por negocio.** El plan MAX cubre hasta 3 negocios del mismo `propietario_usuario_id` bajo un solo ciclo de pago. La purga se evalúa y ejecuta **agrupando por propietario**: si el propietario no paga, se purgan **todos** sus negocios juntos (mismo criterio que ya usa `fn_suspender_propietario_suscripcion`).
2. **Periodo de gracia: 30 días desde el vencimiento.** Aviso único al día 23 (7 días antes del borrado). Borrado al día 30.
3. **El usuario (cuenta global en `usuarios`) NUNCA se borra automáticamente.** Solo se borran sus negocios y los datos asociados. Esto rompe el `ON DELETE RESTRICT` de `negocios.propietario_usuario_id` (línea 1617 de `schema.sql`) — ver Fase 1.
4. **Todo el flujo es manual (2026-06-26), sin fecha de automatización.** El superadmin opera desde `/admin`: ve la lista de negocios en cuenta regresiva, envía el aviso por WhatsApp con un botón (mismo patrón ya usado en cobros), y ejecuta la purga negocio por negocio cuando corresponde, verificando con sus propios ojos que todo se borró correctamente (BD + Storage). No se implementa cron, Edge Function ni envío automático de notificaciones en esta versión — ver sección "Diferido" al final del documento. La función de purga (`fn_purgar_negocio`, Fase 4) queda lista para ser reutilizada por un futuro cron si el volumen lo justifica, pero eso no es parte de este alcance.

---

## Hallazgos de la auditoría (estado actual del esquema)

| Aspecto | Estado actual | Implicación |
|---|---|---|
| Tablas con `negocio_id ON DELETE CASCADE` | 21 tablas (`cajas`, `configuraciones`, `categorias_operaciones`, `turnos_caja`, `recargas`, `recargas_virtuales`, `operaciones_cajas`, `movimientos_empleados`, `categorias_productos`, `atributos`, `atributo_opciones`, `producto_templates`, `productos`, `template_atributos`, `template_atributo_opciones`, `producto_presentaciones`, `codigos_barras`, `clientes`, `secuencias_comprobantes`, `ventas`, `kardex_inventario`, `cuentas_cobrar`, `notas`) + `usuario_negocios` + `suscripciones` | `DELETE FROM negocios WHERE id = ...` las limpia automáticamente, sin tocarlas una por una |
| `suscripcion_pagos.negocio_id` | `ON DELETE SET NULL` | Correcto tal cual está — el historial de pagos NO debe perderse al borrar el negocio (es contable). Se mantiene la fila, solo se desvincula el negocio. **No cambiar.** |
| `negocios.propietario_usuario_id` | `ON DELETE RESTRICT`, ~~`NOT NULL`~~ (eliminado en Fase 1 — ver abajo) | El `RESTRICT` sigue intacto. El `NOT NULL` se eliminó en Fase 1 para que `fn_purgar_negocio` pueda poner `NULL` transitoriamente antes del `DELETE`. |
| Storage (`bucket mi-tienda`) | Solo `deleteFile(path)` por archivo individual en `StorageService` | No existe limpieza por carpeta — hay que añadirla. Postgres `CASCADE` no toca Storage, son sistemas separados |
| Cron / Edge Functions | No existen en el proyecto, ni se implementan en este plan | Flujo 100% manual desde `/admin` (decisión 2026-06-26). Ver sección "Diferido" |
| Funciones de suscripción existentes | `fn_estado_suscripcion` (deriva estado), `fn_suspender_propietario_suscripcion` (UPDATE estado), `fn_registrar_pago_propietario` (renueva) | Ninguna borra `negocios`. Todas operan ya a nivel propietario — coherente con la decisión #1 |

---

## Diseño general

```
Día 0  (vence_el pasa)         → ya bloqueado por fn_estado_suscripcion (sin cambios)
Día 23 (7 días antes de purgar) → fn_marcar_negocios_para_purga lo marca; el superadmin ve la cuenta regresiva en /admin y envía el aviso por WhatsApp con un botón
Día 30                          → el superadmin ejecuta "Purgar ahora" desde /admin (Storage + BD) de todos los negocios del propietario
```

Dos nuevas columnas en `suscripciones` (no en `negocios`, porque el ciclo de vida de purga es 1:1 con el ciclo de suscripción):

```sql
ALTER TABLE suscripciones
    ADD COLUMN purga_avisada_el    TIMESTAMP WITH TIME ZONE,  -- cuándo se marcó (no cuándo se envió el WhatsApp — ese envío es manual y no se registra en BD)
    ADD COLUMN purga_programada_el TIMESTAMP WITH TIME ZONE;  -- fecha desde la que "Purgar ahora" queda habilitado en /admin
```

Ambas nullable. Se llenan cuando `fn_marcar_negocios_para_purga` detecta vencimiento + gracia cumplida (el superadmin la ejecuta manualmente o, si se automatiza más adelante, un cron); se limpian (`NULL`) automáticamente si el propietario paga antes de la purga (ya lo hace `fn_registrar_pago_propietario` — ver Fase 3).

---

## Fase 1 — Esquema: permitir el borrado sin romper integridad

**Objetivo:** dejar la BD lista para que `DELETE FROM negocios` funcione sin tocar `usuarios`.

- [x] Decisión de implementación confirmada: **dejar el `RESTRICT` intacto** + **quitar `NOT NULL`** de `negocios.propietario_usuario_id` (`ALTER TABLE negocios ALTER COLUMN propietario_usuario_id DROP NOT NULL`). El `RESTRICT` protege que no se borre un usuario con negocios activos (caso inverso). El `NOT NULL` se quitó porque `fn_purgar_negocio` necesita poner la columna en `NULL` transitoriamente antes del `DELETE` — ese `NULL` nunca queda persistente (ocurre dentro de la misma transacción atómica). Bug descubierto en la prueba real: sin `DROP NOT NULL`, el `UPDATE ... = NULL` lanzaba "violates not-null constraint".
- [x] Columnas `purga_avisada_el` y `purga_programada_el` agregadas a `suscripciones` en `docs/setup/schema.sql` (junto a la definición de la tabla) y en script suelto `docs/suscripcion/sql/setup/alter_suscripciones_purga.sql` (para ejecutar ya en el proyecto Supabase real sin reset completo).
- [x] Índice parcial agregado: `idx_suscripciones_purga_pendiente ON suscripciones (purga_programada_el) WHERE purga_programada_el IS NOT NULL` (en ambos archivos de la columna anterior).
- [x] RLS verificada: `suscripciones_no_write` (`02_rls.sql:692-693`) ya bloquea toda escritura directa desde el cliente — las columnas nuevas quedan cubiertas sin política adicional. `suscripciones_select` ya cubre lectura.
- [x] Documentado en `docs/suscripcion/SUSCRIPCION-README.md` (sección "Purga automática de negocios vencidos").

**Validación de la fase (pendiente de ejecutar en Supabase):**
1. Ejecutar `docs/suscripcion/sql/setup/alter_suscripciones_purga.sql` en el SQL Editor.
2. Con un negocio de prueba (NUNCA uno real): `UPDATE negocios SET propietario_usuario_id = NULL WHERE id = '<negocio_prueba>';` y confirmar que no lanza error de FK pese al `RESTRICT` (porque ya no hay valor que viole la constraint, el `UPDATE` solo falla si el negocio sigue *referenciado* con un usuario que no existe — no es el caso).
3. Luego `DELETE FROM negocios WHERE id = '<negocio_prueba>';` y confirmar que no lanza error de FK.

---

## Fase 2 — Función de detección y marcado (sin borrar nada todavía)

**Objetivo:** una función que recorra negocios vencidos hace ≥23 días, agrupe por propietario, marque `purga_programada_el` y devuelva la lista para poder avisar.

- [x] Creado `docs/suscripcion/sql/functions/fn_marcar_negocios_para_purga.sql`:
  - `SECURITY DEFINER`, `SET search_path = public`. Valida superadmin (mismo patrón de `fn_registrar_pago_propietario`).
  - Agrupa por `propietario_usuario_id`, usa `MIN(s.vence_el)` como fecha de vencimiento efectiva del propietario (mismo criterio que `fn_registrar_pago_propietario`).
  - Excluye `SUSPENDIDA`/`CANCELADA` del cálculo (`WHERE s.estado NOT IN (...)`).
  - Filtra `MIN(vence_el)` con ≥23 días vencidos por fecha de calendario en hora local (Ecuador, mismo criterio que `fn_estado_suscripcion`) y que ningún negocio del propietario tenga ya `purga_avisada_el` seteado (evita re-marcar).
  - `UPDATE` aplicado a **todos** los negocios del propietario marcado, no solo al del `MIN`.
  - Retorna `JSON` array (no `TABLE`, para consistencia con el resto de funciones del módulo como `fn_listar_suscripciones_admin`) con un item por negocio marcado.
  - No usa `fn_assert_no_superadmin` (es administración de plataforma, no mutación operativa del negocio). `REVOKE ... FROM anon; GRANT ... TO authenticated;`.
- [x] Creado `docs/suscripcion/sql/functions/fn_listar_negocios_pendientes_purga.sql` — de solo lectura, devuelve todos los negocios con `purga_avisada_el IS NOT NULL`, incluyendo `puede_purgar_ya` (booleano ya calculado) y `dias_restantes_purga`.
  - **Decisión tomada:** `telefono_contacto` usa el teléfono del **negocio ancla** del propietario (el más antiguo por `created_at`, mismo criterio "ancla" que ya usa `fn_registrar_pago_propietario` para el pago) — no existe columna teléfono en `usuarios` (perfil global), solo `negocios.telefono`. Evita que el superadmin tenga que elegir entre varios teléfonos si el propietario tiene negocios MAX.

**Validación de la fase — ✅ ejecutada en Supabase (2026-06-26):**
1. Migración `alter_suscripciones_purga.sql` ejecutada — columnas y índice creados.
2. Probado con script de datos ficticios (`docs/suscripcion/sql/setup/test_fn_marcar_negocios_para_purga.sql`, simulando JWT con `set_config('request.jwt.claims', ...)` porque el SQL Editor no tiene sesión real).
3. **Caso crítico confirmado por `fn_listar_negocios_pendientes_purga`**: propietario con 2 negocios (plan MAX) vencidos hace 25 días — ambos quedaron marcados juntos con el mismo `purga_avisada_el`/`purga_programada_el`, y `telefono_contacto` correcto (el del negocio ancla, el más antiguo). Confirma que la agrupación por propietario y el criterio `MIN(vence_el)` funcionan como se diseñó.
4. Casos B (vencido hace 10 días, no debe marcarse) y C (`SUSPENDIDA`, no debe marcarse) quedan pendientes de una verificación manual adicional por el usuario, probando con negocios creados vía onboarding real en vez del script de datos ficticios — no bloquea el avance, el criterio SQL (`HAVING ... - 23`, `WHERE s.estado NOT IN (...)`) ya está revisado y es el mismo patrón usado en el resto del módulo.

---

## Fase 3 — Cancelar la purga si el propietario paga a tiempo

**Objetivo:** que pagar en cualquier momento antes del día 30 anule la purga sin intervención manual.

- [x] Modificado `fn_registrar_pago_propietario.sql`: agregadas `purga_avisada_el`/`purga_programada_el` con valor `NULL` tanto en el `INSERT` como en la cláusula `ON CONFLICT DO UPDATE SET` del loop existente (líneas 164-180) — un pago siempre cancela cualquier purga en curso.
- [x] Modificado `fn_suspender_propietario_suscripcion.sql`: en el `UPDATE` masivo, se agregó `purga_avisada_el`/`purga_programada_el` con `CASE WHEN p_suspender THEN <valor actual> ELSE NULL END` — solo se limpian en la rama de reactivación (`p_suspender = FALSE`); al suspender no se tocan (la purga sigue su curso independiente del bloqueo manual).
- [x] Confirmado: `fn_estado_suscripcion` no necesita cambios — sigue derivando el bloqueo de acceso igual, las columnas de purga son ajenas al guard de la app.

**Validación de la fase (pendiente de ejecutar en Supabase):** re-ejecutar ambos archivos `.sql` modificados en el SQL Editor. Con datos de prueba: marcar un negocio para purga (Fase 2), luego ejecutar `fn_registrar_pago_propietario` para ese propietario, y confirmar que `purga_avisada_el`/`purga_programada_el` vuelven a `NULL`. Repetir con `fn_suspender_propietario_suscripcion(p_suspender = FALSE)` sobre un propietario marcado.

---

## Fase 4 — Función de purga real (BD) + limpieza de Storage

**Objetivo:** el borrado efectivo, irreversible, con limpieza completa BD + archivos.

- [x] Creado `docs/suscripcion/sql/functions/fn_purgar_negocio.sql`:
  - Recibe `p_negocio_id UUID`. `SECURITY DEFINER`, `SET search_path = public`, valida superadmin.
  - Valida `purga_programada_el IS NOT NULL AND purga_programada_el <= NOW()` antes de borrar — cinturón de seguridad contra llamadas accidentales/prematuras.
  - Activa `SET LOCAL app.purga_en_curso = 'true'` antes del borrado para que los triggers de inmutabilidad (`fn_proteger_operacion_caja`, `fn_bloquear_delete_movimiento`, `fn_proteger_propietario_negocio`) cedan. `SET LOCAL` limita el efecto exactamente a esta transacción.
  - **Borrado manual ordenado (hijos → padres)** antes del `DELETE FROM negocios`. No se confía solo en el CASCADE de `negocios` porque hay FK internas entre tablas del negocio SIN `ON DELETE CASCADE` (ej: `ventas_detalles.producto_id → productos`, `ventas.turno_id → turnos_caja`, `productos.categoria_id → categorias_productos`) que bloquean el CASCADE por orden no determinista. Borrar en orden explícito evita tocar esas constraints (que protegen la integridad en operación normal). Las tablas pivote CON cascade hacia su padre se limpian solas. El `DELETE FROM negocios` final limpia el resto (`movimientos_empleados`, `configuraciones`, `usuario_negocios`, `suscripciones`, etc.).
  - Retorna `JSON` con `{ success, negocio_id, negocio_nombre, propietario_id, storage_prefix, tablas_afectadas }`.
  - `REVOKE ... FROM anon; GRANT ... TO authenticated;`.
- [x] **Fix triggers bloqueantes** (`docs/suscripcion/sql/setup/fix_triggers_purga.sql`) — descubierto al probar con negocio real con datos. 3 triggers bloqueaban el CASCADE y 1 FK `RESTRICT` lo bloqueaba también:
  - `fn_proteger_operacion_caja` / `fn_bloquear_delete_movimiento` / `fn_proteger_propietario_negocio` — agregado bypass `IF current_setting('app.purga_en_curso', true) = 'true' THEN RETURN OLD`.
  - `turnos_caja.caja_id` — cambiado de `ON DELETE RESTRICT` a `ON DELETE SET NULL` (si el CASCADE borra `cajas` antes que `turnos_caja`, el turno queda con `caja_id = NULL` en vez de bloquear).
  - Reflejado en `schema.sql`, `trigger_proteger_propietario.sql` y `fn_purgar_negocio.sql`.
- [x] Creado `docs/suscripcion/sql/functions/fn_cancelar_purga_negocio.sql` (mencionada en Fase 5): limpia `purga_avisada_el`/`purga_programada_el` de todos los negocios de un propietario sin que medie un pago real — excepción de soporte.
- [x] Agregado método `deleteNegocioFolder(negocioId: string): Promise<void>` en `StorageService` (`src/app/core/services/storage.service.ts`): recorre recursivamente `{negocioId}/` con un helper privado `listarArchivosRecursivo()` (sin hardcodear nombres de subcarpeta — una entrada con `id === null` es carpeta y se vuelve a listar, una entrada con `id` es archivo y se acumula), y borra todos los paths encontrados en un solo `remove()`.
- [x] Documentado en `docs/core/CORE-README.md` (tabla de API pública de `StorageService`) con advertencia explícita de uso exclusivo del flujo de purga.

**Validación de la fase (pendiente de ejecutar en Supabase + app):**
1. Ejecutar `fn_purgar_negocio.sql` y `fn_cancelar_purga_negocio.sql` en el SQL Editor.
2. Con un negocio de prueba completo (turnos, ventas, productos con fotos subidas a Storage) marcado y con `purga_programada_el` ya vencida (ajustar a mano en SQL si hace falta esperar los 7 días): llamar `deleteNegocioFolder(negocioId)` desde la consola del navegador o un botón temporal, confirmar que el bucket queda vacío bajo ese prefijo.
3. Ejecutar `SELECT public.fn_purgar_negocio('<negocio_id>');` y confirmar:
   - Las tablas con `negocio_id` quedan sin filas de ese negocio.
   - `suscripcion_pagos` conserva sus filas con `negocio_id = NULL`.
   - El usuario propietario sigue existiendo en `usuarios` intacto.
   - Si el propietario no tiene otros negocios, queda con `usuario_negocios` vacío pero su cuenta de login sigue activa.
4. Confirmar que llamar a `fn_purgar_negocio` sobre un negocio SIN `purga_programada_el` (o con fecha futura) lanza la excepción esperada, sin borrar nada.

> **Decisión consciente:** un propietario purgado puede volver a crear un negocio nuevo con trial gratis desde cero, sin ninguna marca o restricción a nivel `usuarios`. No se considera un problema real porque (a) el aviso previo de 7 días ya deja claro que se borrará todo (productos, ventas, configuración), y (b) la fricción de reconfigurar un negocio desde cero ya desincentiva el abuso. No implementar ninguna marca tipo `tuvo_negocio_purgado` salvo que en el futuro se detecte abuso real.

---

## Fase 5 — Panel `/admin`: aviso manual por WhatsApp + disparo manual de la purga

**Objetivo:** dar al superadmin, desde `/admin`, todo lo necesario para operar el ciclo completo a mano: ver quién está en cuenta regresiva, avisarle por WhatsApp, y purgarlo cuando corresponda — verificando con sus propios ojos (BD + Storage) que el borrado fue completo y correcto.

> **Decisión (2026-06-26): todo el flujo de notificación y purga es manual, sin fecha de automatización definida.** No se construye Edge Function, `pg_cron` ni `pg_net` por ahora. Las fases que antes automatizaban esto (Fase 6 orquestación reutilizable, Fase 7 cron) quedan **diferidas indefinidamente** — ver nota al final de este documento. Esta Fase 5 es el alcance real y completo del proyecto en su primera versión.

**Decisión de diseño (2026-06-27):** en vez de una sección/pantalla separada dedicada solo a purga, todo se integró dentro del flujo existente del panel de Negocios (`admin-negocios.page.ts/.html/.scss`) — confirmado con el usuario:

- [x] Botón **"Detectar pendientes"** en el header de la página (junto a "Crear negocio"), dispara `fn_marcar_negocios_para_purga` vía `SuscripcionService.marcarNegociosParaPurga()` y recarga la lista con toast de resultado.
- [x] **Badge visual** "Purga en X día(s)" / "Lista para purgar" en el header de cada propietario marcado (`grupo.purga`, calculado en `propietariosAgrupados` a partir de `fn_listar_negocios_pendientes_purga`).
- [x] **3 acciones nuevas** agregadas al menú de opciones del propietario ya existente (`abrirOpcionesPropietario`), en un grupo aparte, visibles solo si `grupo.purga` está presente:
  - **"Avisar por WhatsApp"** (`avisarPurgaWhatsApp`) — mismo patrón de `api.whatsapp.com/send?phone=...&text=...` que `suscripcion.page.ts`, usando `telefono_contacto` (negocio ancla) y un mensaje con fecha exacta de borrado y qué se pierde.
  - **"Purgar ahora"** (`purgarGrupo`) — confirmación explícita con nombre del propietario y negocios afectados, luego `SuscripcionService.purgarNegocio(negocioId)` por cada negocio del grupo (Storage → BD, en ese orden, ver Fase 4/Fase 6 diferida). Solo habilitado si `puede_purgar_ya`.
  - **"Cancelar purga"** (`cancelarPurga`) — confirmación, llama `fn_cancelar_purga_negocio` vía `SuscripcionService.cancelarPurgaNegocio()`.
- [x] Modelo `PropietarioGrupo.purga?` agregado en `negocio-admin.model.ts`. Modelo `NegocioPendientePurga` agregado en `suscripcion.model.ts`.
- [x] Métodos agregados en `SuscripcionService`: `marcarNegociosParaPurga()`, `listarNegociosPendientesPurga()`, `purgarNegocio(negocioId)`, `cancelarPurgaNegocio(propietarioId)`.
- [ ] **No implementado:** banner visual tipo `SuscripcionBannerComponent` — el badge inline en el header del propietario ya cumple la misma función de aviso visual sin necesitar un componente nuevo. Si en el futuro se considera insuficiente, agregar un banner dedicado es una mejora incremental, no bloqueante.

**Validación de la fase (pendiente de ejecutar por el usuario):**
1. Ejecutar en Supabase los 2 archivos SQL nuevos de Fase 4 (`fn_purgar_negocio.sql`, `fn_cancelar_purga_negocio.sql`) si no se hizo aún.
2. Entrar a `/admin` → tab Negocios, click en "Detectar pendientes", confirmar el toast y que el propietario de prueba (si quedó alguno marcado) muestra el badge correcto.
3. Abrir el menú de ese propietario, confirmar que aparecen las 3 opciones nuevas con los subtítulos correctos (días restantes, teléfono si existe).
4. Probar "Avisar por WhatsApp" — confirmar que abre WhatsApp Web/App con el mensaje correcto.
5. Probar "Cancelar purga" — confirmar que el badge desaparece de la lista tras recargar.
6. Volver a marcar (ajustando `vence_el`/`purga_programada_el` a mano en SQL para no esperar los días reales) y probar "Purgar ahora": confirmar que el negocio desaparece de la lista, de la BD y de Storage.

> Repetir este flujo manual con 2-3 negocios reales/de prueba en producción, en distintos escenarios (trial nunca pagado, suscripción vencida tras haber pagado antes, propietario con 2 negocios MAX), antes de considerar el go-live (Fase 8).

---

## Fase 8 — Pruebas de extremo a extremo y go-live

- [x] Negocio de prueba "Tieda Ivan" creado vía onboarding real. `vence_el` ajustado a -25 días en SQL para simular escenario A (TRIAL vencido).
- [x] Flujo completo validado end-to-end (2026-06-30):
  - "Detectar pendientes" → badge "Purga en 7 día(s)" visible en `/admin`. `purga_avisada_el`/`purga_programada_el` llenados correctamente en BD.
  - "Cancelar purga" → badge desaparece, columnas vuelven a `NULL`. Verificado en BD.
  - `purga_programada_el` forzado al pasado en SQL → badge cambia a "Lista para purgar", botón habilitado.
  - **Bug descubierto y corregido**: `propietario_usuario_id NOT NULL` bloqueaba el `UPDATE ... = NULL` previo al DELETE. Fix: `ALTER TABLE negocios ALTER COLUMN propietario_usuario_id DROP NOT NULL`. Documentado en Fase 1 y en `fn_purgar_negocio.sql`.
  - "Purgar ahora" → negocio eliminado de BD y Storage. Confirmado: `negocios` sin la fila, `usuario_negocios` limpio, usuario propietario intacto en `usuarios`, `suscripcion_pagos` sin filas (negocio no tenía pagos — correcto).
- [x] Flujo manual activo en producción desde 2026-06-30.
- [x] `docs/PENDIENTES.md` no tenía nada al respecto — sin cambios necesarios.

---

## Diferido — automatización futura (sin fecha)

Si en el futuro el volumen de negocios vencidos hace inviable el proceso manual, retomar la automatización implica:

1. **Función de orquestación reutilizable** — extraer la secuencia "Storage → BD" ya validada en Fase 5 a un servicio único (`PurgaNegociosService`) para que tanto el botón de `/admin` como un futuro cron llamen exactamente al mismo código.
2. **Edge Function + cron** — `supabase/functions/purgar-negocios-vencidos/index.ts` ejecutada vía `pg_cron` + `pg_net` (ninguna de las dos extensiones está activada hoy en el proyecto Supabase — hay que activarlas desde el panel de Supabase, no es algo que se configure en el repo). La función llamaría a `fn_marcar_negocios_para_purga()`, enviaría avisos (requeriría decidir un mecanismo de envío automático de WhatsApp o integrar un proveedor de email transaccional, ninguno de los dos existe hoy en el proyecto), y ejecutaría la purga de los negocios con `purga_programada_el <= NOW()`.
3. **Manejo de errores asíncrono** — sin un humano mirando, hay que decidir qué hacer si Storage falla pero BD no (o viceversa), y dejar logs suficientes para reconciliar manualmente.

No implementar nada de esto hasta que el volumen real de negocios vencidos lo justifique.
