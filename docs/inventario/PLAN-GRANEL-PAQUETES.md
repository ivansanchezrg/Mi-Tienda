# Plan de Implementacion: Productos a Granel y Paquetes (Padre-Hijo)

> Version: 3.0 | Fecha: 2026-04-14
> Estado: PENDIENTE APROBACION

---

## Resumen ejecutivo

Agregar soporte para 3 escenarios de venta:

| Escenario | Ejemplo | Como se vende | Stock en |
|-----------|---------|---------------|----------|
| `UNIDAD` (actual) | Coca-Cola, pan | Stepper +1/-1 | Unidades enteras |
| `PESO` (nuevo) | Arroz, queso, azucar | Input decimal (0.400 kg) | Decimales de UoM base |
| Padre-Hijo (nuevo) | Cajetilla→Cigarro, Cubeta→Huevo | Escaneo/boton. Descuenta N del hijo | Unidades base del HIJO |

**Principio clave**: el stock SIEMPRE se trackea en la **unidad minima de venta** (el hijo).
No existen "3.2 cajetillas" — existen 64 cigarros.

---

## Analisis de impacto completo

Todos los puntos de contacto en el codigo que requieren cambio:

### SQL (5 archivos)
| Archivo | Que cambia | Severidad |
|---------|-----------|-----------|
| `docs/schema.sql` — tabla `productos` | 4 campos nuevos + 2 constraints | CRITICO |
| `docs/schema.sql` — tabla `ventas_detalles` | 2 campos nuevos | CRITICO |
| `docs/schema.sql` — trigger `fn_actualizar_stock_venta` | Reescribir: COALESCE para padre-hijo | CRITICO |
| `docs/pos/sql/functions/fn_registrar_venta_pos.sql` | INSERT detalles con 2 campos nuevos | CRITICO |
| `docs/pos/sql/functions/fn_anular_venta.sql` | Loop reposicion con COALESCE | CRITICO |

### TypeScript — Modelos (3 archivos)
| Archivo | Que cambia |
|---------|-----------|
| `src/.../inventario/models/producto.model.ts` | TipoVenta type + 4 campos + ProductoPOS actualizado |
| `src/.../pos/models/cart-item.model.ts` | 3 campos nuevos: producto_stock_id, cantidad_stock, stock_disponible |
| `src/.../ventas/models/venta.model.ts` | 2 campos en VentaDetalle: producto_stock_id, cantidad_stock |

### TypeScript — Servicios (2 archivos)
| Archivo | Que cambia |
|---------|-----------|
| `src/.../inventario/services/inventario.service.ts` | SELECT actualizados en 2 metodos + 2 metodos nuevos + obtenerProductosStockBajo excluye padres |
| `src/.../pos/services/pos.service.ts` | Mapear 2 campos nuevos en JSONB |

### TypeScript — Paginas (8 archivos)
| Archivo | Que cambia | Detalle |
|---------|-----------|---------|
| `pos.page.ts` linea 321 | `agregarAlCarrito()` | Bifurcar: PESO→alert decimal, PADRE→resolver stock hijo |
| `pos.page.ts` linea 355 | `agregarAlCarritoConCantidad()` | Soportar decimales para PESO |
| `pos.page.ts` linea 431 | `incrementar()` | PADRE: validar `(cant+1)*factor <= stockHijo`. PESO: abrir alert en vez de ++ |
| `pos.page.ts` linea 448 | `editarCantidad()` | PESO: `parseFloat` + step 0.001. PADRE: max = `floor(stockHijo/factor)` |
| `pos.page.ts` linea 469 | `parseInt` en editarCantidad | PESO: cambiar a `parseFloat` |
| `pos.page.ts` linea 586 | `parseInt` en patron cantidad.codigo | El patron `10.codigo` ya usa parseInt — NO hay conflicto con PESO porque el patron es `digitos.texto`, no `decimal.texto`. Sin cambio. |
| `pos.page.html` linea 150 | Stock en resultados busqueda | Mostrar stock real (hijo si padre) + UoM |
| `pos.page.html` lineas 198-201 | Badges "Ultimo"/"Quedan" | Usar `stock_disponible` del CartItem |
| `producto-form.page.ts` | FormGroup + guardar() | Campos nuevos, validaciones condicionales |
| `producto-form.page.html` linea 207 | `appNumbersOnly` en stock | La directiva YA permite decimales (punto y coma). Sin cambio en directiva. Solo cambiar `inputmode="numeric"` a `inputmode="decimal"` para PESO |
| `producto-form.page.html` | UI condicional | Selector tipo_venta, selector hijo, factor_conversion |
| `inventario.page.html` lineas 81-93 | Badges de stock | PADRE: calcular desde hijo. PESO: mostrar con UoM |
| `kardex.page.ts` linea 60 | Stock actual | PADRE: cargar stock del hijo, mostrar kardex del hijo |
| `kardex.page.html` linea 24 | Display stock | Agregar UoM |
| `kardex.page.html` linea 63 | Input cantidad ajuste | PESO: `inputmode="decimal"` + min="0.001" |
| `kardex.page.html` lineas 78-84 | Preview resultado | Formatear con UoM |
| `kardex.page.html` linea 135 | Historial cantidades | Mostrar UoM |

### Otros archivos impactados (2 archivos)
| Archivo | Que cambia | Detalle |
|---------|-----------|---------|
| `src/.../ventas/components/venta-detalle-modal/...html` linea 95 | `{{ item.cantidad }}` | Agregar UoM suffix cuando aplique |
| `src/.../ventas/services/share-venta.service.ts` linea 183 | `item.cantidad.toString()` en canvas | Agregar UoM suffix |
| `src/app/core/services/notificaciones.service.ts` | `obtenerProductosStockBajo()` | Sin cambio — el metodo ya filtra `stock_actual <= stock_minimo`. Los padres tienen stock_actual=0 y stock_minimo=5, asi que aparecerian como stock bajo. Solucion: el metodo `obtenerProductosStockBajo` debe excluir padres (producto_hijo_id IS NOT NULL) |

### Archivos que NO cambian (verificado)
| Archivo | Razon |
|---------|-------|
| `fn_reporte_ventas_periodo.sql` | Ganancia usa `vd.precio_costo * vd.cantidad` — correcto para padres (precio_costo es del paquete completo, no de la unidad) |
| `fn_listar_ventas.sql` | Solo lista ventas, no toca stock |
| `fn_resumir_ventas.sql` | Agrega por venta, no por stock |
| `fn_ajustar_stock_inventario.sql` | Opera sobre producto directo — para padres simplemente se bloquea en frontend |
| `fn_generar_codigo_interno.sql` | Genera EAN-13 — sin relacion con tipo_venta |
| `cobrar-modal.component` | Solo recibe totales ya calculados |
| `NumbersOnlyDirective` | YA permite decimales (punto y coma). Sin cambio. |
| Calculo IVA/descuentos en POS | Opera sobre subtotales — no le importa tipo_venta |

---

## FASE 0 — Schema BD

> Editar archivos fuente directamente. No hay ALTER TABLE.

### 0.1 Editar `docs/schema.sql` — tabla `productos` (linea ~250)

Agregar 4 campos + 2 constraints al CREATE TABLE existente:

```sql
CREATE TABLE IF NOT EXISTS productos (
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
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- ── Granel + padre-hijo ──
    tipo_venta          VARCHAR(10) DEFAULT 'UNIDAD' CHECK (tipo_venta IN ('UNIDAD', 'PESO')),
    unidad_medida       VARCHAR(10) DEFAULT 'und',
    producto_hijo_id    UUID REFERENCES productos(id),
    factor_conversion   SMALLINT DEFAULT 1 CHECK (factor_conversion > 0),
    CONSTRAINT chk_padre_solo_unidad CHECK (producto_hijo_id IS NULL OR tipo_venta = 'UNIDAD'),
    CONSTRAINT chk_no_autoreferencia CHECK (producto_hijo_id IS DISTINCT FROM id)
);
```

### 0.2 Editar `docs/schema.sql` — tabla `ventas_detalles` (linea ~319)

Agregar 2 campos:

```sql
CREATE TABLE IF NOT EXISTS ventas_detalles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    cantidad        DECIMAL(12,2) NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    precio_costo    DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal        DECIMAL(12,2) NOT NULL,
    -- ── Padre-hijo: a quien se desconto stock ──
    producto_stock_id UUID REFERENCES productos(id),
    cantidad_stock    DECIMAL(12,2)
);
```

### 0.3 Editar `docs/schema.sql` — trigger `fn_actualizar_stock_venta` (linea ~479)

Reemplazar la funcion completa:

```sql
CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_target_id    UUID;
    v_target_qty   DECIMAL(12,2);
    v_stock_actual DECIMAL(12,2);
BEGIN
    v_target_id  := COALESCE(NEW.producto_stock_id, NEW.producto_id);
    v_target_qty := COALESCE(NEW.cantidad_stock, NEW.cantidad);

    SELECT stock_actual INTO v_stock_actual FROM productos WHERE id = v_target_id;

    UPDATE productos
    SET stock_actual = stock_actual - v_target_qty
    WHERE id = v_target_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo,
        referencia_id, observaciones
    ) VALUES (
        v_target_id, 'VENTA', v_target_qty,
        v_stock_actual, v_stock_actual - v_target_qty,
        NEW.venta_id,
        'Descuento automatico por Venta POS'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 0.4 Editar `docs/pos/sql/functions/fn_registrar_venta_pos.sql`

En el loop INSERT ventas_detalles (linea ~185), agregar 2 campos:

```sql
INSERT INTO ventas_detalles (
    venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal,
    producto_stock_id, cantidad_stock
) VALUES (
    v_venta_id,
    (v_item->>'producto_id')::UUID,
    (v_item->>'cantidad')::DECIMAL,
    (v_item->>'precio_unitario')::DECIMAL,
    COALESCE(v_precio_costo, 0),
    (v_item->>'subtotal')::DECIMAL,
    (v_item->>'producto_stock_id')::UUID,
    (v_item->>'cantidad_stock')::DECIMAL
);
```

Nota: la firma de la funcion NO cambia (p_items es JSONB flexible).

### 0.5 Editar `docs/pos/sql/functions/fn_anular_venta.sql`

En el loop de reposicion de stock (linea ~75), cambiar SELECT y UPDATE:

```sql
FOR v_detalle IN
    SELECT producto_id, cantidad,
           COALESCE(producto_stock_id, producto_id) AS target_id,
           COALESCE(cantidad_stock, cantidad) AS target_qty
    FROM ventas_detalles
    WHERE venta_id = p_venta_id
LOOP
    SELECT stock_actual INTO v_stock_actual
    FROM productos WHERE id = v_detalle.target_id;

    UPDATE productos
    SET stock_actual = stock_actual + v_detalle.target_qty
    WHERE id = v_detalle.target_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo,
        referencia_id, observaciones
    ) VALUES (
        v_detalle.target_id,
        'ANULACION_VENTA',
        v_detalle.target_qty,
        v_stock_actual,
        v_stock_actual + v_detalle.target_qty,
        p_venta_id,
        'Anulacion Venta POS #' || v_venta.numero_comprobante || ': ' || TRIM(p_motivo)
    );
END LOOP;
```

### 0.6 Editar datos de prueba en `docs/schema.sql` (linea ~629)

```sql
INSERT INTO productos (categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida) VALUES
(1, '786123456001', 'Coca-Cola 1L', 0.80, 1.25, 24, 5, TRUE, 'UNIDAD', 'und'),
(2, '786123456002', 'Ruffles Natural 50g', 0.35, 0.50, 50, 10, TRUE, 'UNIDAD', 'und'),
(4, '786123456003', 'Yogur Toni Fresa 200ml', 0.40, 0.60, 15, 5, FALSE, 'UNIDAD', 'und');
```

### 0.7 Actualizar resumen/version del schema.sql

- [ ] Completado

---

## FASE 1 — Modelos TypeScript

### 1.1 Editar `src/app/features/inventario/models/producto.model.ts`

```typescript
import { CategoriaProducto } from './categoria-producto.model';

export type TipoVenta = 'UNIDAD' | 'PESO';

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
    // Granel + padre-hijo
    tipo_venta: TipoVenta;
    unidad_medida: string;
    producto_hijo_id?: string;
    factor_conversion: number;
    // Relacional
    categoria?: CategoriaProducto;
}

export type ProductoPOS = Pick<Producto,
    'id' | 'nombre' | 'codigo_barras' | 'precio_venta' |
    'stock_actual' | 'stock_minimo' | 'imagen_url' | 'tiene_iva' |
    'tipo_venta' | 'unidad_medida' | 'producto_hijo_id' | 'factor_conversion'
>;
```

- [ ] Completado

### 1.2 Editar `src/app/features/pos/models/cart-item.model.ts`

```typescript
import { ProductoPOS } from '../../inventario/models/producto.model';

export interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
    // Padre-hijo
    producto_stock_id?: string;
    cantidad_stock?: number;
    stock_disponible: number;
}
```

- [ ] Completado

### 1.3 Editar `src/app/features/ventas/models/venta.model.ts`

Agregar a la interface VentaDetalle:

```typescript
producto_stock_id?: string;
cantidad_stock?: number;
```

- [ ] Completado

---

## FASE 2 — Servicios

### 2.1 Editar `src/app/features/inventario/services/inventario.service.ts`

**buscarProductosPOS()** — agregar campos al SELECT:

```typescript
.select('id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_hijo_id, factor_conversion')
```

**obtenerProductoPorCodigo()** — ya usa `select('*')` con JOIN, los campos nuevos vienen automaticamente. Verificar que funcione.

**obtenerProductosStockBajo()** — excluir padres:

```typescript
async obtenerProductosStockBajo() {
    const { data } = await this.supabase.client
        .from('productos')
        .select('id, nombre, stock_actual, stock_minimo')
        .eq('activo', true)
        .is('producto_hijo_id', null)  // excluir padres (stock=0 por diseno)
        .order('stock_actual');
    return (data || []).filter(p => p.stock_actual <= p.stock_minimo);
}
```

**Nuevo metodo** — buscar productos candidatos a hijo:

```typescript
async buscarProductosHijo(texto: string): Promise<Pick<Producto, 'id' | 'nombre' | 'stock_actual'>[]> {
    const { data } = await this.supabase.client
        .from('productos')
        .select('id, nombre, stock_actual')
        .eq('activo', true)
        .eq('tipo_venta', 'UNIDAD')
        .is('producto_hijo_id', null)
        .ilike('nombre', `%${texto}%`)
        .order('nombre')
        .limit(10);
    return data || [];
}
```

**Nuevo metodo** — obtener stock del hijo:

```typescript
async obtenerStockHijo(productoHijoId: string): Promise<number> {
    const { data } = await this.supabase.client
        .from('productos')
        .select('stock_actual')
        .eq('id', productoHijoId)
        .single();
    return data?.stock_actual ?? 0;
}
```

- [ ] Completado

### 2.2 Editar `src/app/features/pos/services/pos.service.ts`

En `procesarVenta()`, mapear campos nuevos en JSONB:

```typescript
const items = carrito.map(item => ({
    producto_id: item.id,
    cantidad: item.cantidad,
    precio_unitario: item.precio_venta,
    subtotal: item.subtotal,
    producto_stock_id: item.producto_stock_id || null,
    cantidad_stock: item.cantidad_stock || null
}));
```

- [ ] Completado

---

## FASE 3 — POS

### 3.1 Editar `pos.page.ts` — `agregarAlCarrito()` (linea ~318)

Bifurcar por tipo:

```
SI tipo_venta === 'PESO':
  → Abrir alert con input decimal
  → Header: "{nombre}"
  → Message: "Ingrese peso en {unidad_medida} · ${precio}/{um} · Disponible: {stock} {um}"
  → Input: type="number", step="0.001", inputmode="decimal"
  → Validar: parseFloat > 0, <= stock_actual
  → Agregar al carrito con cantidad decimal, stock_disponible = stock_actual

SI producto tiene producto_hijo_id (ES PADRE):
  → Obtener stock del hijo via inventarioService.obtenerStockHijo()
  → stock_disponible = stockHijo
  → Validar: factor_conversion <= stockHijo
  → Agregar al carrito con:
    - producto_stock_id = producto_hijo_id
    - cantidad_stock = 1 * factor_conversion
    - stock_disponible = stockHijo

SI es UNIDAD normal (sin hijo):
  → Comportamiento actual sin cambios
  → stock_disponible = stock_actual
```

### 3.2 Editar `pos.page.ts` — `agregarAlCarritoConCantidad()` (linea ~355)

- Para PESO: la cantidad ya viene como decimal — usarla directo
- Para PADRE: multiplicar cantidad * factor para validar stock hijo
- Para UNIDAD: sin cambio

### 3.3 Editar `pos.page.ts` — `incrementar()` (linea ~430)

```typescript
incrementar(item: CartItem) {
    if (item.tipo_venta === 'PESO') {
        // Para PESO: abrir alert de edicion en vez de ++
        this.editarCantidad(item);
        return;
    }
    const maxCantidad = item.producto_stock_id
        ? Math.floor(item.stock_disponible / item.factor_conversion)
        : item.stock_disponible;
    if (item.cantidad < maxCantidad) {
        item.cantidad++;
        item.subtotal = item.cantidad * item.precio_venta;
        if (item.producto_stock_id) {
            item.cantidad_stock = item.cantidad * item.factor_conversion;
        }
    } else {
        this.ui.showToast('Maximo stock alcanzado', 'warning');
    }
}
```

### 3.4 Editar `pos.page.ts` — `decrementar()` (linea ~439)

```typescript
decrementar(item: CartItem) {
    if (item.tipo_venta === 'PESO') {
        this.editarCantidad(item);
        return;
    }
    if (item.cantidad > 1) {
        item.cantidad--;
        item.subtotal = item.cantidad * item.precio_venta;
        if (item.producto_stock_id) {
            item.cantidad_stock = item.cantidad * item.factor_conversion;
        }
    } else {
        this.eliminar(item);
    }
}
```

### 3.5 Editar `pos.page.ts` — `editarCantidad()` (linea ~448)

```typescript
async editarCantidad(item: CartItem) {
    const esPeso = item.tipo_venta === 'PESO';
    const esPadre = !!item.producto_stock_id;
    const maxStock = esPadre
        ? Math.floor(item.stock_disponible / item.factor_conversion)
        : item.stock_disponible;
    const uom = esPeso ? ` ${item.unidad_medida}` : '';

    const alert = await this.alertCtrl.create({
        header: item.nombre,
        message: `$${this.currencyService.format(item.precio_venta)} c/u${uom} · Disponible: ${maxStock}${uom}`,
        inputs: [{
            name: 'cantidad',
            type: 'number',
            value: item.cantidad.toString(),
            min: esPeso ? 0.001 : 1,
            max: maxStock,
            attributes: { inputmode: esPeso ? 'decimal' : 'numeric', step: esPeso ? '0.001' : '1' },
            placeholder: esPeso ? 'Ej. 0.400' : 'Cantidad'
        }],
        buttons: [
            { text: 'Cancelar', role: 'cancel' },
            {
                text: 'Confirmar',
                handler: (data) => {
                    const nueva = esPeso ? parseFloat(data.cantidad) : parseInt(data.cantidad, 10);
                    if (!nueva || nueva <= 0) {
                        this.ui.showToast('Cantidad invalida', 'warning');
                        return false;
                    }
                    if (nueva > maxStock) {
                        this.ui.showToast(`Maximo: ${maxStock}${uom}`, 'warning');
                        return false;
                    }
                    item.cantidad = esPeso ? Math.round(nueva * 1000) / 1000 : nueva;
                    item.subtotal = item.cantidad * item.precio_venta;
                    item.subtotal = Math.round(item.subtotal * 100) / 100;
                    if (esPadre) {
                        item.cantidad_stock = item.cantidad * item.factor_conversion;
                    }
                    return true;
                }
            }
        ]
    });
    await alert.present();
}
```

### 3.6 Editar `pos.page.html` — Resultados de busqueda (linea ~150)

Cambiar `{{ prod.stock_actual }}` por stock real calculado + UoM.

Nota: como en la busqueda POS no tenemos el stock del hijo pre-cargado, mostrar el stock del producto tal cual. El padre mostrara stock=0 con badge "Empaque" en vez de "Agotado". Esto se resuelve condicionalmente:

```html
@if (prod.producto_hijo_id) {
  <p>Empaque x{{ prod.factor_conversion }}</p>
} @else if (prod.tipo_venta === 'PESO') {
  <p>Stock: {{ prod.stock_actual }} {{ prod.unidad_medida }}</p>
} @else {
  <p>Stock: {{ prod.stock_actual }}</p>
}
```

### 3.7 Editar `pos.page.html` — Badges en carrito (lineas ~198-201)

Usar `item.stock_disponible` en vez de `item.stock_actual`:

```html
@if (item.stock_disponible <= item.cantidad * (item.factor_conversion || 1)) {
  <ion-badge color="danger">Ultimo!</ion-badge>
}
```

### 3.8 Editar `pos.page.html` — Display cantidad en carrito

Para PESO, mostrar UoM junto a cantidad:

```html
<span>{{ item.cantidad }}{{ item.tipo_venta === 'PESO' ? ' ' + item.unidad_medida : '' }}</span>
```

- [ ] Completado

---

## FASE 4 — Formulario de Producto

### 4.1 Editar `producto-form.page.ts` — FormGroup

Agregar al initForm():

```typescript
tipo_venta: [this.producto?.tipo_venta || 'UNIDAD'],
unidad_medida: [this.producto?.unidad_medida || 'und'],
producto_hijo_id: [this.producto?.producto_hijo_id || null],
factor_conversion: [this.producto?.factor_conversion || 1, [Validators.min(1)]],
```

### 4.2 Editar `producto-form.page.ts` — Validaciones condicionales

```
- Si tipo_venta cambia a 'PESO': setear unidad_medida required, ocultar seccion padre-hijo
- Si checkbox "es empaque" activo: producto_hijo_id required, factor_conversion required min(2)
- Si producto es padre: stock_actual = 0, readonly, help text "Stock se gestiona desde [hijo]"
```

### 4.3 Editar `producto-form.page.ts` — guardar()

```typescript
const productoPayload: Partial<Producto> = {
    ...value,
    // campos existentes...
    tipo_venta: value.tipo_venta,
    unidad_medida: value.tipo_venta === 'PESO' ? value.unidad_medida : 'und',
    producto_hijo_id: value.producto_hijo_id || null,
    factor_conversion: value.producto_hijo_id ? Number(value.factor_conversion) : 1,
    stock_actual: value.producto_hijo_id ? 0 : (Number(value.stock_actual) || 0),
};
```

### 4.4 Editar `producto-form.page.html` — Nuevos campos

Despues de la seccion de IVA, agregar:

```
── Tipo de venta ──
Select nativo: (•) Por unidad  (•) Por peso

── Si PESO: Unidad de medida ──
Select nativo: kg | lb | g | ml | L

── Seccion padre-hijo (solo si tipo_venta = 'UNIDAD') ──
Checkbox: "Es empaque de otro producto"
  Si activo:
    - Buscador de producto hijo (autocomplete)
    - Input: "Unidades por empaque" (min 2)
    - Stock actual: readonly, valor 0, help: "Stock se gestiona desde [nombre hijo]"
```

### 4.5 Editar `producto-form.page.html` — Stock input (linea 207)

Condicional: si es PESO, cambiar `inputmode="numeric"` a `inputmode="decimal"`.
Si es padre, readonly + help text distinto.

- [ ] Completado

---

## FASE 5 — Inventario UI

### 5.1 Editar `inventario.page.ts` — Calcular stock para padres

Para productos padre en la lista, necesitamos el stock del hijo. Opciones:
- **Opcion A**: JOIN en la query `obtenerProductos` para traer `producto_hijo.stock_actual`
- **Opcion B**: Calcular en frontend con una segunda query

Opcion A es mas limpia:

```typescript
// En obtenerProductos(), cambiar el select para incluir hijo:
.select('*, categoria:categorias_productos(*), producto_hijo:productos!producto_hijo_id(stock_actual)')
```

Esto trae `producto_hijo: { stock_actual: number }` cuando existe, null cuando no.

### 5.2 Editar `inventario.page.html` — Badges de stock (lineas 81-93)

```html
@if (prod.producto_hijo_id) {
  <!-- PADRE: calcular paquetes disponibles desde stock hijo -->
  @let paquetes = Math.floor((prod.producto_hijo?.stock_actual || 0) / prod.factor_conversion);
  @if (paquetes === 0) {
    <div class="stock-badge danger shadow-1">Agotado</div>
  } @else {
    <div class="stock-badge success shadow-1">{{ paquetes }}</div>
  }
} @else if (prod.tipo_venta === 'PESO') {
  @if (prod.stock_actual === 0) {
    <div class="stock-badge danger shadow-1">Agotado</div>
  } @else if (prod.stock_actual <= prod.stock_minimo) {
    <div class="stock-badge warning shadow-1">{{ prod.stock_actual }} {{ prod.unidad_medida }}</div>
  } @else {
    <div class="stock-badge success shadow-1">{{ prod.stock_actual }} {{ prod.unidad_medida }}</div>
  }
} @else {
  <!-- UNIDAD normal: sin cambio -->
  ...badges actuales...
}
```

### 5.3 Editar `inventario.page.html` — Indicador visual de padre

Agregar badge "Empaque" debajo del nombre para productos padre.

- [ ] Completado

---

## FASE 6 — Kardex

### 6.1 Editar `kardex.page.ts` — Manejo de padres

Si el producto es padre, redirigir al kardex del hijo:

```typescript
async ngOnInit() {
    this.productoId = this.route.snapshot.paramMap.get('id')!;
    this.productoNombre = this.route.snapshot.queryParamMap.get('nombre') || 'Producto';
    this.stockActual = Number(this.route.snapshot.queryParamMap.get('stock')) || 0;

    // Si es padre, obtener producto para verificar
    const producto = await this.inventarioService.obtenerProductoPorId(this.productoId);
    if (producto?.producto_hijo_id) {
        // Redirigir al kardex del hijo
        const hijo = await this.inventarioService.obtenerProductoPorId(producto.producto_hijo_id);
        if (hijo) {
            this.productoId = hijo.id;
            this.productoNombre = hijo.nombre;
            this.stockActual = hijo.stock_actual;
            this.esPadreRedirigido = true;  // para mostrar aviso en UI
            this.nombrePadre = producto.nombre;
        }
    }

    this.unidadMedida = producto?.unidad_medida || 'und';
    this.tipoPeso = producto?.tipo_venta === 'PESO';
    await this.cargarKardex();
}
```

### 6.2 Editar `kardex.page.html` — Display con UoM

- Stock actual: `{{ stockActual }} {{ unidadMedida !== 'und' ? unidadMedida : '' }}`
- Input cantidad: `inputmode` condicional segun tipoPeso
- Historial: cantidades con UoM
- Si `esPadreRedirigido`: mostrar aviso "Mostrando kardex de {nombreHijo} (base de {nombrePadre})"
- Si es padre: ocultar boton "Ajustar" (no tiene sentido ajustar stock de un padre)

### 6.3 Editar `kardex.page.ts` — Input de ajuste

Para PESO: permitir decimales en `cantidad`. Actualmente el HTML tiene `inputmode="numeric"` — cambiar condicionalmente a `inputmode="decimal"`.

- [ ] Completado

---

## FASE 7 — Ventas (detalle + compartir)

### 7.1 Editar `venta-detalle-modal.component.html` (linea 95)

Agregar UoM a cantidad. Esto requiere que `VentaDetalle` tenga acceso al `unidad_medida` del producto. Opciones:

- **Opcion A**: JOIN en la query de obtenerVentaDetalle para traer unidad_medida del producto
- **Opcion B**: Agregar `unidad_medida` a `ventas_detalles` como snapshot (como ya hacemos con precio_costo)

Opcion A es suficiente (la unidad de medida no cambia frecuentemente):

En `ventas.service.ts` → `obtenerVentaDetalle()`, verificar que el JOIN con productos incluya `unidad_medida`.

Display:

```html
<span class="col-cant">
  {{ item.cantidad }}{{ item.unidad_medida && item.unidad_medida !== 'und' ? ' ' + item.unidad_medida : '' }}
</span>
```

### 7.2 Editar `share-venta.service.ts` (linea 183)

En el canvas de comprobante compartido:

```typescript
const cantText = item.unidad_medida && item.unidad_medida !== 'und'
    ? `${item.cantidad} ${item.unidad_medida}`
    : item.cantidad.toString();
ctx.fillText(cantText, ...);
```

- [ ] Completado

---

## Ejemplos de datos

### Arroz a Granel

```
productos:
  nombre: 'Arroz Blanco'
  tipo_venta: 'PESO', unidad_medida: 'kg'
  precio_venta: 1.50 (por kg), stock_actual: 45.500
  producto_hijo_id: NULL, factor_conversion: 1

Venta 0.400 kg → ventas_detalles:
  cantidad: 0.400, precio_unitario: 1.50, subtotal: 0.60
  producto_stock_id: NULL, cantidad_stock: NULL

Kardex: producto_id: arroz_id, cantidad: 0.400, 45.500 → 45.100
```

### Cajetilla y Cigarro (Padre-Hijo)

```
HIJO:
  nombre: 'Cigarro Lider Suelto'
  tipo_venta: 'UNIDAD', precio_venta: 0.25, stock_actual: 400
  producto_hijo_id: NULL

PADRE:
  nombre: 'Cajetilla Lider x20'
  tipo_venta: 'UNIDAD', codigo_barras: '789123456'
  precio_venta: 4.00, stock_actual: 0
  producto_hijo_id: cigarro_id, factor_conversion: 20

Venta 2 cajetillas → ventas_detalles:
  producto_id: cajetilla_id, cantidad: 2, subtotal: 8.00
  producto_stock_id: cigarro_id, cantidad_stock: 40

Kardex: producto_id: cigarro_id, cantidad: 40, 400 → 360
```

### Cubeta y Huevo

```
HIJO: 'Huevo Suelto', precio: 0.15, stock: 150
PADRE: 'Cubeta x30', precio: 4.00, stock: 0, hijo: huevo_id, factor: 30
```

---

## Riesgos y mitigaciones

| Riesgo | Mitigacion |
|--------|-----------|
| Padre sin hijo configurado | Constraint BD + validacion Angular: producto_hijo_id required si checkbox activo |
| Vender mas que stock hijo | POS valida: `cantidad * factor <= stockHijo` antes de agregar |
| Padre aparece como "stock bajo" en notificaciones | `obtenerProductosStockBajo` excluye `producto_hijo_id IS NOT NULL` |
| Padre muestra "Agotado" en inventario | Badge calculado desde hijo, no desde stock propio |
| Dos padres apuntando al mismo hijo | Permitido y correcto: "Cajetilla x20" y "Carton x200" ambos descuentan de "Cigarro Suelto" |
| Reingreso de stock (compra nueva) | Se hace en el HIJO directo. El padre hereda automaticamente |
| Precio del padre vs costo | El `precio_costo` del padre es el costo del paquete completo. El reporte de ganancia usa `vd.precio_costo * vd.cantidad` — correcto |
| PESO con patron cantidad.codigo en POS | El patron `10.7891234` usa `parseInt("10")` → 10 entero. No hay conflicto: el punto separa cantidad de codigo, no es decimal. Sin cambio |
| Cadena de padres (padre de padre) | Bloqueado por constraint + buscarProductosHijo() filtra `.is('producto_hijo_id', null)` |
| Canvas de comprobante compartido | Agregar UoM al texto de cantidad en share-venta.service.ts |

---

## Orden de ejecucion por fases

```
FASE 0: Schema SQL                    ☐
  0.1 schema.sql — productos (4 campos + 2 constraints)
  0.2 schema.sql — ventas_detalles (2 campos)
  0.3 schema.sql — trigger fn_actualizar_stock_venta
  0.4 fn_registrar_venta_pos.sql
  0.5 fn_anular_venta.sql
  0.6 schema.sql — datos de prueba
  0.7 schema.sql — resumen version

FASE 1: Modelos TS                    ☐
  1.1 producto.model.ts
  1.2 cart-item.model.ts
  1.3 venta.model.ts

FASE 2: Servicios TS                  ☐
  2.1 inventario.service.ts
  2.2 pos.service.ts

FASE 3: POS                           ☐
  3.1-3.5 pos.page.ts (agregar, incrementar, decrementar, editar)
  3.6-3.8 pos.page.html (busqueda, badges, UoM en carrito)

FASE 4: Formulario Producto           ☐
  4.1-4.3 producto-form.page.ts
  4.4-4.5 producto-form.page.html

FASE 5: Inventario UI                 ☐
  5.1 inventario.page.ts (JOIN hijo)
  5.2-5.3 inventario.page.html (badges, indicador padre)

FASE 6: Kardex                        ☐
  6.1 kardex.page.ts (redireccion padre→hijo, UoM)
  6.2-6.3 kardex.page.html (display UoM, input condicional)

FASE 7: Ventas (detalle + compartir)  ☐
  7.1 venta-detalle-modal.component.html
  7.2 share-venta.service.ts
```
