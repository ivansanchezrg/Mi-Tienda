# Plan de Refactorizacion Multi-Tenant — Schema

> **Estado**: PENDIENTE DE APROBACION (v7 — sexta revision senior)
> **Alcance**: Solo schema SQL (tablas, constraints, indices, RLS, triggers, funciones, seeds).
> **NO incluye**: cambios en frontend/TypeScript, servicios Angular, modelos TS.
> **Fecha**: 2026-04-24

---

## 1. Tabla nueva: `negocios` (tenant root)

Toda la arquitectura multi-tenant se ancla en esta tabla. Cada negocio es un tenant aislado.

```sql
CREATE TABLE IF NOT EXISTS negocios (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(255) NOT NULL,
    slug        VARCHAR(50)  NOT NULL UNIQUE,  -- identificador URL-safe ("panaderia-don-viche")
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Por que UUID y no SERIAL:**
- Evita IDs predecibles (seguridad).
- Compatible con Supabase Auth custom claims (JWT acepta strings, no ints).
- No colisiona si en el futuro se federan datos entre instancias.

**Por que `slug`:**
- Identificador humano para URLs, subdominio o deep-linking en la app.
- `UNIQUE` garantiza que no se repitan.

---

## 2. Clasificacion de tablas — impacto de `negocio_id`

### Grupo A — Tablas con `negocio_id` directo (21 tablas)

Tablas que contienen datos de un tenant especifico y se consultan frecuentemente con filtro de negocio. El `negocio_id` es columna directa con indice para que RLS no necesite JOINs.

| # | Tabla | Motivo |
|---|-------|--------|
| 1 | `cajas` | Cada negocio tiene sus propias 5 cajas con saldos independientes |
| 2 | `configuraciones` | Parametros como `negocio_nombre`, `caja_fondo_fijo_diario` son por negocio |
| 3 | `categorias_operaciones` | Categorias de ingreso/egreso customizables por negocio |
| 4 | `turnos_caja` | Turnos de caja del negocio |
| 5 | `recargas` | Registro de recargas por turno del negocio |
| 6 | `recargas_virtuales` | Saldo virtual por negocio |
| 7 | `operaciones_cajas` | Log de auditoria por negocio |
| 8 | `movimientos_empleados` | Cuenta corriente de empleados del negocio |
| 9 | `categorias_productos` | Cada negocio define sus propias categorias de inventario |
| 10 | `atributos` | Cada negocio define sus propios tipos de atributo (SABOR, COLOR) |
| 11 | `atributo_opciones` | Opciones de atributo del negocio (FRESA, ROJO) |
| 12 | `producto_templates` | Templates de producto del negocio |
| 13 | `productos` | SKUs del inventario del negocio |
| 14 | `producto_presentaciones` | Presentaciones de los productos del negocio |
| 15 | `clientes` | Clientes del negocio |
| 16 | `ventas` | Ventas del negocio |
| 17 | `kardex_inventario` | Auditoria de stock del negocio |
| 18 | `cuentas_cobrar` | Cuentas por cobrar del negocio |
| 19 | `secuencias_comprobantes` | Contadores de comprobantes por negocio |
| 20 | `notas` | Notas compartidas dentro del negocio |
| 21 | `usuario_negocios` | Tabla puente usuario-negocio (tiene `negocio_id` por definicion) |

### Grupo B — Tablas pivot sin `negocio_id` (4 tablas)

Tablas de relacion N:M que heredan el tenant de sus tablas padre via FK. No necesitan `negocio_id` propio porque sus padres ya lo tienen. El RLS se resuelve con `EXISTS` + JOIN.

| # | Tabla pivot | Hereda de | RLS via |
|---|-------------|-----------|---------|
| 1 | `producto_atributos` | `productos.negocio_id` | `EXISTS (SELECT 1 FROM productos WHERE ...)` |
| 2 | `template_atributos` | `producto_templates.negocio_id` | `EXISTS (SELECT 1 FROM producto_templates WHERE ...)` |
| 3 | `template_atributo_opciones` | `template_atributos` → `producto_templates` | `EXISTS` encadenado |
| 4 | `ventas_detalles` | `ventas.negocio_id` | `EXISTS (SELECT 1 FROM ventas WHERE ...)` |

### Grupo C — Tablas globales del sistema (2 tablas)

Catalogos inmutables compartidos por todos los tenants. Sin `negocio_id`.

| # | Tabla | Motivo |
|---|-------|--------|
| 1 | `tipos_servicio` | Catalogo del sistema (BUS, CELULAR). Si un negocio no usa recargas, simplemente no crea registros en `recargas`/`recargas_virtuales` |
| 2 | `tipos_referencia` | Catalogo de nombres de tablas para trazabilidad. Inmutable |

### Grupo D — Tabla global con acceso especial (1 tabla)

| # | Tabla | Motivo |
|---|-------|--------|
| 1 | `usuarios` | Perfil global del usuario (1 registro por email). Sin `negocio_id`. La relacion usuario-negocio vive en `usuario_negocios` |

**Inventario final: 21 Grupo A + 4 Grupo B + 2 Grupo C + 1 Grupo D + 1 `negocios` = 29 tablas totales**

> **Nota**: `cierres_diarios` aparece en el `DROP TABLE` del schema actual pero no tiene `CREATE TABLE` — es un vestigio. No existe como tabla real y se elimina del inventario.

---

## 3. Unificacion de PKs a UUID (Grupo A)

### Problema
`usuarios`, `cajas`, `categorias_operaciones` y `categorias_productos` usan `SERIAL` (INTEGER) como PK. El resto del schema usa UUID. Esto genera FKs mixtas (INTEGER vs UUID) que complican JOINs, RLS y migraciones.

### Solucion: migrar a UUID las 4 tablas del Grupo A

| Tabla | PK actual | PK nueva | FKs afectadas |
|-------|-----------|----------|---------------|
| `usuarios` | `SERIAL` | `UUID` | 10 columnas en 8 tablas (ver FKs en seccion 4) |
| `cajas` | `SERIAL` | `UUID` | `operaciones_cajas.caja_id` |
| `categorias_operaciones` | `SERIAL` | `UUID` | `operaciones_cajas.categoria_id` |
| `categorias_productos` | `SERIAL` | `UUID` | `productos.categoria_id`, `producto_templates.categoria_id` |

**`tipos_servicio` se mantiene SERIAL** — es Grupo C (catalogo global inmutable con 2 filas). No genera problemas de aislamiento ni colision.

---

## 4. Cambios en `usuarios` — relacion usuario-negocio

### Problema actual
```sql
CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,                          -- INTEGER
    nombre         VARCHAR(255) NOT NULL,
    usuario        VARCHAR(50)  NOT NULL UNIQUE,                -- Email
    rol            rol_usuario_enum NOT NULL DEFAULT 'EMPLEADO', -- rol global
    activo         BOOLEAN DEFAULT TRUE,                         -- activo global
    es_superadmin  BOOLEAN DEFAULT FALSE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

Problemas:
- `id` es `SERIAL` (INTEGER). Todas las FKs usan INTEGER. Para multi-tenant, UUID es mejor.
- `rol` y `activo` son globales. En multi-tenant, un usuario puede ser ADMIN en un negocio y EMPLEADO en otro.
- Columna `usuario` deberia llamarse `email` (es lo que almacena).

### Solucion: perfil global + membresia por negocio

```sql
-- usuarios: perfil global (1 registro por email)
CREATE TABLE IF NOT EXISTS usuarios (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre         VARCHAR(255) NOT NULL,
    email          VARCHAR(100) NOT NULL UNIQUE,  -- Email Google OAuth (antes 'usuario')
    es_superadmin  BOOLEAN DEFAULT FALSE,          -- acceso global del sistema (ver seccion 8.3)
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- usuario_negocios: membresia N:M
CREATE TABLE IF NOT EXISTS usuario_negocios (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    negocio_id  UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    rol         rol_usuario_enum NOT NULL DEFAULT 'EMPLEADO',
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (usuario_id, negocio_id)
);
```

**Cambios respecto al modelo actual:**

| Campo | Antes | Despues | Motivo |
|-------|-------|---------|--------|
| `usuarios.id` | `SERIAL` (INTEGER) | `UUID` | Consistencia con el resto del schema (ver seccion 3) |
| `usuarios.usuario` | `VARCHAR(50) 'usuario'` | `VARCHAR(100) 'email'` | Es un email, debe llamarse email |
| `usuarios.rol` | En `usuarios` | Movido a `usuario_negocios.rol` | El rol es por negocio |
| `usuarios.activo` | En `usuarios` | Movido a `usuario_negocios.activo` | Puede estar activo en un negocio e inactivo en otro |
| `es_superadmin` | En `usuarios` | Se mantiene + sync a JWT via trigger | Superadmin es global. Se lee del JWT en RLS (sin query a BD) |

**Impacto en FKs — tablas que referencian `usuarios.id` como INTEGER:**

Todas estas columnas cambian de `INTEGER` a `UUID`:
- `turnos_caja.empleado_id`
- `recargas.empleado_id`
- `operaciones_cajas.empleado_id`
- `movimientos_empleados.empleado_id`, `.creado_por`
- `recargas_virtuales.empleado_id`
- `ventas.empleado_id`
- `cuentas_cobrar.empleado_id`
- `notas.creada_por`, `.completada_por`

**Impacto en FKs — tablas que referencian `cajas.id` como INTEGER:**

- `operaciones_cajas.caja_id` → `UUID`

**Impacto en FKs — tablas que referencian `categorias_operaciones.id` como INTEGER:**

- `operaciones_cajas.categoria_id` → `UUID`

**Impacto en FKs — tablas que referencian `categorias_productos.id` como INTEGER:**

- `productos.categoria_id` → `UUID`
- `producto_templates.categoria_id` → `UUID`

---

## 5. Cambios en constraints UNIQUE — scope por negocio

### Constraints que cambian a scope por negocio

| Tabla | Constraint actual | Nuevo constraint |
|-------|-------------------|------------------|
| `cajas.codigo` | `UNIQUE (codigo)` | `UNIQUE (negocio_id, codigo)` |
| `categorias_productos.nombre` | `UNIQUE (nombre)` | `UNIQUE (negocio_id, nombre)` |
| `atributos.nombre` | `UNIQUE (nombre)` | `UNIQUE (negocio_id, nombre)` |
| `productos.codigo_barras` | `UNIQUE (codigo_barras)` | **Sin UNIQUE** — campo denormalizado, unicidad real vive en `codigos_barras(negocio_id, codigo)` |
| `producto_presentaciones.codigo_barras` | `UNIQUE (codigo_barras)` | **Sin UNIQUE** — campo denormalizado, unicidad real vive en `codigos_barras(negocio_id, codigo)` |
| `clientes.identificacion` | `UNIQUE (identificacion)` | `UNIQUE (negocio_id, identificacion)` |
| `configuraciones.clave` | `PRIMARY KEY (clave)` | `PRIMARY KEY (negocio_id, clave)` |
| `secuencias_comprobantes.tipo_documento` | `PRIMARY KEY (tipo_documento)` | `PRIMARY KEY (negocio_id, tipo_documento)` |
| `categorias_operaciones.codigo` | `UNIQUE (codigo)` | `UNIQUE (negocio_id, codigo)` |

### Constraints que se mantienen como estan

| Constraint | Motivo |
|------------|--------|
| `atributo_opciones (atributo_id, valor)` | Ya scoped: atributo pertenece a un negocio |
| `recargas (turno_id, tipo_servicio_id)` | Ya scoped: turno pertenece a un negocio |
| `usuarios.email` | Email unico global — 1 perfil por email |
| `ventas.idempotency_key` | UUID v4 universalmente unico |
| `negocios.slug` | Unico global por definicion |
| `tipos_servicio.codigo` | Catalogo global del sistema |
| `tipos_referencia.tabla` | Catalogo global del sistema |

### Constraint CHECK en atributos (se mantiene, re-scoped)

```sql
-- El CHECK de normalizacion se mantiene sin cambio:
CONSTRAINT atributos_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre)))
-- El UNIQUE cambia:
UNIQUE (negocio_id, nombre)  -- antes: UNIQUE (nombre)
```

---

## 6. Integridad template/SKU — constraints duros (no solo comentarios)

### Problema actual
Los campos `categoria_id`, `tipo_venta`, `unidad_medida` estan duplicados entre `producto_templates` y `productos`. El schema dice en un comentario: *"si producto_template_id IS NOT NULL, se heredan del template (ignorar los locales)"*. Pero no hay nada que lo imponga — un bug en el frontend puede escribir valores diferentes en el SKU y el template.

### Solucion: constraint CHECK + trigger de limpieza

**Constraint duro — la BD rechaza datos inconsistentes:**

```sql
-- Si es variante, los campos heredados DEBEN ser NULL.
-- La fuente de verdad es el template.
ALTER TABLE productos ADD CONSTRAINT chk_herencia_template CHECK (
    (producto_template_id IS NULL)
    OR
    (producto_template_id IS NOT NULL
     AND categoria_id IS NULL
     AND tipo_venta IS NULL
     AND unidad_medida IS NULL)
);
```

**Trigger de limpieza — forza NULL en variantes (defense in depth):**

```sql
-- Si el frontend envia categoria_id/tipo_venta/unidad_medida en una variante,
-- el trigger los limpia silenciosamente antes del INSERT/UPDATE.
-- Esto evita que un bug en el frontend cause un error de constraint.
CREATE OR REPLACE FUNCTION fn_limpiar_herencia_template()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.producto_template_id IS NOT NULL THEN
        NEW.categoria_id   := NULL;
        NEW.tipo_venta     := NULL;
        NEW.unidad_medida  := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_limpiar_herencia_template
    BEFORE INSERT OR UPDATE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_limpiar_herencia_template();
```

**Por que ambos (constraint + trigger):**
- El trigger evita errores silenciosos del frontend (limpia datos incorrectos).
- El constraint es la red de seguridad final (si alguien bypassea el trigger con SQL directo).
- El trigger se ejecuta BEFORE, limpia los valores, y luego el constraint valida — nunca entran en conflicto.

### Vista `v_productos_completos` — resuelve la herencia para queries

```sql
CREATE OR REPLACE VIEW v_productos_completos AS
SELECT
    p.id,
    p.negocio_id,
    p.producto_template_id,
    p.nombre,
    p.codigo_barras,
    p.precio_costo,
    p.precio_venta,
    p.stock_actual,
    p.stock_minimo,
    p.tiene_iva,
    p.activo,
    p.imagen_url,
    p.created_at,
    -- Campos heredados: template si es variante, propios si es simple
    COALESCE(t.categoria_id, p.categoria_id) AS categoria_id,
    COALESCE(t.tipo_venta, p.tipo_venta)     AS tipo_venta,
    COALESCE(t.unidad_medida, p.unidad_medida) AS unidad_medida,
    -- Template info (NULL para productos simples)
    t.nombre AS template_nombre
FROM productos p
LEFT JOIN producto_templates t ON t.id = p.producto_template_id;
```

El frontend puede consultar `v_productos_completos` en vez de `productos` + JOIN manual para obtener siempre los campos efectivos.

---

## 6b. Tabla centralizada de codigos de barras

### Problema

Los codigos de barras viven en dos tablas distintas (`productos.codigo_barras` y `producto_presentaciones.codigo_barras`). Esto causa 3 problemas:

1. **Colision cross-table**: el mismo codigo puede existir en un producto Y en una presentacion del mismo negocio. El POS busca primero en `productos` — si coincide, ignora la presentacion (bug silencioso).
2. **Lookup ineficiente**: el POS escanea un codigo y hace 2 queries secuenciales (primero `productos`, luego `presentaciones`). Deberia ser 1 query.
3. **Sin unicidad real**: `UNIQUE` por tabla no cruza tablas. Un constraint no puede verificar otra tabla.

### Solucion: tabla `codigos_barras` como registro central

```sql
CREATE TABLE IF NOT EXISTS codigos_barras (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id      UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    codigo          VARCHAR(50) NOT NULL,
    tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('PRODUCTO', 'PRESENTACION')),
    producto_id     UUID REFERENCES productos(id) ON DELETE CASCADE,      -- siempre presente
    presentacion_id UUID REFERENCES producto_presentaciones(id) ON DELETE CASCADE, -- solo si tipo = PRESENTACION
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Unicidad real: un codigo solo puede existir una vez por negocio
    CONSTRAINT uq_codigo_barras_negocio UNIQUE (negocio_id, codigo)
);

CREATE INDEX idx_codigos_barras_negocio  ON codigos_barras(negocio_id);
CREATE INDEX idx_codigos_barras_lookup   ON codigos_barras(negocio_id, codigo) INCLUDE (tipo, producto_id, presentacion_id);  -- index-only scan en POS
CREATE INDEX idx_codigos_barras_producto ON codigos_barras(producto_id);
```

**`producto_id` siempre presente**: una presentacion pertenece a un producto. Tener el `producto_id` directo permite resolver el escaneo en un solo paso: leer la fila de `codigos_barras` → ya sabes si es producto o presentacion Y a que producto apunta.

### Convivencia con campos existentes

Los campos `productos.codigo_barras` y `producto_presentaciones.codigo_barras` **se mantienen** como campos denormalizados. Razon: eliminarlos requiere cambiar todas las queries del frontend (inventario, POS, escaner, formularios). No vale la pena para este refactor.

La sincronizacion es unidireccional:

```
productos.codigo_barras ──────────► codigos_barras (via trigger)
presentaciones.codigo_barras ─────► codigos_barras (via trigger)
```

### Triggers de sincronizacion

```sql
-- Sincroniza codigos_barras al insertar/actualizar/borrar en productos o presentaciones.
-- La tabla codigos_barras es la fuente de verdad de unicidad.
-- Los campos codigo_barras en productos/presentaciones son copias denormalizadas.

CREATE OR REPLACE FUNCTION fn_sync_codigo_barras()
RETURNS TRIGGER AS $$
DECLARE
    v_negocio_id UUID;
    v_producto_id UUID;
    v_tipo TEXT;
    v_pres_id UUID := NULL;
BEGIN
    -- Determinar contexto segun tabla origen
    IF TG_TABLE_NAME = 'productos' THEN
        v_tipo := 'PRODUCTO';
        v_negocio_id := COALESCE(NEW.negocio_id, OLD.negocio_id);
        v_producto_id := COALESCE(NEW.id, OLD.id);
    ELSIF TG_TABLE_NAME = 'producto_presentaciones' THEN
        v_tipo := 'PRESENTACION';
        v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
        v_pres_id := COALESCE(NEW.id, OLD.id);
        v_negocio_id := (SELECT negocio_id FROM productos WHERE id = v_producto_id);
    END IF;

    -- DELETE: borrar el registro de codigos_barras
    IF TG_OP = 'DELETE' THEN
        IF OLD.codigo_barras IS NOT NULL THEN
            DELETE FROM codigos_barras
            WHERE negocio_id = v_negocio_id AND codigo = OLD.codigo_barras;
        END IF;
        RETURN OLD;
    END IF;

    -- INSERT o UPDATE:
    -- Si el codigo anterior existia, borrarlo
    IF TG_OP = 'UPDATE' AND OLD.codigo_barras IS NOT NULL
       AND (NEW.codigo_barras IS DISTINCT FROM OLD.codigo_barras) THEN
        DELETE FROM codigos_barras
        WHERE negocio_id = v_negocio_id AND codigo = OLD.codigo_barras;
    END IF;

    -- Si hay codigo nuevo, insertarlo (el UNIQUE de codigos_barras lo protege)
    IF NEW.codigo_barras IS NOT NULL AND TRIM(NEW.codigo_barras) <> '' THEN
        BEGIN
            INSERT INTO codigos_barras (negocio_id, codigo, tipo, producto_id, presentacion_id)
            VALUES (v_negocio_id, NEW.codigo_barras, v_tipo, v_producto_id, v_pres_id)
            ON CONFLICT (negocio_id, codigo) DO UPDATE
            SET tipo = EXCLUDED.tipo,
                producto_id = EXCLUDED.producto_id,
                presentacion_id = EXCLUDED.presentacion_id
            -- Guardia: si el codigo ya existe con tipo diferente, no sobrescribir silenciosamente.
            -- Esto evita que un INSERT concurrente cambie PRODUCTO → PRESENTACION sin aviso.
            WHERE codigos_barras.tipo = EXCLUDED.tipo
               OR codigos_barras.producto_id = EXCLUDED.producto_id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'El codigo de barras % ya existe en este negocio', NEW.codigo_barras;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_barcode_productos
    AFTER INSERT OR UPDATE OF codigo_barras OR DELETE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_codigo_barras();

CREATE TRIGGER trg_sync_barcode_presentaciones
    AFTER INSERT OR UPDATE OF codigo_barras OR DELETE ON producto_presentaciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_codigo_barras();
```

### Beneficios

| Aspecto | Antes (2 tablas separadas) | Ahora (tabla centralizada) |
|---------|---------------------------|---------------------------|
| Unicidad cross-table | Trigger con race condition teorica | `UNIQUE (negocio_id, codigo)` — garantia absoluta |
| Lookup POS | 2 queries secuenciales | 1 query a `codigos_barras` |
| Concurrencia | EXISTS puede fallar en TX concurrentes | UNIQUE constraint es atomico en PostgreSQL |
| Impacto frontend | N/A | Minimo — campos denormalizados se mantienen |

### Uso en el POS (futuro)

```sql
-- Un solo query resuelve cualquier escaneo:
SELECT cb.tipo, cb.producto_id, cb.presentacion_id
FROM codigos_barras cb
WHERE cb.negocio_id = auth.negocio_id()
  AND cb.codigo = '7861234567890';
-- tipo = 'PRODUCTO' → cargar producto
-- tipo = 'PRESENTACION' → cargar producto + presentacion
```

---

## 7. Cambio de tenant activo — flujo completo

### Problema
`auth.negocio_id()` lee `app_metadata.negocio_id` del JWT. Si el usuario cambia de negocio y no se refresca el JWT, las queries siguen apuntando al negocio anterior.

### Flujo definido

```
LOGIN (Google OAuth)
  │
  ▼
¿Usuario tiene negocios asignados?
  ├─ 0 negocios → Pantalla de onboarding / espera invitacion
  ├─ 1 negocio  → Auto-seleccion → setear claim → refrescar JWT
  └─ N negocios → Pantalla selector de negocio
                     │
                     ▼
              Usuario selecciona negocio
                     │
                     ▼
              fn_set_negocio_activo(p_negocio_id)
                     │
                     ▼
              Actualiza auth.users.raw_app_meta_data
              con { negocio_id: <uuid> }
                     │
                     ▼
              supabase.auth.refreshSession()
              → nuevo JWT con negocio_id en claims
                     │
                     ▼
              App carga con datos del negocio correcto
```

### Funcion SQL para cambiar tenant activo

```sql
CREATE OR REPLACE FUNCTION public.fn_set_negocio_activo(p_negocio_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auth_uid UUID;
    v_rol      rol_usuario_enum;
BEGIN
    v_auth_uid := auth.uid();

    -- Verificar pertenencia y obtener el rol en una sola query
    v_rol := (
        SELECT un.rol FROM usuario_negocios un
        INNER JOIN usuarios u ON u.id = un.usuario_id
        WHERE u.email = (SELECT email FROM auth.users WHERE id = v_auth_uid)
          AND un.negocio_id = p_negocio_id
          AND un.activo = TRUE
    );

    IF v_rol IS NULL THEN
        RAISE EXCEPTION 'No tienes acceso a este negocio';
    END IF;

    -- Escribir negocio_id Y rol en app_metadata del JWT
    -- Asi las RLS policies de usuarios/usuario_negocios
    -- pueden leer el rol del JWT sin consultar tablas.
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
        'negocio_id', p_negocio_id,
        'rol', v_rol::TEXT
    )
    WHERE id = v_auth_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_set_negocio_activo FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_set_negocio_activo TO authenticated;
```

### Garantias y casos de error

| Escenario | Comportamiento |
|-----------|---------------|
| Usuario no pertenece al negocio | `fn_set_negocio_activo` lanza EXCEPTION. No se modifica el JWT. Frontend muestra error |
| Usuario pertenece pero esta inactivo en ese negocio | EXCEPTION. `un.activo = TRUE` falla la validacion |
| `refreshSession()` falla (red, timeout) | JWT viejo sigue activo con el negocio anterior. No hay riesgo de seguridad — ve datos del negocio anterior, no del nuevo. Frontend reintenta |
| Usuario tiene 1 solo negocio | Auto-seleccion en login, sin pantalla de selector |
| Usuario tiene N negocios | Pantalla selector. Cada seleccion llama `fn_set_negocio_activo` + `refreshSession()` |
| `app_metadata.negocio_id` es NULL (recien logueado) | `auth.negocio_id()` retorna NULL → RLS evalua `negocio_id = NULL` → 0 filas visibles → seguro por defecto |
| Cambio de negocio en caliente (app abierta) | `fn_set_negocio_activo()` → `refreshSession()` → recargar datos. Sin ventana de inconsistencia |

**Quien puede ejecutar `fn_set_negocio_activo`:**
- Solo `authenticated` (REVOKE de `anon`).
- La funcion valida internamente que el `auth.uid()` del JWT corresponde a un usuario con membresia activa en el negocio solicitado.
- Un usuario no puede setear el negocio de otro usuario — `auth.uid()` viene del JWT, no de un parametro.

---

## 8. RLS — patron multi-tenant con acceso superadmin

### 8.1. Helper: extraer `negocio_id` del JWT

```sql
CREATE OR REPLACE FUNCTION auth.negocio_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
    SELECT (auth.jwt() -> 'app_metadata' ->> 'negocio_id')::UUID;
$$;
```

### 8.2. Helpers desde JWT (sin query a BD)

```sql
CREATE OR REPLACE FUNCTION auth.es_superadmin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'es_superadmin')::BOOLEAN, FALSE);
$$;

-- Rol del usuario en el negocio activo (seteado por fn_set_negocio_activo)
CREATE OR REPLACE FUNCTION auth.rol()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT auth.jwt() -> 'app_metadata' ->> 'rol';
$$;

-- Email del usuario autenticado
CREATE OR REPLACE FUNCTION auth.email()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT auth.jwt() ->> 'email';
$$;
```

**Principio: NINGUNA RLS policy debe consultar tablas de usuario.**

Todos los datos necesarios para evaluar policies viven en el JWT:
- `auth.negocio_id()` → tenant activo
- `auth.es_superadmin()` → acceso global
- `auth.rol()` → `'ADMIN'` o `'EMPLEADO'` en el negocio activo
- `auth.email()` → email del usuario autenticado

**Por que:**
- Leer de `usuarios` dentro de una RLS policy de `usuarios` genera dependencia circular (la policy necesita leer la tabla que la policy protege).
- Leer de `usuarios` en policies de OTRAS tablas agrega un SELECT extra por cada evaluacion de RLS.
- Leer del JWT es O(1), sin round-trip a BD, sin riesgo de recursion.

**Sincronizacion:** cuando se cambia `usuarios.es_superadmin` en la BD, se debe actualizar `auth.users.raw_app_meta_data` en la misma transaccion. Esto se hace con un trigger:

```sql
-- Trigger: sincroniza es_superadmin a app_metadata del JWT
-- Se ejecuta al cambiar el flag en la tabla usuarios.
CREATE OR REPLACE FUNCTION fn_sync_superadmin_to_jwt()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin THEN
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('es_superadmin', NEW.es_superadmin)
        WHERE email = NEW.email;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_superadmin
    AFTER UPDATE OF es_superadmin ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_superadmin_to_jwt();

-- Trigger: sincroniza rol a app_metadata del JWT cuando un ADMIN
-- cambia el rol de un usuario en usuario_negocios.
-- Solo sincroniza si el negocio modificado es el negocio activo del usuario.
CREATE OR REPLACE FUNCTION fn_sync_rol_to_jwt()
RETURNS TRIGGER AS $$
DECLARE
    v_email       TEXT;
    v_negocio_act UUID;
BEGIN
    IF NEW.rol IS DISTINCT FROM OLD.rol THEN
        v_email := (SELECT email FROM usuarios WHERE id = NEW.usuario_id);
        v_negocio_act := (
            SELECT (raw_app_meta_data ->> 'negocio_id')::UUID
            FROM auth.users WHERE email = v_email
        );
        -- Solo sincronizar si el negocio modificado es el activo
        IF v_negocio_act = NEW.negocio_id THEN
            UPDATE auth.users
            SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('rol', NEW.rol::TEXT)
            WHERE email = v_email;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_rol
    AFTER UPDATE OF rol ON usuario_negocios
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_rol_to_jwt();
```

> **Nota:** el usuario necesita hacer `refreshSession()` para que el nuevo JWT refleje cambios de `es_superadmin` o `rol`. Ambos son operaciones infrecuentes (administracion), no flujos normales de uso.

### 8.3. Politica de acceso superadmin

El superadmin necesita acceso transversal para:
- Soporte tecnico (ver datos de cualquier negocio).
- Administracion del sistema (gestionar negocios, ver metricas globales).
- Debugging en produccion.

**Regla: el superadmin ve todo. Pero SOLO cuando actua como superadmin, no en uso normal.**

Implementacion: las RLS policies permiten acceso si es el tenant correcto **O** si es superadmin:

```sql
-- Patron para TODAS las tablas con negocio_id:
CREATE POLICY "tenant_or_superadmin_select" ON productos
    FOR SELECT TO authenticated
    USING (
        negocio_id = auth.negocio_id()
        OR auth.es_superadmin()
    );

CREATE POLICY "tenant_or_superadmin_insert" ON productos
    FOR INSERT TO authenticated
    WITH CHECK (
        negocio_id = auth.negocio_id()
        OR auth.es_superadmin()
    );

CREATE POLICY "tenant_or_superadmin_update" ON productos
    FOR UPDATE TO authenticated
    USING (
        negocio_id = auth.negocio_id()
        OR auth.es_superadmin()
    );

CREATE POLICY "tenant_or_superadmin_delete" ON productos
    FOR DELETE TO authenticated
    USING (
        negocio_id = auth.negocio_id()
        OR auth.es_superadmin()
    );
```

Como `auth.es_superadmin()` lee del JWT (no de la BD), no hay costo de query adicional. El OR cortocircuita: si `negocio_id = auth.negocio_id()` es TRUE, `auth.es_superadmin()` ni se evalua.

### 8.4. Policies para tablas con `negocio_id` directo (Grupo A)

Todas las 21 tablas del Grupo A usan el patron `tenant_or_superadmin` de la seccion 8.3.

### 8.5. Policies para tablas pivot sin `negocio_id` (Grupo B)

```sql
-- producto_atributos: hereda aislamiento del producto padre
CREATE POLICY "tenant_pivot_select" ON producto_atributos
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM productos p
            WHERE p.id = producto_atributos.producto_id
            AND (p.negocio_id = auth.negocio_id() OR auth.es_superadmin())
        )
    );

-- Mismo patron para INSERT, UPDATE, DELETE
-- Mismo patron para template_atributos, template_atributo_opciones, ventas_detalles
```

### 8.6. Policies para `usuarios` (aislamiento entre tenants)

La tabla `usuarios` es global (sin `negocio_id`), pero un empleado de Panaderia A no debe ver el email del admin de Panaderia B. El filtro de "co-miembros del mismo negocio" requiere consultar `usuario_negocios`.

**Problema:** un EXISTS directo a `usuario_negocios` dentro de la policy de `usuarios` activa las RLS policies de `usuario_negocios`, que a su vez podrian consultar `usuarios` → recursion.

**Solucion:** funcion `SECURITY DEFINER` que bypassa RLS para el check de co-membresia:

```sql
-- Funcion helper: verifica si dos usuarios comparten al menos un negocio.
-- SECURITY DEFINER: bypassa RLS de usuario_negocios (evita recursion).
-- Solo usada internamente por la policy de usuarios.
CREATE OR REPLACE FUNCTION auth.comparten_negocio(p_usuario_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM usuario_negocios un1
        INNER JOIN usuario_negocios un2 ON un1.negocio_id = un2.negocio_id
        WHERE un1.usuario_id = p_usuario_id
          AND un2.usuario_id = (
              SELECT u.id FROM usuarios u WHERE u.email = auth.email()
          )
          AND un1.activo = TRUE
          AND un2.activo = TRUE
    );
$$;

CREATE POLICY "usuarios_select" ON usuarios
    FOR SELECT TO authenticated
    USING (
        -- Puede ver su propio perfil (necesario para bootstrap/login)
        email = auth.email()
        -- Superadmin ve todos los perfiles
        OR auth.es_superadmin()
        -- Puede ver perfiles de co-miembros (comparten al menos un negocio)
        OR auth.comparten_negocio(usuarios.id)
    );

-- INSERT: auto-registro del propio email + ADMIN del negocio + superadmin
CREATE POLICY "usuarios_insert" ON usuarios
    FOR INSERT TO authenticated
    WITH CHECK (
        -- Auto-registro: solo puede insertar con su propio email
        email = auth.email()
        -- ADMIN puede crear usuarios en su negocio
        OR auth.rol() = 'ADMIN'
        -- Superadmin puede crear cualquier usuario
        OR auth.es_superadmin()
    );

-- UPDATE: ADMIN del negocio + superadmin
CREATE POLICY "usuarios_update" ON usuarios
    FOR UPDATE TO authenticated
    USING (
        auth.rol() = 'ADMIN'
        OR auth.es_superadmin()
    );
```

**Por que `auth.comparten_negocio()` en vez de EXISTS directo:**
- EXISTS directo en la policy activa las RLS de `usuario_negocios`, que podrian generar recursion o evaluacion inesperada.
- La funcion `SECURITY DEFINER` accede a `usuario_negocios` sin RLS — es segura porque solo retorna un booleano (no expone datos de `usuario_negocios`).
- El indice `idx_usuario_negocios_lookup(usuario_id, negocio_id, activo)` ya cubre esta query.
- El cortocircuito del OR garantiza que `auth.comparten_negocio()` solo se evalua si las dos condiciones anteriores son FALSE (no es su propio perfil, no es superadmin).

### 8.7. Policies para `usuario_negocios` (zero self-reference)

```sql
-- SELECT: puede ver sus propias membresias + todas las del negocio activo si es ADMIN + superadmin
CREATE POLICY "usuario_negocios_select" ON usuario_negocios
    FOR SELECT TO authenticated
    USING (
        -- Puede ver sus propias membresias (para selector de negocio en login)
        usuario_id = (SELECT id FROM auth.users WHERE id = auth.uid())::UUID
        -- ADMIN ve todas las membresias de su negocio (gestionar empleados)
        OR (negocio_id = auth.negocio_id() AND auth.rol() = 'ADMIN')
        -- Superadmin ve todo
        OR auth.es_superadmin()
    );

-- INSERT: solo ADMIN del negocio + superadmin pueden agregar miembros
CREATE POLICY "usuario_negocios_insert" ON usuario_negocios
    FOR INSERT TO authenticated
    WITH CHECK (
        (negocio_id = auth.negocio_id() AND auth.rol() = 'ADMIN')
        OR auth.es_superadmin()
    );

-- UPDATE: solo ADMIN del negocio + superadmin pueden cambiar rol/activo
CREATE POLICY "usuario_negocios_update" ON usuario_negocios
    FOR UPDATE TO authenticated
    USING (
        (negocio_id = auth.negocio_id() AND auth.rol() = 'ADMIN')
        OR auth.es_superadmin()
    );
```

> **Nota sobre `usuario_negocios_select`**: la primera clausula usa `auth.uid()` (UUID de `auth.users`) en vez de buscar por email en `usuarios`. Esto evita consultar `usuarios` dentro de la policy de `usuario_negocios`. Requiere que `usuario_negocios.usuario_id` referencie al mismo UUID que `auth.users.id` — lo cual se resuelve mapeando `usuarios.id` con `auth.users.id` en `fn_crear_negocio`.

### 8.8. Policies para tablas globales (Grupo C)

```sql
-- tipos_servicio y tipos_referencia: solo lectura para authenticated
CREATE POLICY "global_select" ON tipos_servicio
    FOR SELECT TO authenticated USING (true);
-- Sin INSERT/UPDATE/DELETE — inmutables desde el cliente
```

---

## 9. Indices multi-tenant

Toda query que filtre por `negocio_id` necesita indice. Como RLS inyecta `WHERE negocio_id = auth.negocio_id()` en todas las queries, estos indices son criticos para performance.

```sql
-- Tablas de datos (Grupo A)
CREATE INDEX idx_cajas_negocio                ON cajas(negocio_id);
CREATE INDEX idx_configuraciones_negocio      ON configuraciones(negocio_id);
CREATE INDEX idx_cat_operaciones_negocio      ON categorias_operaciones(negocio_id);
CREATE INDEX idx_turnos_negocio               ON turnos_caja(negocio_id);
CREATE INDEX idx_recargas_negocio             ON recargas(negocio_id);
CREATE INDEX idx_recargas_virt_negocio        ON recargas_virtuales(negocio_id);
CREATE INDEX idx_operaciones_negocio          ON operaciones_cajas(negocio_id);
CREATE INDEX idx_operaciones_negocio_fecha    ON operaciones_cajas(negocio_id, fecha);
CREATE INDEX idx_mov_empleados_negocio        ON movimientos_empleados(negocio_id);
CREATE INDEX idx_categorias_prod_negocio      ON categorias_productos(negocio_id);
CREATE INDEX idx_atributos_negocio            ON atributos(negocio_id);
CREATE INDEX idx_atrib_opciones_negocio       ON atributo_opciones(negocio_id);
CREATE INDEX idx_templates_negocio            ON producto_templates(negocio_id);
CREATE INDEX idx_productos_negocio            ON productos(negocio_id);
CREATE INDEX idx_productos_negocio_activo     ON productos(negocio_id, activo);
CREATE INDEX idx_presentaciones_negocio       ON producto_presentaciones(negocio_id);
CREATE INDEX idx_clientes_negocio             ON clientes(negocio_id);
CREATE INDEX idx_ventas_negocio               ON ventas(negocio_id);
CREATE INDEX idx_ventas_negocio_turno         ON ventas(negocio_id, turno_id);
CREATE INDEX idx_kardex_negocio               ON kardex_inventario(negocio_id);
CREATE INDEX idx_cuentas_cobrar_negocio       ON cuentas_cobrar(negocio_id);
CREATE INDEX idx_secuencias_negocio           ON secuencias_comprobantes(negocio_id);
CREATE INDEX idx_notas_negocio                ON notas(negocio_id);

-- Compuestos para patrones de acceso frecuentes (reportes, operaciones, filtros)
CREATE INDEX idx_ventas_negocio_fecha_desc    ON ventas(negocio_id, fecha DESC);  -- listados recientes
CREATE INDEX idx_ventas_negocio_estado        ON ventas(negocio_id, estado);
CREATE INDEX idx_ventas_negocio_metodo        ON ventas(negocio_id, metodo_pago);
CREATE INDEX idx_ventas_negocio_estado_pago   ON ventas(negocio_id, estado_pago);
CREATE INDEX idx_operaciones_negocio_caja     ON operaciones_cajas(negocio_id, caja_id);
CREATE INDEX idx_operaciones_negocio_caja_f   ON operaciones_cajas(negocio_id, caja_id, fecha DESC);  -- historial por caja
CREATE INDEX idx_operaciones_negocio_empl     ON operaciones_cajas(negocio_id, empleado_id);
CREATE INDEX idx_kardex_negocio_producto      ON kardex_inventario(negocio_id, producto_id);
CREATE INDEX idx_mov_empl_negocio_empl_est    ON movimientos_empleados(negocio_id, empleado_id, estado_liquidacion);  -- saldo por empleado
CREATE INDEX idx_recargas_virt_negocio_pagado ON recargas_virtuales(negocio_id, pagado);
CREATE INDEX idx_productos_negocio_categoria  ON productos(negocio_id, categoria_id);
CREATE INDEX idx_productos_negocio_nombre     ON productos(negocio_id, LOWER(nombre));  -- busqueda case-insensitive
CREATE INDEX idx_productos_negocio_barcode_nn ON productos(negocio_id, codigo_barras) WHERE codigo_barras IS NOT NULL;  -- parcial: solo productos con barcode
CREATE INDEX idx_turnos_negocio_empleado      ON turnos_caja(negocio_id, empleado_id);

-- Tabla puente usuario-negocio
CREATE INDEX idx_usuario_negocios_usuario     ON usuario_negocios(usuario_id);
CREATE INDEX idx_usuario_negocios_negocio     ON usuario_negocios(negocio_id);
CREATE INDEX idx_usuario_negocios_lookup      ON usuario_negocios(usuario_id, negocio_id, activo);
```

---

## 10. Funciones SQL — estrategia `auth.negocio_id()` (sin parametro explicito)

### Decision

Las funciones `SECURITY DEFINER` leen `auth.negocio_id()` internamente en vez de recibir `p_negocio_id` como parametro.

**Ventajas:**
- Imposibilita que el frontend envie un `negocio_id` incorrecto.
- Reduce la superficie de API.
- Consistencia con las RLS policies (misma fuente de verdad).

**Excepcion:** `fn_crear_negocio` recibe `p_nombre` y `p_slug` porque crea un negocio nuevo que aun no existe en el JWT.

### Lista de funciones afectadas

| Funcion | Cambio |
|---------|--------|
| `fn_crear_producto_simple` | INSERT en `productos` usa `auth.negocio_id()` como `negocio_id` |
| `fn_crear_producto_con_variantes` | INSERT en `producto_templates` y `productos` usa `auth.negocio_id()` |
| `fn_ajustar_stock_inventario` | Validar que el producto pertenece a `auth.negocio_id()` |
| `fn_registrar_venta_pos` | INSERTs en `ventas`. Lookup de `secuencias_comprobantes` filtrado |
| `fn_anular_venta` | Validar que la venta pertenece a `auth.negocio_id()` |
| `fn_abrir_turno` | INSERT en `turnos_caja` con `auth.negocio_id()` |
| `fn_ejecutar_cierre_diario` | Lookups de `cajas` filtrados por `auth.negocio_id()` |
| `fn_reparar_deficit_turno` | Idem |
| `fn_registrar_operacion_manual` | Idem |
| `fn_crear_transferencia` | Idem |
| `fn_verificar_transferencia_caja_chica_hoy` | Idem |
| `fn_registrar_recarga_proveedor_celular` | INSERT con `auth.negocio_id()` |
| `fn_registrar_pago_proveedor_celular` | Idem |
| `fn_registrar_compra_saldo_bus` | Idem |
| `fn_liquidar_ganancias_bus` | Idem |
| `fn_registrar_pago_fiado` | Idem |
| `fn_listar_cuentas_cobrar` | WHERE filtrado por `auth.negocio_id()` |
| `fn_resumir_cuentas_cobrar` | Idem |
| `fn_listar_ventas` | Idem |
| `fn_resumir_ventas` | Idem |
| `fn_reporte_ventas_periodo` | Idem |
| `fn_registrar_adelanto_sueldo` | INSERT con `auth.negocio_id()` |
| `fn_pagar_nomina_empleado` | Idem |
| `fn_eliminar_nota` | Validar que la nota pertenece a `auth.negocio_id()` |

**Funciones sin cambio:**
- `fn_generar_codigo_interno` — trigger, sequence global, sin `negocio_id`
- `fn_generar_codigo_interno_presentacion` — idem

---

## 10b. Invariante: `movimientos_empleados` es un ledger inmutable

Los movimientos de nómina funcionan como un libro contable: solo se insertan, nunca se modifican ni eliminan. Si hay un error, se corrige con un movimiento nuevo (`AJUSTE_ABONO` o `AJUSTE_CARGO`).

La unica excepcion es el campo `estado_liquidacion` que cambia de `PENDIENTE` a `LIQUIDADO` cuando se paga la nomina, y `liquidado_en` que apunta al `PAGO_NOMINA` que lo liquido.

```sql
-- Trigger: whitelist — SOLO permite modificar estado_liquidacion y liquidado_en.
-- Todo lo demas es inmutable despues del INSERT.
-- Logica invertida: en vez de listar campos bloqueados (y arriesgarse a olvidar uno),
-- verificamos que SOLO los campos permitidos hayan cambiado.
CREATE OR REPLACE FUNCTION fn_proteger_movimiento_empleado()
RETURNS TRIGGER AS $$
BEGIN
    -- Verificar si ALGO ademas de los campos permitidos cambio
    IF ROW(NEW.id, NEW.empleado_id, NEW.fecha, NEW.tipo_movimiento, NEW.monto,
           NEW.turno_id, NEW.descripcion, NEW.creado_por, NEW.negocio_id, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.empleado_id, OLD.fecha, OLD.tipo_movimiento, OLD.monto,
           OLD.turno_id, OLD.descripcion, OLD.creado_por, OLD.negocio_id, OLD.created_at)
    THEN
        RAISE EXCEPTION 'Los movimientos de empleados son inmutables. Solo se permite cambiar estado_liquidacion y liquidado_en. Para corregir montos o tipos, crear un movimiento de ajuste.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_movimiento_empleado
    BEFORE UPDATE ON movimientos_empleados
    FOR EACH ROW
    EXECUTE FUNCTION fn_proteger_movimiento_empleado();

-- DELETE tambien bloqueado: un ledger contable nunca borra registros.
CREATE OR REPLACE FUNCTION fn_bloquear_delete_movimiento()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'No se pueden eliminar movimientos de empleados. Para corregir, crear un movimiento de ajuste.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bloquear_delete_movimiento
    BEFORE DELETE ON movimientos_empleados
    FOR EACH ROW
    EXECUTE FUNCTION fn_bloquear_delete_movimiento();
```

**Whitelist vs blacklist:**
- Blacklist (listar campos bloqueados) es peligroso — si se agrega una columna nueva a la tabla y se olvida agregarla al trigger, queda modificable.
- Whitelist (comparar todo MENOS los campos permitidos) es seguro — cualquier columna nueva queda automaticamente protegida. Solo `estado_liquidacion` y `liquidado_en` pueden cambiar.

---

## 10c. CHECK constraints de integridad de saldos

### `productos.stock_actual >= 0`

Safety net contra bugs en triggers de stock. Hoy el trigger `fn_actualizar_stock_venta` hace `RAISE EXCEPTION` si stock insuficiente, pero un bug en otra funcion podria dejar stock negativo.

```sql
ALTER TABLE productos ADD CONSTRAINT chk_stock_no_negativo CHECK (stock_actual >= 0);
```

### `cajas.saldo_actual` — sin CHECK

Las cajas pueden tener saldo negativo temporalmente (ej: egreso cuando caja esta en $0 al inicio del dia). El trigger de ventas ya usa `FOR UPDATE` para evitar race conditions. El CHECK no aplica aqui.

### Reconciliacion de saldos — deuda tecnica documentada

No se implementa en este refactor, pero es obligatorio antes de escalar a >10 tenants:

```sql
-- fn_reconciliar_saldos() — 1 query liviana, ejecutar como cron diario
-- Compara SUM(operaciones_cajas) vs cajas.saldo_actual por negocio
-- Si diferencia > 0.01, inserta alerta en tabla de auditoria
-- Mismo patron para productos: SUM(kardex) vs stock_actual
```

**Criterio de activacion:** implementar cuando haya el primer caso real de drift o cuando se superen 5 tenants activos.

---

## 10d. `updated_at` en tablas maestras

Trigger generico para tablas que se editan frecuentemente. Util para debugging multi-tenant y cache invalidation.

```sql
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Tablas que reciben `updated_at TIMESTAMPTZ DEFAULT NOW()`:**

| Tabla | Motivo |
|-------|--------|
| `productos` | Edicion frecuente (precios, stock, nombre) |
| `clientes` | Edicion de datos de contacto |
| `cajas` | Saldo cambia con cada operacion |
| `configuraciones` | Cambios de parametros de negocio |
| `usuario_negocios` | Cambios de rol/activo |

Cada tabla recibe su propio trigger:

```sql
CREATE TRIGGER trg_updated_at_productos
    BEFORE UPDATE ON productos FOR EACH ROW
    EXECUTE FUNCTION fn_set_updated_at();
-- Idem para clientes, cajas, configuraciones, usuario_negocios
```

---

## 10e. Invariante: `operaciones_cajas` es un ledger inmutable

Misma logica que `movimientos_empleados` (seccion 10b). Las operaciones de caja son registros contables — los campos financieros nunca se modifican. Solo `descripcion` y `comprobante_url` son editables (corregir typos, adjuntar comprobante despues del hecho).

```sql
-- Trigger: whitelist — SOLO permite modificar descripcion y comprobante_url.
-- Todos los campos financieros (monto, saldo_anterior, saldo_actual, tipo_operacion, etc.)
-- son inmutables despues del INSERT.
CREATE OR REPLACE FUNCTION fn_proteger_operacion_caja()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'No se pueden eliminar operaciones de caja. Para corregir, registrar una operacion inversa.';
    END IF;

    -- Whitelist: verificar que SOLO los campos permitidos hayan cambiado
    IF ROW(NEW.id, NEW.fecha, NEW.caja_id, NEW.empleado_id, NEW.tipo_operacion,
           NEW.monto, NEW.saldo_anterior, NEW.saldo_actual, NEW.categoria_id,
           NEW.tipo_referencia_id, NEW.referencia_id, NEW.negocio_id)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.fecha, OLD.caja_id, OLD.empleado_id, OLD.tipo_operacion,
           OLD.monto, OLD.saldo_anterior, OLD.saldo_actual, OLD.categoria_id,
           OLD.tipo_referencia_id, OLD.referencia_id, OLD.negocio_id)
    THEN
        RAISE EXCEPTION 'Las operaciones de caja son inmutables. Solo se permite editar descripcion y comprobante_url. Para corregir montos, registrar una operacion inversa.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_operacion_caja
    BEFORE UPDATE ON operaciones_cajas
    FOR EACH ROW
    EXECUTE FUNCTION fn_proteger_operacion_caja();

CREATE TRIGGER trg_bloquear_delete_operacion_caja
    BEFORE DELETE ON operaciones_cajas
    FOR EACH ROW
    EXECUTE FUNCTION fn_proteger_operacion_caja();
```

---

## 10f. `ON DELETE CASCADE` desde `negocios` — politica de borrado de tenant

Todas las tablas del Grupo A que tengan `negocio_id` usan `REFERENCES negocios(id) ON DELETE CASCADE`. Si se borra un negocio, todos sus datos se eliminan en cascada.

```sql
-- Ejemplo (aplica a las 21 tablas del Grupo A):
negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE
```

**Tablas del Grupo B** (pivots sin `negocio_id`) ya heredan el CASCADE de sus tablas padre:
- `producto_atributos` → CASCADE via `productos.id`
- `ventas_detalles` → CASCADE via `ventas.id`
- etc.

**Nota:** el borrado de negocio es una operacion extrema (solo superadmin). Se documenta como operacion destructiva que requiere confirmacion multiple en el frontend.

---

## 11. Triggers — cambios requeridos

| Trigger / Funcion | Cambio |
|-------------------|--------|
| `fn_limpiar_herencia_template` | **NUEVO** — limpia `categoria_id`/`tipo_venta`/`unidad_medida` en variantes (ver seccion 6) |
| `fn_sync_codigo_barras` | **NUEVO** — sincroniza codigos a tabla centralizada `codigos_barras` (ver seccion 6b) |
| `fn_sync_superadmin_to_jwt` | **NUEVO** — sincroniza `es_superadmin` a `app_metadata` del JWT (ver seccion 8.2) |
| `fn_sync_rol_to_jwt` | **NUEVO** — sincroniza `rol` a `app_metadata` del JWT cuando un ADMIN cambia el rol (ver seccion 8.2) |
| `fn_proteger_movimiento_empleado` | **NUEVO** — whitelist: solo permite UPDATE de `estado_liquidacion` y `liquidado_en` (ver seccion 10b) |
| `fn_bloquear_delete_movimiento` | **NUEVO** — bloquea DELETE en movimientos_empleados (ledger inmutable) |
| `fn_proteger_operacion_caja` | **NUEVO** — bloquea UPDATE y DELETE en operaciones_cajas (ledger inmutable, ver seccion 10e) |
| `fn_set_updated_at` | **NUEVO** — trigger generico de `updated_at` para tablas maestras (ver seccion 10d) |
| `fn_actualizar_stock_venta` | `negocio_id` del INSERT en `kardex_inventario` se obtiene de `(SELECT negocio_id FROM productos WHERE id = NEW.producto_id)` |
| `fn_actualizar_saldo_caja_venta` | Lookups de `cajas` y `categorias_operaciones` filtrados por `negocio_id` (obtenerlo de `ventas.negocio_id` via NEW, ya que ventas tiene negocio_id directo) |
| `fn_set_codigo_categoria_operacion` | Secuencia de codigos (`EG-001`) por negocio: `WHERE codigo LIKE ... AND negocio_id = NEW.negocio_id`. Agregar `pg_advisory_xact_lock(hashtext(NEW.negocio_id::text))` antes del MAX para evitar race condition en INSERTs concurrentes |
| `fn_generar_codigo_interno` | Sin cambio — sequence global, EAN-13 unicos universalmente |
| `fn_generar_codigo_interno_presentacion` | Sin cambio |

---

## 12. Datos seed — `fn_crear_negocio`

Los datos iniciales ya no se insertan globalmente en `schema.sql`. Se insertan al crear un negocio nuevo via funcion atomica:

```sql
-- fn_crear_negocio(p_nombre TEXT, p_slug TEXT, p_email_admin TEXT)
-- Crea un negocio completo con toda su configuracion base.
-- Atomica: si algo falla, no se persiste nada.
--
-- Pasos:
--   1. INSERT en negocios
--   2. Buscar/crear usuario por email
--   3. INSERT en usuario_negocios (rol ADMIN)
--   4. INSERT en cajas (5 cajas con negocio_id, saldo $0)
--   5. INSERT en configuraciones (10 claves default con negocio_id)
--   6. INSERT en categorias_operaciones (19 categorias con negocio_id)
--   7. INSERT en secuencias_comprobantes (3 contadores con negocio_id)
--   8. INSERT en categorias_productos (7 categorias default con negocio_id)
--   9. INSERT en clientes (CONSUMIDOR FINAL con negocio_id)
--  10. Setear app_metadata.negocio_id en auth.users
--
-- Retorna: { ok: true, negocio_id: UUID }
```

Los seeds del `schema.sql` actual se conservan como documentacion/referencia de los valores default, pero ya no se ejecutan directamente.

---

## 13. Vistas — cambios requeridos

### `v_saldos_empleados`

```sql
-- security_barrier evita que PostgreSQL reordene predicados y exponga datos de otro tenant
CREATE OR REPLACE VIEW v_saldos_empleados WITH (security_barrier=true) AS
SELECT
    un.negocio_id,
    u.id AS empleado_id,
    u.nombre,
    COALESCE(SUM(
        CASE
            WHEN m.tipo_movimiento IN ('SUELDO_BASE', 'BONO_COMISION', 'AJUSTE_ABONO') THEN m.monto
            WHEN m.tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'PAGO_NOMINA', 'AJUSTE_CARGO') THEN -m.monto
        END
    ), 0) AS saldo
FROM usuarios u
INNER JOIN usuario_negocios un ON un.usuario_id = u.id AND un.activo = TRUE
LEFT JOIN movimientos_empleados m
    ON m.empleado_id = u.id
    AND m.negocio_id = un.negocio_id
    AND m.estado_liquidacion = 'PENDIENTE'
GROUP BY un.negocio_id, u.id, u.nombre;
```

### `v_productos_completos` (nueva — ver seccion 6)

```sql
-- security_barrier en vistas que cruzan tablas con datos de multiples tenants
CREATE OR REPLACE VIEW v_productos_completos WITH (security_barrier=true) AS
...
```

---

## 14. Estrategia de migracion — paso a paso

### Contexto

No hay datos en produccion. El schema actual es de desarrollo. Esto simplifica la migracion: se puede reescribir el `schema.sql` desde cero sin backfill.

### Fases de ejecucion

#### Fase 1: Infraestructura base (sin romper nada existente)

1. Crear tabla `negocios`
2. Crear funcion `auth.negocio_id()`
3. Crear funcion `auth.es_superadmin()`

#### Fase 2: PKs a UUID (breaking change controlado)

4. Recrear tabla `usuarios` con `id UUID`, renombrar `usuario` → `email` (eliminar `rol`, `activo`)
5. Recrear `cajas` con `id UUID`
6. Recrear `categorias_operaciones` con `id UUID`
7. Recrear `categorias_productos` con `id UUID`
8. Crear tabla `usuario_negocios`

> A partir de aqui, todas las FKs a estas tablas deben ser UUID.

#### Fase 3: Agregar `negocio_id` a tablas existentes

9. Recrear `configuraciones` con PK compuesta `(negocio_id, clave)`
10. Recrear `secuencias_comprobantes` con PK compuesta `(negocio_id, tipo_documento)`
11. Agregar `negocio_id NOT NULL REFERENCES negocios(id) ON DELETE CASCADE` a las 19 tablas restantes del Grupo A
12. Actualizar todos los constraints UNIQUE a scope por negocio
13. Agregar `updated_at` a tablas maestras (productos, clientes, cajas, configuraciones, usuario_negocios)

#### Fase 4: Integridad de datos

14. Agregar constraint `chk_herencia_template` en `productos`
15. Agregar constraint `chk_stock_no_negativo` en `productos`
16. Crear trigger `fn_limpiar_herencia_template`
17. Crear tabla `codigos_barras` (vacia, sin triggers aun)
17b. Backfill `codigos_barras` con INSERT...SELECT desde `productos` y `presentaciones` existentes
17c. Crear triggers `fn_sync_codigo_barras` en `productos` y `presentaciones` (DESPUES del backfill para no duplicar inserts)
18. Crear triggers de ledger inmutable: `fn_proteger_movimiento_empleado` + `fn_proteger_operacion_caja`
19. Crear trigger generico `fn_set_updated_at` para tablas maestras

#### Fase 5: Seguridad

20. Actualizar todas las RLS policies (patron `tenant_or_superadmin`)
21. Crear funcion `auth.comparten_negocio()` (helper SECURITY DEFINER para policy de `usuarios`)
22. Crear funcion `fn_set_negocio_activo`
23. Crear triggers `fn_sync_superadmin_to_jwt` y `fn_sync_rol_to_jwt`

#### Fase 6: Funciones SQL y triggers

24. Actualizar los 3 triggers existentes
25. Actualizar las 24 funciones SQL para usar `auth.negocio_id()`

#### Fase 7: Seeds y vistas

26. Crear `fn_crear_negocio` (seed automatico)
27. Crear vistas `v_productos_completos` y `v_saldos_empleados` (ambas con `security_barrier=true`)
28. Crear indices multi-tenant

#### Fase 8: Validacion

29. Ejecutar `fn_crear_negocio` con datos del negocio actual ('Panaderia Don Viche')
30. Verificar que todas las RLS policies funcionan (tenant isolation + superadmin bypass)
31. Verificar que `auth.comparten_negocio()` filtra correctamente en policy de `usuarios`
32. Verificar que `fn_set_negocio_activo` actualiza el JWT correctamente
33. Verificar que las funciones SQL leen `auth.negocio_id()` correctamente
34. Verificar que el constraint `chk_herencia_template` rechaza datos invalidos
35. Verificar que `chk_stock_no_negativo` rechaza stock negativo
36. Verificar que `codigos_barras` rechaza codigos duplicados cross-table (incluido cross-tipo)
37. Verificar que `fn_sync_superadmin_to_jwt` sincroniza el flag al JWT
38. Verificar que `fn_proteger_movimiento_empleado` bloquea UPDATE de campos contables
39. Verificar que `fn_proteger_operacion_caja` bloquea UPDATE/DELETE de campos financieros

### Orden de archivos SQL a ejecutar

```
1. docs/schema.sql                              (schema completo reescrito)
2. docs/auth/sql/setup/rls_usuarios.sql         (policies usuarios)
3. docs/dashboard/sql/setup/rls_tablas.sql      (policies todas las tablas)
4. docs/setup/fn_crear_negocio.sql              (seed por tenant)
5. docs/setup/fn_set_negocio_activo.sql         (cambio de tenant)
6. docs/inventario/sql/functions/*.sql           (funciones inventario)
7. docs/dashboard/sql/functions/*.sql            (funciones dashboard)
8. docs/pos/sql/functions/*.sql                  (funciones POS)
9. docs/recargas-virtuales/sql/functions/*.sql   (funciones recargas)
10. docs/cuentas-cobrar/sql/functions/*.sql      (funciones cuentas)
11. docs/ventas/sql/functions/*.sql              (funciones ventas)
12. docs/movimientos-empleados/sql/functions/*.sql (funciones nomina)
13. docs/notas/sql/functions/*.sql               (funciones notas)
14. docs/auth/sql/setup/realtime_usuarios.sql    (realtime)
15. docs/configuracion/sql/setup/realtime_configuraciones.sql
16. docs/dashboard/sql/setup/realtime_turnos_caja.sql
```

---

## 15. Resumen de archivos SQL afectados

### Schema principal
- `docs/schema.sql` — reescritura completa

### Funciones SQL (24 archivos con cambios + 2 sin cambio)
- `docs/inventario/sql/functions/fn_crear_producto_simple.sql`
- `docs/inventario/sql/functions/fn_crear_producto_con_variantes.sql`
- `docs/inventario/sql/functions/fn_ajustar_stock_inventario.sql`
- `docs/inventario/sql/functions/fn_generar_codigo_interno.sql` — sin cambio
- `docs/inventario/sql/functions/fn_generar_codigo_interno_presentacion.sql` — sin cambio
- `docs/dashboard/sql/functions/fn_abrir_turno.sql`
- `docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql`
- `docs/dashboard/sql/functions/fn_reparar_deficit_turno.sql`
- `docs/dashboard/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql`
- `docs/dashboard/sql/functions/fn_registrar_operacion_manual.sql`
- `docs/dashboard/sql/functions/fn_crear_transferencia.sql`
- `docs/recargas-virtuales/sql/functions/fn_registrar_recarga_proveedor_celular.sql`
- `docs/recargas-virtuales/sql/functions/fn_registrar_pago_proveedor_celular.sql`
- `docs/recargas-virtuales/sql/functions/fn_registrar_compra_saldo_bus.sql`
- `docs/recargas-virtuales/sql/functions/fn_liquidar_ganancias_bus.sql`
- `docs/pos/sql/functions/fn_registrar_venta_pos.sql`
- `docs/pos/sql/functions/fn_anular_venta.sql`
- `docs/cuentas-cobrar/sql/functions/fn_registrar_pago_fiado.sql`
- `docs/cuentas-cobrar/sql/functions/fn_listar_cuentas_cobrar.sql`
- `docs/cuentas-cobrar/sql/functions/fn_resumir_cuentas_cobrar.sql`
- `docs/ventas/sql/functions/fn_listar_ventas.sql`
- `docs/ventas/sql/functions/fn_resumir_ventas.sql`
- `docs/ventas/sql/functions/fn_reporte_ventas_periodo.sql`
- `docs/movimientos-empleados/sql/functions/fn_registrar_adelanto_sueldo.sql`
- `docs/movimientos-empleados/sql/functions/fn_pagar_nomina_empleado.sql`
- `docs/notas/sql/functions/fn_eliminar_nota.sql`

### RLS
- `docs/dashboard/sql/setup/rls_tablas.sql` — reescribir con patron `tenant_or_superadmin`
- `docs/auth/sql/setup/rls_usuarios.sql` — reescribir para multi-tenant

### Funciones nuevas
- `docs/setup/fn_crear_negocio.sql` — seed automatico al crear tenant
- `docs/setup/fn_set_negocio_activo.sql` — cambio de tenant activo en JWT
- `auth.comparten_negocio()` — helper SECURITY DEFINER para policy de `usuarios` (definida en schema.sql o en rls_usuarios.sql)

---

## 16. Riesgos y mitigaciones

| Riesgo | Severidad | Mitigacion |
|--------|-----------|------------|
| 4 tablas SERIAL → UUID rompe todas sus FKs | Alta | No hay datos en produccion. Reescribir schema desde cero |
| JWT con `negocio_id` stale despues de cambio de negocio | Alta | `fn_set_negocio_activo` + `refreshSession()` obligatorio. Sesion sin negocio = 0 datos (seguro por defecto) |
| `es_superadmin` en JWT puede estar stale si se cambia en BD | Baja | Trigger `fn_sync_superadmin_to_jwt` sincroniza automaticamente. El usuario necesita `refreshSession()` — aceptable porque cambiar superadmin ocurre una vez en la vida |
| RLS con EXISTS en tablas pivot (JOINs) | Baja | Las tablas pivot son pequenas. Indices en FK garantizan performance. Monitorear con `EXPLAIN ANALYZE` |
| Funciones `SECURITY DEFINER` bypasean RLS | N/A | Correcto y necesario. Validan internamente con `auth.negocio_id()` |
| Sequence global `seq_codigo_interno_producto` | Nula | EAN-13 unicos por sequence. Dos negocios nunca generan el mismo codigo |
| Trigger `fn_limpiar_herencia_template` + constraint `chk_herencia_template` | Baja | El trigger se ejecuta BEFORE (limpia), el constraint valida despues. Sin conflicto |
| Sync trigger de codigos de barras agrega overhead en INSERT/UPDATE | Baja | Solo se ejecuta cuando hay codigo de barras (no NULL). UNIQUE constraint atomico — sin race condition |
| Renombrar `usuario` → `email` rompe frontend | Alta | Breaking change controlado. Requiere actualizar todos los `.ts` que referencian `usuario`. Incluido en el plan de frontend (fuera de scope de este documento) |
| Ledger inmutable bloquea correccion manual directa | Intencional | Los movimientos/operaciones erroneos se corrigen con movimientos inversos. Esto es la practica contable correcta |

---

## 17. Politica de soft delete

Las tablas con datos historicos referenciados por FKs (productos, clientes, categorias) usan `activo BOOLEAN` para desactivacion logica. **Nunca se hace DELETE fisico** en estas tablas porque:
- `ventas_detalles` referencia `productos.id` — borrar un producto rompe el historial de ventas.
- `ventas` referencia `clientes.id` — borrar un cliente rompe el historial.
- `operaciones_cajas` referencia `categorias_operaciones.id` — idem.

**Regla:** para "eliminar" un registro que tiene FKs historicas, marcar `activo = FALSE`. Solo se permite DELETE fisico en tablas sin referencias historicas (notas, atributo_opciones sin uso).

---

## 18. Script de migracion para datos existentes (Panaderia Don Viche)

Aunque el plan asume base en desarrollo, los datos actuales de Panaderia Don Viche deben migrarse. Orden del script:

```sql
-- 1. Crear negocio
INSERT INTO negocios (id, nombre, slug) VALUES (uuid_generate_v4(), 'Panaderia Don Viche', 'panaderia-don-viche')
RETURNING id;  -- guardar como v_negocio_id

-- 2. Migrar usuarios: SERIAL → UUID (recrear tabla)
-- 3. Crear usuario_negocios para Ivan (rol ADMIN)

-- 4. UPDATE masivo: setear negocio_id en todas las tablas Grupo A
-- (cajas, configuraciones, categorias_*, turnos, ventas, productos, etc.)
UPDATE cajas SET negocio_id = v_negocio_id;
UPDATE productos SET negocio_id = v_negocio_id;
-- ... idem para las 21 tablas

-- 5. Backfill codigos_barras desde productos y presentaciones existentes
INSERT INTO codigos_barras (negocio_id, codigo, tipo, producto_id)
SELECT v_negocio_id, codigo_barras, 'PRODUCTO', id
FROM productos WHERE codigo_barras IS NOT NULL;

INSERT INTO codigos_barras (negocio_id, codigo, tipo, producto_id, presentacion_id)
SELECT v_negocio_id, pp.codigo_barras, 'PRESENTACION', pp.producto_id, pp.id
FROM producto_presentaciones pp WHERE pp.codigo_barras IS NOT NULL;

-- 6. Setear app_metadata en auth.users para Ivan
-- 7. Activar triggers y constraints
-- 8. Verificar integridad
```

> **Nota:** este script se generara completo al implementar. Aqui se documenta el orden critico para no perder integridad referencial.

---

## 19. Lo que NO cambia

- Estructura del modelo template → SKU → presentaciones.
- Enums (`tipo_operacion_caja_enum`, `rol_usuario_enum`, etc.) — globales del sistema. No se convierten a tablas lookup (estables, ALTER TYPE ADD VALUE no bloquea en PG 12+).
- `tipos_servicio` (SERIAL, Grupo C) y `tipos_referencia` — catalogos globales inmutables.
- Logica de las 5 cajas y flujo de dinero (solo se scopa por negocio).
- Trigger de generacion de codigo de barras interno (sequence global).
- Logica de POS, ventas, recargas — solo se agrega filtro por tenant.
- Particionamiento — no se implementa. Con <100 tenants y ~36K ventas/año por tienda, PostgreSQL maneja bien sin particiones. Se evalua como mejora futura si se llega a millones de registros. Se coloca `negocio_id` como primera columna en PKs compuestas y UNIQUE para facilitar migracion futura a PARTITION BY HASH.
- Timezone `America/Guayaquil` en indice de `turnos_caja` — correcto para operacion en Ecuador. Si se expande a otras zonas, se resuelve con columna `timezone` en `negocios`.
