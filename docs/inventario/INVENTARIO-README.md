# Inventario — Documentacion del modulo

Gestion completa de productos: CRUD, categorias, stock, kardex (auditoria),
y el sistema padre-hijo para empaques (cajetilla/cigarro, cubeta/huevo, etc.).

---

## Estructura de archivos

```
features/inventario/
├── pages/
│   ├── main/                    # Grid de productos con filtros y categorias
│   │   ├── inventario.page.ts
│   │   ├── inventario.page.html
│   │   └── inventario.page.scss
│   ├── producto-form/           # Crear / Editar producto (incluye empaque)
│   │   ├── producto-form.page.ts
│   │   ├── producto-form.page.html
│   │   └── producto-form.page.scss
│   └── kardex/                  # Historial de movimientos + ajustes manuales
│       ├── kardex.page.ts
│       ├── kardex.page.html
│       └── kardex.page.scss
├── services/
│   └── inventario.service.ts    # Queries, CRUD, empaques, ajustes de stock
├── models/
│   ├── producto.model.ts        # Producto, ProductoPOS, TipoVenta
│   ├── categoria-producto.model.ts
│   └── kardex.model.ts          # KardexInventario, TipoMovimientoKardex
└── inventario.routes.ts         # Lazy-load: '' | 'nuevo' | 'editar/:id' | 'kardex/:id'
```

---

## Concepto clave: Producto Base vs Empaque (padre-hijo)

El producto base es la **unidad minima de inventario** (ej: 1 cigarro).
El empaque es solo una **presentacion de venta** (ej: cajetilla de 20 cigarros).

```
Producto Base: Cigarro Marlboro     → stock_actual = 100, precio_venta = $0.50
Empaque:       Cajetilla Marlboro   → stock_actual = 0,   precio_venta = $10.00
                                      producto_hijo_id = UUID del cigarro
                                      factor_conversion = 20
```

### Reglas fundamentales

| Concepto | Donde vive | Ejemplo |
|----------|-----------|---------|
| Stock real | Siempre en el producto base (hijo) | 100 cigarros |
| Precio unitario | En el producto base | $0.50 |
| Precio por paquete | En el empaque (padre) | $10.00 |
| Costo unitario | En el producto base | $0.25 |
| Costo del empaque | En el empaque | $5.00 (20 x $0.25) |
| Stock del empaque | Calculado: `hijo.stock / factor_conversion` | 100/20 = 5 cajetillas |

### Constraints de BD (tabla `productos`)

```sql
producto_hijo_id    UUID REFERENCES productos(id),
factor_conversion   SMALLINT DEFAULT 1 CHECK (factor_conversion > 0),
CONSTRAINT chk_padre_solo_unidad CHECK (producto_hijo_id IS NULL OR tipo_venta = 'UNIDAD'),
CONSTRAINT chk_no_autoreferencia CHECK (producto_hijo_id IS DISTINCT FROM id)
```

- Solo productos tipo `UNIDAD` pueden ser empaque (no `PESO`)
- Un producto no puede ser empaque de si mismo
- `factor_conversion` siempre >= 1

---

## Donde se muestra cada producto

| Vista | Producto base | Empaque (padre) |
|-------|--------------|-----------------|
| Grid inventario | Card con stock, precio, y mini-card del empaque si tiene | NO se muestra (filtrado en SQL) |
| Formulario editar | Campos normales | Campos + seccion empaque (hijo, factor) |
| Kardex | Historial completo | Redirige al kardex del hijo |
| Busqueda POS | Aparece como item vendible | Aparece como item vendible |
| Desactivados | Card normal | NO se muestra |
| Stock bajo (dashboard) | Aparece si stock <= minimo | NO aparece (filtrado con `producto_hijo_id IS NULL`) |

---

## Flujo de datos: Grid de inventario

### Query principal (solo productos base)

```typescript
// inventario.service.ts → obtenerProductos()
query = supabase.from('productos')
    .select('*, categoria:categorias_productos(*)')
    .eq('activo', true)
    .is('producto_hijo_id', null)   // ← excluye padres
    .order('nombre')
    .range(from, to);
```

### Decoracion con info del padre (segundo query ligero)

Despues de traer la pagina de productos base, un segundo query busca
los empaques que apuntan a ellos:

```typescript
const { data: padres } = await supabase.from('productos')
    .select('id, nombre, precio_venta, factor_conversion, producto_hijo_id')
    .eq('activo', true)
    .in('producto_hijo_id', ids);    // ids de esta pagina
```

Se arma un `Map<hijo_id, padre>` y se decora cada producto base con `producto_padre`.
Esto se renderiza como la mini-card azul debajo del precio.

### Por que no se filtra client-side

Versiones anteriores traian padres + hijos juntos y filtraban en JS.
Problemas con paginacion:

1. Padre en pagina 1, hijo en pagina 2 → cards duplicadas/sueltas
2. Filtrar N padres de 25 resultados → pagina con 22 items visible, huecos
3. Infinite scroll pierde sincronizacion con la BD

Con `.is('producto_hijo_id', null)` en SQL, cada pagina tiene exactamente
`pageSize` items visibles sin huecos.

---

## Eventos reactivos: `onProductoChange$`

Emitido desde el servicio en tres situaciones:
- CRUD desde `ProductoFormPage` (crear, editar, desactivar, reactivar)
- Ajuste de stock desde `KardexPage` — `ajustarStock()` hace un query del producto actualizado y emite `ACTUALIZADO` para refrescar el card en el grid sin necesidad de scroll ni pull-to-refresh

| Evento | Producto base | Empaque (padre) |
|--------|--------------|-----------------|
| CREADO | Se agrega al inicio del grid | No se agrega. Se busca el hijo en el grid y se decora con `producto_padre` |
| ACTUALIZADO | Se reemplaza en el grid preservando `producto_padre` existente | Se busca el hijo y se refresca la decoracion |
| DESACTIVADO | Se elimina del grid | Se elimina del grid |

```typescript
// Clave: al actualizar un producto base, NO perder la decoracion
const padreInfo = this.items[idx].producto_padre;
this.items[idx] = { ...producto, producto_padre: padreInfo };
```

---

## Formulario de producto (`ProductoFormPage`)

### Modos

- **CREAR**: todos los campos editables, stock inicial obligatorio
- **EDITAR**: codigo de barras readonly, stock readonly (se ajusta solo via Kardex o Ventas)

### Seccion Empaque (solo visible si `tipo_venta === 'UNIDAD'`)

1. Toggle "Es empaque" → habilita el buscador de producto base
2. Buscador con debounce: `buscarProductosHijo(texto)` (min 2 chars)
   - Solo retorna productos UNIDAD sin hijo propio (evita cadenas padre→padre)
3. Seleccionar hijo → se muestra nombre + stock
4. Input "Unidades por empaque" → `factor_conversion`
5. Hint dinamico: "Al vender 1 {empaque}, se descontaran {N} unidades de {hijo}"

### Validaciones del formulario

| Campo | Validadores |
|-------|------------|
| nombre | required, minLength(3), maxLength(100) |
| categoria_id | required |
| precio_costo | required, min(0.01) |
| precio_venta | required, min(0.01), >= precio_costo (group validator) |
| stock_actual | required, min(0) — disabled si es empaque |
| stock_minimo | required, min(0) |
| producto_hijo_id | required solo si `esEmpaque` |
| factor_conversion | required, min(1) |

### Payload al guardar

```typescript
{
    // ... campos normales
    stock_actual: isEmpaque ? 0 : Number(value.stock_actual),
    producto_hijo_id: isEmpaque ? value.producto_hijo_id : null,
    factor_conversion: isEmpaque ? Number(value.factor_conversion) : 1,
    unidad_medida: isPeso ? value.unidad_medida : 'und'
}
```

Empaques siempre se guardan con `stock_actual = 0` y `factor_conversion >= 1`.

---

## Kardex (auditoria de stock)

### Redireccion padre → hijo

Si el usuario abre el kardex de un empaque, la pagina detecta `producto_hijo_id`
y redirige automaticamente al kardex del producto base (que es donde vive el stock real).

```typescript
if (producto.producto_hijo_id) {
    const hijo = await obtenerProductoPorId(producto.producto_hijo_id);
    this.productoId = hijo.id;     // ← todo el kardex se carga del hijo
}
```

### Tipos de movimiento

| Tipo | Direccion | Origen |
|------|-----------|--------|
| VENTA | Salida (-) | Trigger automatico al insertar en `ventas_detalles` |
| COMPRA | Entrada (+) | Ajuste manual desde kardex |
| AJUSTE_POSITIVO | Entrada (+) | Ajuste manual (ej: inventario fisico) |
| AJUSTE_NEGATIVO | Salida (-) | Ajuste manual (ej: producto danado) |
| ANULACION_VENTA | Entrada (+) | `fn_anular_venta` revierte el descuento |

### Funcion SQL de ajuste

`fn_ajustar_stock_inventario(p_producto_id, p_tipo_movimiento, p_cantidad, p_observaciones)`

- Actualiza `productos.stock_actual`
- Inserta registro en `kardex_inventario` con stock anterior y nuevo
- Observaciones obligatorias (auditoria)

---

## Descuento de stock en ventas (Trigger)

**Archivo**: `docs/pos/sql/triggers/trg_descontar_stock_venta.sql`

Se dispara `AFTER INSERT ON ventas_detalles`. Logica:

```sql
v_target_id  := COALESCE(NEW.producto_stock_id, NEW.producto_id);
v_target_qty := COALESCE(NEW.cantidad_stock, NEW.cantidad);
-- UPDATE productos SET stock_actual = stock_actual - v_target_qty WHERE id = v_target_id
-- INSERT INTO kardex_inventario (...)
```

| Caso | producto_stock_id | cantidad_stock | Descuenta de | Cantidad |
|------|-------------------|----------------|-------------|----------|
| Producto normal | NULL | NULL | producto_id | cantidad |
| Empaque (cajetilla) | UUID del cigarro | cantidad x factor | UUID del cigarro | cantidad x factor |

### Flujo completo de una venta con empaque

```
POS: vender 2 cajetillas (factor=20)
  ↓
CartItem: { id: cajetilla, cantidad: 2, producto_stock_id: cigarro, cantidad_stock: 40 }
  ↓
fn_registrar_venta_pos → INSERT ventas_detalles(producto_id=cajetilla, cantidad=2, producto_stock_id=cigarro, cantidad_stock=40)
  ↓
Trigger → COALESCE(cigarro, cajetilla) = cigarro, COALESCE(40, 2) = 40
  ↓
UPDATE productos SET stock_actual = stock_actual - 40 WHERE id = cigarro
INSERT kardex_inventario (producto_id=cigarro, cantidad=40, tipo='VENTA')
```

### Anulacion (flujo inverso)

`fn_anular_venta` usa la misma logica COALESCE para reponer stock al hijo:

```sql
COALESCE(producto_stock_id, producto_id) AS target_id,
COALESCE(cantidad_stock, cantidad) AS target_qty
-- UPDATE productos SET stock_actual = stock_actual + target_qty WHERE id = target_id
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
    producto_hijo_id?: string;       // Solo padres: UUID del hijo
    factor_conversion: number;       // Unidades del hijo por 1 padre (default 1)

    // Decoracion runtime (no viene de BD directamente)
    categoria?: CategoriaProducto;
    producto_padre?: { id, nombre, precio_venta, factor_conversion };
}
```

### `ProductoPOS`

Proyeccion liviana para busqueda POS — sin categoria, sin imagen, sin `producto_padre`.

### `CartItem` (modulo POS)

Extiende `ProductoPOS` y agrega:

```typescript
interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
    producto_stock_id?: string;   // UUID del hijo (solo padres)
    cantidad_stock?: number;      // cantidad * factor_conversion (solo padres)
    stock_disponible: number;     // Stock real: del hijo si es padre, propio si no
}
```

---

## Servicio (`inventario.service.ts`)

### Metodos principales

| Metodo | Descripcion |
|--------|-------------|
| `obtenerProductos(buscar?, categoriaId?, page, pageSize)` | Paginado. Solo productos base + decoracion padre |
| `buscarProductosPOS(texto)` | Liviana, limit 10, para POS. Incluye padres (son vendibles) |
| `obtenerProductoPorCodigo(codigo)` | Por EAN exacto. Usa `maybeSingle()` |
| `obtenerProductoPorId(id)` | Con join categoria |
| `crearProducto(producto)` | INSERT + emite evento CREADO |
| `actualizarProducto(id, producto)` | UPDATE + emite evento ACTUALIZADO |
| `desactivarProducto(id)` | Soft delete (`activo=false`) + emite DESACTIVADO |
| `reactivarProducto(id)` | `activo=true` + emite ACTUALIZADO |
| `obtenerProductosDesactivados()` | Solo productos base inactivos |
| `obtenerProductosStockBajo()` | Excluye padres (stock=0 por diseno) |
| `buscarProductosHijo(texto)` | Candidatos para empaque: UNIDAD sin hijo propio |
| `obtenerStockHijo(productoHijoId)` | Stock actual del hijo (validacion POS) |
| `ajustarStock(productoId, tipo, cantidad, obs)` | Via `fn_ajustar_stock_inventario`. Tras el ajuste emite `ACTUALIZADO` para refrescar el grid |

### Eventos (`onProductoChange$`)

```typescript
interface ProductoChangeEvent {
    tipo: 'CREADO' | 'ACTUALIZADO' | 'DESACTIVADO';
    producto: Producto;
}
```

Emitido por `crearProducto`, `actualizarProducto`, `desactivarProducto`, `reactivarProducto`.
La pagina principal escucha y actualiza el grid sin recargar.

---

## Categorias

Tabla `categorias_productos` con soft delete (`activo`).

| Accion | Restriccion |
|--------|-------------|
| Crear | Nombre unico |
| Renombrar | Nombre unico |
| Eliminar | Solo si no tiene productos activos NI inactivos |

Las categorias se gestionan desde el menu `...` del filtro en la pagina principal,
no desde una pagina separada.

---

## Tabla de BD: `productos`

```sql
CREATE TABLE productos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    categoria_id    INTEGER REFERENCES categorias_productos(id),
    codigo_barras   VARCHAR(50) UNIQUE,
    nombre          VARCHAR(150) NOT NULL,
    precio_costo    DECIMAL(12,2) NOT NULL DEFAULT 0,
    precio_venta    DECIMAL(12,2) NOT NULL,
    stock_actual    DECIMAL(12,2) DEFAULT 0,
    stock_minimo    INTEGER DEFAULT 5,
    tiene_iva       BOOLEAN DEFAULT TRUE,
    activo          BOOLEAN DEFAULT TRUE,
    imagen_url      TEXT,
    tipo_venta      VARCHAR(10) DEFAULT 'UNIDAD' CHECK (tipo_venta IN ('UNIDAD', 'PESO')),
    unidad_medida   VARCHAR(10) DEFAULT 'und',
    producto_hijo_id UUID REFERENCES productos(id),
    factor_conversion SMALLINT DEFAULT 1 CHECK (factor_conversion > 0)
);
```

### Tabla: `kardex_inventario`

```sql
CREATE TABLE kardex_inventario (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    fecha           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_movimiento VARCHAR(20) CHECK (tipo_movimiento IN
                    ('VENTA', 'COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'ANULACION_VENTA')),
    cantidad        DECIMAL(12,2) NOT NULL,
    stock_anterior  DECIMAL(12,2) NOT NULL,
    stock_nuevo     DECIMAL(12,2) NOT NULL,
    referencia_id   UUID,
    observaciones   TEXT
);
```

### Tabla: `ventas_detalles` (campos padre-hijo)

```sql
producto_stock_id UUID REFERENCES productos(id),  -- NULL=normal, UUID hijo=empaque
cantidad_stock    DECIMAL(12,2)                    -- NULL=normal, cantidad*factor=empaque
```

---

## Funciones SQL relacionadas

| Funcion | Ubicacion | Descripcion |
|---------|-----------|-------------|
| `fn_ajustar_stock_inventario` | `docs/inventario/sql/functions/` | Ajuste manual + kardex |
| `fn_actualizar_stock_venta` | `docs/pos/sql/triggers/` | Trigger: descuenta stock al vender (COALESCE padre-hijo) |
| `fn_registrar_venta_pos` | `docs/pos/sql/functions/` | RPC atomica. Inserta en ventas_detalles con producto_stock_id |
| `fn_anular_venta` | `docs/pos/sql/functions/` | Revierte stock con COALESCE al hijo |
| `fn_generar_codigo_interno` | `docs/inventario/sql/functions/` | Trigger: genera codigo_barras si no tiene |

---

## Capas de validacion (orden de ejecucion)

1. **Formulario Angular** — validators (required, min, maxLength, ventaMayorCosto)
2. **Servicio TypeScript** — logica de negocio (isEmpaque → stock=0, factor=1 si no es empaque)
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

### Soportar multiples padres por hijo

Actualmente un hijo solo puede tener un padre (la query usa `Map<hijo_id, padre>` que seria 1:1).
Si se necesita que un cigarro tenga cajetilla Y media-cajetilla:
1. Cambiar `Map` a `Map<hijo_id, padre[]>` en `obtenerProductos()`
2. Cambiar `producto_padre` en el modelo a array
3. Ajustar el template para mostrar multiples mini-cards

### Imagenes de productos

- Upload: `StorageService.uploadImage()` con `quality: 80, width: 1200, height: 1600` (~300KB)
- Bucket: `productos` en Supabase Storage
- Subfolder: nombre de la categoria sanitizado (`Bebidas` → `bebidas`)
- Al cambiar imagen: se elimina la anterior del storage
- Al desactivar producto: la imagen se conserva (por si se reactiva)
