# Inventario — Documentacion del modulo

Gestion completa de productos: CRUD, categorias, stock, kardex (auditoria),
sistema de presentaciones para multiples formatos de venta, y creacion de
productos con variantes (atributos + opciones combinables).

---

## Estructura de archivos

```
features/inventario/
├── pages/
│   ├── main/                    # Grid de productos con chips de categorias scrollables
│   │   ├── inventario.page.ts
│   │   ├── inventario.page.html
│   │   └── inventario.page.scss
│   ├── selector-tipo/           # Paso previo a crear: elige Producto Simple vs Con Variantes
│   │   ├── selector-tipo.page.ts
│   │   ├── selector-tipo.page.html
│   │   └── selector-tipo.page.scss
│   ├── producto-form/           # Crear (modo simple) / Editar producto (incluye presentaciones)
│   │   ├── producto-form.page.ts
│   │   ├── producto-form.page.html
│   │   └── producto-form.page.scss
│   ├── producto-variantes/      # Wizard 3 pasos para crear productos con variantes
│   │   ├── producto-variantes.page.ts
│   │   ├── producto-variantes.page.html
│   │   └── producto-variantes.page.scss
│   └── kardex/                  # Historial de movimientos + ajustes manuales
│       ├── kardex.page.ts
│       ├── kardex.page.html
│       └── kardex.page.scss
├── services/
│   └── inventario.service.ts    # Queries, CRUD, presentaciones, variantes, ajustes de stock
├── components/
│   ├── presentacion-modal/      # Modal bottom-sheet para crear/editar presentaciones
│   ├── ajuste-stock-modal/      # Modal para registrar ajustes de stock (inventario físico)
│   └── atributo-modal/          # Modal para gestionar atributos (no usado directamente, inline en producto-variantes)
├── models/
│   ├── producto.model.ts        # Producto, ProductoPOS, ProductoPresentacion, Atributo, AtributoOpcion, TipoVenta
│   ├── categoria-producto.model.ts
│   └── kardex.model.ts          # KardexInventario, TipoMovimientoKardex
└── inventario.routes.ts         # Lazy-load: '' | 'nuevo' | 'editar/:id' | 'kardex/:id'
```

---

## Flujo de creacion de producto

Todo el flujo de creación vive en una **sola ruta** (`/inventario/nuevo` → `ProductoCrearPage`) con múltiples pasos internos controlados por la variable `paso`. No hay rutas separadas por tipo de producto.

```
Boton "Nuevo" (o scan codigo)
  ↓
/inventario/nuevo  →  ProductoCrearPage
  paso 0: selector visual de tipo (cards: Simple / Tamaños o empaques / Sabores·colores·tallas)
    ├─ "Simple"               → paso 1: formulario (info + precio + stock) → guardar
    ├─ "Tamaños o empaques"   → paso 1: formulario + sección presentaciones → guardar
    └─ "Con variantes"        → paso 1: datos base
                                paso 2: tipos de variante (atributos + opciones)
                                paso 3: revisar y ajustar SKUs → guardar
```

El scanner pasa `?codigo=EAN` como queryParam al navegar a `/inventario/nuevo`, y `ProductoCrearPage` lo prellenan en el campo de código de barras del formulario simple.

**Protección de datos al salir:** si el usuario intenta salir con datos ingresados sin guardar (gesto de retroceso Android, flecha del header, o al volver del paso 1 al paso 0), se muestra un alert de confirmación "¿Descartar producto?". Si no hay datos, sale directamente sin preguntar.

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
    imagen_url        TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Relacion con granel (PESO)

Presentaciones son ortogonales al tipo de venta. Un producto PESO (granel) no necesita
presentaciones — se vende por peso con modal de cantidad decimal. El formulario solo
muestra la seccion de presentaciones cuando `tipo_venta === 'UNIDAD'`.

---

## Concepto clave: Productos con Variantes (atributos + opciones)

Los **productos con variantes** son grupos de productos fisicamente distintos que comparten
una familia comun, definida por combinaciones de atributos (ej: Sabor, Color, Talla).

Cada variante generada es un **producto completo e independiente** en la tabla `productos`,
con su propio stock, precio y codigo de barras. No existe una tabla padre — la agrupacion
se hace via la tabla `atributos_producto_variante` que mapea cada variante a sus opciones.

```
Atributo: SABOR  →  Opciones: [FRESA, CHOCOLATE, MARACUYA]
Atributo: TAMANIO → Opciones: [CHICO, GRANDE]

Combinaciones generadas:
  Tapioca FRESA CHICO     → producto_id: A, stock: 0, precio: $1.50
  Tapioca FRESA GRANDE    → producto_id: B, stock: 0, precio: $2.00
  Tapioca CHOCOLATE CHICO → producto_id: C, stock: 0, precio: $1.50
  ...
```

### Variantes vs Presentaciones

| | Presentaciones | Variantes |
|---|---|---|
| Ejemplo | Cigarro suelto vs cajetilla x10 | Tapioca Fresa vs Tapioca Chocolate |
| Stock | **Compartido** (unidad base) | **Independiente** por variante |
| Codigo de barras | Uno por presentacion | Uno por variante |
| Relacion fisica | Es el mismo producto | Son productos fisicamente distintos |
| Tabla | `producto_presentaciones` | `atributos` + `atributo_opciones` + `atributos_producto_variante` |

Una variante PUEDE tener sus propias presentaciones.

### Tablas de variantes

```sql
-- Tipos de atributo reutilizables: SABOR, COLOR, TALLA...
CREATE TABLE atributos (
    id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(100) NOT NULL UNIQUE  -- normalizado UPPER(TRIM()) en BD
);

-- Opciones de cada atributo: FRESA, CHOCOLATE, ROJO, AZUL...
CREATE TABLE atributo_opciones (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    atributo_id  UUID NOT NULL REFERENCES atributos(id) ON DELETE CASCADE,
    valor        VARCHAR(100) NOT NULL  -- normalizado UPPER(TRIM()) en BD
);

-- Relacion variante ↔ opciones (qué combinacion define a cada producto)
CREATE TABLE atributos_producto_variante (
    producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
    opcion_id   UUID REFERENCES atributo_opciones(id) ON DELETE CASCADE,
    PRIMARY KEY (producto_id, opcion_id)
);
```

---

## Wizard de creacion con variantes (`ProductoVariantesPage`)

Flujo en 3 pasos dentro de la misma pagina (sin routing entre ellos):

### Paso 1 — Datos base del template

Campos compartidos por todas las variantes:
- Nombre base (ej: "Tapioca") — las variantes se nombran `TAPIOCA FRESA`, `TAPIOCA CHOCOLATE`, etc.
- Categoria, IVA, tipo de venta
- Precio costo y venta base (cada variante hereda estos valores; editables en el paso 3)
- Stock minimo (compartido)
- Margen de ganancia calculado en tiempo real (mismo patron que `ProductoFormPage`)

### Paso 2 — Definicion de atributos y opciones

- Agregar atributos con autocompletado (`buscarAtributos` ILIKE, debounce 300ms)
- Si el texto no coincide con ninguno existente: boton "Crear tipo" llama a `crearOObtenerAtributo()`
- Por cada atributo: agregar opciones con autocompletado (`buscarOpcionesAtributo`)
- Si la opcion no existe: boton "Crear opcion" llama a `crearOObtenerOpcionAtributo()`
- Un atributo puede estar en edicion a la vez (`tipoEnEdicion`), el panel muestra sugerencias
- Resumen en tiempo real: "X combinaciones se generaran"

### Paso 3 — Revision y ajuste de SKUs

- Se generan todas las combinaciones cartesianas de los atributos seleccionados
- Cada SKU muestra nombre, precio costo, precio venta, stock inicial, margen y campo de codigo de barras
- El usuario puede deseleccionar SKUs que no quiere crear (toggle)
- Los precios de cada SKU son editables individualmente
- Boton escaner por SKU (one-shot via `BarcodeScannerService`)
- Boton "Crear X variantes" → llama a `inventarioService.crearProductoConVariantes()` via RPC atomica

### Guardado atomico

```typescript
// Llama fn_crear_producto_con_variantes (RPC SQL) — todo en una transaccion
await this.inventarioService.crearProductoConVariantes({
    nombre, categoria_id, tiene_iva, tipo_venta, unidad_medida,
    atributos_template: [{ atributo_nombre, opcion_ids }],
    variantes: [{ nombre, precio_costo, precio_venta, stock_actual, stock_minimo, opcion_ids, codigo_barras }]
});
```

---

## Listado de inventario (`InventarioPage`) — panel operativo

Desde **2026-07-08** el listado dejó de ser un grid de tarjetas tipo catálogo y es una
**lista de items (`ion-list`) al estilo de la página de Ventas**: un panel de trabajo donde
el dueño/cajero actúa sobre el stock sin navegar. Plan completo: `docs/inventario/PLAN-INVENTARIO-OPERATIVO.md`.

**Por qué lista y no tabla:** de los ~18 campos de `productos`, solo 5-6 tienen valor operativo
(nombre, stock, precio, costo, categoría, unidad). Una tabla de columnas solo es legible en
desktop; en móvil (plataforma principal) colapsa. La lista de items presenta esos datos bien
en ambos, sin scroll horizontal ni vistas duplicadas.

### Anatomía del item (3 zonas, densidad del carrito POS)

Desde **2026-07-09** el item adoptó la densidad de `.cart-item` (carrito del POS, `pos.page.html`):
lista continua con separador fino (`border-bottom`) en vez de cards sueltas con `margin` + `box-shadow`,
`--min-height: 56px` (antes 72px), thumbnail 44px, tipografías compactas. Más productos visibles por
pantalla sin scrollear — mismo criterio que ya resolvió bien la densidad del carrito.

```
[thumb 44px]  Nombre + tags (peso/present./variante)   24 und
              Categoría                                en stock    ⋮
              $venta · costo $costo
```

- **`slot="start"`** — thumbnail 44px (o placeholder icono, bloque de color sólido).
- **`ion-label`** — nombre · categoría+tags · precio+costo (texto secundario, no protagonista).
- **`slot="end"`** — patrón `.item-actions` del carrito: dato grande arriba (`inv-precio-total`,
  aquí el stock) + pill de estado abajo (`inv-stock`, aquí "en stock"/"stock bajo"/"agotado") +
  `app-options-menu` (⋮).
- **Tap en el cuerpo** → editar. **⋮** → Ajustar stock · Ver kárdex · Editar · Desactivar.
- **La lista entera** (`.inv-list`) es una sola superficie con `box-shadow` + `border-radius`,
  no una card por item — igual que `.cart-wrapper` del POS.

### Menú ⋮ por item — todas las acciones (`app-options-menu`, mismo componente que Ventas)

Opciones: **Ajustar stock · Ver kárdex · Editar · Desactivar** (último en rojo). Concentra toda
acción secundaria en un solo punto → `slot="end"` limpio con el stock protagonista sin competencia
visual. El popover ya hace `stopPropagation` internamente, así que `onMenuOpcion()` no recibe el
evento DOM.

**"Ajustar stock"** abre `AjusteStockModalComponent`, que obliga a **tipo + motivo** (compra, dañado,
conteo físico…) → cada movimiento queda trazado en el kárdex. No se permite edición directa de la
cifra (trazabilidad). Al confirmar, `ajustarStock()` emite `onProductoChange$:ACTUALIZADO` y el item
se refresca solo, sin recargar la lista. `ajustandoId` bloquea el item durante la operación.

> **Nota de diseño (2026-07-09):** se descartaron los botones − / + inline. Duplicaban "Ajustar stock"
> del menú ⋮ (ambos abren el mismo modal) y sugerían un stepper de suma/resta directa, cuando en
> realidad el ajuste exige tipo + motivo. El menú ⋮ es la vía única y más honesta.

### Métricas de cabecera — stat-cards cuadradas de resumen ejecutivo (server-side)

Desde **2026-07-11**, bajo el buscador hay **3 stat-cards cuadradas** con el resumen del inventario,
calculadas server-side sobre **todo el catálogo** (no la página cargada) vía `fn_metricas_inventario()`
— una sola pasada sobre `productos` filtrada por negocio:

| Card | Qué muestra | Al tocar |
|------|-------------|----------|
| **Productos** | `total_activos` — productos vendibles (`activo = TRUE`). Tamaño del catálogo | Limpia filtros (muestra todo) |
| **Reposición** | `por_reponer` grande (activos con `stock <= mínimo`) + sub-badge rojo "N agotados" (`agotados`, solo si > 0). Realce ámbar si hay algo por reponer | Activa filtro Reponer |
| **En inventario** | `valor_inventario` — Σ `stock × precio_costo`. Capital invertido en mercadería | Informativa (sin navegación) |

**Decisión de diseño (2026-07-11):** las cards son **bloques cuadrados verticales** (ícono arriba,
número al centro, label abajo) — no pills horizontales — para diferenciarlas claramente de los chips
de filtro que van debajo. Reponer y Agotados se **fusionaron en una sola card**: agotados es un
subconjunto de por_reponer (stock 0 ⊂ stock ≤ mínimo), así que tenerlas separadas era redundante
(ambas caían en el mismo filtro Reponer). Ahora "por reponer" es el número protagonista y los
agotados aparecen como sub-badge rojo solo cuando existen — más limpio, menos ancho, mejor en celular.

- **Clickeables**: informan Y navegan (Reposición → filtro Reponer, Productos → limpia filtros).
- **Valor compacto**: el getter `valorInventarioCompacto` abrevia montos grandes (`12.5k`, `1.2M`)
  para caber en la card; montos < 10.000 usan formato moneda estándar. Fuerza `Number()` porque el
  `SUM(DECIMAL)` de Supabase puede llegar como string.
- **Refresco reactivo**: `cargarMetricas()` se llama al entrar, en pull-to-refresh (`handleRefresh`
  sobrescrito), y ante **toda** mutación de `onProductoChange$` (crear/ajustar/desactivar alteran
  alguna métrica). Es silencioso — nunca bloquea la lista.
- **Estética**: `.metric-card` con ícono en pastilla de color, `grid` de 3 columnas iguales. Design
  tokens (`--ion-color-*`) → dark-mode aware. Las 3 caben sin scroll en celular.
- **Multiplataforma (crítico)** — layout adaptativo dentro de la card:
  - `min-height` fijo, **NO `aspect-ratio`** (un aspect-ratio ata el alto al ancho → en desktop las
    cards se estirarían a cientos de px de alto).
  - **Móvil**: `flex-direction: column` — ícono arriba, número y label debajo (compacto, centrado).
  - **Tablet/desktop (`@media min-width: 600px`)**: `flex-direction: row` alineado al inicio
    (`justify-content: flex-start`) — ícono grande a la izquierda + texto a su lado, tipo dashboard-tile.
    Sin esto, en pantallas anchas el contenido queda flotando al centro con huecos vacíos a ambos lados.
    El ícono y el número crecen en este breakpoint para llenar la card más grande.
  - Hover sutil solo en `@media (hover: hover)` (desktop con puntero, no afecta el táctil).

### Filtro "Reponer" — ¿qué compro? (server-side)

Chip **"Reponer"** en la barra de categorías (junto a "Todas"). Filtra `stock_actual <= stock_minimo`
vía `fn_listar_productos(..., p_solo_stock_bajo => true)` — server-side para respetar la paginación
e infinite-scroll. `soloStockBajo` en el componente; cuando está activo la lista se muestra plana
(sin agrupar por template, igual que "Desactivados").

### Header — dos secciones fijas (búsqueda y filtros), no el patrón POS

Desde **2026-07-09** el header dejó el patrón "lupa + swap de capas" (idéntico al POS, donde
tocar la lupa oculta los chips y muestra el input encima). Ahora son **dos secciones propias,
siempre visibles, apiladas**: `.inv-search-section` (buscador) arriba y `.inv-chips-section`
(chips de categoría) debajo. Jerarquía explícita — el usuario ve de entrada "aquí busco" / "aquí
filtro" sin tener que descubrir el botón lupa. Costo asumido: una fila fija más de alto en vez del
ahorro de espacio del swap — se prioriza claridad sobre densidad en esta franja del header.

`limpiarBusqueda()` reemplaza al antiguo `cerrarSearch()`: solo vacía `buscarTexto` y recarga —
no oculta nada (ya no hay nada que ocultar) ni resetea filtros de categoría. **Búsqueda y chip de
categoría ahora se combinan**, no se pisan: escribir texto con "Reponer" activo sigue filtrando
por stock bajo + el texto buscado (ver `aplicarFiltro()`). Antes (patrón POS) escribir texto
reseteaba categoría/reponer porque compartían la misma barra; con secciones independientes esa
sorpresa ya no aplica. `mostrarDesactivados` y `templateSeleccionado` sí se limpian al buscar
texto — son contextos distintos, no filtros de categoría.

### Chips de categoría — scrollables horizontales

Barra de chips horizontales estilo Google Play / supermercado, en su propia sección `.inv-chips-section`:

- Chips: "Todas" + **"Reponer"** + una por categoria + "Desactivados" (al final, color neutro)
- El chip activo se destaca con fondo primario
- Al tocar un chip, **se centra automaticamente** con `scrollTo({ behavior: 'smooth' })`
  usando la formula: `chipLeft - containerWidth/2 + chipWidth/2`
- La barra oculta el scrollbar nativo en todas las plataformas (`scrollbar-width: none`)

```typescript
// inventario.page.ts
seleccionarCategoria(value: string, event: MouseEvent) {
    this.onFiltroChange(value);
    this.centrarChip(event.currentTarget as HTMLElement);
}
```

### Estado de stock en el item

| Indicador | Condicion | Estilo |
|-----------|-----------|--------|
| Bloque stock rojo + `N agot.` + fila teñida | `stock_actual === 0` | Rojo, animacion pulse, `border-left` rojo |
| Bloque stock ámbar + fila teñida | `0 < stock_actual <= stock_minimo` | Ámbar, `border-left` ámbar |
| Bloque stock neutro | Normal | Fondo `step-100` |
| `kg` / `lb` (inv-tag) | `tipo_venta === 'PESO'` | Azul terciario |
| `N` present. (inv-tag) | Tiene presentaciones activas | Verde secundario |
| Botón "Reactivar" | Producto desactivado (`mostrarDesactivados`) | Item con `opacity: 0.6` |

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

Cuando el POS escanea un codigo, busca en dos tablas en paralelo (`Promise.all()`):

```typescript
// inventario.service.ts → buscarPorCodigoBarras(codigo)
// Ambas queries se lanzan en paralelo — 1 round-trip
const [{ data: prod }, { data: pres }] = await Promise.all([
    supabase.from('productos')
        .select('id, nombre, ...')
        .eq('codigo_barras', codigo)
        .eq('activo', true)
        .maybeSingle(),
    supabase.from('producto_presentaciones')
        .select('id, nombre, factor_conversion, precio_venta, imagen_url, producto:producto_id(id, nombre, ...)')
        .eq('codigo_barras', codigo)
        .eq('activo', true)
        .maybeSingle(),
]);

if (prod) return { producto: prod };
if (pres?.producto) return { producto: pres.producto, presentacion: pres };
// presentacion incluye imagen_url
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

Cuando se crea, edita o desactiva una presentacion, el servicio llama a `emitirCambioPorPresentacion(productoId)`:

1. Hace `obtenerProductoPorId(id)` — que incluye `presentaciones:producto_presentaciones(id)` con filtro `activo = true`
2. Emite evento `ACTUALIZADO` con el producto ya refrescado
3. El grid actualiza la tarjeta (badge de presentaciones, etc.) sin necesidad de navegar

```typescript
// inventario.service.ts — metodo privado
private async emitirCambioPorPresentacion(productoId: string): Promise<void> {
    const producto = await this.obtenerProductoPorId(productoId);
    if (producto) this.productoChange$.next({ tipo: 'ACTUALIZADO', producto });
}
```

> `obtenerProductoPorId` incluye el join a `producto_presentaciones` con filtro de activo.
> El join trae solo el campo `id` — suficiente para `presentaciones.length` en la UI.

---

## Formulario de producto (`ProductoCrearPage` / `ProductoEditarPage`)

### Modos

- **CREAR** (`/inventario/nuevo`): todos los campos editables, stock inicial obligatorio
- **EDITAR** (`/inventario/editar/:id`): codigo de barras readonly, stock readonly, + seccion presentaciones

### Campo de codigo de barras — comportamiento dinamico

Solo editable en modo **CREAR**. En modo EDITAR el codigo es readonly.

El input en modo CREAR tiene dos estados con mensaje de ayuda contextual:
- **Vacio**: mensaje gris con icono `sparkles-outline` — informa que se generara un codigo automaticamente via trigger (`fn_generar_codigo_interno`)
- **Con valor**: mensaje verde con icono `checkmark-circle-outline` — confirma que ese codigo se usara en el POS

El boton de escaner llama a `BarcodeScannerService.scan()` — one-shot, cierra solo al detectar un codigo.

### Margen de ganancia — badge visual

Badge siempre verde (`#2e7d32`) junto al titulo del campo. Muestra porcentaje y monto absoluto.

### Seccion Presentaciones

Disponible en modo **CREAR** y **EDITAR**, solo cuando `tipo_venta === 'UNIDAD'`.

#### Modo EDITAR (desde BD)

Lista de presentaciones activas + opcion de ver inactivas (toggle). Cada presentacion se gestiona via `PresentacionModalComponent` (bottom sheet):
- **Agregar**: modal con callback `onConfirmar` que persiste directamente en BD. Emite `emitirCambioPorPresentacion()` automaticamente desde el servicio.
- **Editar**: modal con callback `onConfirmar` que actualiza en BD.
- **Eliminar**: confirm dialog → soft delete (`activo = false`). Las ventas anteriores conservan historial.
- **Reactivar**: visible en el panel de inactivas, restaura `activo = true`.

#### Modo CREAR (en memoria)

Las presentaciones se acumulan en `presentacionesNuevas[]` sin tocar la BD. Al guardar el producto:
1. `crearProducto()` → obtiene el ID del producto nuevo
2. `crearPresentacion()` en paralelo para cada presentacion (modo silencioso)
3. Se emite un evento `ACTUALIZADO` manual para que el grid lo muestre correctamente

```typescript
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
- Badge de margen siempre verde junto al titulo
- Input de codigo de barras con boton escaner y hint dinamico
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
IF NEW.presentacion_id IS NOT NULL THEN
    v_factor := (SELECT factor_conversion FROM producto_presentaciones WHERE id = NEW.presentacion_id);
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

### `Atributo` / `AtributoOpcion`

```typescript
interface Atributo {
    id: string;
    nombre: string;      // UPPER(TRIM()) — normalizado en BD
}

interface AtributoOpcion {
    id: string;
    atributo_id: string;
    valor: string;       // UPPER(TRIM()) — normalizado en BD
}
```

### `Producto`

```typescript
interface Producto {
    id: string;
    categoria_id?: string;
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
    precio_costo: number;
    codigo_barras?: string;
    es_principal: boolean;
    activo: boolean;
    imagen_url?: string | null;  // path en Storage — resuelto a signed URL por el POS
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
    presentacion_id?: string;
    presentacion_nombre?: string;
    factor_conversion?: number;
}
```

---

## Escaner de codigos de barras

El inventario usa `BarcodeScannerService` (`core/services/`) para todas las operaciones de escaneo. **No llama directamente a `@capacitor-mlkit/barcode-scanning`.**

| Punto de escaneo | Metodo usado | Comportamiento |
|-----------------|-------------|----------------|
| Grid inventario — boton escaner | `scan()` | One-shot: si el producto ya existe ofrece editar o ver kardex; si no existe navega a `/inventario/nuevo?codigo=EAN` |
| Formulario simple — campo codigo | `scan()` | One-shot: parchea `codigo_barras` en el form. Solo en modo CREAR |
| Modal presentacion — campo codigo | `scan()` | One-shot: parchea `codigo_barras` en el form del modal |
| Wizard variantes (paso 3) | `scan()` | One-shot por SKU: parchea `codigo_barras` del SKU correspondiente |

### Formatos soportados

`FORMATOS_DEFAULT` en `BarcodeScannerService`:

```typescript
const FORMATOS_DEFAULT = [
    BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.Code128,
    BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code39,
    BarcodeFormat.QrCode,  // agregado para codigos QR de proveedores
];
```

> Para mas detalles del servicio, ver `docs/core/CORE-README.md` → seccion `BarcodeScannerService`.

---

## Servicio (`inventario.service.ts`)

### Metodos principales

| Metodo | Descripcion |
|--------|-------------|
| `obtenerProductos(buscar?, categoriaId?, page, pageSize)` | Paginado con join categoria |
| `buscarProductosPOS(texto)` | Buscador del POS por texto. RPC `fn_buscar_productos_pos`. Limit 20, incluye presentaciones completas |
| `buscarPorCodigoBarras(codigo)` | Busqueda dual en paralelo: producto + presentaciones. Retorna `{ producto, presentacion? }`. `presentacion` incluye `imagen_url` |
| `obtenerProductosCatalogoPOS(categoriaId?)` | Catálogo completo del POS. RPC `fn_catalogo_productos_pos`. **Filtra correctamente por categoría heredada del template (fix bug 2026-05-30 — antes ocultaba variantes)** |
| `obtenerProductoPorCodigo(codigo)` | Por EAN exacto solo en productos. Usa `maybeSingle()` |
| `obtenerProductoPorId(id)` | Con join categoria y `presentaciones:producto_presentaciones(id)` filtrado por `activo=true` |
| `crearProducto(producto)` | INSERT + emite evento CREADO |
| `actualizarProducto(id, producto)` | UPDATE + emite evento ACTUALIZADO |
| `desactivarProducto(id)` | Soft delete + emite DESACTIVADO |
| `reactivarProducto(id)` | `activo=true` + emite ACTUALIZADO |
| `obtenerPresentaciones(productoId)` | Lista activas, ordenadas por `factor_conversion` |
| `obtenerPresentacionesInactivas(productoId)` | Lista inactivas |
| `crearPresentacion(presentacion, silencioso?)` | INSERT + llama `emitirCambioPorPresentacion()` |
| `actualizarPresentacion(id, data)` | UPDATE + llama `emitirCambioPorPresentacion()` |
| `desactivarPresentacion(id)` | Soft delete + llama `emitirCambioPorPresentacion()` |
| `reactivarPresentacion(id)` | `activo=true` + llama `emitirCambioPorPresentacion()` |
| `ajustarStock(productoId, tipo, cantidad, obs)` | Via `fn_ajustar_stock_inventario`. Emite ACTUALIZADO |
| `obtenerCategorias()` | Lista todas las categorias activas |
| `buscarAtributos(texto)` | ILIKE, limit 10 — autocompletado en wizard variantes |
| `obtenerOpcionesAtributo(atributoId)` | Lista todas las opciones de un atributo |
| `buscarOpcionesAtributo(atributoId, texto)` | ILIKE, limit 10 — autocompletado en wizard |
| `crearOObtenerAtributo(nombre)` | INSERT ON CONFLICT DO NOTHING + SELECT. Nunca falla por duplicado |
| `crearOObtenerOpcionAtributo(atributoId, valor)` | INSERT ON CONFLICT DO NOTHING + SELECT |
| `crearProductoConVariantes(payload)` | RPC atomica `fn_crear_producto_con_variantes` |

---

## Funciones SQL relacionadas

| Funcion | Ubicacion | Descripcion |
|---------|-----------|-------------|
| `fn_ajustar_stock_inventario` | `docs/inventario/sql/functions/` | v1.1 — Ajuste manual + kardex. Filtra por `negocio_id` (multi-tenant) |
| `fn_crear_producto_simple` | `docs/inventario/sql/functions/` | RPC atómica. Valida que la categoría pertenezca al negocio |
| `fn_crear_producto_con_variantes` | `docs/inventario/sql/functions/` | RPC atómica. Valida categoría + cada `atributo_opcion_id` del negocio |
| `fn_listar_productos` | `docs/inventario/sql/functions/` | v2.0 — Lista paginada para gestión de inventario. Subqueries reemplazadas por JOINs explícitos (categoria + template.categoria + LEFT JOIN LATERAL para presentaciones) |
| `fn_buscar_productos_pos` | `docs/pos/sql/functions/` | v1.0 — Buscador del POS por texto (nombre/código). Limit 20. Presentaciones completas + template básico |
| `fn_catalogo_productos_pos` | `docs/pos/sql/functions/` | v1.0 — Catálogo POS con filtro por categoría heredada del template (fix bug variantes 2026-05-30). Presentaciones completas + template_atributos |
| `fn_generar_codigo_interno` | `docs/inventario/sql/functions/` | Trigger: genera `codigo_barras` interno si no se provee |
| `fn_generar_codigo_interno_presentacion` | `docs/inventario/sql/functions/` | Idem para presentaciones |
| `trg_descontar_stock_venta` | `docs/pos/sql/triggers/` | Trigger: descuenta stock al vender (multiplica por `factor_conversion` de la presentación si aplica) |
| `fn_registrar_venta_pos` | `docs/pos/sql/functions/` | v3.0 — RPC atómica con validación multi-tenant y `INSERT ... SELECT FROM jsonb_array_elements` (sin N+1) |
| `fn_anular_venta` | `docs/ventas/sql/functions/` | v2.0 — Revierte stock + caja + `cuentas_cobrar`. `FOR UPDATE` en venta |

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

- Captura y recorte: `StorageService.elegirFuenteFoto()` — flujo completo (cámara/galería → cropper → blob). Defaults: `initialRatio: 'libre'`, `lockRatio: true`. Retorna `{ previewUrl: SafeUrl, rawUrl: string }`. El preview se muestra inmediato; el `rawUrl` se pasa a `uploadImage()` al guardar.
- Upload: `StorageService.uploadImage(rawUrl, subfolder, false)` — el subfolder es `'productos/<categoria>'`, comprime a WebP máx 1600px, calidad 0.92 antes de subir.
- Bucket: `mi-tienda` (privado, aislado por `negocio_id`) en Supabase Storage
- Subfolder: nombre de la categoría sanitizado (`Bebidas` → `bebidas`)
- Al cambiar imagen: `StorageService.replaceImage()` sube la nueva y elimina la anterior atómicamente.
- Al desactivar producto: la imagen se conserva (por si se reactiva)

### Imagenes de presentaciones

La tabla `producto_presentaciones` tiene la columna `imagen_url TEXT` (path en Storage, nullable).

- El campo se incluye en los selects de `buscarProductosPOS()`, `obtenerProductosCatalogoPOS()` y `buscarPorCodigoBarras()`.
- En el POS, `resolverImagen()` resuelve los paths a signed URLs en paralelo para todas las presentaciones del catalogo.
- **Fallback chain** por item en el POS: `presentacion.imagen_url → producto.imagen_url (SKU) → producto_template.imagen_url`
- En `VarianteSelectorModalComponent` las imágenes se muestran condicionalmente con `@if (p.imagen_url)` — si no hay imagen, se muestra el icono `cube-outline` como placeholder.
- El path guardado en BD es el que retorna `uploadImage()`. Nunca guardar la URL firmada.
