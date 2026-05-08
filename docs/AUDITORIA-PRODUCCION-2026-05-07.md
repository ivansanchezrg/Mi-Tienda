# Auditoría Técnica de Producción — Mi Tienda

**Fecha:** 2026-05-07
**Auditor:** Arquitecto de Software Senior / Auditor Técnico Principal
**Stack:** Angular 20, Ionic 8, Capacitor 8, Supabase, PostgreSQL
**Alcance:** Frontend + Backend + Infra + Documentación

---

## Cómo usar este documento

Cada hallazgo tiene un **checkbox `[ ]`** al lado de su ID. A medida que vayas implementando los fixes:

1. Cambia `[ ]` → `[x]` en el hallazgo correspondiente.
2. Actualiza la **tabla de progreso** de abajo.
3. Anota la fecha de fix junto al checkbox: `[x]` → `[x] (2026-05-08)`.

**Convención de IDs:**
- `C-N` = Crítico
- `A-N` = Alto
- `M-N` = Medio
- `B-N` = Bajo
- `FE-N` = Frontend Angular
- `BE-N` = Backend SQL
- `INF-N` = Infraestructura/Build
- `DOC-N` = Documentación
- `PERF-N` = Rendimiento

---

## Tabla de Progreso

| Severidad | Total | Completado | Pendiente | % |
|-----------|-------|------------|-----------|---|
| Crítico   | 3     | 0          | 3         | 0% |
| Alto      | 6     | 0          | 6         | 0% |
| Medio     | 10    | 0          | 10        | 0% |
| Bajo      | 9     | 0          | 9         | 0% |
| **TOTAL** | **28** | **0**     | **28**    | **0%** |

**Última actualización:** 2026-05-07
**Estado:** 🔴 Bloqueado por críticos.

---

## Resumen Ejecutivo

El proyecto **NO está listo para producción**. La arquitectura general es sólida y demuestra dominio avanzado de patrones multi-tenant, RLS, Realtime y modularización feature-based. Sin embargo, existen **problemas bloqueantes de seguridad** (credenciales en historial git, falta de minify/ofuscación) y **bugs funcionales reales** en al menos una función SQL (`fn_registrar_recarga_proveedor_celular` rota por columna `negocio_id NOT NULL` no incluida en el INSERT).

**Riesgo global:** 🔴 **ALTO** — Bloqueado por hallazgos críticos.
**Tiempo estimado de remediación:** 16–24 horas de ingeniería para los bloqueantes; 1–2 sprints adicionales para deuda técnica alta.

---

## Estado General del Proyecto

**¿Está listo para producción?** ❌ **NO**

**Justificación técnica:**
1. **Credenciales de Supabase en historial git** (commit `f0744e6` y `b8fc77c`). Las anon keys están expuestas permanentemente, aunque ahora estén en `.gitignore`.
2. **Función SQL `fn_registrar_recarga_proveedor_celular` está rota** — no incluye `negocio_id` en el INSERT pero la columna es `NOT NULL`. Cada llamada falla.
3. **APK no minificado en release** (`minifyEnabled false`) — código accesible por reverse engineering.
4. **Memory leaks** documentados en al menos 8 servicios/componentes (subscriptions sin `takeUntil`).

Una vez resueltos los bloqueantes, la base arquitectónica es sólida y deployable.

---

## Riesgos Críticos

### `[ ]` C-1. Credenciales Supabase en historial git
- **Severidad:** CRÍTICA
- **Archivo:** `src/environments/environment.ts`, `src/environments/environment.prod.ts`
- **Verificado:** `git ls-files | grep environment` muestra que ambos archivos están trackeados.
- **Riesgo:** Acceso permanente a la BD vía anon key. Aunque RLS protege a nivel tenant, un atacante puede consumir cuota, hacer denial-of-wallet o explotar cualquier RLS débil que se descubra.
- **Reproducir:** `git show HEAD:src/environments/environment.ts` → muestra la URL y anon key.
- **Fix obligatorio:**
  1. **Rotar anon key en Supabase Dashboard inmediatamente.**
  2. `git rm --cached src/environments/environment.ts src/environments/environment.prod.ts`
  3. Limpiar historial con `git filter-repo` (preferido sobre `filter-branch`):
     ```bash
     git filter-repo --path src/environments/environment.ts --path src/environments/environment.prod.ts --invert-paths
     ```
  4. Force push tras coordinar con el equipo (`git push --force-with-lease`).
- **Prioridad:** P0 — antes de cualquier despliegue.

### `[ ]` C-2. `fn_registrar_recarga_proveedor_celular` rota
- **Severidad:** CRÍTICA
- **Archivo:** `docs/recargas-virtuales/sql/functions/fn_registrar_recarga_proveedor_celular.sql:89-97`
- **Código afectado:**
  ```sql
  INSERT INTO recargas_virtuales (
      id, fecha, tipo_servicio_id, empleado_id,
      monto_virtual, monto_a_pagar, ganancia,
      pagado, created_at
  ) VALUES ( ... )  -- sin negocio_id
  ```
- **Riesgo:** Schema declara `negocio_id UUID NOT NULL` en `recargas_virtuales`. Cada llamada a esta función falla con `null value in column "negocio_id" violates not-null constraint`. Bug de funcionalidad, no de seguridad.
- **Reproducir:** Llamar la RPC desde un POS con turno abierto.
- **Fix:**
  ```sql
  INSERT INTO recargas_virtuales (
      id, negocio_id, fecha, tipo_servicio_id, empleado_id, ...
  ) VALUES (
      v_recarga_id, public.get_negocio_id(), p_fecha, v_tipo_celular_id, p_empleado_id, ...
  );
  ```
  Adicionalmente, cambiar `p_empleado_id INTEGER` → `p_empleado_id UUID` (schema v11 usa UUID en `usuarios.id`).
- **Prioridad:** P0.

### `[ ]` C-3. APK release sin minify ni ProGuard
- **Severidad:** CRÍTICA
- **Archivo:** `android/app/build.gradle` + `android/app/proguard-rules.pro`
- **Riesgo:** Código JS y nombres de clases accesibles. Reverse engineering trivial. Endpoints, lógica de negocio, claves embebidas (si existieran) quedan visibles.
- **Fix:**
  ```gradle
  release {
      minifyEnabled true
      shrinkResources true
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
  }
  ```
  Y poblar `proguard-rules.pro` con reglas para Capacitor + Supabase + modelos de la app (ejemplos en sección "Correcciones Obligatorias").
- **Prioridad:** P0.

---

## Riesgos Altos

### `[ ]` A-1. Memory leaks por subscriptions sin cleanup
- **Severidad:** ALTA
- **Archivos afectados:**
  - `src/app/features/caja/services/turnos-caja.service.ts:59` — sub a `usuarioActual$` sin cleanup en root service
  - `src/app/features/caja/pages/home/home.page.ts:161-176` — `networkSub`, `queryParamsSub`, `turnoSub` sin `takeUntil`
  - `src/app/shared/components/sidebar/sidebar.component.ts:152-163` — `posSub`, `usuarioSub`
  - `src/app/features/caja/components/operacion-modal/operacion-modal.component.ts:99` — `cajaIdSub`
  - `src/app/features/inventario/pages/main/inventario.page.ts:99` — `productoChangeSub`
- **Riesgo:** Acumulación de listeners en cambios de tenant, navegación rápida, y reaperturas de modal. Resultado: handlers fantasma reaccionando a eventos de la nueva sesión, posibles crashes.
- **Fix:**
  ```typescript
  private destroy$ = new Subject<void>();
  ngOnInit() {
    this.servicio.observable$
      .pipe(takeUntil(this.destroy$))
      .subscribe(...);
  }
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  ```
  O migrar a `takeUntilDestroyed()` (Angular 16+).
- **Prioridad:** P1.

### `[ ]` A-2. AppComponent registra `wheel` listener global sin cleanup
- **Severidad:** ALTA
- **Archivo:** `src/app/app.component.ts:64-71`
- **Riesgo:** En tests / hot reload / re-mount, listeners se acumulan; cada wheel produce N blurs.
- **Fix:** Guardar referencia a la función y removerla en `ngOnDestroy()`.

### `[ ]` A-3. Path incorrecto en `ORDEN_EJECUCION.txt`
- **Severidad:** ALTA (operacional)
- **Archivo:** `docs/setup/ORDEN_EJECUCION.txt:76-83`
- **Problema:** Menciona `docs/dashboard/sql/functions/fn_abrir_turno.sql`, pero la carpeta real es `docs/caja/`.
- **Riesgo:** Setup fresco en nuevo entorno (Supabase) falla — el operador no encuentra los archivos.
- **Fix:** Reemplazar `docs/dashboard/` → `docs/caja/` en todo el archivo.

### `[ ]` A-4. Seed dev imprime contraseña en texto plano
- **Severidad:** ALTA
- **Archivo:** `docs/setup/schema.sql:1348`
- **Código:**
  ```sql
  RAISE NOTICE 'Email: %  |  Password: %', v_superadmin_email, v_superadmin_pass;
  ```
- **Riesgo:** Logs de Supabase contienen la contraseña dev en plain text.
- **Fix:** Eliminar password del NOTICE. Para producción, comentar o aislar bajo flag el seed completo.

### `[ ]` A-5. SQLite no encriptado
- **Severidad:** ALTA
- **Archivo:** `capacitor.config.ts:19-20`
- **Riesgo:** Si el módulo SQLite cachea datos sensibles, son legibles en root devices. Aunque actualmente el plugin parece no usarse (verificar), la config queda lista para almacenar sin protección.
- **Fix:** Si SQLite no se usa, eliminar el plugin de la config. Si se usa, habilitar encriptación.

### `[ ]` A-6. Identificadores Android inconsistentes
- **Severidad:** ALTA (funcional)
- **Archivos:**
  - `android/app/build.gradle` — `applicationId "io.ionic.starter"`
  - `android/app/src/main/res/values/strings.xml` — `package_name = "io.ionic.starter"`, `custom_url_scheme = "io.ionic.starter"`
  - `capacitor.config.ts` — `appId: 'ec.mitienda.app'`
- **Riesgo:** OAuth callbacks (deep links) no funcionan; Play Store rechaza el bundle si no coincide con package esperado; push notifications futuras se rompen.
- **Fix:** Unificar todo a `ec.mitienda.app`.

---

## Riesgos Medios

### `[ ]` M-1. `fn_transferir_empleado` retorna `VOID`
- **Archivo:** `docs/usuarios/sql/functions/fn_transferir_empleado.sql:10`
- **Riesgo:** Cliente no recibe confirmación granular del éxito; debugging difícil.
- **Fix:** Cambiar a `RETURNS JSON` con `{success, mensaje}`.

### `[ ]` M-2. Falta CHECK constraints en `ventas` (montos)
- **Archivo:** `docs/setup/schema.sql` — tabla `ventas`
- **Problema:** `descuento`, `base_iva_0`, `base_iva_15`, `iva_valor` sin `CHECK (>= 0)`.
- **Riesgo:** Descuentos negativos fraudulentos o por bug aceptados a nivel BD.
- **Fix:** `ALTER TABLE ventas ADD CONSTRAINT chk_descuento CHECK (descuento >= 0); ...`

### `[ ]` M-3. Servicios mal ubicados en `core/`
- **Archivos:**
  - `src/app/core/services/recargas-virtuales.service.ts`
  - `src/app/core/services/ganancias.service.ts`
- **Problema:** Lógica específica de feature en `core/`. `core/` debe contener solo utilidades transversales.
- **Fix:** Mover a `src/app/features/recargas-virtuales/services/`.

### `[ ]` M-4. `pos.page.ts` con 1232 líneas
- **Archivo:** `src/app/features/pos/pages/pos/pos.page.ts`
- **Problema:** Lógica de carrito + búsqueda + cálculos + cliente + flujo de cobro en un solo archivo.
- **Fix:** Extraer `CarritoService`, `PosCalculosService`, componentes hijos para carrito y búsqueda.

### `[ ]` M-5. `auth.service.ts` con 738 líneas
- **Archivo:** `src/app/features/auth/services/auth.service.ts`
- **Problema:** Login + JWT + validación + cambio de negocio + Realtime + superadmin en un solo servicio.
- **Fix:** Extraer `JwtService` y `SuperAdminService`.

### `[ ]` M-6. Cobertura de tests ~0%
- **Estado:** 1 archivo `.spec.ts` (`app.component.spec.ts`).
- **Riesgo:** Cualquier refactor introduce regresiones silenciosas. Servicios financieros sin verificación.
- **Fix:** Empezar por servicios críticos: `auth`, `turnos-caja`, `pos`, `recargas`, `inventario`.

### `[ ]` M-7. Hardcoded values en código
- `src/app/features/caja/services/turnos-caja.service.ts:291` — `300` (segundos refresh JWT)
- `src/app/core/services/supabase.service.ts:36` — `30000` (ms toast)
- `src/app/features/layout/pages/main/main-layout.page.ts:45` — mensaje POS deshabilitado
- **Fix:** Centralizar en `core/config/messages.config.ts` y `core/config/timing.config.ts`.

### `[ ]` M-8. Network Security Config faltante
- **Archivo:** `android/app/src/main/res/xml/network_security_config.xml` — no existe.
- **Riesgo:** Sin política explícita de cleartext + pinning. Apps modernas deben declarar dominios permitidos.
- **Fix:** Crear archivo con `cleartextTrafficPermitted="false"` y referenciar dominios Supabase.

### `[ ]` M-9. `iosIsEncryption: false, androidIsEncryption: false` en SQLite
- Ya cubierto en A-5 si SQLite se usa. Si no se usa, eliminar plugin.

### `[ ]` M-10. Sheet modals con scroll potencial
- Revisar componentes que usen `breakpoints: [0,1]` con contenido scrolleable interno (CLAUDE.md prohíbe).

---

## Riesgos Bajos

### `[ ]` B-1. `usuario_actual.model.ts` viola kebab-case
- **Archivo:** `src/app/features/auth/models/usuario_actual.model.ts`
- **Fix:** Renombrar a `usuario-actual.model.ts` y actualizar 5 imports.

### `[ ]` B-2. Features sin README
- `src/app/features/layout/`, `crear-negocio/`, `historial-recargas/`, `notas/`
- **Fix:** Crear README mínimo o documentar que son módulos sin docs por simplicidad.

### `[ ]` B-3. `package.json` versión `0.0.1`
- **Fix:** Subir a `1.0.0` para release.

### `[ ]` B-4. `applicationId "io.ionic.starter"` (cubierto en A-6)

### `[ ]` B-5. `.client` directo sin `.call()` en algunos SELECT (aceptable, pero inconsistente)

### `[ ]` B-6. Type assertions `as any` y `as unknown as T` en mappers de Realtime
- Ej: `src/app/features/auth/services/auth.service.ts:423` — `'postgres_changes' as any`
- **Fix:** Tipar correctamente con interfaces de Supabase.

### `[ ]` B-7. Source maps no explícitamente deshabilitados en `angular.json`
- Por defecto Angular 20 los desactiva en prod, pero conviene declararlo:
  ```json
  "production": { "sourceMap": false, ... }
  ```

### `[ ]` B-8. Permisos Android `READ/WRITE_EXTERNAL_STORAGE` con `maxSdkVersion`
- Aceptable, pero verificar si todos se usan. Eliminar los no usados.

### `[ ]` B-9. `file_paths.xml` con `path="."`
- Demasiado amplio. Restringir a subcarpetas concretas (`Pictures/`, `Camera/`).

---

## Hallazgos Técnicos (Detallado)

### Frontend Angular

| ✓ | ID | Archivo | Línea | Problema |
|---|----|---------|-------|----------|
| `[ ]` | FE-01 | `home.page.ts` | 161-176 | 3 subscriptions sin `takeUntil` |
| `[ ]` | FE-02 | `sidebar.component.ts` | 152-163 | 2 subscriptions sin `takeUntil`; props no inicializadas |
| `[ ]` | FE-03 | `turnos-caja.service.ts` | 59 | Sub en root service sin cleanup |
| `[ ]` | FE-04 | `operacion-modal.component.ts` | 99 | Sub en modal sin `OnDestroy` declarado |
| `[ ]` | FE-05 | `inventario.page.ts` | 99, 144-150 | Sub + setTimeout sin cleanup |
| `[ ]` | FE-06 | `app.component.ts` | 64-71 | `wheel` listener global sin remove |
| `[ ]` | FE-07 | `parametros.page.ts` | 148-150 | setTimeout fire-and-forget |
| `[ ]` | FE-08 | `recargas.service.ts` | 349 | `toISOString()` sobre fecha local — riesgo de offset |
| `[ ]` | FE-09 | `inventario.service.ts` | 66 | `as unknown as ProductoPOS[]` — bandera roja |
| `[ ]` | FE-10 | `auth.service.ts` | 423,454 | `'postgres_changes' as any` — tipos perdidos |

### Backend SQL

| ✓ | ID | Archivo | Problema |
|---|----|---------|----------|
| `[ ]` | BE-01 | `fn_registrar_recarga_proveedor_celular.sql:89-97` | INSERT sin `negocio_id` (función rota) |
| `[ ]` | BE-02 | `fn_registrar_recarga_proveedor_celular.sql:26` | `p_empleado_id INTEGER` debería ser UUID |
| `[ ]` | BE-03 | `fn_transferir_empleado.sql:10` | `RETURNS VOID` sin feedback |
| `[ ]` | BE-04 | `schema.sql:1348` | NOTICE imprime password dev |
| `[ ]` | BE-05 | `schema.sql` (tabla ventas) | Sin CHECK `>= 0` en montos |
| `[ ]` | BE-06 | Varias funciones | Validación `p_turno_id` pertenece al negocio (defensa en profundidad) |
| `[ ]` | BE-07 | `fn_listar_clientes_con_saldo.sql:74` | Sin `MAX(p_page_size)` cap |

### Infra / Build

| ✓ | ID | Archivo | Problema |
|---|----|---------|----------|
| `[ ]` | INF-01 | git history | `environment.ts` y `environment.prod.ts` committeados |
| `[ ]` | INF-02 | `build.gradle` | `minifyEnabled false` en release |
| `[ ]` | INF-03 | `proguard-rules.pro` | Archivo vacío |
| `[ ]` | INF-04 | `build.gradle` | `applicationId "io.ionic.starter"` |
| `[ ]` | INF-05 | `strings.xml` | `package_name`, `custom_url_scheme` con valores template |
| `[ ]` | INF-06 | `package.json` | versión `0.0.1` |
| `[ ]` | INF-07 | `capacitor.config.ts` | SQLite sin encriptar; SplashScreen `launchAutoHide:false` |
| `[ ]` | INF-08 | Falta archivo | `network_security_config.xml` no existe |
| `[ ]` | INF-09 | `file_paths.xml` | `path="."` demasiado amplio |
| `[ ]` | INF-10 | `angular.json` | `sourceMap` no declarado explícitamente en producción |

### Documentación

| ✓ | ID | Archivo | Problema |
|---|----|---------|----------|
| `[ ]` | DOC-01 | `ORDEN_EJECUCION.txt:76-83` | Path `docs/dashboard/` (no existe; es `docs/caja/`) |
| `[ ]` | DOC-02 | `ESTRUCTURA-PROYECTO.md:198-204` | Documenta `cuentas-cobrar/` como página separada (no existe) |
| `[ ]` | DOC-03 | `ESTRUCTURA-PROYECTO.md:144,254` | Refs a `categorias-gastos.service.ts` eliminado en v5 |
| `[ ]` | DOC-04 | — | 4 features sin README: `layout`, `crear-negocio`, `historial-recargas`, `notas` |
| `[ ]` | DOC-05 | `usuario.service.ts:85` | Llama `fn_registrar_usuario_negocio` sin archivo `.sql` separado |

---

## Hallazgos de Seguridad

### Lo que está bien implementado ✅

- **RLS exhaustivo:** 21 tablas Grupo A con `negocio_id = get_negocio_id()`; políticas RESTRICTIVE `superadmin_no_write` en todas las tablas mutables.
- **`fn_assert_no_superadmin()`** en 18+ funciones de mutación.
- **`SECURITY DEFINER` + `SET search_path = public`** en todas las funciones financieras.
- **`FOR UPDATE`** en operaciones críticas de caja para prevenir race conditions.
- **Triggers de inmutabilidad** en `operaciones_cajas` y `movimientos_empleados`.
- **Vistas con `security_barrier=true`** (ej: `v_saldos_empleados`).
- **JWT custom claims** vía `fn_set_negocio_activo` — el cliente nunca controla `negocio_id`.

### Lo que está mal o débil ❌

1. **C-1**: Credenciales en historial git (cubierto arriba).
2. **A-4**: Password dev en NOTICE.
3. **M-2**: Falta CHECK en montos de ventas.
4. **B-9**: `file_paths.xml` demasiado abierto.
5. **A-5/M-9**: SQLite sin encriptar.
6. **M-8**: Sin Network Security Config explícita.
7. **Configuraciones expuestas a superadmin:** Política `configuraciones_select` permite al superadmin leer configs de todos los tenants. Diseño consciente, pero documentar como riesgo si la cuenta se compromete.

### Lo que NO es vulnerabilidad (aclaración sobre falsos positivos del agente)

- `fn_configurar_modulos_admin(p_negocio_id UUID, ...)` recibir `p_negocio_id` **NO es inyección**. La función valida superadmin antes de operar; el superadmin opera desde `/admin` sin tener `negocio_id` en el JWT. Es la única arquitectura válida.

---

## Hallazgos de Rendimiento

| ✓ | ID | Problema | Archivo |
|---|----|----------|---------|
| `[ ]` | PERF-01 | Falta debounce en búsqueda de productos POS | `inventario.service.ts:52` |
| `[ ]` | PERF-02 | Índices faltantes en FK de uso frecuente: `turnos_caja.empleado_id`, `recargas.empleado_id`, `operaciones_cajas.empleado_id`, `movimientos_empleados.turno_id` | `schema.sql` |
| `[ ]` | PERF-03 | `*ngFor` sin `trackBy` en sidebar y otros listados | varios |
| `[ ]` | PERF-04 | `ngOnInit` en `parametros.page.ts:82` con queries secuenciales (resto del proyecto sí usa `Promise.all`) | `parametros.page.ts` |
| `[ ]` | PERF-05 | Sin `MAX(p_page_size)` en `fn_listar_clientes_con_saldo` — riesgo OOM si cliente envía 1M | `fn_listar_clientes_con_saldo.sql` |

---

## Hallazgos de Arquitectura

### Aciertos ✅
- **Feature-based** con lazy loading total.
- **Standalone components** + `inject()` consistente.
- **Patrón unificado de `negocio_id`** (ya corregido recientemente — ver memoria).
- **Single source of truth de rutas** vía `routes.config.ts`.
- **`PaginatedListPage<T>` base class** reutilizable.
- **`ConfigService` con cache** para parámetros del negocio.
- **`UiService` centralizado** para loading/toasts/errores.
- **Mensajes de error tipados** con detección de superadmin_blocked.

### Deuda ⚠️
- **2 servicios de feature en `core/`** (M-3).
- **3 archivos > 500 líneas** (auth.service, inventario.service, pos.page).
- **Cobertura de tests ~0%** (M-6).
- **Falta de tipado fuerte en payloads de Realtime** (`as any`).

---

## Hallazgos SQL y Supabase

Consolidado arriba en sección "Backend SQL". Lo más urgente:

1. **BE-01/BE-02** — `fn_registrar_recarga_proveedor_celular` rota.
2. **A-3** — `ORDEN_EJECUCION.txt` con paths inexistentes.
3. **BE-04** — Password dev en NOTICE.
4. **PERF-02** — Índices FK faltantes.
5. **BE-05** — CHECK constraints en montos de ventas.

---

## Hallazgos de Documentación

Consolidado arriba en tabla DOC-01 a DOC-05. Recomendación: aprovechar la auditoría para hacer pasada general de docs vs código antes de release.

---

## Buenas Prácticas Encontradas

1. **Multi-tenant disciplinado** — `negocio_id = get_negocio_id()` en TODA query y RLS.
2. **Bloqueo en capas del superadmin** — RLS RESTRICTIVE + `fn_assert_no_superadmin()` en RPCs.
3. **`UiService` con debounce** evita doble overlay (gotcha conocido y resuelto).
4. **Manejo de sesión expirada centralizado** en `SupabaseService`.
5. **Idempotencia de canales Realtime** — se reutilizan, no se duplican.
6. **`Promise.all()`** para queries paralelas en la mayoría de servicios.
7. **`getFechaLocal()`** en lugar de `toISOString()` (con 1 excepción reportada).
8. **`OptionsModalComponent`** estándar para selects/action sheets (workaround de bug Ionic 8 + Capacitor).
9. **Patrón único de obtención de `negocio_id`** (`auth.usuarioActualValue`) — recientemente unificado.
10. **Función helper `fn_assert_no_superadmin`** centralizada.

---

## Antipatrones Encontrados

1. Subscriptions sin cleanup (memory leaks) — múltiples archivos.
2. `as any` y `as unknown as T` en payloads de Realtime.
3. `setTimeout` fire-and-forget sin cleanup en `ngOnDestroy`.
4. Listener global `wheel` sin remove.
5. Lógica de feature en `core/`.
6. Componente con 1232 líneas (`pos.page.ts`).
7. Servicio sin verificación de éxito en mutación (`recargas.service.ts.guardarRecarga`).
8. `RAISE EXCEPTION` con password en NOTICE.
9. `RETURNS VOID` en función que debería dar feedback (`fn_transferir_empleado`).
10. INSERT sin `negocio_id` en función SQL multi-tenant (función rota).

---

## Correcciones Obligatorias Antes de Producción

### Bloque 1 — Seguridad (P0, ~6h)

1. **Rotar anon key Supabase** (Dashboard → Project Settings → API → Reset).
2. **Limpiar git history**:
   ```bash
   git filter-repo --path src/environments/environment.ts \
                   --path src/environments/environment.prod.ts --invert-paths
   git push --force-with-lease origin main develop
   ```
3. **Habilitar minify en Android**:
   ```gradle
   release {
       minifyEnabled true
       shrinkResources true
       proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
   }
   ```
4. **Poblar `proguard-rules.pro`**:
   ```proguard
   # Capacitor
   -keep class com.getcapacitor.** { *; }
   -keepclassmembers interface com.getcapacitor.** { *; }
   # Supabase / OkHttp / Gson
   -keep class io.supabase.** { *; }
   -dontwarn okhttp3.**
   -dontwarn okio.**
   # App models
   -keep class ec.mitienda.app.** { *; }
   ```
5. **Eliminar password de NOTICE** (`schema.sql:1348`).
6. **Crear `network_security_config.xml`** con dominios permitidos.

### Bloque 2 — Bugs funcionales (P0, ~3h)

7. **Arreglar `fn_registrar_recarga_proveedor_celular`** — agregar `negocio_id` y cambiar `p_empleado_id` a UUID.
8. **Cambiar `fn_transferir_empleado` a `RETURNS JSON`**.
9. **Actualizar `ORDEN_EJECUCION.txt`** — `docs/dashboard/` → `docs/caja/`.
10. **Unificar `applicationId`** a `ec.mitienda.app` en build.gradle, strings.xml.
11. **Subir versión** en `package.json` a `1.0.0` y actualizar `versionCode`/`versionName` en `build.gradle`.

### Bloque 3 — Memory leaks (P1, ~6h)

12. **Refactor de subscriptions** con `takeUntil(destroy$)` o `takeUntilDestroyed()` en:
    - `home.page.ts`
    - `sidebar.component.ts`
    - `operacion-modal.component.ts`
    - `inventario.page.ts`
    - `turnos-caja.service.ts` (si aplica para root services)
13. **Cleanup de `wheel` listener** en `app.component.ts`.
14. **Cleanup de setTimeouts** en `inventario.page.ts`, `parametros.page.ts`.

### Bloque 4 — Hardening adicional (P1, ~3h)

15. **CHECK constraints en `ventas`** (descuento, base_iva_*, iva_valor `>= 0`).
16. **Cap en `p_page_size`** de funciones paginadas (`MAX 500`).
17. **Índices faltantes**:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_turnos_caja_empleado_id ON turnos_caja(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_recargas_empleado_id ON recargas(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_empleado_id ON operaciones_cajas(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_movimientos_empleados_turno_id ON movimientos_empleados(turno_id);
    ```
18. **Restringir `file_paths.xml`** a paths específicos.
19. **Declarar `"sourceMap": false`** en `angular.json` producción.

---

## Mejoras Recomendadas (Post-Release)

### Sprint +1
- Mover `recargas-virtuales.service.ts` y `ganancias.service.ts` a su feature.
- Renombrar `usuario_actual.model.ts` → `usuario-actual.model.ts`.
- Crear READMEs faltantes (`layout`, `crear-negocio`, `historial-recargas`, `notas`).
- Actualizar `ESTRUCTURA-PROYECTO.md` (quitar refs a `categorias-gastos`, `cuentas-cobrar` page).
- Tipar payloads de Realtime (eliminar `as any`).
- Centralizar mensajes/timings hardcodeados en `core/config/`.

### Sprint +2
- **Tests unitarios** de servicios críticos: `auth`, `turnos-caja`, `pos`, `recargas`, `inventario`.
- Refactor de `auth.service.ts` (extraer `JwtService`, `SuperAdminService`).
- Refactor de `pos.page.ts` (extraer `CarritoService`, `PosCalculosService`, componentes hijos).
- Refactor de `inventario.service.ts` (extraer `PresentacionesService`).

### Sprint +3
- Implementar **monitoring** (Sentry/Bugsnag) para producción.
- **Rate limiting** en RPCs financieras (a nivel Supabase Edge Function o aplicación).
- **Auditoría de acceso** del superadmin (tabla `audit_log`).
- **Backups y disaster recovery** documentados.
- E2E tests con Cypress/Playwright en flujos críticos (login, venta POS, cierre diario).

---

## Checklist Final de Producción

### Bloqueante (P0)
- [ ] Anon key Supabase rotada
- [ ] `environment.ts` removido del historial git
- [ ] `minifyEnabled true` en build.gradle
- [ ] `proguard-rules.pro` poblado
- [ ] `fn_registrar_recarga_proveedor_celular` corregida (negocio_id + UUID)
- [ ] Password dev removido de NOTICE en `schema.sql`
- [ ] `applicationId` unificado a `ec.mitienda.app`
- [ ] Versión bumped en `package.json` y `build.gradle`
- [ ] APK release probado end-to-end en dispositivo físico

### Alta prioridad (P1)
- [ ] Subscriptions con `takeUntil`/`takeUntilDestroyed` en componentes principales
- [ ] `wheel` listener removido en `ngOnDestroy` de AppComponent
- [ ] `network_security_config.xml` creado y referenciado
- [ ] CHECK constraints en `ventas` aplicados
- [ ] Índices FK faltantes creados
- [ ] `ORDEN_EJECUCION.txt` corregido
- [ ] `fn_transferir_empleado` → `RETURNS JSON`

### Media prioridad (P2)
- [ ] Cap de `p_page_size` en funciones paginadas
- [ ] `file_paths.xml` restringido
- [ ] `sourceMap: false` explícito en `angular.json`
- [ ] Servicios fuera de lugar movidos a sus features
- [ ] READMEs de features faltantes creados
- [ ] Hardcoded values centralizados en config

### Pre-go-live
- [ ] APK firmado con keystore de producción (no dev)
- [ ] Build subido a Play Console (track de pruebas internas primero)
- [ ] Variables de Supabase de producción separadas de staging
- [ ] Política de privacidad publicada (requerimiento Play Store)
- [ ] Iconos y splash screen finales (no template Ionic)
- [ ] Smoke test con cuentas reales de prueba en al menos 2 dispositivos Android

---

## Conclusión Técnica Final

El proyecto **Mi Tienda** es una aplicación SaaS multi-tenant de gestión retail que demuestra **diseño arquitectónico maduro**: RLS exhaustivo, separación de responsabilidades a nivel BD, patrones consistentes en el frontend, y una capa de seguridad multi-capa (RLS + RESTRICTIVE policies + `fn_assert_no_superadmin`).

Sin embargo, **no es deployable en su estado actual** por:

1. **Credenciales expuestas en historial git** (acción urgente).
2. **Una función SQL bloqueante rota** (recargas celular).
3. **APK release sin ofuscación** (riesgo de IP y reverse engineering).
4. **Memory leaks documentados** que se manifestarán bajo carga.

Una vez corregidos los **20 ítems del bloque P0** (estimado 9–10 horas) y los **8 ítems del bloque P1** (estimado 6–8 horas), el proyecto estará en **condiciones aceptables de producción para una v1.0**. El bloque P2 y las mejoras recomendadas pueden iterarse en sprints posteriores sin bloquear el lanzamiento.

**Recomendación operacional:** lanzar **primero a un grupo de pruebas internas (Play Console internal testing track)** durante 1–2 semanas antes de release público, con monitoreo activo de Sentry o equivalente.

**Veredicto final:** 🟡 **No apto hoy. Apto en ~2 semanas con plan de remediación ejecutado.**

---

*Reporte generado por auditoría multi-agente: SQL/Supabase, Angular/Ionic, Capacitor/Build, Arquitectura/Docs.*
