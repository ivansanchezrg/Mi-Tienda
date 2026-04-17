# Plan de Refactor: Modelo de Presentaciones (2 Niveles)

> **Estado**: APROBADO
> **Fecha**: 2026-04-16
> **Reemplaza**: `PLAN-GRANEL-PAQUETES.md` (modelo padre-hijo obsoleto)

---

## Resumen ejecutivo

Reemplazar el modelo padre-hijo (`producto_hijo_id` + `factor_conversion` en `productos`) por una tabla independiente `producto_presentaciones`. Cada producto base puede tener 0..N presentaciones (ej: "Unidad", "Cajetilla x10", "Cajetilla x20"), cada una con su propio precio de venta, factor de conversion y codigo de barras.

**Principio clave**: el 95% de productos NO tienen presentaciones y siguen funcionando exactamente como hoy (venta directa del producto). Solo los productos con multiples formas de venta (cigarros, huevos, etc.) usan presentaciones.

---

## Reglas de implementacion

> **CRITICO**: Estas reglas aplican a TODAS las fases del plan.

1. **Schema unico**: Todo cambio de BD (tablas, columnas, constraints, triggers, indices) se edita directamente en `docs/schema.sql`. NO crear archivos SQL de migracion aparte. El schema.sql es la fuente de verdad y debe ser re-ejecutable.

2. **Funciones SQL en su archivo**: Cada funcion SQL se actualiza en su propio archivo existente dentro de `docs/`. Ej: `fn_registrar_venta_pos` se edita en `docs/pos/sql/functions/fn_registrar_venta_pos.sql`, NO se crea un archivo nuevo. Los triggers inline en schema.sql tambien se actualizan ahi.

3. **Documentacion sincronizada**: Toda modificacion que cambie el comportamiento documentado en un README (`INVENTARIO-README.md`, etc.) debe actualizar ese README en la misma fase. La documentacion nunca queda desactualizada respecto al codigo.

4. **Seeds actualizados**: Los archivos de seed (`docs/inventario/sql/seeds/`) se reescriben para reflejar el nuevo modelo. Los seeds viejos (padre-hijo) se eliminan.

---

## Modelo de datos

### Tabla `productos` (MODIFICAR)

**Eliminar columnas:**
```sql
-- ELIMINAR
producto_hijo_id    UUID REFERENCES productos(id)
factor_conversion   SMALLINT DEFAULT 1

-- ELIMINAR constraints
CONSTRAINT chk_padre_solo_unidad
CONSTRAINT chk_no_autoreferencia
```

**Conservar todo lo demas** (stock_actual, precio_costo, precio_venta, codigo_barras, tipo_venta, unidad_medida, etc.)

> El producto mantiene `precio_venta` como precio unitario base. Las presentaciones definen precios alternativos.

### Tabla `producto_presentaciones` (NUEVA)

```sql
CREATE TABLE IF NOT EXISTS producto_presentaciones (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    nombre            VARCHAR(100) NOT NULL,             -- "Unidad", "Cajetilla x10", "Cajetilla x20"
    factor_conversion INTEGER NOT NULL CHECK (factor_conversion > 0), -- unidades base por presentacion
    precio_venta      DECIMAL(12,2) NOT NULL,            -- precio de venta de esta presentacion
    codigo_barras     VARCHAR(50) UNIQUE,                -- codigo de barras propio (opcional)
    es_principal      BOOLEAN DEFAULT FALSE,             -- la presentacion por defecto en POS
    activo            BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_presentaciones_producto ON producto_presentaciones(producto_id);
CREATE INDEX idx_presentaciones_barcode  ON producto_presentaciones(codigo_barras);
```

**Reglas:**
- `factor_conversion` es INTEGER (no DECIMAL) — no existen media unidad en una cajetilla
- Un producto puede tener 0 presentaciones (producto simple) o N presentaciones
- `es_principal = TRUE` marca la presentacion por defecto para el POS (solo 1 por producto)
- `codigo_barras` es UNIQUE global — permite escanear directamente la cajetilla

### Tabla `ventas_detalles` (MODIFICAR)

```sql
-- ELIMINAR columnas padre-hijo
ALTER TABLE ventas_detalles DROP COLUMN producto_stock_id;
ALTER TABLE ventas_detalles DROP COLUMN cantidad_stock;

-- AGREGAR referencia a presentacion
ALTER TABLE ventas_detalles ADD COLUMN presentacion_id UUID REFERENCES producto_presentaciones(id);
```

**Logica:**
- `presentacion_id = NULL` → venta directa del producto (sin presentacion). Descuenta `cantidad` del stock.
- `presentacion_id = UUID` → venta via presentacion. Descuenta `cantidad * factor_conversion` del stock del `producto_id`.

> `producto_id` se mantiene SIEMPRE (producto base al que se le descuenta stock). Necesario para reportes y trazabilidad.

### Tabla `kardex_inventario` (SIN CAMBIOS)

El kardex sigue apuntando a `producto_id` (producto base). No necesita saber sobre presentaciones — solo registra movimientos de stock en unidad base.

---

## Relacion con granel (PESO)

Granel y presentaciones son **features ortogonales e independientes**:

| Feature | Donde vive | Productos que aplica | Cambia en este refactor? |
|---------|-----------|---------------------|------------------------|
| **Granel (PESO)** | `productos.tipo_venta`, `unidad_medida` | Arroz, frejol, queso | NO — se mantiene intacto |
| **Presentaciones** | `producto_presentaciones` | Cigarros, huevos, etc. | SI — reemplaza padre-hijo |

- Un producto PESO **no usa presentaciones** (se vende por peso decimal, el POS pide cantidad via `CantidadModalComponent`).
- Un producto UNIDAD **puede tener 0..N presentaciones** (cajetilla x10, x20, cubeta x30).
- La logica PESO existente (`pedirCantidadPeso()`, `editarCantidad()`, inputmode decimal) **no se toca en este refactor**.
- Si en el futuro se necesita granel + presentaciones (ej: arroz por libra O por saco de 100lb), solo se cambia `factor_conversion` de INTEGER a DECIMAL.

---

## Flujos de negocio

### Venta de producto simple (sin presentaciones)

```
Cajero escanea "Coca Cola 500ml" (codigo de barras del producto)
→ busca en productos.codigo_barras
→ agrega al carrito: producto_id, cantidad=1, precio_unitario=producto.precio_venta
→ ventas_detalles: producto_id=X, presentacion_id=NULL, cantidad=1
→ trigger: stock -= 1 (directo, sin factor)
```

### Venta de producto con presentacion

```
Cajero escanea cajetilla x20 (codigo de barras de la presentacion)
→ busca en producto_presentaciones.codigo_barras
→ resuelve: producto_id (cigarro), factor=20, precio=4.50
→ agrega al carrito: producto_id, presentacion_id, cantidad=1, precio=4.50
→ ventas_detalles: producto_id=X, presentacion_id=Y, cantidad=1
→ trigger: stock -= 1 * 20 = 20 unidades base
```

### Venta de 3 cajetillas x10

```
→ ventas_detalles: producto_id=cigarro, presentacion_id=cajetilla_x10, cantidad=3
→ trigger: stock -= 3 * 10 = 30 unidades base
→ kardex: producto_id=cigarro, cantidad=30, tipo=VENTA
```

### Ajuste de stock (kardex manual)

```
→ Siempre sobre el producto base (no sobre presentaciones)
→ fn_ajustar_stock_inventario: sin cambios
```

### Anulacion de venta

```
→ Lee ventas_detalles: si presentacion_id no es NULL, obtiene factor_conversion
→ Repone: cantidad * COALESCE(factor, 1) al producto_id
→ kardex: ANULACION_VENTA con cantidad real (factorizada)
```

---

## Ejemplo completo: Cigarrillo Marlboro

### Estado en BD

**productos:**
| id | nombre | precio_costo | precio_venta | stock_actual | codigo_barras |
|----|--------|-------------|-------------|-------------|--------------|
| abc-123 | Cigarro Marlboro | 0.15 | 0.25 | 200 | 7861234567890 |

**producto_presentaciones:**
| id | producto_id | nombre | factor | precio_venta | codigo_barras | es_principal |
|----|------------|--------|--------|-------------|--------------|-------------|
| pp-001 | abc-123 | Cajetilla x10 | 10 | 2.30 | 7861234567891 | true |
| pp-002 | abc-123 | Cajetilla x20 | 20 | 4.50 | 7861234567892 | false |

### Venta: 2 cajetillas x10 + 3 unidades sueltas

**ventas_detalles:**
| producto_id | presentacion_id | cantidad | precio_unitario | subtotal |
|------------|----------------|----------|----------------|----------|
| abc-123 | pp-001 | 2 | 2.30 | 4.60 |
| abc-123 | NULL | 3 | 0.25 | 0.75 |

**Stock descuento:**
- Linea 1: 2 * 10 = 20 unidades
- Linea 2: 3 * 1 = 3 unidades
- Total descontado: 23 unidades
- Stock resultante: 200 - 23 = 177

**kardex_inventario:**
| producto_id | tipo | cantidad | stock_anterior | stock_nuevo |
|------------|------|----------|---------------|-------------|
| abc-123 | VENTA | 20 | 200 | 180 |
| abc-123 | VENTA | 3 | 180 | 177 |

---

## Plan de implementacion por fases

### FASE 0 — Schema SQL

**Objetivo**: Crear tabla, modificar schema, actualizar triggers y funciones.

#### 0.1 — Crear tabla `producto_presentaciones`

**Archivo**: `docs/schema.sql` (despues de productos, antes de clientes)

```sql
-- 12b. producto_presentaciones — Formas de venta de un producto (cajetilla, pack, etc.)
CREATE TABLE IF NOT EXISTS producto_presentaciones (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    nombre            VARCHAR(100) NOT NULL,
    factor_conversion INTEGER NOT NULL CHECK (factor_conversion > 0),
    precio_venta      DECIMAL(12,2) NOT NULL,
    codigo_barras     VARCHAR(50) UNIQUE,
    es_principal      BOOLEAN DEFAULT FALSE,
    activo            BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Indices** (seccion de indices):
```sql
CREATE INDEX IF NOT EXISTS idx_presentaciones_producto ON producto_presentaciones(producto_id);
CREATE INDEX IF NOT EXISTS idx_presentaciones_barcode  ON producto_presentaciones(codigo_barras);
```

#### 0.2 — Limpiar tabla `productos`

**Archivo**: `docs/schema.sql`

Eliminar de la definicion de `productos`:
```sql
-- ELIMINAR estas lineas:
producto_hijo_id    UUID REFERENCES productos(id),
factor_conversion   SMALLINT DEFAULT 1 CHECK (factor_conversion > 0),
CONSTRAINT chk_padre_solo_unidad CHECK (producto_hijo_id IS NULL OR tipo_venta = 'UNIDAD'),
CONSTRAINT chk_no_autoreferencia CHECK (producto_hijo_id IS DISTINCT FROM id)
```

#### 0.3 — Modificar `ventas_detalles`

**Archivo**: `docs/schema.sql`

```sql
-- ELIMINAR:
producto_stock_id UUID REFERENCES productos(id),
cantidad_stock    DECIMAL(12,2)

-- AGREGAR:
presentacion_id   UUID REFERENCES producto_presentaciones(id)
```

#### 0.4 — Actualizar trigger `fn_actualizar_stock_venta()`

**Archivo**: `docs/schema.sql` + `docs/pos/sql/triggers/trg_descontar_stock_venta.sql`

```sql
CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_factor       INTEGER;
    v_cantidad_real DECIMAL(12,2);
    v_stock_actual DECIMAL(12,2);
BEGIN
    -- Si tiene presentacion, obtener factor; sino, factor = 1
    IF NEW.presentacion_id IS NOT NULL THEN
        SELECT factor_conversion INTO v_factor
        FROM producto_presentaciones
        WHERE id = NEW.presentacion_id;
    ELSE
        v_factor := 1;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;

    SELECT stock_actual INTO v_stock_actual
    FROM productos WHERE id = NEW.producto_id;

    UPDATE productos
    SET stock_actual = stock_actual - v_cantidad_real
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo,
        referencia_id, observaciones
    ) VALUES (
        NEW.producto_id, 'VENTA', v_cantidad_real,
        v_stock_actual, v_stock_actual - v_cantidad_real,
        NEW.venta_id, 'Descuento automatico por Venta POS'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### 0.5 — Actualizar `fn_registrar_venta_pos()` (v2.0)

**Archivo**: `docs/pos/sql/functions/fn_registrar_venta_pos.sql`

Cambios en el loop de items:
```sql
-- p_items JSONB ahora acepta: producto_id, cantidad, precio_unitario, subtotal, presentacion_id (opcional)

INSERT INTO ventas_detalles (
    venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal, presentacion_id
) VALUES (
    v_venta_id,
    (v_item->>'producto_id')::UUID,
    (v_item->>'cantidad')::DECIMAL,
    (v_item->>'precio_unitario')::DECIMAL,
    COALESCE(v_precio_costo, 0),
    (v_item->>'subtotal')::DECIMAL,
    (v_item->>'presentacion_id')::UUID   -- NULL si venta directa
);
```

#### 0.6 — Actualizar `fn_anular_venta()` (v2.0)

**Archivo**: `docs/pos/sql/functions/fn_anular_venta.sql`

Cambios en el loop de reposicion de stock:
```sql
FOR v_detalle IN
    SELECT vd.producto_id, vd.cantidad, vd.presentacion_id,
           COALESCE(pp.factor_conversion, 1) AS factor
    FROM   ventas_detalles vd
    LEFT JOIN producto_presentaciones pp ON pp.id = vd.presentacion_id
    WHERE  vd.venta_id = p_venta_id
LOOP
    v_cantidad_real := v_detalle.cantidad * v_detalle.factor;

    SELECT stock_actual INTO v_stock_actual
    FROM   productos WHERE id = v_detalle.producto_id;

    UPDATE productos
    SET    stock_actual = stock_actual + v_cantidad_real
    WHERE  id = v_detalle.producto_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo,
        referencia_id, observaciones
    ) VALUES (
        v_detalle.producto_id, 'ANULACION_VENTA', v_cantidad_real,
        v_stock_actual, v_stock_actual + v_cantidad_real,
        p_venta_id,
        'Anulacion Venta POS #' || v_venta.numero_comprobante || ': ' || TRIM(p_motivo)
    );
END LOOP;
```

#### 0.7 — Actualizar `fn_reporte_ventas_periodo()`

**Archivo**: `docs/ventas/sql/functions/fn_reporte_ventas_periodo.sql`

Top 5 productos — sin cambios funcionales (ya usa `vd.producto_id` + `p.nombre`). Las presentaciones no afectan el agrupamiento porque `producto_id` siempre apunta al producto base.

#### 0.8 — Actualizar `fn_ajustar_stock_inventario()`

**Sin cambios** — los ajustes manuales siempre se hacen sobre el producto base.

#### 0.9 — Seed de prueba

**Archivo**: `docs/inventario/sql/seeds/seed_productos_prueba.sql`

```sql
-- Reemplazar el escenario padre-hijo por presentaciones:

-- Producto base: Cigarro Marlboro (stock en unidades sueltas)
INSERT INTO productos (id, nombre, precio_costo, precio_venta, stock_actual, categoria_id, codigo_barras)
VALUES ('...cigarro-uuid...', 'Cigarro Marlboro', 0.15, 0.25, 200, 1, '7861234567890');

-- Presentaciones
INSERT INTO producto_presentaciones (producto_id, nombre, factor_conversion, precio_venta, codigo_barras, es_principal)
VALUES
    ('...cigarro-uuid...', 'Cajetilla x10', 10, 2.30, '7861234567891', true),
    ('...cigarro-uuid...', 'Cajetilla x20', 20, 4.50, '7861234567892', false);

-- Producto base: Huevo (stock en unidades)
INSERT INTO productos (id, nombre, precio_costo, precio_venta, stock_actual, categoria_id, codigo_barras)
VALUES ('...huevo-uuid...', 'Huevo', 0.12, 0.15, 360, 1, '7861234567893');

-- Presentaciones
INSERT INTO producto_presentaciones (producto_id, nombre, factor_conversion, precio_venta, es_principal)
VALUES
    ('...huevo-uuid...', 'Cubeta x30', 30, 4.00, true);
```

#### 0.10 — RLS (si aplica)

```sql
-- producto_presentaciones hereda la misma politica que productos
ALTER TABLE producto_presentaciones ENABLE ROW LEVEL SECURITY;

-- Lectura para authenticated
CREATE POLICY "Lectura presentaciones" ON producto_presentaciones
    FOR SELECT TO authenticated USING (true);

-- Escritura para authenticated
CREATE POLICY "Escritura presentaciones" ON producto_presentaciones
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

---

### FASE 1 — Modelos TypeScript

#### 1.1 — Nuevo modelo `ProductoPresentacion`

**Archivo**: `src/app/features/inventario/models/producto.model.ts`

```typescript
export interface ProductoPresentacion {
    id: string;
    producto_id: string;
    nombre: string;              // "Cajetilla x10"
    factor_conversion: number;   // 10
    precio_venta: number;        // 2.30
    codigo_barras?: string;
    es_principal: boolean;
    activo: boolean;
}
```

#### 1.2 — Limpiar modelo `Producto`

**Archivo**: `src/app/features/inventario/models/producto.model.ts`

```typescript
export interface Producto {
    id: string;
    categoria_id?: number;
    codigo_barras?: string;
    nombre: string;
    precio_costo: number;
    precio_venta: number;
    stock_actual: number;
    stock_minimo: number;
    tiene_iva: boolean;
    activo: boolean;
    imagen_url?: string;
    created_at?: string;

    // Granel
    tipo_venta: TipoVenta;
    unidad_medida: string;

    // --- ELIMINADO ---
    // producto_hijo_id?: string;
    // factor_conversion: number;
    // producto_hijo?: {...};
    // producto_padre?: {...};

    // Relacional
    categoria?: CategoriaProducto;
    presentaciones?: ProductoPresentacion[];  // NUEVO — cargadas on-demand
}
```

#### 1.3 — Actualizar `ProductoPOS`

```typescript
export type ProductoPOS = Pick<Producto,
    'id' | 'nombre' | 'codigo_barras' | 'precio_venta' |
    'stock_actual' | 'stock_minimo' | 'imagen_url' | 'tiene_iva' |
    'tipo_venta' | 'unidad_medida'
>;
```

> Eliminar: `producto_hijo_id`, `factor_conversion`

#### 1.4 — Actualizar `CartItem`

**Archivo**: `src/app/features/pos/models/cart-item.model.ts`

```typescript
export interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
    stock_disponible: number;
    // Presentacion (null si venta directa)
    presentacion_id?: string;
    presentacion_nombre?: string;    // Para mostrar en UI: "Cajetilla x10"
    factor_conversion?: number;      // Para calcular stock: cantidad * factor
}
```

> Eliminar: `producto_stock_id`, `cantidad_stock`

#### 1.5 — Actualizar `VentaDetalle`

**Archivo**: `src/app/features/ventas/models/venta.model.ts`

```typescript
export interface VentaDetalle {
    id: string;
    venta_id: string;
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    presentacion_id?: string;       // NUEVO
    // --- ELIMINADO ---
    // producto_stock_id?: string;
    // cantidad_stock?: number;
    // JOINs
    producto_nombre?: string;
    unidad_medida?: string;
    presentacion_nombre?: string;   // NUEVO — JOIN
}
```

---

### FASE 2 — Servicio de Inventario

#### 2.1 — Nuevos metodos para presentaciones

**Archivo**: `src/app/features/inventario/services/inventario.service.ts`

```typescript
// ==========================================
// PRESENTACIONES
// ==========================================

async obtenerPresentaciones(productoId: string): Promise<ProductoPresentacion[]> {
    const { data } = await this.supabase.client
        .from('producto_presentaciones')
        .select('*')
        .eq('producto_id', productoId)
        .eq('activo', true)
        .order('factor_conversion');
    return data || [];
}

async crearPresentacion(presentacion: Partial<ProductoPresentacion>): Promise<ProductoPresentacion> {
    const res = await this.supabase.call<ProductoPresentacion[]>(
        this.supabase.client.from('producto_presentaciones').insert([presentacion]).select(),
        'Presentacion creada',
        { showLoading: true }
    );
    return res ? res[0] : ({} as ProductoPresentacion);
}

async actualizarPresentacion(id: string, presentacion: Partial<ProductoPresentacion>): Promise<void> {
    await this.supabase.call(
        this.supabase.client.from('producto_presentaciones').update(presentacion).eq('id', id),
        'Presentacion actualizada',
        { showLoading: true }
    );
}

async desactivarPresentacion(id: string): Promise<void> {
    await this.supabase.call(
        this.supabase.client.from('producto_presentaciones').update({ activo: false }).eq('id', id),
        'Presentacion eliminada',
        { showLoading: true }
    );
}
```

#### 2.2 — Eliminar metodos padre-hijo

```typescript
// ELIMINAR:
// buscarProductosHijo()
// obtenerStockHijo()
```

#### 2.3 — Actualizar `obtenerProductos()`

Eliminar toda la logica de decoracion de padres (lineas 50-71 actuales):
```typescript
// ELIMINAR: query de padres + padreMap + decoracion producto_padre
```

Opcionalmente, cargar presentaciones para mostrar en el grid:
```typescript
// Despues de obtener productos, cargar presentaciones para los que tengan
const productosConPresentaciones = data.filter(p => /* criterio */);
// Solo si es necesario para la UI
```

#### 2.4 — Actualizar `obtenerProductosStockBajo()`

```typescript
// ELIMINAR: .is('producto_hijo_id', null)
// Ya no hay padres con stock=0 artificial — todos los productos tienen stock real
```

#### 2.5 — Actualizar `buscarProductosPOS()`

```typescript
// ELIMINAR de select: producto_hijo_id, factor_conversion
// El POS busca productos directamente + presentaciones por codigo de barras
```

#### 2.6 — Nuevo: buscar por codigo de barras incluyendo presentaciones

```typescript
async buscarPorCodigoBarras(codigo: string): Promise<{
    producto: ProductoPOS;
    presentacion?: ProductoPresentacion;
} | null> {
    // 1. Buscar en productos
    const { data: prod } = await this.supabase.client
        .from('productos')
        .select('id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida')
        .eq('codigo_barras', codigo)
        .eq('activo', true)
        .maybeSingle();

    if (prod) return { producto: prod as ProductoPOS };

    // 2. Buscar en presentaciones
    const { data: pres } = await this.supabase.client
        .from('producto_presentaciones')
        .select('*, producto:producto_id(id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida)')
        .eq('codigo_barras', codigo)
        .eq('activo', true)
        .maybeSingle();

    if (pres?.producto) {
        return {
            producto: pres.producto as ProductoPOS,
            presentacion: {
                id: pres.id,
                producto_id: pres.producto_id,
                nombre: pres.nombre,
                factor_conversion: pres.factor_conversion,
                precio_venta: pres.precio_venta,
                codigo_barras: pres.codigo_barras,
                es_principal: pres.es_principal,
                activo: pres.activo
            }
        };
    }

    return null;
}
```

---

### FASE 3 — POS (Punto de Venta)

#### 3.1 — Actualizar `PosService.procesarVenta()`

**Archivo**: `src/app/features/pos/services/pos.service.ts`

```typescript
const items = carrito.map(item => ({
    producto_id: item.id,
    cantidad: item.cantidad,
    precio_unitario: item.presentacion_id
        ? /* precio de la presentacion */ item.subtotal / item.cantidad
        : item.precio_venta,
    subtotal: item.subtotal,
    presentacion_id: item.presentacion_id || null  // NUEVO (reemplaza producto_stock_id/cantidad_stock)
}));
```

#### 3.2 — Actualizar `PosPage.agregarAlCarrito()`

**Archivo**: `src/app/features/pos/pages/pos/pos.page.ts`

Reemplazar toda la logica padre-hijo:

```typescript
async agregarAlCarrito(producto: ProductoPOS, presentacion?: ProductoPresentacion) {
    // PESO: logica existente (sin cambios)
    if (producto.tipo_venta === 'PESO') { ... return; }

    const stockBase = producto.stock_actual;
    const factor = presentacion?.factor_conversion ?? 1;
    const precioVenta = presentacion?.precio_venta ?? producto.precio_venta;
    const maxUnidades = Math.floor(stockBase / factor);

    // Identificador unico en carrito: producto_id + presentacion_id
    const carritoKey = presentacion
        ? `${producto.id}__${presentacion.id}`
        : producto.id;

    const existe = this.carrito.find(item =>
        item.id === producto.id &&
        item.presentacion_id === (presentacion?.id ?? undefined)
    );

    if (existe) {
        if (existe.cantidad < maxUnidades) {
            this.incrementar(existe);
            this.feedbackEscaneo(existe.id);
            this.scrollToBottom();
        } else {
            this.ui.showToast('Stock insuficiente', 'warning');
        }
    } else {
        if (maxUnidades > 0) {
            const item: CartItem = {
                ...producto,
                precio_venta: precioVenta,
                cantidad: 1,
                subtotal: precioVenta,
                stock_disponible: stockBase,
                ...(presentacion ? {
                    presentacion_id: presentacion.id,
                    presentacion_nombre: presentacion.nombre,
                    factor_conversion: presentacion.factor_conversion
                } : {})
            };
            this.carrito.push(item);
            // ...feedback
        } else {
            this.ui.showToast('Producto sin stock', 'danger');
        }
    }
}
```

#### 3.3 — Actualizar `incrementar()` / `decrementar()`

```typescript
incrementar(item: CartItem) {
    if (item.tipo_venta === 'PESO') { this.editarCantidad(item); return; }
    const factor = item.factor_conversion ?? 1;
    const maxCantidad = Math.floor(item.stock_disponible / factor);
    if (item.cantidad < maxCantidad) {
        item.cantidad++;
        item.subtotal = Math.round(item.cantidad * item.precio_venta * 100) / 100;
    } else {
        this.ui.showToast('Maximo stock alcanzado', 'warning');
    }
}
```

#### 3.4 — Actualizar busqueda por codigo de barras

```typescript
private async buscarPorCodigo(texto: string) {
    // Usar el nuevo metodo que busca en ambas tablas
    const resultado = await this.inventarioService.buscarPorCodigoBarras(texto);
    if (resultado) {
        await this.agregarAlCarrito(resultado.producto, resultado.presentacion);
        this.buscarTexto = '';
    } else {
        this.ui.showToast(`Codigo "${texto}" no encontrado`, 'warning');
    }
}
```

#### 3.5 — Stock disponible en carrito (calculo cruzado)

Cuando el mismo producto base tiene items en carrito por distintas presentaciones (ej: 2 cajetillas x10 + 5 sueltas), el stock disponible debe considerar TODAS las lineas de ese producto:

```typescript
private stockUsadoPorProducto(productoId: string): number {
    return this.carrito
        .filter(i => i.id === productoId)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);
}
```

Usar este metodo para validar antes de agregar/incrementar.

---

### FASE 4 — Formulario de Producto (Inventario)

#### 4.1 — Reemplazar seccion empaque por seccion presentaciones

**Archivo**: `src/app/features/inventario/pages/producto-form/producto-form.page.ts`

**Eliminar:**
- `esEmpaque` flag
- `productosHijoCandidatos`, `productoHijoSeleccionado`, `buscandoHijo`
- `toggleEmpaque()`, `buscarHijo()`, `seleccionarHijo()`, `quitarHijo()`
- Campos del form: `producto_hijo_id`, `factor_conversion`

**Agregar:**
- `presentaciones: ProductoPresentacion[]` (lista cargada al editar)
- Solo en modo EDITAR: seccion colapsable "Presentaciones" con:
  - Lista de presentaciones activas
  - Boton "Agregar presentacion"
  - Cada presentacion: nombre, factor, precio_venta, codigo_barras, es_principal
  - Editar/eliminar inline

> En modo CREAR: no mostrar presentaciones (primero guardar el producto, luego agregar presentaciones).

#### 4.2 — Agregar/editar presentacion (alert o mini-form)

```typescript
async agregarPresentacion() {
    const alert = await this.alertCtrl.create({
        header: 'Nueva presentacion',
        inputs: [
            { name: 'nombre', type: 'text', placeholder: 'Ej: Cajetilla x10' },
            { name: 'factor_conversion', type: 'number', placeholder: 'Unidades por presentacion' },
            { name: 'precio_venta', type: 'number', placeholder: 'Precio de venta' },
            { name: 'codigo_barras', type: 'text', placeholder: 'Codigo de barras (opcional)' }
        ],
        buttons: [
            { text: 'Cancelar', role: 'cancel' },
            {
                text: 'Guardar',
                handler: async (data) => {
                    // Validar y crear
                    await this.inventarioService.crearPresentacion({
                        producto_id: this.producto!.id,
                        nombre: data.nombre.trim(),
                        factor_conversion: Number(data.factor_conversion),
                        precio_venta: Number(data.precio_venta),
                        codigo_barras: data.codigo_barras?.trim() || null,
                        es_principal: this.presentaciones.length === 0 // primera = principal
                    });
                    this.presentaciones = await this.inventarioService.obtenerPresentaciones(this.producto!.id);
                }
            }
        ]
    });
    await alert.present();
}
```

#### 4.3 — Actualizar `guardar()`

Eliminar toda logica de empaque del payload:
```typescript
// ELIMINAR:
// producto_hijo_id: isEmpaque ? ... : null,
// factor_conversion: isEmpaque ? ... : 1,
// stock_actual: isEmpaque ? 0 : ...,
```

---

### FASE 5 — Grid de Inventario

#### 5.1 — Actualizar `inventario.page.ts`

**Eliminar:**
- Toda la logica de decoracion `producto_padre` en `onProductoChange$`
- El metodo `irAEditarEmpaque()`
- Las queries de padres en `obtenerProductos()` (ya eliminadas en servicio)

**Simplificar `onProductoChange$`:**
```typescript
this.productoChangeSub = this.inventarioService.onProductoChange$.subscribe(event => {
    if (event.tipo === 'DESACTIVADO') {
        this.items = this.items.filter(p => p.id !== event.producto.id);
    } else if (event.tipo === 'CREADO') {
        this.items.unshift(this.resolverImagenUrl(event.producto));
    } else if (event.tipo === 'ACTUALIZADO') {
        const idx = this.items.findIndex(p => p.id === event.producto.id);
        if (idx >= 0) this.items[idx] = this.resolverImagenUrl(event.producto);
    }
});
```

#### 5.2 — Actualizar `inventario.page.html`

**Eliminar:**
- Mini-card de empaque padre (el bloque que muestra layers icon + factor + precio del padre)

**Opcionalmente agregar:**
- Badge o indicador si el producto tiene presentaciones (ej: icono de layers + "3 presentaciones")

---

### FASE 6 — Kardex

#### 6.1 — Actualizar `kardex.page.ts`

**Eliminar:** logica de redireccion padre→hijo:
```typescript
// ELIMINAR: if (producto.producto_hijo_id) { ... redirect to hijo ... }
```

El kardex siempre muestra el producto seleccionado directamente — ya no hay padres con stock=0.

---

### FASE 7 — Ventas (historial y detalle)

#### 7.1 — Actualizar carga de detalle de venta

Si se usa JOIN para mostrar nombre de presentacion:
```typescript
// En obtenerVentaDetalle():
// Agregar al select: presentacion:presentacion_id(nombre)
```

#### 7.2 — Actualizar venta-detalle-modal

Mostrar nombre de presentacion junto al nombre del producto:
```
Cigarro Marlboro — Cajetilla x10    x2    $4.60
Cigarro Marlboro                    x3    $0.75
```

#### 7.3 — Actualizar share-venta.service

Incluir nombre de presentacion en el PDF/canvas de compartir venta.

---

### FASE 8 — Cuentas por Cobrar

#### 8.1 — Actualizar `obtenerItemsVenta()`

**Archivo**: `src/app/features/cuentas-cobrar/services/cuentas-cobrar.service.ts`

Si el select incluye `producto:producto_id(nombre)`, mantenerlo igual — `producto_id` sigue existiendo. Opcionalmente agregar `presentacion:presentacion_id(nombre)`.

---

## Archivos afectados (resumen)

### SQL (6 archivos)
| Archivo | Cambio |
|---------|--------|
| `docs/schema.sql` | Crear tabla, limpiar productos, modificar ventas_detalles, actualizar trigger |
| `docs/pos/sql/triggers/trg_descontar_stock_venta.sql` | Reescribir con logica de presentacion |
| `docs/pos/sql/functions/fn_registrar_venta_pos.sql` | v2.0: presentacion_id en items loop |
| `docs/pos/sql/functions/fn_anular_venta.sql` | v2.0: JOIN presentaciones para factor |
| `docs/ventas/sql/functions/fn_reporte_ventas_periodo.sql` | Sin cambios funcionales |
| `docs/inventario/sql/seeds/seed_productos_prueba.sql` | Reescribir con presentaciones |

### TypeScript Modelos (3 archivos)
| Archivo | Cambio |
|---------|--------|
| `src/.../inventario/models/producto.model.ts` | Agregar ProductoPresentacion, limpiar Producto |
| `src/.../pos/models/cart-item.model.ts` | presentacion_id reemplaza producto_stock_id |
| `src/.../ventas/models/venta.model.ts` | presentacion_id reemplaza producto_stock_id |

### TypeScript Servicios (3 archivos)
| Archivo | Cambio |
|---------|--------|
| `src/.../inventario/services/inventario.service.ts` | CRUD presentaciones, eliminar padre-hijo, busqueda dual |
| `src/.../pos/services/pos.service.ts` | presentacion_id en items map |
| `src/.../cuentas-cobrar/services/cuentas-cobrar.service.ts` | Agregar JOIN presentacion (opcional) |

### TypeScript Pages (6 archivos)
| Archivo | Cambio |
|---------|--------|
| `src/.../inventario/pages/main/inventario.page.ts` | Eliminar logica padre, simplificar eventos |
| `src/.../inventario/pages/main/inventario.page.html` | Eliminar mini-card empaque |
| `src/.../inventario/pages/producto-form/producto-form.page.ts` | Seccion presentaciones reemplaza empaque |
| `src/.../inventario/pages/producto-form/producto-form.page.html` | UI de presentaciones |
| `src/.../inventario/pages/kardex/kardex.page.ts` | Eliminar redireccion padre→hijo |
| `src/.../pos/pages/pos/pos.page.ts` | Logica presentaciones en carrito |

### Otros (2 archivos)
| Archivo | Cambio |
|---------|--------|
| `src/.../ventas/pages/venta-detalle-modal/...` | Mostrar nombre presentacion |
| `src/.../ventas/services/share-venta.service.ts` | Incluir presentacion en PDF |

**Total: ~20 archivos**

---

## Orden de ejecucion

```
FASE 0 (SQL)
  ├── 0.1  Crear tabla producto_presentaciones
  ├── 0.2  Limpiar productos (eliminar padre-hijo)
  ├── 0.3  Modificar ventas_detalles
  ├── 0.4  Trigger fn_actualizar_stock_venta
  ├── 0.5  fn_registrar_venta_pos v2.0
  ├── 0.6  fn_anular_venta v2.0
  ├── 0.9  Seeds de prueba
  └── 0.10 RLS

FASE 1 (Modelos TS) — depende de FASE 0
  ├── 1.1  ProductoPresentacion interface
  ├── 1.2  Limpiar Producto
  ├── 1.3  Limpiar ProductoPOS
  ├── 1.4  Actualizar CartItem
  └── 1.5  Actualizar VentaDetalle

FASE 2 (Servicio) — depende de FASE 1
  ├── 2.1  CRUD presentaciones
  ├── 2.2  Eliminar metodos padre-hijo
  ├── 2.3  Limpiar obtenerProductos()
  ├── 2.4  Limpiar obtenerProductosStockBajo()
  ├── 2.5  Limpiar buscarProductosPOS()
  └── 2.6  buscarPorCodigoBarras() dual

FASE 3 (POS) — depende de FASE 2
  ├── 3.1  PosService.procesarVenta()
  ├── 3.2  agregarAlCarrito() con presentacion
  ├── 3.3  incrementar/decrementar con factor
  ├── 3.4  Busqueda por codigo dual
  └── 3.5  Stock cruzado por producto

FASE 4 (Form) — depende de FASE 2
  ├── 4.1  Reemplazar empaque por presentaciones
  ├── 4.2  CRUD presentaciones inline
  └── 4.3  Limpiar guardar()

FASE 5 (Grid) — depende de FASE 2
  ├── 5.1  Limpiar inventario.page.ts
  └── 5.2  Limpiar inventario.page.html

FASE 6 (Kardex) — depende de FASE 2
  └── 6.1  Eliminar redireccion padre→hijo

FASE 7 (Ventas) — depende de FASE 1
  ├── 7.1  Detalle con presentacion
  ├── 7.2  Modal detalle
  └── 7.3  Share PDF

FASE 8 (Cuentas) — depende de FASE 1
  └── 8.1  JOIN presentacion
```

> **FASE 3 y FASE 4 son independientes** — se pueden implementar en paralelo despues de FASE 2.

---

## Testing checklist

- [ ] Crear producto simple (sin presentaciones) — funciona como siempre
- [ ] Crear producto + agregar 2 presentaciones (ej: x10, x20)
- [ ] Vender producto simple en POS — stock descuenta correctamente
- [ ] Vender presentacion en POS (escaneando codigo de barras de la presentacion)
- [ ] Vender mezcla: 2 cajetillas x10 + 3 sueltas del mismo producto → stock = -(2*10+3)
- [ ] Stock bajo: no muestra falsos positivos
- [ ] Anular venta con presentacion → stock se repone correctamente (con factor)
- [ ] Kardex muestra movimientos en unidad base (siempre)
- [ ] Ajuste manual de stock funciona (no toca presentaciones)
- [ ] Reporte top productos agrupa correctamente por producto base
- [ ] Busqueda POS por nombre encuentra el producto (no la presentacion)
- [ ] Busqueda POS por codigo de barras de presentacion resuelve correctamente
- [ ] Producto PESO (granel) sigue funcionando sin cambios
- [ ] Formulario: seccion presentaciones solo visible en modo EDITAR
- [ ] Grid: no muestra mini-cards de empaque (limpio)
- [ ] Cuentas por cobrar: detalle de venta muestra nombre de presentacion
