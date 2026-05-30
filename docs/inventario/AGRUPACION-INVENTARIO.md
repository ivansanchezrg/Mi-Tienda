# Agrupación de productos en Inventario

> Fecha de inicio: 2026-05-27
> Estado: ✅ Fase 1 implementada
> Módulo afectado: `src/app/features/inventario/pages/main/`

## Contexto

Antes de este cambio, el grid de inventario mostraba **cada SKU como una card individual**. Esto generaba problemas en negocios con productos de muchas variantes (ej. una camiseta con tallas S/M/L × 4 colores = 12 cards casi idénticas) saturando la pantalla y dificultando ver el inventario como entidades de negocio reales.

El POS ya resuelve esto agrupando variantes por template (`pos.page.ts` → `agruparParaCatalogo()`). Llevamos esa estrategia a inventario, pero con criterios diferentes adecuados al caso de uso de "gestión" vs "venta".

## Decisión arquitectónica

**Agrupamos solo variantes (templates), NO presentaciones.**

| Tipo de producto | ¿Se agrupa en inventario? | Razón |
|---|---|---|
| Producto simple | No | Cada simple es 1 card |
| Producto con presentaciones | No | Las presentaciones **comparten stock** del padre (vía `factor_conversion`). Mostrarlas separadas confundiría — la card del producto base ya muestra el badge "🏷 N present." |
| Producto con variantes (template) | **Sí**, agrupado en una sola card | Las variantes (talla × color) son SKUs independientes con stock propio. Mostrar 12 cards idénticas satura |

**Estrategia de implementación:** la agrupación sucede en el **cliente**, no en la BD. La función SQL `fn_listar_productos` sigue paginando por SKU; el cliente agrupa los SKUs que comparten `producto_template_id` en una card de template virtual antes de renderizar. Mismo patrón que `pos.page.ts`.

**Por qué no en BD:**
- Reescribir la paginación SQL para agrupar requiere cambiar contratos
- El POS ya probó este enfoque en cliente sin problemas de performance
- Permite alternar entre vista agrupada e individual sin re-fetch

## Fase 1 — Implementado (2026-05-27)

### Funcionalidad

1. **Toggle vista agrupada/lista** en el header de inventario
   - Icono `apps-outline` (default, agrupada) ↔ `list-outline` (plana)
   - Persistido en `Capacitor Preferences` con clave `inventario_vista_agrupada`
   - Default: **agrupada** (mejor para gestión operativa)

2. **Card de template agrupado** — visualmente distinta:
   - Borde sutil primary para diferenciar de cards de SKU
   - Foto del template (o icono `color-palette-outline` si no tiene)
   - Badge "N variantes" arriba-izquierda (color primary)
   - Badge de stock arriba-derecha con lógica agregada:
     - `success` → todas las variantes con stock normal, muestra stock total
     - `warning` → "N bajo" si alguna está bajo el mínimo
     - `danger` → "N agotadas" si alguna está en cero
   - Pie del card: rango de precios (`$10 – $15`) o precio único si todas las variantes valen lo mismo
   - Botón visual "Ver variantes →" como CTA

3. **Tap en card de template** → filtra el grid por ese template (reusa `templateSeleccionado`). Muestra las variantes individuales como cards normales, cada una editable.

4. **Búsqueda y filtros respetados:**
   - Al buscar texto o filtrar por categoría → la agrupación se mantiene (los resultados se agrupan post-fetch)
   - Si se selecciona un template específico → se desactiva la agrupación automáticamente (vemos los SKUs internos)
   - Vista "Desactivados" → siempre desagrupada (cada SKU desactivado se gestiona individualmente)

### Modelo de datos

```typescript
// En inventario.page.ts
type InventarioItem =
    | { kind: 'simple'; producto: Producto }
    | {
        kind: 'template';
        templateId: string;
        templateNombre: string;
        templateImagenUrl?: string | null;
        categoriaNombre?: string;
        variantes: Producto[];
        stockTotal: number;
        stockBajo: number;        // # variantes con stock <= stock_minimo y > 0
        stockAgotado: number;     // # variantes con stock = 0
        precioMin: number;
        precioMax: number;
      };
```

`itemsGrid` (getter) calcula este array desde `items: Producto[]` (heredado de `PaginatedListPage`). Se ejecuta en cada change detection — Angular optimiza con `track item.kind === 'template' ? 'tmpl-'+id : 'prod-'+id` en `@for`.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/app/features/inventario/pages/main/inventario.page.ts` | Tipo `InventarioItem`, `vistaAgrupada`, `itemsGrid`, `agruparItems()`, `abrirTemplate()`, `toggleVistaAgrupada()`, persistencia via `Preferences` |
| `src/app/features/inventario/pages/main/inventario.page.html` | `@for` con dos ramas (`item.kind === 'simple'` vs `template`), botón de toggle en header |
| `src/app/features/inventario/pages/main/inventario.page.scss` | `.product-card--template`, `.template-badge`, `.template-ver-variantes` |

### Schema BD

**Sin cambios.** Toda la info ya está en:
- `productos.producto_template_id` (FK al template)
- `producto_templates.id, nombre, imagen_url, categoria_id`
- `producto_templates.categoria` (vía JOIN en `fn_listar_productos`)

## Edge cases manejados

- **Template con 1 sola variante:** se agrupa igual (muestra "1 variantes"). Razón: comportamiento predecible — si un usuario eliminó 11 variantes y dejó 1, sigue siendo un producto-con-variantes en BD y no queremos cambiar la UI por debajo
- **Stock total con variantes desactivadas:** la función `fn_listar_productos` ya filtra por `activo=true`, así que solo se cuentan las activas
- **Paginación con agrupación:** si una página de 25 SKUs tiene 12 del mismo template, la grilla muestra ~14 cards (1 del template + 13 de otros). El infinite scroll trae más naturalmente. **Trade-off aceptado:** no compensamos pidiendo más páginas — mantiene la lógica simple y al usuario no le molesta scrollear
- **Imagen del template:** se resuelve junto con la imagen del producto en `resolverImagenesLote()` para no hacer N+1 requests
- **Cambio de tab (Ionic cachea la página):** la preferencia se lee solo en `ngOnInit`, no se sincroniza entre pestañas — caso real raro, no merece complejidad extra

## Fase 2 — A futuro (si se requiere)

Funcionalidades evaluadas y **postpuestas** por no ser críticas:

### 2.1 Acordeón inline para presentaciones
Mostrar las presentaciones de un producto desplegables dentro de su card, sin tener que entrar a editar. **No implementado** porque:
- El badge actual "🏷 N present." ya comunica que existen
- Entrar a editar es 1 tap → el costo es mínimo
- Saturaría la grilla en negocios con muchos productos con presentaciones

Si se implementa, sugerido: botón discreto al pie de la card que despliegue una lista compacta con stock-equivalente por presentación (`5 lb × factor 5 = 25 lb`).

### 2.2 Vista matriz para conteo físico de variantes
Página dedicada al hacer tap en un template: matriz `filas = tallas × columnas = colores` con stock editable por celda. Útil para **conteos físicos mensuales** en tiendas de ropa.

Costo medio: requiere componente nuevo + endpoint para actualizar varios stocks atómicamente. **No prioritario** salvo que el feedback de usuarios lo pida.

### 2.3 Compensación de paginación
Si en el futuro la agrupación deja la pantalla casi vacía (templates con muchísimas variantes), agregar lógica que pida más páginas automáticamente hasta tener N cards visibles. **No urgente.** Lo más probable es que un negocio tenga un puñado de productos con variantes, no decenas.

### 2.4 Badge "actualización masiva"
En el card del template agrupado, ofrecer acciones rápidas tipo "ajustar precio de todas las variantes en %X". **Nice-to-have**, no crítico — hoy se hace una por una entrando a cada variante.

### 2.5 Búsqueda por código de barras de variante
Hoy si el cajero escanea el código de barras de una variante específica (ej. "Camiseta M Roja"), llega a la página de edición de ese SKU. En vista agrupada esto podría mejorarse para llevar al template y abrir esa variante destacada. **Cambio menor**, no es bug crítico.

## Limitaciones conocidas

1. **El stock total agregado puede engañar:** "Camiseta: 48 unidades" suena bien, pero pueden ser 47 XL y 1 M. **Mitigación implementada:** el badge `warning`/`danger` muestra cuántas variantes están bajo/agotadas — pista visual clara
2. **Los productos con presentaciones NO se agrupan** — visto como decisión consciente, no como limitación. Si en el futuro se requiere, ver Fase 2.1
3. **El toggle es por dispositivo** (Preferences es local). Un usuario que use la app en celular Y tablet verá la preferencia separada en cada uno

## Referencias

- Patrón de agrupación del POS: `src/app/features/pos/pages/pos/pos.page.ts` → `agruparParaCatalogo()`
- Schema relevante: `docs/setup/schema.sql` tablas `productos`, `producto_templates`, `template_atributos`, `producto_atributos`
- Plan original de variantes: `docs/inventario/PLAN-ATRIBUTOS-VARIANTES.md`
