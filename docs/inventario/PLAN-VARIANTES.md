# Plan de Implementacion — Variantes de Producto

> **Estado:** Pendiente de aprobacion
> **Fecha:** 2026-04-19
> **Complejidad:** Media (BD + frontend inventario, POS sin cambios de logica)
> **Enfoque:** Tabla normalizada `grupos_variantes` + FK en `productos`

---

## Problema

Productos como "Tapioca" tienen multiples sabores (Fresa, Chocolate, Maracuya), cada uno con:
- Codigo de barras propio
- Stock independiente
- Posiblemente precio diferente

El workaround actual (un producto independiente por sabor) funciona pero:
- Infla la lista de inventario
- No hay relacion visual entre sabores del mismo producto
- Imposible ver "Tapioca: 3 sabores, 72 unidades en total"

### Variantes vs Presentaciones — por que son cosas distintas

| | Presentaciones | Variantes |
|---|---|---|
| Ejemplo | Cigarro suelto vs cajetilla x10 | Tapioca Fresa vs Tapioca Chocolate |
| Stock | **Compartido** (unidad base) | **Independiente** por variante |
| Codigo de barras | Uno por presentacion | Uno por variante |
| Relacion fisica | Es el mismo producto | Son productos fisicamente distintos |
| Tabla actual | `producto_presentaciones` | **Nueva:** `grupos_variantes` |

**Las presentaciones se mantienen sin cambios.** Una variante PUEDE tener sus propias presentaciones (ej: Tapioca Fresa en pack x6). El modelo lo soporta nativamente porque cada variante es un producto completo.

---

## Arquitectura: tabla normalizada `grupos_variantes`

### Por que tabla separada y no un VARCHAR suelto

1. **Integridad referencial** — FK real en `productos.grupo_variante_id`, no un string que alguien puede escribir mal
2. **Metadata del grupo** — nombre, imagen representativa, fecha de creacion. Extensible sin ALTER TABLE
3. **Queries eficientes** — `WHERE grupo_variante_id = UUID` con indice, no `GROUP BY` sobre VARCHAR
4. **Escalabilidad SaaS** — si la app escala a multi-tenant, el grupo es una entidad de primera clase con su propio ID, permisos y audit trail
5. **CRUD limpio** — crear, renombrar, eliminar grupos sin riesgo de inconsistencias por typos

### Modelo de datos

```
grupos_variantes:
  id: uuid-A | nombre: "TAPIOCA"

productos:
  id: uuid-001 | nombre: "Tapioca Fresa"      | grupo_variante_id: uuid-A | stock: 24 | precio: 1.50
  id: uuid-002 | nombre: "Tapioca Chocolate"   | grupo_variante_id: uuid-A | stock: 18 | precio: 1.50
  id: uuid-003 | nombre: "Tapioca Maracuya"    | grupo_variante_id: uuid-A | stock: 30 | precio: 1.75
  id: uuid-004 | nombre: "Coca Cola 500ml"     | grupo_variante_id: NULL   | stock: 50 | precio: 1.00
```

### Principio clave: cada variante ES un producto completo

La tabla `grupos_variantes` es **solo agrupacion**. No cambia como funciona el stock, las ventas, el kardex ni el POS. Cada variante:
- Tiene su propio `id` en `productos`
- Tiene su propio stock, precio, codigo de barras, imagen
- Puede tener sus propias presentaciones
- Se vende, se anula, se ajusta exactamente igual que cualquier producto

---

## Cambios requeridos

### 1. Base de datos

#### 1a. Nueva tabla `grupos_variantes` — `schema.sql`

```sql
-- Antes de la tabla productos (por dependencia FK)
CREATE TABLE IF NOT EXISTS grupos_variantes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Garantiza que el nombre siempre este normalizado a nivel de BD
    -- independientemente de si el INSERT viene del frontend, una migracion o SQL directo
    CONSTRAINT grupos_variantes_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre)))
);
```

#### 1b. Nueva columna FK en `productos` — `schema.sql`

```sql
-- En la tabla productos, agregar despues de unidad_medida:
grupo_variante_id  UUID REFERENCES grupos_variantes(id) ON DELETE SET NULL
```

`ON DELETE SET NULL`: si se elimina un grupo, los productos quedan sueltos (no se borran). Esto es seguro — el producto no pierde datos, solo la agrupacion visual.

#### 1c. Indices

```sql
CREATE INDEX IF NOT EXISTS idx_productos_grupo_variante
    ON productos(grupo_variante_id) WHERE grupo_variante_id IS NOT NULL;
```

#### 1d. Limpieza en `schema.sql` — seccion DROP

Agregar al inicio del schema (antes de productos, despues de producto_presentaciones):

```sql
DROP TABLE IF EXISTS grupos_variantes CASCADE;
```

> **Nota:** como `productos` tiene FK a `grupos_variantes`, el DROP CASCADE de `productos` ya elimina la FK. Pero `grupos_variantes` debe dropearse explicitamente si existe como tabla independiente.

#### 1e. Script de migracion (Supabase SQL Editor)

```sql
-- Ejecutar UNA VEZ en BD existente
CREATE TABLE IF NOT EXISTS grupos_variantes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT grupos_variantes_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre)))
);

ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS grupo_variante_id UUID REFERENCES grupos_variantes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_productos_grupo_variante
    ON productos(grupo_variante_id) WHERE grupo_variante_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

---

### 2. Modelo TypeScript — `producto.model.ts`

#### 2a. Nuevo interface para el grupo

```typescript
export interface GrupoVariante {
    id: string;
    nombre: string;
    created_at?: string;
}
```

#### 2b. Agregar campo al interface `Producto`

```typescript
export interface Producto {
    // ... campos existentes ...

    // Variantes
    grupo_variante_id?: string;
    grupo_variante?: GrupoVariante;  // JOIN opcional (como categoria)
}
```

#### 2c. Agregar al type `ProductoPOS`

```typescript
export type ProductoPOS = Pick<Producto,
    'id' | 'nombre' | 'codigo_barras' | 'precio_venta' |
    'stock_actual' | 'stock_minimo' | 'imagen_url' | 'tiene_iva' |
    'tipo_venta' | 'unidad_medida' | 'grupo_variante_id'
> & {
    presentaciones?: ProductoPresentacion[];
};
```

---

### 3. Servicio — `inventario.service.ts`

#### 3a. Queries existentes: agregar JOIN a `grupos_variantes`

**`obtenerProductos()`** — agregar al SELECT:
```typescript
.select('*, categoria:categorias_productos(*), grupo_variante:grupos_variantes(*), presentaciones:producto_presentaciones(id)')
```

**`obtenerProductoPorId()`** — agregar al SELECT:
```typescript
.select('*, categoria:categorias_productos(*), grupo_variante:grupos_variantes(*), presentaciones:producto_presentaciones(id)')
```

**`buscarProductosPOS()`** — agregar `grupo_variante_id` al SELECT:
```typescript
.select(`
    id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo,
    imagen_url, tiene_iva, tipo_venta, unidad_medida, grupo_variante_id,
    presentaciones:producto_presentaciones(id, producto_id, nombre, factor_conversion, precio_venta, codigo_barras, es_principal, activo)
`)
```

**`buscarPorCodigoBarras()`** — agregar `grupo_variante_id` al SELECT del producto:
```typescript
.select('id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, grupo_variante_id')
```

#### 3b. Nuevos metodos para grupos

```typescript
// ==========================================
// GRUPOS DE VARIANTES
// ==========================================

async obtenerGruposVariantes(): Promise<GrupoVariante[]> {
    const { data } = await this.supabase.client
        .from('grupos_variantes')
        .select('*')
        .order('nombre');
    return data || [];
}

async buscarGruposVariantes(texto: string): Promise<GrupoVariante[]> {
    const { data } = await this.supabase.client
        .from('grupos_variantes')
        .select('*')
        .ilike('nombre', `%${texto}%`)
        .order('nombre')
        .limit(5);
    return data || [];
}

/**
 * Crea el grupo si no existe, o devuelve el existente si ya habia uno con ese nombre.
 * Nunca falla por duplicado — UX fluida: el usuario siempre obtiene el grupo correcto.
 *
 * Patron: INSERT ON CONFLICT DO NOTHING + SELECT
 * (DO UPDATE SET nombre = EXCLUDED.nombre tambien funciona pero hace un write
 * innecesario cuando ya existe; DO NOTHING + SELECT es mas limpio)
 */
async crearOObtenerGrupoVariante(nombre: string): Promise<GrupoVariante | null> {
    const nombreNorm = nombre.toUpperCase().trim();

    // Intentar insertar — falla silenciosamente si el nombre ya existe (UNIQUE constraint)
    await this.supabase.client
        .from('grupos_variantes')
        .insert({ nombre: nombreNorm })
        .onConflict('nombre')
        .ignoreDuplicates();

    // Siempre buscar el registro final (nuevo o pre-existente)
    const { data } = await this.supabase.client
        .from('grupos_variantes')
        .select('*')
        .eq('nombre', nombreNorm)
        .single();

    return data;
}

async renombrarGrupoVariante(id: string, nombre: string): Promise<void> {
    await this.supabase.call(
        this.supabase.client.from('grupos_variantes').update({ nombre: nombre.toUpperCase().trim() }).eq('id', id),
        'Grupo renombrado'
    );
}

async eliminarGrupoVariante(id: string): Promise<void> {
    // ON DELETE SET NULL: los productos quedan sueltos
    await this.supabase.call(
        this.supabase.client.from('grupos_variantes').delete().eq('id', id),
        'Grupo eliminado'
    );
}

async obtenerVariantesDelGrupo(grupoId: string, excluirProductoId?: string): Promise<Producto[]> {
    let query = this.supabase.client
        .from('productos')
        .select('id, nombre, stock_actual, precio_venta, codigo_barras, imagen_url')
        .eq('grupo_variante_id', grupoId)
        .eq('activo', true)
        .order('nombre');
    if (excluirProductoId) query = query.neq('id', excluirProductoId);
    const { data } = await query;
    return data || [];
}

async contarProductosPorGrupo(grupoId: string): Promise<number> {
    const { count } = await this.supabase.client
        .from('productos')
        .select('*', { count: 'exact', head: true })
        .eq('grupo_variante_id', grupoId)
        .eq('activo', true);
    return count || 0;
}
```

---

### 4. Formulario de producto — `producto-form.page.ts` + `.html`

#### 4a. Nuevo campo en el form

```typescript
// initForm() — agregar:
grupo_variante_id: [this.producto?.grupo_variante_id || null]
```

#### 4b. Estado del componente

```typescript
// Variantes
grupoVarianteSeleccionado: GrupoVariante | null = null;
variantesHermanas: Producto[] = [];
gruposSugeridos: GrupoVariante[] = [];
buscandoGrupos = false;
```

#### 4c. Logica

```typescript
// Al cargar producto en modo EDITAR: si tiene grupo, cargar hermanas
if (producto?.grupo_variante) {
    this.grupoVarianteSeleccionado = producto.grupo_variante;
    this.variantesHermanas = await this.inventarioService.obtenerVariantesDelGrupo(
        producto.grupo_variante.id, producto.id
    );
}

// Autocompletado de grupos existentes al escribir en el input
async buscarGrupos(texto: string) {
    if (!texto || texto.length < 2) { this.gruposSugeridos = []; return; }
    this.buscandoGrupos = true;
    this.gruposSugeridos = await this.inventarioService.buscarGruposVariantes(texto);
    this.buscandoGrupos = false;
}

// Seleccionar grupo existente
async seleccionarGrupo(grupo: GrupoVariante) {
    this.grupoVarianteSeleccionado = grupo;
    this.productoForm.patchValue({ grupo_variante_id: grupo.id });
    this.gruposSugeridos = [];
    // Cargar hermanas para preview
    this.variantesHermanas = await this.inventarioService.obtenerVariantesDelGrupo(
        grupo.id, this.producto?.id
    );
}

// Crear grupo nuevo al vuelo (o seleccionar el existente si ya habia uno con ese nombre)
async crearOSeleccionarGrupo(nombre: string) {
    const grupo = await this.inventarioService.crearOObtenerGrupoVariante(nombre);
    if (grupo) await this.seleccionarGrupo(grupo);
}

// Quitar del grupo
quitarDelGrupo() {
    this.grupoVarianteSeleccionado = null;
    this.variantesHermanas = [];
    this.productoForm.patchValue({ grupo_variante_id: null });
}
```

#### 4d. UI — seccion "Variantes"

Ubicacion: despues de la seccion de presentaciones, antes del boton guardar.

```html
<!-- ═══ VARIANTES ═══ -->
<div class="form-section">
    <div class="section-header">
        <ion-icon name="color-palette-outline"></ion-icon>
        <span>Grupo de variantes</span>
        <span class="section-hint">Opcional — agrupa sabores, colores, tallas</span>
    </div>

    @if (!grupoVarianteSeleccionado) {
        <!-- Input de busqueda/creacion de grupo -->
        <div class="grupo-search">
            <input type="text"
                placeholder="Buscar o crear grupo (ej: TAPIOCA)"
                appUppercase
                (input)="buscarGrupos($event.target.value)"
                class="form-input" />

            <!-- Sugerencias de grupos existentes -->
            @if (gruposSugeridos.length > 0) {
                <div class="grupo-sugerencias">
                    @for (grupo of gruposSugeridos; track grupo.id) {
                        <button class="grupo-sugerencia" (click)="seleccionarGrupo(grupo)">
                            {{ grupo.nombre }}
                        </button>
                    }
                </div>
            }

            <!-- Boton crear nuevo si no hay match -->
            <!-- Visible cuando el texto tiene 2+ chars y no coincide exactamente con ninguna sugerencia -->
        </div>
    } @else {
        <!-- Grupo seleccionado -->
        <div class="grupo-seleccionado">
            <div class="grupo-header">
                <ion-icon name="color-palette-outline"></ion-icon>
                <span class="grupo-nombre">{{ grupoVarianteSeleccionado.nombre }}</span>
                <button class="btn-quitar" (click)="quitarDelGrupo()">
                    <ion-icon name="close-outline"></ion-icon>
                </button>
            </div>

            <!-- Variantes hermanas (readonly) -->
            @if (variantesHermanas.length > 0) {
                <div class="variantes-hermanas">
                    <span class="hermanas-label">Otras variantes del grupo:</span>
                    @for (v of variantesHermanas; track v.id) {
                        <div class="variante-item">
                            <span class="variante-nombre">{{ v.nombre }}</span>
                            <span class="variante-stock">{{ v.stock_actual }} uds</span>
                            <span class="variante-precio">${{ currencyService.format(v.precio_venta) }}</span>
                        </div>
                    }
                </div>
            } @else if (modo === 'EDITAR') {
                <span class="hermanas-empty">Este es el unico producto en el grupo</span>
            }
        </div>
    }
</div>
```

#### 4e. Guardar — incluir `grupo_variante_id` en payload

```typescript
const productoPayload: Partial<Producto> = {
    ...value,
    grupo_variante_id: value.grupo_variante_id || null,
    // ... resto igual
};
```

---

### 5. Grid de inventario — `inventario.page.ts` + `.html`

#### 5a. Badge de grupo en la tarjeta

```html
@if (producto.grupo_variante) {
    <span class="variante-badge">
        <ion-icon name="color-palette-outline"></ion-icon>
        {{ producto.grupo_variante.nombre }}
    </span>
}
```

#### 5b. Registrar icono

Agregar `colorPaletteOutline` a `addIcons()` e importar de `ionicons/icons`.

#### 5c. Filtro por grupo (fase 2, opcional)

Agregar opcion en el selector de categorias: "Filtrar por grupo de variantes" que abra un sub-selector con los grupos existentes.

---

### 6. POS — sin cambios de logica

El POS **no necesita cambios funcionales**:
- Busqueda por nombre: cada variante aparece como item independiente
- Busqueda por codigo: cada variante tiene su propio EAN
- Stock: independiente por variante
- Presentaciones: cada variante puede tener las suyas

**Unico cambio menor:** agregar `grupo_variante_id` al SELECT de `buscarProductosPOS()` y `buscarPorCodigoBarras()` para que el campo este disponible (ya descrito en seccion 3a).

---

### 7. Funciones SQL — sin cambios

Ninguna funcion SQL necesita modificacion:
- `fn_registrar_venta_pos` — opera sobre `producto_id`, no le importa el grupo
- `fn_anular_venta` — opera sobre `ventas_detalles.producto_id`
- `fn_actualizar_stock_venta` (trigger) — descuenta stock del producto individual
- `fn_ajustar_stock_inventario` — ajusta stock del producto individual
- `fn_listar_ventas`, `fn_resumir_ventas`, `fn_reporte_ventas_periodo` — no tocan el grupo

---

## Archivos a modificar (resumen)

| Archivo | Cambio |
|---------|--------|
| `docs/schema.sql` | Nueva tabla `grupos_variantes` + FK `grupo_variante_id` en productos + indice + DROP |
| `src/app/features/inventario/models/producto.model.ts` | Nuevo interface `GrupoVariante` + campos en `Producto` y `ProductoPOS` |
| `src/app/features/inventario/services/inventario.service.ts` | JOINs en queries existentes + 7 metodos nuevos para CRUD de grupos |
| `src/app/features/inventario/pages/producto-form/producto-form.page.ts` | Campo en form + logica de busqueda/seleccion/creacion de grupo + carga de hermanas |
| `src/app/features/inventario/pages/producto-form/producto-form.page.html` | Seccion UI completa para variantes |
| `src/app/features/inventario/pages/producto-form/producto-form.page.scss` | Estilos para la seccion variantes |
| `src/app/features/inventario/pages/main/inventario.page.ts` | Registrar icono `colorPaletteOutline` |
| `src/app/features/inventario/pages/main/inventario.page.html` | Badge de grupo en tarjeta del producto |
| `src/app/features/inventario/pages/main/inventario.page.scss` | Estilos del badge |
| `docs/inventario/INVENTARIO-README.md` | Documentar variantes + nueva tabla |

**Total: 10 archivos, 1 tabla nueva, 0 funciones SQL modificadas.**

---

## Orden de implementacion

1. **BD:** Crear tabla `grupos_variantes` + FK en `productos` (migracion en Supabase)
2. **BD:** Actualizar `schema.sql` con tabla nueva, FK, indice, DROP
3. **Modelo:** Nuevo interface `GrupoVariante` + campos en `Producto` y `ProductoPOS`
4. **Servicio:** JOINs actualizados + 7 metodos nuevos (CRUD grupos + variantes del grupo)
5. **Formulario:** Seccion completa de variantes (busqueda, autocompletado, creacion al vuelo, hermanas)
6. **Grid inventario:** Badge visual de grupo + icono
7. **Docs:** Actualizar INVENTARIO-README.md

---

## Fuera de alcance (fase 2, si se necesita)

- Modo agrupado en el grid de inventario (card padre expandible con stock total)
- Agrupacion visual en busqueda POS (mostrar grupo antes de variantes individuales)
- Reporte de ventas por grupo de variantes
- Imagen representativa del grupo (usar imagen de la primera variante por ahora)
- Gestion dedicada de grupos (pagina/tab independiente — por ahora se gestionan desde el form del producto)

---

## Bugs existentes encontrados durante el analisis

> Estos bugs NO son causados por las variantes. Ya existen en el codigo actual.
> Se documentan aqui porque se descubrieron revisando el flujo completo.

### Bug 1: `fn_registrar_venta_pos` no inserta `presentacion_id` en `ventas_detalles`

**Archivo:** `docs/pos/sql/functions/fn_registrar_venta_pos.sql`, linea 185-199

El POS service envia `presentacion_id` en el JSONB de items:
```typescript
// pos.service.ts:59
presentacion_id: item.presentacion_id || null
```

Pero la funcion SQL NUNCA lo lee ni lo inserta:
```sql
-- fn_registrar_venta_pos.sql — INSERT actual (falta presentacion_id)
INSERT INTO ventas_detalles (
    venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal
    -- ↑ falta: presentacion_id
) VALUES (...);
```

**Consecuencia:** `ventas_detalles.presentacion_id` siempre es NULL. El trigger `fn_actualizar_stock_venta` usa `factor = 1` en vez del factor real. **Si vendes 2 cajetillas x20, descuenta 2 unidades en vez de 40. Stock queda inflado.**

**Fix:** agregar `presentacion_id` al INSERT y leerlo del JSONB: `(v_item->>'presentacion_id')::UUID`.

### Bug 2: `fn_anular_venta` no usa `factor_conversion` al reponer stock

**Archivo:** `docs/pos/sql/functions/fn_anular_venta.sql`, linea 75-101

La anulacion repone `v_detalle.cantidad` sin multiplicar por el factor de la presentacion. Si el trigger desconto `cantidad * factor`, la anulacion repone menos de lo que se desconto.

**Nota:** Mientras Bug 1 exista, Bug 2 es inofensivo (ambos usan factor=1). Al corregir Bug 1, Bug 2 se vuelve critico.

**Fix:** hacer LEFT JOIN a `producto_presentaciones` y multiplicar por `COALESCE(pp.factor_conversion, 1)`.

### Prioridad

**Corregir ambos bugs ANTES de implementar variantes** (o cualquier otra feature). Son bugs de integridad de stock.

---

## Decision pendiente

Revisar y confirmar:
1. Si arrancamos por los 2 bug fixes de presentaciones primero
2. Si el plan de variantes con tabla normalizada esta bien
3. Si fase 1 (sin modo agrupado en grid/POS) es suficiente para empezar
