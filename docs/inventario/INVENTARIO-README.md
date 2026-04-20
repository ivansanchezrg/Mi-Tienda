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
├── components/
│   └── presentacion-modal/      # Modal bottom-sheet para crear/editar presentaciones
├── models/
│   ├── producto.model.ts        # Producto, ProductoPOS, ProductoPresentacion, GrupoVariante, TipoVenta
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

## Concepto clave: Grupos de Variantes

Los **grupos de variantes** agrupan productos que son fisicamente distintos pero pertenecen
a la misma familia (ej: sabores de Tapioca, colores de camiseta). Cada variante es un
producto completo con stock, precio y codigo de barras independientes.

```
Grupo: TAPIOCA
  ├─ Tapioca Fresa       → stock: 24, precio: $1.50, EAN: 123456
  ├─ Tapioca Chocolate   → stock: 18, precio: $1.50, EAN: 123457
  └─ Tapioca Maracuya    → stock: 30, precio: $1.75, EAN: 123458
```

### Variantes vs Presentaciones

| | Presentaciones | Variantes |
|---|---|---|
| Ejemplo | Cigarro suelto vs cajetilla x10 | Tapioca Fresa vs Tapioca Chocolate |
| Stock | **Compartido** (unidad base) | **Independiente** por variante |
| Codigo de barras | Uno por presentacion | Uno por variante |
| Relacion fisica | Es el mismo producto | Son productos fisicamente distintos |
| Tabla | `producto_presentaciones` | `grupos_variantes` + FK en `productos` |

Una variante PUEDE tener sus propias presentaciones (ej: Tapioca Fresa en pack x6).

### Tabla `grupos_variantes`

```sql
CREATE TABLE grupos_variantes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT grupos_variantes_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre)))
);
```

FK en `productos`:
```sql
grupo_variante_id UUID REFERENCES grupos_variantes(id) ON DELETE SET NULL
```

`ON DELETE SET NULL`: si se elimina un grupo, los productos quedan sueltos (no se pierden datos).

### Gestion desde el formulario de producto

Los grupos se crean y asignan directamente desde el formulario del producto (no hay pagina dedicada):

- **Buscar grupo existente**: input con autocompletado (`buscarGruposVariantes`)
- **Crear grupo nuevo**: boton "Crear grupo" aparece si el texto no coincide con ningun grupo existente
- **Ver hermanas**: al seleccionar un grupo, se muestran las demas variantes del grupo (nombre, stock, precio)
- **Quitar del grupo**: boton X que desvincula el producto sin eliminar el grupo

El patron de creacion usa `INSERT ON CONFLICT DO NOTHING` + `SELECT` separado — nunca falla por duplicado.

### Visualizacion en el grid de inventario

Cada producto que pertenece a un grupo muestra un badge con el nombre del grupo:

```html
@if (prod.grupo_variante) {
    <span class="tipo-tag variante">
        <ion-icon name="color-palette-outline"></ion-icon>
        {{ prod.grupo_variante.nombre }}
    </span>
}
```

### Impacto en POS y funciones SQL

**Ninguno.** Cada variante es un producto completo — el POS, triggers, kardex y funciones SQL
no necesitan cambios. La agrupacion es puramente visual/organizacional.

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

Emitido desde el servicio en CRUD, ajustes de stock **y operaciones sobre presentaciones**.

| Evento | Comportamiento en grid |
|--------|----------------------|
| CREADO | Se agrega al inicio del grid |
| ACTUALIZADO | Se reemplaza en el grid (incluye badge de presentaciones actualizado) |
| DESACTIVADO | Se elimina del grid |

### Presentaciones y reactividad

Cuando se crea, edita o desactiva una presentación, el servicio llama a `emitirCambioPorPresentacion(productoId)`:

1. Hace `obtenerProductoPorId(id)` — que incluye `presentaciones:producto_presentaciones(id)` con filtro `activo = true`
2. Emite evento `ACTUALIZADO` con el producto ya refrescado
3. El grid actualiza la tarjeta (badge de presentaciones, etc.) sin necesidad de navegar

```typescript
// inventario.service.ts — método privado
private async emitirCambioPorPresentacion(productoId: string): Promise<void> {
    const producto = await this.obtenerProductoPorId(productoId);
    if (producto) this.productoChange$.next({ tipo: 'ACTUALIZADO', producto });
}
```

> **Importante:** `obtenerProductoPorId` incluye el join a `producto_presentaciones` con filtro de activo. Sin este join, `presentaciones` llega como `undefined` y el badge de conteo desaparece al navegar de vuelta al grid. El join trae solo el campo `id` — suficiente para `presentaciones.length` en la UI.

---

## Formulario de producto (`ProductoFormPage`)

### Modos

- **CREAR**: todos los campos editables, stock inicial obligatorio
- **EDITAR**: codigo de barras readonly, stock readonly, + seccion presentaciones

### Campo de codigo de barras — comportamiento dinámico

Solo editable en modo **CREAR**. En modo EDITAR el codigo es readonly (no se puede cambiar después de creado).

El input en modo CREAR tiene dos estados con mensaje de ayuda contextual:

- **Vacío**: mensaje gris con icono `sparkles-outline` — informa que se generará un codigo automáticamente via trigger (`fn_generar_codigo_interno`)
- **Con valor**: mensaje verde con icono `checkmark-circle-outline` — confirma que ese codigo se usará en el POS

El botón de escáner llama a `BarcodeScannerService.scan()` — one-shot, cierra solo al detectar un código.

### Margen de ganancia — badge visual

Badge siempre verde (`#2e7d32`) junto al título del campo. Muestra porcentaje y monto absoluto. Sin variantes de color — la pantalla de calculadora de margen es el lugar para analizar umbrales.

### Sección Presentaciones

Disponible en modo **CREAR** y **EDITAR**, solo cuando `tipo_venta === 'UNIDAD'`.

#### Modo EDITAR (desde BD)

Lista de presentaciones activas + opción de ver inactivas (toggle). Cada presentacion se gestiona via `PresentacionModalComponent` (bottom sheet):
- **Agregar**: modal con callback `onConfirmar` que persiste directamente en BD. Emite `emitirCambioPorPresentacion()` automáticamente desde el servicio.
- **Editar**: modal con callback `onConfirmar` que actualiza en BD. Luego recarga la lista local via `obtenerPresentaciones()`.
- **Eliminar**: confirm dialog → soft delete (`activo = false`). Las ventas anteriores conservan historial.
- **Reactivar**: visible en el panel de inactivas, restaura `activo = true`.

#### Modo CREAR (en memoria)

Las presentaciones se acumulan en `presentacionesNuevas[]` sin tocar la BD. Al guardar el producto:
1. `crearProducto()` → obtiene el ID del producto nuevo
2. `crearPresentacion()` en paralelo para cada presentación (modo silencioso, sin toast/loading individual)
3. Se emite un evento `ACTUALIZADO` manual con el producto + presentaciones ya combinados, para que el grid de inventario lo muestre correctamente desde el primer momento

```typescript
// producto-form.page.ts — flujo CREAR con presentaciones
const productoCreado = await this.inventarioService.crearProducto(payload);
if (productoCreado.id && this.presentacionesNuevas.length > 0) {
    const presentaciones = await Promise.all(
        this.presentacionesNuevas.map(p =>
            this.inventarioService.crearPresentacion({ ...p, producto_id: productoCreado.id }, true)
        )
    );
    this.inventarioService.emitirCambio({ tipo: 'ACTUALIZADO', producto: { ...productoCreado, presentaciones } });
}
```

#### Modal `PresentacionModalComponent`

Se abre como `bottom-sheet-modal` (breakpoints `[0, 1]`, sin scroll largo). Muestra:
- Nombre del producto padre como badge pill (color primario, alineado izquierda)
- Badge de margen siempre verde junto al título (`#2e7d32`, igual que el form del producto)
- Input de codigo de barras con botón escáner y hint dinámico (mismo patrón que el form del producto)
- `precio_costo` propio del paquete — no se deriva del precio base del producto

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

### `GrupoVariante`

```typescript
interface GrupoVariante {
    id: string;
    nombre: string;           // UPPER(TRIM()) — normalizado en BD
    created_at?: string;
}
```

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
    grupo_variante_id?: string;      // FK a grupos_variantes
    categoria?: CategoriaProducto;
    grupo_variante?: GrupoVariante;  // JOIN opcional
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
    precio_costo: number;        // costo real del paquete (obligatorio, no derivado del base)
    codigo_barras?: string;
    es_principal: boolean;
    activo: boolean;
}
```

### `ProductoPOS`

Proyeccion liviana para busqueda POS — sin categoria, pero **incluye presentaciones** (JOIN en la query).

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

## Escáner de códigos de barras

El inventario usa `BarcodeScannerService` (`core/services/`) para todas las operaciones de escaneo. **No llama directamente a `@capacitor-mlkit/barcode-scanning`.**

| Punto de escaneo | Método usado | Comportamiento |
|-----------------|-------------|----------------|
| Grid inventario — botón escáner | `scan()` | One-shot: escanea 1 código y cierra. Si el producto ya existe: ofrece editar o ver kardex. Si no existe: navega a crear con el código prellenado. La página gestiona el flag `escaneando` para mostrar un spinner mientras la cámara está activa |
| Formulario producto — campo código | `scan()` | One-shot: parchea `codigo_barras` en el form con el código capturado. Solo disponible en modo CREAR (en EDITAR el campo es readonly) |
| Modal presentación — campo código | `scan()` | One-shot: parchea `codigo_barras` en el form del modal |

### Formatos soportados

`FORMATOS_DEFAULT` en `BarcodeScannerService` incluye QR desde la refactorización de abril 2026:

```typescript
const FORMATOS_DEFAULT = [
    BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.Code128,
    BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code39,
    BarcodeFormat.QrCode,  // ← agregado para soportar códigos QR de proveedores
];
```

> Para más detalles del servicio, ver `docs/core/CORE-README.md` → sección `BarcodeScannerService`.

---

## Servicio (`inventario.service.ts`)

### Metodos principales

| Metodo | Descripcion |
|--------|-------------|
| `obtenerProductos(buscar?, categoriaId?, page, pageSize)` | Paginado con join categoria |
| `buscarProductosPOS(texto)` | Liviana, limit 10, para POS |
| `buscarPorCodigoBarras(codigo)` | Busqueda dual: producto + presentaciones. Retorna `{ producto, presentacion? }` |
| `obtenerProductoPorCodigo(codigo)` | Por EAN exacto solo en productos. Usa `maybeSingle()` |
| `obtenerProductoPorId(id)` | Con join categoria y `presentaciones:producto_presentaciones(id)` filtrado por `activo=true`. Solo trae el `id` de cada presentacion (suficiente para el badge de conteo en el grid) |
| `crearProducto(producto)` | INSERT + emite evento CREADO |
| `actualizarProducto(id, producto)` | UPDATE + emite evento ACTUALIZADO |
| `desactivarProducto(id)` | Soft delete + emite DESACTIVADO |
| `reactivarProducto(id)` | `activo=true` + emite ACTUALIZADO |
| `obtenerPresentaciones(productoId)` | Lista activas, ordenadas por `factor_conversion` |
| `obtenerPresentacionesInactivas(productoId)` | Lista inactivas. Usada en el form de edición para el panel "ver desactivadas" |
| `crearPresentacion(presentacion, silencioso?)` | INSERT + llama `emitirCambioPorPresentacion()`. `silencioso=true` suprime toast y spinner (modo CREAR en memoria) |
| `actualizarPresentacion(id, data)` | UPDATE + llama `emitirCambioPorPresentacion()` |
| `desactivarPresentacion(id)` | Soft delete + llama `emitirCambioPorPresentacion()` |
| `reactivarPresentacion(id)` | `activo=true` + llama `emitirCambioPorPresentacion()` |
| `ajustarStock(productoId, tipo, cantidad, obs)` | Via `fn_ajustar_stock_inventario`. Emite ACTUALIZADO |
| `obtenerGruposVariantes()` | Lista todos los grupos, ordenados por nombre |
| `buscarGruposVariantes(texto)` | Busqueda ILIKE, limit 5 — para autocompletado en el form |
| `crearOObtenerGrupoVariante(nombre)` | INSERT ON CONFLICT DO NOTHING + SELECT. Nunca falla por duplicado |
| `renombrarGrupoVariante(id, nombre)` | UPDATE con normalizacion UPPER(TRIM()) |
| `eliminarGrupoVariante(id)` | DELETE (ON DELETE SET NULL deja productos sueltos) |
| `obtenerVariantesDelGrupo(grupoId, excluirId?)` | Productos activos del mismo grupo (hermanas). Excluye el producto actual |
| `contarProductosPorGrupo(grupoId)` | COUNT exacto de productos activos en el grupo |

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
