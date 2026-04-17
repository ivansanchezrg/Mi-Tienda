# Inventario — Documentacion del modulo

Gestion completa de productos: CRUD, categorias, stock, kardex (auditoria),
y el sistema de presentaciones para multiples formatos de venta (cajetilla, cubeta, etc.).

---

## Estructura de archivos

```
features/inventario/
├── pages/
│   ├── main/                    # Grid de productos con filtros y categorias
│   │   ├── inventario.page.ts
│   │   ├── inventario.page.html
│   │   └── inventario.page.scss
│   ├── producto-form/           # Crear / Editar producto (incluye presentaciones)
│   │   ├── producto-form.page.ts
│   │   ├── producto-form.page.html
│   │   └── producto-form.page.scss
│   └── kardex/                  # Historial de movimientos + ajustes manuales
│       ├── kardex.page.ts
│       ├── kardex.page.html
│       └── kardex.page.scss
├── services/
│   └── inventario.service.ts    # Queries, CRUD, presentaciones, ajustes de stock
├── models/
│   ├── producto.model.ts        # Producto, ProductoPOS, ProductoPresentacion, TipoVenta
│   ├── categoria-producto.model.ts
│   └── kardex.model.ts          # KardexInventario, TipoMovimientoKardex
└── inventario.routes.ts         # Lazy-load: '' | 'nuevo' | 'editar/:id' | 'kardex/:id'
```

---

## Concepto clave: Producto + Presentaciones (2 niveles)

El **producto** es la unidad base de inventario (ej: 1 cigarro).
Las **presentaciones** son formatos de venta alternativos (ej: cajetilla x10, cajetilla x20).

```
Producto:       Cigarro Marlboro     → stock_actual = 200, precio_venta = $0.50
Presentacion 1: Cajetilla x10       → factor_conversion = 10, precio_venta = $5.00
Presentacion 2: Cajetilla x20       → factor_conversion = 20, precio_venta = $9.50
```

### Reglas fundamentales

| Concepto | Donde vive | Ejemplo |
|----------|-----------|---------|
| Stock real | Siempre en el producto base | 200 cigarros |
| Precio unitario | En el producto base | $0.50 |
| Precio por paquete | En cada presentacion | $5.00 (x10), $9.50 (x20) |
| factor_conversion | En cada presentacion (INTEGER) | 10, 20 |
| Codigo de barras | En producto Y en cada presentacion (independientes) | EAN del cigarro, EAN de la cajetilla |
| Stock disponible por presentacion | Calculado: `producto.stock_actual / factor_conversion` | 200/10 = 20 cajetillas x10 |

### Tabla `producto_presentaciones`

```sql
CREATE TABLE producto_presentaciones (
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

### Relacion con granel (PESO)

Presentaciones son ortogonales al tipo de venta. Un producto PESO (granel) no necesita
presentaciones — se vende por peso con modal de cantidad decimal. El formulario solo
muestra la seccion de presentaciones cuando `tipo_venta === 'UNIDAD'`.

---

## Donde se muestra cada producto

| Vista | Producto base | Presentacion |
|-------|--------------|-------------|
| Grid inventario | Card con stock, precio, categoria | No se muestra (vive dentro del producto) |
| Formulario editar | Campos normales + lista de presentaciones (CRUD inline) | Se gestiona desde el form del producto |
| Kardex | Historial completo del producto base | N/A (stock siempre en producto base) |
| Busqueda POS (nombre) | Aparece como item vendible | N/A (busqueda solo por nombre de producto) |
| Busqueda POS (codigo) | Si el EAN es del producto, se agrega directo | Si el EAN es de una presentacion, se agrega con su precio y factor |
| Stock bajo (dashboard) | Aparece si stock <= minimo | N/A |

---

## Busqueda dual por codigo de barras (POS)

Cuando el POS escanea un codigo, busca en dos tablas:

```typescript
// inventario.service.ts → buscarPorCodigoBarras(codigo)
// 1. Buscar en productos
const { data: prod } = await supabase.from('productos')
    .select('id, nombre, ...')
    .eq('codigo_barras', codigo)
    .eq('activo', true)
    .maybeSingle();
if (prod) return { producto: prod };

// 2. Buscar en presentaciones (con JOIN al producto padre)
const { data: pres } = await supabase.from('producto_presentaciones')
    .select('*, producto:producto_id(id, nombre, ...)')
    .eq('codigo_barras', codigo)
    .eq('activo', true)
    .maybeSingle();
if (pres?.producto) return { producto: pres.producto, presentacion: pres };
```

---

## Stock cruzado en el carrito (POS)

Cuando el mismo producto aparece en el carrito via diferentes presentaciones
(ej: 3 cigarros sueltos + 2 cajetillas x10), el stock total comprometido se
calcula sumando `cantidad * factor` de todas las lineas del mismo producto:

```typescript
private stockUsadoPorProducto(productoId: string): number {
    return this.carrito
        .filter(i => i.id === productoId)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);
}
// Ejemplo: 3*1 + 2*10 = 23 unidades base comprometidas
```

---

## Eventos reactivos: `onProductoChange$`

Emitido desde el servicio en CRUD y ajustes de stock.

| Evento | Comportamiento en grid |
|--------|----------------------|
| CREADO | Se agrega al inicio del grid |
| ACTUALIZADO | Se reemplaza en el grid |
| DESACTIVADO | Se elimina del grid |

---

## Formulario de producto (`ProductoFormPage`)

### Modos

- **CREAR**: todos los campos editables, stock inicial obligatorio
- **EDITAR**: codigo de barras readonly, stock readonly, + seccion presentaciones

### Seccion Presentaciones (solo EDITAR + tipo UNIDAD)

Se muestra una lista de presentaciones existentes con opciones:
- **Agregar**: AlertController con inputs (nombre, factor, precio, codigo_barras)
- **Editar**: Click en la presentacion abre alert con valores actuales
- **Eliminar**: Soft delete (`activo = false`). Las ventas anteriores conservan historial.

### Validaciones del formulario

| Campo | Validadores |
|-------|------------|
| nombre | required, minLength(3), maxLength(100) |
| categoria_id | required |
| precio_costo | required, min(0.01) |
| precio_venta | required, min(0.01), >= precio_costo (group validator) |
| stock_actual | required, min(0) |
| stock_minimo | required, min(0) |

---

## Kardex (auditoria de stock)

El kardex siempre muestra el historial del producto base. No hay redireccion
porque con el modelo de presentaciones, el stock siempre vive en el producto.

### Tipos de movimiento

| Tipo | Direccion | Origen |
|------|-----------|--------|
| VENTA | Salida (-) | Trigger automatico al insertar en `ventas_detalles` |
| COMPRA | Entrada (+) | Ajuste manual desde kardex |
| AJUSTE_POSITIVO | Entrada (+) | Ajuste manual (ej: inventario fisico) |
| AJUSTE_NEGATIVO | Salida (-) | Ajuste manual (ej: producto danado) |
| ANULACION_VENTA | Entrada (+) | `fn_anular_venta` revierte el descuento |

---

## Descuento de stock en ventas (Trigger)

**Archivo**: `docs/pos/sql/triggers/trg_descontar_stock_venta.sql`

Se dispara `AFTER INSERT ON ventas_detalles`. Logica:

```sql
-- Si tiene presentacion_id, buscar factor_conversion
IF NEW.presentacion_id IS NOT NULL THEN
    SELECT factor_conversion INTO v_factor
    FROM producto_presentaciones WHERE id = NEW.presentacion_id;
ELSE
    v_factor := 1;
END IF;
v_cantidad_real := NEW.cantidad * v_factor;
-- UPDATE productos SET stock_actual = stock_actual - v_cantidad_real WHERE id = NEW.producto_id
-- INSERT INTO kardex_inventario (...)
```

| Caso | presentacion_id | Descuenta de | Cantidad |
|------|----------------|-------------|----------|
| Producto directo | NULL | producto_id | cantidad |
| Presentacion (cajetilla x20) | UUID de la presentacion | producto_id (base) | cantidad * 20 |

### Flujo completo de una venta con presentacion

```
POS: vender 2 cajetillas x20 (factor=20) de Cigarro Marlboro
  ↓
CartItem: { id: cigarro, cantidad: 2, presentacion_id: UUID-cajetilla20, factor_conversion: 20 }
  ↓
fn_registrar_venta_pos → INSERT ventas_detalles(producto_id=cigarro, cantidad=2, presentacion_id=UUID-cajetilla20)
  ↓
Trigger → factor=20, cantidad_real=2*20=40
  ↓
UPDATE productos SET stock_actual = stock_actual - 40 WHERE id = cigarro
INSERT kardex_inventario (producto_id=cigarro, cantidad=40, tipo='VENTA')
```

### Anulacion (flujo inverso)

`fn_anular_venta` JOIN con `producto_presentaciones` para obtener el factor:

```sql
FOR v_detalle IN
    SELECT vd.producto_id, vd.cantidad,
           COALESCE(pp.factor_conversion, 1) AS factor
    FROM ventas_detalles vd
    LEFT JOIN producto_presentaciones pp ON pp.id = vd.presentacion_id
    WHERE vd.venta_id = p_venta_id
LOOP
    v_cantidad_real := v_detalle.cantidad * v_detalle.factor;
    -- UPDATE productos SET stock_actual = stock_actual + v_cantidad_real
END LOOP;
```

---

## Modelos

### `Producto`

```typescript
interface Producto {
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
    tipo_venta: 'UNIDAD' | 'PESO';
    unidad_medida: string;           // 'und', 'kg', 'lb', etc.
    categoria?: CategoriaProducto;
    presentaciones?: ProductoPresentacion[];
}
```

### `ProductoPresentacion`

```typescript
interface ProductoPresentacion {
    id: string;
    producto_id: string;
    nombre: string;
    factor_conversion: number;   // INTEGER: unidades base por presentacion
    precio_venta: number;
    codigo_barras?: string;
    es_principal: boolean;
    activo: boolean;
}
```

### `ProductoPOS`

Proyeccion liviana para busqueda POS — sin categoria, sin presentaciones.

### `CartItem` (modulo POS)

```typescript
interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
    stock_disponible: number;
    presentacion_id?: string;         // UUID de la presentacion (null si venta directa)
    presentacion_nombre?: string;     // Para mostrar en UI: "Cajetilla x10"
    factor_conversion?: number;       // Para calcular stock: cantidad * factor
}
```

---

## Servicio (`inventario.service.ts`)

### Metodos principales

| Metodo | Descripcion |
|--------|-------------|
| `obtenerProductos(buscar?, categoriaId?, page, pageSize)` | Paginado con join categoria |
| `buscarProductosPOS(texto)` | Liviana, limit 10, para POS |
| `buscarPorCodigoBarras(codigo)` | Busqueda dual: producto + presentaciones. Retorna `{ producto, presentacion? }` |
| `obtenerProductoPorCodigo(codigo)` | Por EAN exacto solo en productos. Usa `maybeSingle()` |
| `obtenerProductoPorId(id)` | Con join categoria |
| `crearProducto(producto)` | INSERT + emite evento CREADO |
| `actualizarProducto(id, producto)` | UPDATE + emite evento ACTUALIZADO |
| `desactivarProducto(id)` | Soft delete + emite DESACTIVADO |
| `reactivarProducto(id)` | `activo=true` + emite ACTUALIZADO |
| `obtenerPresentaciones(productoId)` | Lista activas, ordenadas por factor |
| `crearPresentacion(presentacion)` | INSERT en producto_presentaciones |
| `actualizarPresentacion(id, data)` | UPDATE en producto_presentaciones |
| `desactivarPresentacion(id)` | Soft delete de presentacion |
| `ajustarStock(productoId, tipo, cantidad, obs)` | Via `fn_ajustar_stock_inventario`. Emite ACTUALIZADO |

---

## Funciones SQL relacionadas

| Funcion | Ubicacion | Descripcion |
|---------|-----------|-------------|
| `fn_ajustar_stock_inventario` | `docs/inventario/sql/functions/` | Ajuste manual + kardex |
| `fn_actualizar_stock_venta` | `docs/pos/sql/triggers/` | Trigger: descuenta stock al vender (factor desde presentacion) |
| `fn_registrar_venta_pos` | `docs/pos/sql/functions/` | RPC atomica. Inserta en ventas_detalles con presentacion_id |
| `fn_anular_venta` | `docs/pos/sql/functions/` | Revierte stock con JOIN a presentaciones |
| `fn_generar_codigo_interno` | `docs/inventario/sql/functions/` | Trigger: genera codigo_barras si no tiene |

---

## Capas de validacion (orden de ejecucion)

1. **Formulario Angular** — validators (required, min, maxLength, ventaMayorCosto)
2. **Servicio TypeScript** — logica de negocio (parseo precios, tipo_venta)
3. **Funcion PostgreSQL** — RAISE EXCEPTION si hay inconsistencia
4. **Constraints de BD** — UNIQUE, NOT NULL, CHECK, FK

---

## Notas para mantenimiento

### Agregar un nuevo tipo de venta (ej: DOCENA)

1. Agregar al CHECK constraint de `tipo_venta` en `schema.sql`
2. Agregar al type `TipoVenta` en `producto.model.ts`
3. Agregar boton en `producto-form.page.html` (seccion "Tipo de Venta")
4. Agregar handler en `onTipoVentaChange()` si necesita logica especial

### Agregar un nuevo tipo de movimiento de kardex

1. Agregar al CHECK constraint de `tipo_movimiento` en `schema.sql`
2. Agregar al type `TipoMovimientoKardex` en `kardex.model.ts`
3. Agregar case en `getIconoMovimiento()`, `getColorMovimiento()`, `getLabelMovimiento()` en `kardex.page.ts`

### Imagenes de productos

- Upload: `StorageService.uploadImage()` con `quality: 80, width: 1200, height: 1600` (~300KB)
- Bucket: `productos` en Supabase Storage
- Subfolder: nombre de la categoria sanitizado (`Bebidas` → `bebidas`)
- Al cambiar imagen: se elimina la anterior del storage
- Al desactivar producto: la imagen se conserva (por si se reactiva)
