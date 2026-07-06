# PLAN — Planes y Suscripción (Monetización del SaaS)

> **Estado:** ✅ Implementado (Fases 1–6). Fase 7 (feature gates en sidebar) pendiente.
> **Última actualización:** 2026-06-15.
> **Objetivo de negocio:** SaaS de cobro. Cada negocio paga una suscripción para usar el sistema. Trial gratis de 15 días → al vencer, bloqueo total con instrucciones de pago.
> **Planes actuales:** PRO y MAX. Ver §11 para diferenciadores del plan MAX.

---

## 0. Resumen ejecutivo (TL;DR)

Se agrega un sistema de **planes de suscripción** sin romper nada de lo existente. Todo es **aditivo**:

1. Una tabla catálogo global **`planes`** (como `tipos_servicio`) — define qué planes existen, su precio y qué features traen.
2. Una tabla **`suscripciones`** por negocio — registra el estado actual + historial de pagos (qué plan, desde cuándo, hasta cuándo, cuánto pagó).
3. Cada negocio nace con **plan Básico en TRIAL de 15 días** (se inicializa en `fn_completar_onboarding`, donde ya nace todo negocio).
4. El estado de la suscripción (TRIAL / ACTIVA / VENCIDA + días restantes) se calcula en BD y se entrega al cliente al activar el negocio.
5. Un **guard nuevo** (`suscripcionGuard`) bloquea el acceso a la app cuando la suscripción está vencida, redirigiendo a una pantalla de "Suscríbete" con tus datos de pago.
6. El **superadmin** registra los pagos desde `/admin` y extiende la fecha de vencimiento. El bloqueo/desbloqueo es **automático por fecha** — no anda suspendiendo negocios uno por uno.

### ¿El modelo de datos actual lo soporta?

**Sí, sin necesidad de reestructurar nada.** El proyecto ya tiene exactamente los patrones que este sistema necesita:

| Lo que necesita el sistema de planes | Lo que ya existe en el proyecto | Veredicto |
|---|---|---|
| Catálogo global sin `negocio_id` | `tipos_servicio`, `tipos_referencia` (Grupo C) | ✅ Patrón ya establecido |
| Estado/config por tenant | tabla `negocios`, `configuraciones` | ✅ Patrón ya establecido |
| Inicializar datos al crear negocio | `fn_completar_onboarding` (single source of truth) | ✅ Punto de enganche natural |
| Bloqueo de acceso por estado | `authGuard` + `usuarios.activo` + `/auth/pending` | ✅ Patrón a replicar |
| Gestión desde superadmin | módulo `admin/` + `fn_set_negocio_activo` | ✅ Punto de enganche natural |
| Inyectar estado en sesión del cliente | `UsuarioActual` + `fn_set_negocio_activo` (JWT) | ✅ Punto de enganche natural |

**Conclusión:** no hace falta ajustar el modelo existente antes de empezar. El sistema de planes se monta encima de la arquitectura actual respetando todos sus patrones (RLS, multi-tenant, `fn_assert_no_superadmin`, `SECURITY DEFINER`, `ROUTES`, standalone components, etc.).

> ⚠️ **Nota de terminología — importante:** en este proyecto la palabra **"membresía"** YA significa otra cosa: la relación usuario↔negocio (`usuario_negocios`, `fn_actualizar_membresia` = rol ADMIN/EMPLEADO). Para evitar confusión, este sistema usa siempre **"suscripción"** y **"plan"**, nunca "membresía".

---

## 1. Decisiones de diseño (ya tomadas con el dueño)

| Decisión | Elección | Implicación |
|---|---|---|
| **Definición de planes** | Tabla catálogo `planes` (no enum hardcodeado) | Se agregan planes con un `INSERT`, sin tocar código ni redeploy. |
| **Qué controla el plan** | Habilita/oculta secciones, módulos e información según el plan | El plan lleva un campo `features` (JSONB) que mapea qué desbloquea. Hoy Básico = todo; mañana planes superiores agregan IA, etc. |
| **Quién gestiona** | Solo el superadmin asigna plan y registra pagos | El cliente solo VE su plan. La presión de pago es automática por vencimiento, no manual. |
| **Al vencer** | **Bloqueo total** | El negocio no opera hasta pagar. Pantalla "Suscríbete" + datos de pago (transferencia/depósito). |
| **Historial** | Tabla `suscripciones` con historial de pagos | Se ve cuánto y cuándo pagó cada negocio. |
| **Trial inicial** | 15 días gratis, plan Básico | Se inicializa al crear el negocio. |
| **Comunicados a clientes** | **Fuera de alcance de este plan** | Es una feature separada (sistema de anuncios). Ver §8 "Fuera de alcance". |

---

## 2. Modelo de datos propuesto

### 2.1. Tabla `planes` — catálogo global (Grupo C, sin `negocio_id`)

```sql
CREATE TABLE IF NOT EXISTS planes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(50)   NOT NULL UNIQUE,  -- 'PRO' | 'MAX' | ...
    nombre          VARCHAR(100)  NOT NULL,          -- 'Plan PRO'
    descripcion     TEXT,                            -- texto comercial para la sección de planes
    precio_mensual  DECIMAL(12,2) NOT NULL DEFAULT 0,
    precio_anual    DECIMAL(12,2),                   -- NULL = el plan no ofrece pago anual
    trial_dias      INT NOT NULL DEFAULT 0,          -- días de prueba al asignar este plan
    features        JSONB NOT NULL DEFAULT '{}',     -- { "pos": true, "ia": true, ... }
    activo          BOOLEAN NOT NULL DEFAULT TRUE,   -- false = ya no se ofrece (no se borra)
    orden           INT NOT NULL DEFAULT 0,          -- orden de presentación al cliente
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

> **Precio dual implementado en 2026-06:** `precio_mensual` (obligatorio) + `precio_anual` (NULL = el plan no ofrece pago anual). Reemplazó el diseño original de columna única `precio` + `periodo`.

**Planes actuales (2026-06-15):** PRO (entrada) y MAX (premium con IA). El seed inicial de la migración usa `BASICO` como placeholder; los planes reales se insertan con los UPDATE de features documentados en `docs/suscripcion/SUSCRIPCION-README.md` sección "Planes actuales".

```sql
-- Features del plan PRO (todo el sistema base):
UPDATE planes SET features = '{"panel_financiero":true,"pos":true,"inventario":true,"ventas":true,"clientes":true,"empleados":true,"nomina":true,"notas":true,"acciones_rapidas":true,"configuracion":true}'::jsonb WHERE codigo = 'PRO';

-- Features del plan MAX (PRO + ia):
UPDATE planes SET features = '{"panel_financiero":true,"pos":true,"inventario":true,"ventas":true,"clientes":true,"empleados":true,"nomina":true,"notas":true,"acciones_rapidas":true,"configuracion":true,"ia":true}'::jsonb WHERE codigo = 'MAX';
```

> El campo `features` define el contenido sin tocar código. Cuando se activen feature gates (Fase 7), el `FEATURE_LABELS` en `SuscripcionPage` ya mapea las 11 claves actuales a etiquetas legibles.

### 2.2. Tabla `metodos_pago_suscripcion` — catálogo global de métodos (Grupo C)

> **Decisión (2026-06-13):** el método de pago va en **tabla catálogo**, no en un `VARCHAR` ni en un `ENUM`. Justificación: el dueño espera agregar métodos a futuro (PayPal, Payphone, tarjeta…) y quiere mostrarlos en la UI con icono/orden. Una tabla catálogo permite agregar un método con un `INSERT` (sin `ALTER TYPE` ni redeploy) y adjuntar metadata visual. Mismo patrón que `planes` / `tipos_servicio`.

```sql
CREATE TABLE IF NOT EXISTS metodos_pago_suscripcion (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo     VARCHAR(50)  NOT NULL UNIQUE,   -- 'TRANSFERENCIA' | 'DEPOSITO' | 'EFECTIVO' | 'PAYPHONE' ...
    nombre     VARCHAR(100) NOT NULL,          -- 'Transferencia bancaria'
    icono      VARCHAR(50)  NOT NULL DEFAULT 'cash-outline',  -- ionicon para la UI
    activo     BOOLEAN NOT NULL DEFAULT TRUE,  -- false = ya no se ofrece (no se borra)
    orden      INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO metodos_pago_suscripcion (codigo, nombre, icono, orden) VALUES
('TRANSFERENCIA', 'Transferencia bancaria', 'swap-horizontal-outline', 1),
('DEPOSITO',      'Depósito bancario',      'cash-outline',            2),
('EFECTIVO',      'Efectivo',               'wallet-outline',          3);
```

### 2.3. Tabla `suscripciones` — estado + historial por negocio (Grupo A, con `negocio_id`)

> **⚠️ Modelo superado (refactor 2026-06):** lo que sigue describe el diseño original
> "estado + historial en una sola tabla". **Ya no es el modelo vigente.** Hoy `suscripciones`
> guarda **una sola fila por negocio** (`negocio_id` UNIQUE, estado mutable vía `UPDATE`) y el
> historial financiero vive en una tabla aparte `suscripcion_pagos`. La fuente de verdad
> actualizada es `docs/setup/schema.sql` + `docs/suscripcion/SUSCRIPCION-README.md`
> (sección "Estado actual vs. historial financiero").

```sql
CREATE TABLE IF NOT EXISTS suscripciones (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id    UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    plan_id       UUID NOT NULL REFERENCES planes(id),
    -- Estado ALMACENADO (no derivado). 'VENCIDA' NO se guarda: se deriva comparando
    -- vence_el con NOW() en fn_estado_suscripcion. Ver nota de diseño abajo.
    estado        VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
                  CHECK (estado IN ('TRIAL', 'ACTIVA', 'SUSPENDIDA', 'CANCELADA')),
    inicia_el     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    vence_el      TIMESTAMP WITH TIME ZONE NOT NULL,   -- fecha de corte
    monto_pagado  DECIMAL(12,2) DEFAULT 0,             -- 0 en el trial
    metodo_pago_id UUID REFERENCES metodos_pago_suscripcion(id),  -- FK al catálogo, NULL en trial
    nota          TEXT,                                -- referencia del pago, comprobante, etc.
    registrada_por UUID REFERENCES usuarios(id),       -- superadmin que registró el pago
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_suscripciones_negocio ON suscripciones(negocio_id, created_at DESC);
```

**Modelo de "estado actual" + "historial" en una sola tabla:** la suscripción **vigente** de un negocio es siempre la fila más reciente (`ORDER BY created_at DESC LIMIT 1`). Cada pago/renovación inserta una fila nueva. Así tienes ambas cosas (estado actual e histórico) sin duplicar estructura.

> **Autocorrección de diseño (2026-06-13) — estado almacenado vs. derivado:** `'VENCIDA'` **no es un estado guardado**, es **derivado** de la fecha (`vence_el < NOW()`). Guardarlo crearía inconsistencias (una fila marcada `ACTIVA` cuya fecha ya pasó requeriría un job que la "marque vencida"). En su lugar: la fila guarda `TRIAL` o `ACTIVA`, y `fn_estado_suscripcion` devuelve `VENCIDA` calculándolo al vuelo. Cero jobs, cero inconsistencia.
>
> **Estados que SÍ se guardan:**
> - `TRIAL` — período de prueba en curso.
> - `ACTIVA` — pagada y vigente.
> - `SUSPENDIDA` — **bloqueo manual del superadmin** (ej. abuso, fraude) independiente del vencimiento. Cubre el caso "quiero bloquear un negocio que SÍ pagó". Se setea con una función dedicada; el guard la trata como bloqueo igual que `VENCIDA`.
> - `CANCELADA` — el cliente canceló (reservado para la fase futura de cancelación self-service, §8.1). Hoy no se usa pero queda en el CHECK para no migrar el constraint después.

> **Alternativa evaluada y descartada:** poner `plan_id`/`vence_el` directo en `negocios`. Se descartó porque el dueño pidió historial de pagos. Con tabla aparte tienes trazabilidad completa de cuánto te ha pagado cada negocio.

### 2.4. Tabla `config_plataforma` — datos de cobro globales (Grupo C, editable solo por superadmin)

> **⚠️ Actualización (refactor 2026-06):** la columna `mensaje_suspension` fue **eliminada**. Los textos de la pantalla de bloqueo ahora son **contextuales por estado** (trial vencido / vencida / suspendida) y viven en el frontend, no en BD. La tabla vigente tiene solo `whatsapp_cobro` + `cuentas_bancarias`. Ver `docs/setup/schema.sql` y la migración `005_suscripciones_estado_pagos.sql`.

> **Decisión (2026-06-13):** los datos de cobro (WhatsApp de contacto + cuentas bancarias del titular) son los **mismos para toda la plataforma** (tú cobras a todos los negocios), por eso van en una **tabla global dedicada**, no en `configuraciones` (que es por-tenant) ni en `environment.ts` (que exigiría recompilar la APK para cambiar tu WhatsApp o una cuenta). Así editas tus datos de cobro desde `/admin` sin redeploy.

Modelo simple de fila única (singleton) clave-valor global, o tabla con columnas explícitas. Recomendado: columnas explícitas + JSONB para las cuentas (que son una lista variable):

```sql
CREATE TABLE IF NOT EXISTS config_plataforma (
    id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton: una sola fila
    whatsapp_cobro     VARCHAR(20),    -- '593987654321' (formato Ecuador, sin +)
    mensaje_suspension TEXT,           -- texto mostrado en la pantalla de bloqueo
    cuentas_bancarias  JSONB NOT NULL DEFAULT '[]',  -- lista de cuentas (ver abajo)
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Estructura de cada cuenta en el JSONB (estándar Ecuador):
-- {
--   "banco":   "Cooperativa JEP",
--   "tipo":    "Ahorros",          // Ahorros | Corriente
--   "numero":  "1234567890",
--   "titular": "Ivan Sanchez",
--   "cedula":  "0102030405"        // en Ecuador se pide para confirmar la transferencia
-- }

INSERT INTO config_plataforma (id, whatsapp_cobro, mensaje_suspension, cuentas_bancarias)
VALUES (1, '', 'Tu acceso fue suspendido por falta de pago. Comunícate con nosotros por WhatsApp o realiza tu pago a las cuentas indicadas para reactivar tu cuenta.', '[]')
ON CONFLICT (id) DO NOTHING;
```

> **Por qué JSONB para las cuentas:** puedes tener varias cuentas (JEP, Pichincha, Guayaquil) y agregar/quitar sin migración. La UI de admin las edita como lista. Es lo escalable.

### 2.5. RLS — políticas a agregar en `02_rls.sql`

**`planes`** y **`metodos_pago_suscripcion`** (catálogos globales, solo lectura para todos — patrón `tipos_servicio`):
```sql
ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "planes_select" ON planes FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE: solo superadmin (gestiona el catálogo)
CREATE POLICY "planes_admin" ON planes FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

ALTER TABLE metodos_pago_suscripcion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metodos_pago_select" ON metodos_pago_suscripcion FOR SELECT TO authenticated USING (true);
CREATE POLICY "metodos_pago_admin" ON metodos_pago_suscripcion FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());
```

**`config_plataforma`** (lectura para todos los autenticados — el cliente bloqueado necesita ver los datos de cobro; escritura solo superadmin):
```sql
ALTER TABLE config_plataforma ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_plataforma_select" ON config_plataforma FOR SELECT TO authenticated USING (true);
CREATE POLICY "config_plataforma_admin" ON config_plataforma FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());
```
> El superadmin para editar usa `get_es_superadmin()` (escribe desde dentro de un negocio o vía función dedicada). El SELECT es `true` porque el cliente suspendido —cuyo único acceso es la pantalla de bloqueo— debe poder leer tu WhatsApp y cuentas para pagarte.

**`suscripciones`** (por tenant — el negocio lee la suya, el superadmin gestiona):
```sql
ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
-- SELECT: el negocio ve su propia suscripción; el superadmin ve todas (vía tabla usuarios, no JWT)
CREATE POLICY "suscripciones_select" ON suscripciones FOR SELECT TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    OR EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true)
);
-- + política RESTRICTIVE superadmin_no_write estándar (ver CLAUDE.md)
-- Las escrituras van SOLO por fn_registrar_pago_suscripcion (SECURITY DEFINER, superadmin).
```

> ⚠️ **Detalle multi-tenant crítico:** la RLS de `suscripciones` para el superadmin usa `EXISTS (SELECT ... FROM usuarios WHERE es_superadmin)`, **no** `get_es_superadmin()` del JWT. Razón documentada en CLAUDE.md: en `/admin` el JWT del superadmin puede no tener el claim actualizado. Mismo patrón que `negocios_select`.

---

## 3. Lógica de negocio (funciones SQL)

### 3.1. `fn_estado_suscripcion(p_negocio_id)` — calcula el estado vigente

`SECURITY DEFINER`, retorna JSON. Lee la fila más reciente de `suscripciones`, deriva el estado efectivo y devuelve:
```json
{
  "estado": "TRIAL" | "ACTIVA" | "VENCIDA" | "SUSPENDIDA",
  "plan_codigo": "PRO",
  "plan_nombre": "Plan PRO",
  "vence_el": "2026-06-28T...",
  "dias_restantes": 12,
  "features": { "pos": true, ... },
  "bloqueada": false
}
```

**Cómo deriva el `estado` efectivo:**
- Si la fila guardada es `SUSPENDIDA` o `CANCELADA` → ese estado, `bloqueada = true` (bloqueo manual/cancelación, independiente de la fecha).
- Si `vence_el < NOW()` → `VENCIDA`, `bloqueada = true`.
- Si no → el estado guardado (`TRIAL` o `ACTIVA`), `bloqueada = false`.

El campo `bloqueada` es lo único que el guard necesita mirar — encapsula las tres razones de bloqueo (vencida, suspendida, cancelada) en un solo booleano. Todo se evalúa **on-demand** (pura comparación de fecha), sin cron ni jobs.

### 3.2. Inicialización en `fn_completar_onboarding` (modificación)

Agregar un paso (entre el paso 8 y 9 actuales) que cree la suscripción inicial:
```sql
-- ── 8b. Suscripción inicial: plan PRO en TRIAL de 15 días ──
v_plan_basico_id := (SELECT id FROM planes WHERE codigo = 'PRO');  -- plan de entrada
INSERT INTO suscripciones (negocio_id, plan_id, estado, vence_el)
VALUES (
    v_negocio_id, v_plan_basico_id, 'TRIAL',
    NOW() + ((SELECT trial_dias FROM planes WHERE id = v_plan_basico_id) || ' days')::INTERVAL
);
```
Es el único cambio a una función existente. Todo lo demás es nuevo.

### 3.3. `fn_registrar_pago_suscripcion(...)` — superadmin registra un pago (1 clic)

`SECURITY DEFINER`. **No** lleva `fn_assert_no_superadmin` (es una función que el superadmin SÍ ejecuta, como `fn_configurar_modulos`). Valida que el caller sea superadmin, inserta una fila nueva en `suscripciones` con estado `ACTIVA`, monto, `metodo_pago_id` y nota.

**Renovación "desde el vencimiento" (decisión 2026-06-13):** el nuevo período NO arranca el día del pago, sino desde la fecha de vencimiento anterior — así el cliente nunca pierde días por pagar por adelantado. La regla:
```sql
-- Base de cálculo: si la suscripción aún no venció, extiende desde su vence_el.
-- Si ya venció hace tiempo, extiende desde HOY (no se "regalan" meses retroactivos).
v_base   := GREATEST(v_vence_anterior, NOW());
v_nuevo_vence := v_base + (CASE WHEN v_periodo = 'ANUAL' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END);
```

**Esto responde "¿cómo lo hago automático?":** el único acto manual es que el superadmin **confirme que el dinero llegó** (verificar la transferencia/depósito) y haga **un clic en "Registrar pago"**. A partir de ahí TODO es automático: la fecha se extiende, el estado pasa a `ACTIVA`, el bloqueo se levanta solo (el guard recalcula al próximo ingreso), y el cliente vuelve a operar. No hay nada más que hacer manualmente.

> El pago por transferencia/depósito **no puede ser 100% automático sin una pasarela** conectada al banco — alguien tiene que confirmar que el dinero entró (trabajo humano inevitable, igual que en cualquier SaaS que cobra por transferencia). Lo que sí automatizamos es todo el ciclo posterior a esa confirmación. Cuando integres una pasarela (Payphone/Stripe), su webhook llamaría a esta misma función y se elimina hasta ese clic. Ver §8.

### 3.4. `fn_suspender_propietario_suscripcion(p_propietario_id, p_suspender)` — suspensión por cobro

> **Actualizado 2026-06-16:** la suscripción se paga **por propietario, no por sucursal** (PRO = 1 negocio, MAX = 3, una sola suscripción cubre todas). Por eso la suspensión es a nivel de propietario, no de negocio puntual.

`SECURITY DEFINER`, solo superadmin. Recorre **todos** los negocios del propietario e inserta por cada uno una fila nueva en `suscripciones` con `estado = 'SUSPENDIDA'` (o reactiva con `ACTIVA` conservando `vence_el`). Cada sucursal queda mostrando la pantalla de cobro. El guard la trata como bloqueo vía el campo `bloqueada`.

> **Eliminadas en este cambio:** `fn_suspender_suscripcion` (suspendía 1 negocio puntual) y `fn_suspender_usuario` (`usuarios.activo = false`, muro seco sin canal de pago). Reemplazadas por esta única función. `usuarios.activo` sigue vivo para la gestión de empleados/membresías, no para la suspensión del propietario.

### 3.5. (Opcional) `fn_set_negocio_activo` — adjuntar estado al JWT

Para que el bloqueo sea instantáneo sin un round-trip extra, se puede añadir el estado de suscripción al `app_metadata` del JWT dentro de `fn_set_negocio_activo` (igual que hoy escribe `rol`). **Trade-off:** el JWT no se refresca solo al vencer, así que igual hace falta el chequeo on-demand. Por eso este punto es **opcional** — el guard puede consultar `fn_estado_suscripcion` directamente. Se decide en la Fase 3.

---

## 4. Frontend — piezas a crear/modificar

### 4.1. Nuevas piezas (todo standalone, siguiendo patrones del proyecto)

| Pieza | Ubicación | Qué hace |
|---|---|---|
| `SuscripcionService` | `core/services/suscripcion.service.ts` | Llama `fn_estado_suscripcion`, cachea el estado (patrón `ConfigService`), expone `estado$`. |
| `suscripcionGuard` | `core/guards/suscripcion.guard.ts` | **Guard NUEVO** (no se reutiliza ninguno — ver justificación abajo). Bloquea la app si `bloqueada === true` (vencida, suspendida o cancelada) → redirige a pantalla de suscripción. Espera estado listo (patrón `cajaAbiertaGuard`). |
| `BannerComponent` | `shared/components/banner/` | Banner genérico reutilizable (presentación pura). Lo consumen `offline-banner` y el aviso de suscripción. Ver §4.3. |
| `SuscripcionPage` | `features/suscripcion/pages/...` | Pantalla "Suscríbete" (bloqueo) + sección "Mi Plan" (informativa). Muestra plan actual, días restantes, datos de pago. |
| Modelos | `features/suscripcion/models/` | `Plan`, `Suscripcion`, `EstadoSuscripcion`, `MetodoPago`. IDs siempre `string`. |
| Rutas | `core/config/routes.config.ts` | Agregar `ROUTES.suscripcion`. |
| Admin: registrar pago | `features/admin/components/...modal` | Modal en `/admin` para que el superadmin registre un pago (1 clic) / cambie de plan. |

**Justificación del guard nuevo (responsabilidad única):** cada guard del proyecto valida UNA dimensión — `authGuard` (sesión/identidad), `cajaAbiertaGuard` (turno), `roleGuard` (rol), `superadminGuard` (superadmin). La suscripción es una dimensión de autorización distinta ("¿este negocio pagó?") que no encaja en ninguno. Meterla dentro de `authGuard` lo volvería un "god guard" que mezcla identidad con facturación — más difícil de testear y razonar. Los guards de Angular están diseñados para **componerse en cadena** (`canActivate: [authGuard, suscripcionGuard]`), no para inflarse. Por eso: guard nuevo, enganchado después de `authGuard`.

### 4.2. Modificaciones a piezas existentes

| Archivo | Cambio |
|---|---|
| `app.routes.ts` | Agregar `suscripcionGuard` junto a `authGuard` en la ruta del layout (línea 25), o dentro del layout. |
| `UsuarioActual` (model) | (Opcional) agregar `suscripcion?: EstadoSuscripcion` para tenerla en cache. |
| `auth.service.ts` | (Opcional) poblar el estado de suscripción al activar negocio. |
| `configuracion.page.ts` | Agregar entrada "Mi Plan / Suscripción" en el menú de configuración. |
| `admin-dashboard.page` | Mostrar badge del plan + estado por negocio; acción "Registrar pago". |
| `negocio-admin.model.ts` | Agregar campos de suscripción al modelo del admin. |

### 4.3. Aviso de vencimiento — banner genérico reutilizable

> **Decisión (2026-06-13):** NO renombrar ni reutilizar directamente `offline-banner` (está acoplado a `NetworkService` + `OutboxService` y a la cola de ventas). En su lugar, crear un **`BannerComponent` genérico y "tonto"** y hacer que `offline-banner` lo consuma. Esto da "un banner para toda clase de aviso pequeño" sin romper lo que ya funciona, por **composición** en vez de acoplamiento.

**Arquitectura del banner:**
- **`BannerComponent`** (`shared/components/banner/`) — presentación pura. Recibe por `@Input()`: `texto`, `color` (warning/primary/danger), `icono`, y opcionalmente `accion` (texto + callback). No conoce red, ni ventas, ni suscripciones. Maneja la animación slideDown, el min-height 44px y la franja de safe-area-top que hoy vive en `offline-banner`.
- **`offline-banner`** se refactoriza para **usar** `BannerComponent` internamente — conserva su lógica de `NetworkService`/`OutboxService`, solo delega el "cómo se ve".
- **Aviso de suscripción** — un consumidor más del `BannerComponent`, alimentado por `SuscripcionService`. Aparece cuando `dias_restantes <= umbral` (ej. 7 días) y `estado !== VENCIDA`: *"Tu plan vence en 5 días. Renueva para no perder acceso."* No bloquea — solo recuerda.

> **Distinción clave de UX:** el banner es para el aviso **preventivo** (faltan X días, no bloquea). Cuando ya está **VENCIDA**, no es banner: es el **bloqueo total** (pantalla completa "Suscríbete" vía `suscripcionGuard`). Dos componentes distintos para dos estados distintos.

### 4.4. Pantalla de bloqueo "Suscríbete" — diseño para Ecuador

Cuando `suscripcionGuard` detecta `VENCIDA`, redirige a `SuscripcionPage` en modo bloqueo. Diseño recomendado (cobro manual, contexto Ecuador/Cuenca):

1. **Mensaje claro** (desde `config_plataforma.mensaje_suspension`): *"Tu acceso fue suspendido por falta de pago. Reactiva tu cuenta para seguir operando."*
2. **Botón WhatsApp (canal principal)** — el más prominente. En Ecuador WhatsApp es el canal de cobro/soporte de facto. Abre el chat contigo con un mensaje pre-escrito (*"Hola, quiero reactivar la suscripción de [negocio]"*). Reutiliza el patrón ya documentado en memoria: `project_whatsapp_web_pattern.md` (escape Unicode, `api.whatsapp.com`, teléfono Ecuador `593...`). El número sale de `config_plataforma.whatsapp_cobro`.
3. **Cuentas bancarias (información secundaria)** — card/acordeón para quien prefiere transferir directo. Por cada cuenta (de `config_plataforma.cuentas_bancarias`): banco, tipo (Ahorros/Corriente), número, titular y **cédula del titular** (estándar Ecuador para confirmar la transferencia). Botón "copiar número de cuenta" por conveniencia.
4. **Monto a pagar** — tomado del `precio` del plan (ej. *"$5.00 / mes"*).

> **Jerarquía intencional:** WhatsApp grande (el cliente te escribe y coordinas) + cuentas como respaldo. Es como operan los SaaS pequeños/medianos en Ecuador donde el cobro es manual. Cuando el cliente pague, tú confirmas y registras el pago con 1 clic (§3.3).

### 4.5. Lo que el plan habilita/oculta (control por `features`)

El `SuscripcionService` expone `tieneFeature('ia')`. Las secciones premium se ocultan con `@if (suscripcion.tieneFeature('x'))` en el sidebar/templates. **Hoy no oculta nada** (Básico trae todo); la infraestructura queda lista para cuando agregues planes superiores.

> **Seguridad:** igual que con el superadmin, el guardián real es la BD (la feature gate del frontend es UX, no seguridad). Cuando una feature premium tenga su propia función SQL, esa función validará el plan del negocio. Por ahora no aplica porque no hay features premium todavía.

### 4.6. Performance — cache del estado (no consultar BD en cada navegación)

> **Autocorrección (2026-06-13):** el guard se ejecuta en cada cambio de ruta. Si `SuscripcionService` llamara `fn_estado_suscripcion` cada vez, serían decenas de queries por sesión. **Decisión:** cachear el estado en memoria con un **TTL corto** (ej. 5–10 min), patrón idéntico a `ConfigService`. El guard lee del cache; solo refresca tras expirar el TTL o tras un evento que lo invalide (activar negocio, registrar pago). Así el bloqueo es instantáneo y no castiga la red.
>
> **Alternativa (JWT):** adjuntar el estado al `app_metadata` en `fn_set_negocio_activo` (§3.4) elimina hasta esa query, pero el JWT no se refresca solo al vencer a mitad de sesión. **Recomendación:** cache con TTL como mecanismo principal; el JWT queda como optimización opcional, no necesaria para v1.

### 4.7. Refactor del panel `/admin` — de monolito a tabs (observación del dueño, 2026-06-13)

> **Contexto:** hoy `/admin` es **una sola página de 319 líneas** (`admin-dashboard.page.ts`) que ya concentra: listar negocios, agruparlos por propietario, búsqueda, módulos, suspensión de propietario y navegación. Una sola ruta `''`.
>
> **Problema:** meterle "registrar pagos + editar planes + editar config de cobro + ver suscripciones" SIN refactorizar convertiría ese componente en un monolito ingobernable. Es el anti-patrón que evita la guía senior del proyecto (analizar impacto completo antes de parchear).

**Solución — `/admin` con tabs internas** (patrón ya documentado en CLAUDE.md: tabs internas con rutas planas + `AdminTabsComponent` que detecta la ruta por `NavigationEnd`, igual que el módulo `ventas`):

```
/admin
  ├── /admin                 → tab "Negocios"      (lo de hoy, extraído a pages/negocios/)
  ├── /admin/suscripciones   → tab "Suscripciones" (estados, registrar pago)
  ├── /admin/planes          → tab "Planes"        (editar precio, trial, features)
  └── /admin/configuracion   → tab "Configuración" (datos de cobro: WhatsApp, cuentas)
```

**Ganancias del refactor:**
- Cada sección es un componente chico y testeable (la página de negocios actual deja de crecer).
- **Escalable:** mañana agregas "Métricas de ingresos" o "Reportes" como otra tab sin tocar lo demás.
- El `superadminGuard` se aplica una vez a nivel del layout de tabs — todas las sub-rutas quedan protegidas.
- Funcionalmente, la sección de negocios actual no cambia para el usuario — solo se reorganiza.

> **Por qué es su propia fase (Fase 5, antes de la gestión):** el refactor estructural se hace primero, en aislamiento, para verificar que `/admin` sigue funcionando idéntico. Luego (Fase 6) se cuelgan las nuevas tabs. Separar reduce el riesgo: si algo se rompe, se sabe si fue el refactor o la feature nueva.

---

## 5. Fases de implementación (con checklist)

> Cada fase es entregable e independiente. Marcar `[x]` al completar. **No avanzar a la siguiente fase sin aprobación del dueño.**

### ⬜ Fase 0 — Aprobación del plan
- [x] Trial = 15 días, precio Básico = $5/mes (**editables desde `/admin`** vía tabla `planes` — confirmado 2026-06-13).
- [x] Datos de cobro: WhatsApp (principal) + cuentas bancarias (Ecuador) en tabla `config_plataforma` (confirmado 2026-06-13).
- [ ] El dueño aprueba el enfoque general y autoriza empezar la Fase 1.
- [ ] Entregar al implementar: número de WhatsApp de cobro + cuentas bancarias reales (para sembrar `config_plataforma`).

### ✅ Fase 1 — Modelo de datos (BD) — IMPLEMENTADA EN SQL (2026-06-13)
- [x] Crear tabla `planes` + seed del plan Básico.
- [x] Crear tabla `metodos_pago_suscripcion` + seed (transferencia, depósito, efectivo).
- [x] Crear tabla `config_plataforma` (singleton) + seed del mensaje de suspensión.
- [x] Crear tabla `suscripciones` (con FK `metodo_pago_id`) + índice.
- [x] Agregar RLS de las cuatro en `02_rls.sql` (+ RESTRICTIVE `suscripciones_no_write` que bloquea TODA escritura directa).
- [x] Agregar las tablas a los `DROP TABLE` del teardown (`01_teardown.sql`) y al `schema.sql`.
- [x] Migración única: crear suscripción para los negocios que ya existían (en `migrations/001_planes_suscripciones.sql`, bloque 5).
- [x] Documentar en `docs/setup/schema.sql` el nuevo grupo (tablas de monetización).
- [ ] **PENDIENTE — el dueño ejecuta** `migrations/001_planes_suscripciones.sql` en Supabase y verifica.

### ✅ Fase 2 — Lógica SQL — IMPLEMENTADA EN SQL (2026-06-13)
- [x] `fn_estado_suscripcion(p_negocio_id)` — deriva estado vigente + `bloqueada`.
- [x] Modificar `fn_completar_onboarding` — crea suscripción TRIAL al nacer el negocio (paso 8b).
- [x] `fn_registrar_pago_suscripcion(...)` — superadmin registra pago/renovación **desde el vencimiento**.
- [x] `fn_suspender_suscripcion(...)` — bloqueo/desbloqueo manual de un negocio.
- [ ] (Decidir en Fase 3) si se adjunta estado al JWT en `fn_set_negocio_activo`.
- [x] Funciones documentadas en `docs/suscripcion/sql/functions/`.
- [ ] **PENDIENTE — el dueño ejecuta** las 4 funciones (3 nuevas + onboarding reemplazado) en Supabase.

### ✅ Fase 3 — Frontend: estado + guard + bloqueo — IMPLEMENTADA (2026-06-13)
- [x] `SuscripcionService` (cache RAM + TTL 5 min, fail-open, RPC directo sin toast; `core/services/suscripcion.service.ts`).
- [x] `suscripcionGuard` (guard nuevo, exime superadmin, fail-open; `core/guards/suscripcion.guard.ts`).
- [x] `SuscripcionPage` — pantalla dual: bloqueo "Suscríbete" (WhatsApp + cuentas) e informativo "Mi Plan". Modelos en `features/suscripcion/models/`.
- [x] Guard enganchado en cadena `[authGuard, suscripcionGuard]` en `app.routes.ts`; `/suscripcion` fuera del layout (sin loop).
- [x] `ROUTES.suscripcion` en `routes.config.ts`.
- [x] Entrada "Mi Plan" en el menú de Configuración.
- [x] ⚠️ **BLOQUEANTE cumplido:** el dueño ya ejecutó la migración (Fase 1) → su negocio tiene suscripción ACTIVA, no se autobloquea.
- [x] **Entregable:** un negocio con suscripción bloqueada no puede operar y ve cómo pagar.

### ✅ Fase 4 — Frontend: banner genérico + aviso preventivo de vencimiento — IMPLEMENTADA (2026-06-13)
> "Mi Plan" y la pantalla de bloqueo ya se entregaron en la Fase 3. Esta fase es solo el banner.
- [x] `BannerComponent` genérico (`shared/components/banner/`) — presentación pura, colores semánticos, acción opcional.
- [x] Refactorizado `offline-banner` para que consuma `BannerComponent` (lógica intacta; SCSS reducido a solo safe-area).
- [x] `SuscripcionBannerComponent` (`core/components/suscripcion-banner/`): "vence en X días" cuando `dias_restantes <= 7` y no bloqueada. Exime superadmin; tocar lleva a "Mi Plan".
- [x] Ambos banners montados en `app.component`; coordinan el safe-area-top para no duplicarlo.
- [x] **Entregable:** el cliente recibe el aviso preventivo dentro de la app; el banner queda reutilizable para futuros avisos (anuncios, etc.).

### ✅ Fase 5 — Refactor del panel `/admin` a tabs internas — IMPLEMENTADA (2026-06-13)
> Ver §4.7 para el detalle y la justificación. Se hace ANTES de meter la gestión de suscripciones para no agrandar el monolito actual.
- [x] Dashboard monolítico movido (`git mv`) a `pages/negocios/` como `AdminNegociosPage` (lógica intacta, +header con tabs).
- [x] `AdminTabsComponent` (`components/admin-tabs/`, chrome-tabs, detección por `NavigationEnd`): Negocios / Suscripciones / Planes / Cobro.
- [x] `admin.routes.ts` convertido a rutas planas; cada una con `superadminGuard`.
- [x] `ROUTES.admin` pasó de string a objeto (`root`/`suscripciones`/`planes`/`configuracion`); actualizados los 4 usos.
- [x] 3 páginas placeholder (suscripciones/planes/configuración) con `UnderConstructionComponent` describiendo lo que trae la Fase 6.
- [x] **Entregable:** el panel admin quedó modular y escalable; la sección de negocios funciona igual que antes.

### ✅ Fase 6 — Frontend: gestión de suscripciones desde superadmin — IMPLEMENTADA (2026-06-13)
- [x] Tab "Suscripciones": lista de negocios con plan + estado (badge) + días, buscador, acciones "Registrar pago" y "Suspender/Reactivar". Usa `fn_listar_suscripciones_admin` (1 query para todos).
- [x] `RegistrarPagoModalComponent` (bottom-sheet): plan + método (catálogo vía `<select>` nativo con `[(ngModel)]`, dentro de formulario) + monto prellenado + nota → `fn_registrar_pago_suscripcion`.
- [x] Tab "Planes": CRUD del catálogo. `PlanModalComponent` con precio, periodo, días de trial, features (toggles de catálogo fijo), activar/desactivar.
- [x] Tab "Cobro": edita `config_plataforma` (WhatsApp, mensaje) + CRUD de cuentas bancarias (`CuentaBancariaModalComponent`).
- [x] Función SQL nueva `fn_listar_suscripciones_admin` (lista todos los negocios + suscripción vigente, solo superadmin).
- [x] Métodos en `SuscripcionService`: listarSuscripcionesAdmin, registrarPago, suspenderNegocio, listarPlanes, listarMetodosPago, guardarPlan, guardarMetodoPago, guardar/getConfigPlataforma.
- [ ] **PENDIENTE — el dueño ejecuta** `fn_listar_suscripciones_admin.sql` en Supabase.
- [ ] (Diferido) CRUD de `metodos_pago_suscripcion` desde UI — hoy se gestiona por SQL/seed; el selector ya los consume.
- [x] **Entregable:** el superadmin gestiona pagos, planes y datos de cobro sin tocar SQL a mano.

### ⬜ Fase 7 — Control de features por plan (preparación para futuro)
- [ ] `SuscripcionService.tieneFeature(codigo)`.
- [ ] Feature-gates en sidebar/templates con `@if`.
- [ ] **Entregable:** infraestructura lista para que planes superiores desbloqueen secciones (IA, etc.). Sin features premium aún — no cambia nada visible hoy.

---

## 6. Ganancias de esta implementación

| Ganancia | Detalle |
|---|---|
| **Monetización real** | Convierte la app de herramienta interna a SaaS de cobro. Es el habilitador directo de tu modelo de venta puerta a puerta. |
| **Cobro sin fricción** | El trial de 15 días deja al cliente probar gratis; el bloqueo automático presiona el pago sin que tengas que perseguir a nadie manualmente. |
| **Cero mantenimiento manual** | El vencimiento es por fecha — no andas suspendiendo negocios uno por uno. Solo registras el pago y la fecha se extiende sola. |
| **Escalable a más planes** | Catálogo en BD: agregas "Plan PRO con IA" con un `INSERT`, sin redeploy ni tocar código. |
| **Trazabilidad de ingresos** | La tabla `suscripciones` te da el histórico: cuánto te ha pagado cada negocio y cuándo. |
| **Respeta tu arquitectura** | No reescribe nada. Usa los mismos patrones (RLS multi-tenant, `SECURITY DEFINER`, catálogos globales, `fn_completar_onboarding`, guards, `ROUTES`, standalone). Mantenible por cualquiera que ya conozca el proyecto. |
| **Seguro por diseño** | El guardián es la BD (RLS + funciones), no el frontend. Un cliente no puede saltarse el bloqueo manipulando la app. |
| **Bajo riesgo** | 100% aditivo. Si algo falla en una fase, las anteriores siguen funcionando. La app actual no se ve afectada hasta que se active el guard (Fase 3). |

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El cliente queda bloqueado por un fallo de red al calcular el estado | El guard hace **fail-open** ante error de conexión (deja entrar) y solo bloquea cuando confirma vencimiento real. Igual que `cajaAbiertaGuard` tiene fallback offline. |
| El superadmin queda bloqueado por su propia suscripción | El guard exime a `es_superadmin` (igual que el resto de validaciones de la app). |
| Negocios creados ANTES de este sistema sin suscripción → **autobloqueo del dueño** | Migración única en Fase 1 + check **BLOQUEANTE** en Fase 3: el guard no se engancha hasta verificar que todos los negocios existentes tienen suscripción. |
| El guard consulta la BD en cada navegación (performance) | `SuscripcionService` cachea el estado con **TTL** (patrón `ConfigService`). Ver §4.6. |
| El panel `/admin` se vuelve un monolito al agregar la gestión | **Refactor a tabs internas** (Fase 5) antes de colgar las nuevas secciones. Ver §4.7. |
| Estado `VENCIDA` inconsistente con la fecha real | `VENCIDA` es **derivado**, no almacenado — se calcula al vuelo, sin jobs. Ver §2.3. |
| Cambio de hora/zona horaria afecta el vencimiento | Se compara en UTC (`TIMESTAMPTZ` + `NOW()`), sin convertir a local en el WHERE — respeta la regla de CLAUDE.md sobre fechas e índices. |
| Duplicar el concepto "membresía" | Nomenclatura estricta: "suscripción"/"plan", nunca "membresía". |

---

## 8. Fuera de alcance (features separadas — NO en este plan)

- **Comunicados / anuncios a clientes** (avisar de features nuevas): es un sistema distinto (tabla `anuncios` + pantalla de novedades). Se planifica aparte cuando se priorice. *(El `BannerComponent` genérico de la Fase 4 quedará listo para reutilizarse aquí.)*
- **Notificación push / correo de vencimiento**: el aviso de "vence en X días" se hace por **banner dentro de la app** (Fase 4). Push al celular o correo automático requieren infraestructura extra (push de Capacitor o un job/edge-function de Supabase que corra diario). Se evalúan como evolución posterior.
- **Downgrade/upgrade self-service por el cliente**: hoy el cliente no cambia su plan solo; lo hace el superadmin. Self-service es evolución futura.

### 8.1. Cobro automático con tarjeta (estilo Claude/Anthropic) — fase futura

> **Pregunta del dueño (2026-06-13):** "¿Y si quiero un plan con tarjeta que se descuente solo cada mes hasta que el cliente cancele, como Anthropic?"

**Veredicto profesional: gran visión, pero NO ahora — y la arquitectura actual ya te deja listo para enchufarlo sin rehacer nada.**

**Por qué no ahora:**
1. **Stripe no opera oficialmente en Ecuador.** Un negocio ecuatoriano no puede cobrar con Stripe directo. Las opciones reales son **Payphone** (la más popular y local — recomendada), **Kushki**, **PayPal** o **Datafast**.
2. **Requisitos serios:** cuenta de comercio (merchant account) con la pasarela, cumplimiento **PCI-DSS** (el número de tarjeta NUNCA se guarda en tu BD — lo tokeniza la pasarela), manejo de webhooks, lógica de reintentos por cobro fallido, dunning. Es un proyecto en sí mismo.
3. **No lo necesitas para validar el negocio.** El cobro manual ($5 + 1 clic) te hace ganar dinero desde el día uno sin esperar la integración.

**Por qué la base ya está lista (sería aditivo, no reescritura):**
- `metodos_pago_suscripcion` es catálogo → agregas `'PAYPHONE'` / `'TARJETA'` con un `INSERT`.
- `fn_registrar_pago_suscripcion` es el **punto único de renovación** → el **webhook de la pasarela** lo llama cuando el cobro automático se procesa. La lógica de renovación NO cambia; solo cambia **quién la dispara** (hoy: superadmin con 1 clic; mañana: webhook).
- `planes.features` ya distingue planes → un "Plan PRO con tarjeta" es otra fila.
- Solo se **agregaría:** tabla `metodos_pago_cliente` (tokens de tarjeta que devuelve la pasarela — nunca el número real), un endpoint de webhook (edge-function de Supabase), y el toggle "Cancelar suscripción" en Configuración del cliente.

**Recomendación:** dejarlo como **Fase 7 futura** ("Cobro recurrente con Payphone"), a evaluar cuando tengas varios clientes pagando y el cobro manual se vuelva tedioso. Hasta entonces, el modelo manual cubre todo.

---

## 9. Archivos que se tocarían (resumen para revisión)

**Nuevos (SQL):**
- `docs/suscripcion/sql/functions/fn_estado_suscripcion.sql`
- `docs/suscripcion/sql/functions/fn_registrar_pago_suscripcion.sql`
- `docs/suscripcion/sql/functions/fn_suspender_suscripcion.sql`
- (seed de `planes` + `metodos_pago_suscripcion` + `config_plataforma` — en un nuevo `docs/setup/05_planes.sql`)

**Nuevos (Frontend):**
- `src/app/core/services/suscripcion.service.ts`
- `src/app/core/guards/suscripcion.guard.ts`
- `src/app/shared/components/banner/` (BannerComponent genérico reutilizable)
- `src/app/features/suscripcion/` (página, modelos, componentes)
- `src/app/features/admin/components/admin-tabs/` (AdminTabsComponent — refactor a tabs)
- `src/app/features/admin/pages/{negocios,suscripciones,planes,configuracion}/` (tabs del panel)

**Modificados (SQL):**
- `docs/setup/schema.sql` — definición de `planes` + `metodos_pago_suscripcion` + `config_plataforma` + `suscripciones`, DROP en teardown, doc del nuevo grupo.
- `docs/setup/02_rls.sql` — políticas de las cuatro tablas.
- `docs/setup/01_teardown.sql` — orden de drop.
- `docs/onboarding/sql/functions/fn_completar_onboarding.sql` — paso 8b (suscripción TRIAL).

**Modificados (Frontend):**
- `src/app/app.routes.ts` — enganchar `suscripcionGuard` en cadena.
- `src/app/core/config/routes.config.ts` — `ROUTES.suscripcion` + sub-rutas de `/admin`.
- `src/app/core/components/offline-banner/` — refactor para consumir `BannerComponent`.
- `src/app/features/auth/models/usuario-actual.model.ts` — (opcional) estado de suscripción.
- `src/app/features/configuracion/pages/main/configuracion.page.ts` — entrada "Mi Plan".
- `src/app/features/admin/admin.routes.ts` — de ruta única a rutas planas (tabs).
- `src/app/features/admin/pages/dashboard/admin-dashboard.page.ts` — extraer a `pages/negocios/`.

**Documentación:**
- `docs/suscripcion/SUSCRIPCION-README.md` (nuevo).
- `CLAUDE.md` — agregar el módulo a la tabla de módulos y a la de docs.

---

## 10. Próximo paso

**Esperando tu aprobación de la Fase 0.** Cuando confirmes (y me des los datos de pago + el precio/días definitivos), empiezo por la **Fase 1 (modelo de datos)** y te muestro el SQL para que lo revises antes de ejecutarlo. No ejecuto ni modifico nada sin tu visto bueno fase por fase.

---

## 11. Diferenciadores del plan MAX (marketing implementado, bloqueo técnico pendiente)

### Planes actuales (2026-06-15)
- **Plan Pro** — acceso completo al sistema base (POS, inventario, clientes, caja). Solo web, 1 negocio.
- **Plan Max** — todo lo del Pro, más: Multisucursal, Multiplataforma y (próximamente) Inteligencia artificial.

Los tres diferenciadores del Max se muestran como bloques visuales en la tarjeta (`susc-plan__extra-bloque`). Son **solo marketing** — no hay bloqueo técnico real aún.

### Implementación futura del bloqueo real (cuando MAX tenga clientes)

#### 1. Multiplataforma
```sql
UPDATE planes SET features = features || '{"movil": true}' WHERE codigo = 'MAX';
```
```typescript
// En suscripcionGuard, tras verificar estado:
if (Capacitor.isNativePlatform() && !suscripcionService.tieneFeature('movil')) {
  router.navigate([ROUTES.suscripcion.root]);
  return false;
}
```
Mensaje en pantalla de suscripción: "Tu plan Pro solo está disponible en web. Actualiza al Max para usar la app en celular y tablet."

#### 2. Multisucursal — ✅ IMPLEMENTADO (2026-06-16)

```sql
-- migrations/003_planes_max_negocios.sql
ALTER TABLE planes ADD COLUMN IF NOT EXISTS max_negocios INT; -- NULL = ilimitado
UPDATE planes SET max_negocios = 1 WHERE codigo = 'PRO';
UPDATE planes SET max_negocios = 3 WHERE codigo = 'MAX';
```

- **`fn_completar_onboarding`** (paso 2b): cuenta **todos** los negocios del propietario y los compara con `max_negocios` del plan vigente. Si alcanzó el tope → `RAISE EXCEPTION 'limite_negocios: ...'`. El límite es **absoluto** — aplica también al superadmin creando para un dueño.
- **Frontend:** `OnboardingService.completar()` extrae el texto tras `limite_negocios:` y lo lanza como `OnboardingNegocioError`; la página `onboarding-caja` lo muestra como toast claro. **No** hay bloqueo preventivo del botón "Nueva sucursal" (la BD es el guardián — decisión 2026-06-16).
- Valores actuales: **PRO = 1, MAX = 3** (editables desde `/admin`, tab Planes — `PlanModalComponent` ya incluye el campo).

##### Dashboard "Resumen General" — beneficio MAX concreto ✅ (2026-07-02)

Además del límite de creación, el plan MAX tiene una **superficie exclusiva ya implementada**: el dashboard consolidado multi-negocio (módulo `grupo`). Es la vista de "todos mis negocios juntos" — KPIs, alertas, gráficos, tabla por negocio, deuda fiado y top productos del grupo.

- **Gate (frontend):** la opción "Ver resumen general" en el selector de negocios solo se muestra si `plan_codigo === 'MAX'` **y** el propietario tiene 2+ negocios. Es un gate de **UX**, no un bloqueo técnico duro: reutiliza `estadoSuscripcion` ya cargado.
- **Backend:** funciones `fn_grupo_*` `SECURITY DEFINER` que derivan el propietario del JWT — un no-propietario recibe listas vacías aunque llame la RPC directamente. La seguridad de datos no depende del gate de UI.
- Detalle completo: [`docs/grupo/GRUPO-README.md`](grupo/GRUPO-README.md) y [`docs/PLAN-DASHBOARD-RESUMEN-GENERAL.md`](PLAN-DASHBOARD-RESUMEN-GENERAL.md).

#### 3. Inteligencia artificial
Feature key `ia: true` ya está en el JSON de features del MAX. Cuando el módulo de IA esté construido, `tieneFeature('ia')` ya funcionará sin cambios de esquema.

### Por qué se difirió
- Solo hay clientes de prueba — bloquear hoy generaría fricción sin beneficio comercial.
- La señal visual es suficiente para el pitch de venta.
- Los cambios de esquema (max_negocios) son simples y no bloquean el desarrollo actual.

**Referencia en backlog:** `docs/PENDIENTES.md` → "Bloqueo técnico por dispositivo y multisucursal según plan".
