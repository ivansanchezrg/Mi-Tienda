# Inventario — Documentación de Mantenimiento

## Estructura del módulo

```
src/app/features/inventario/
├── inventario.routes.ts              # 4 rutas (listado, crear, editar, kardex)
├── models/
│   ├── producto.model.ts             # Producto con relación a categoría
│   ├── categoria-producto.model.ts   # Categoría (id, nombre, activo)
│   └── kardex.model.ts               # Movimientos de inventario
├── services/
│   └── inventario.service.ts         # CRUD productos, categorías, kardex
└── pages/
    ├── main/inventario.page.*        # Listado con filtros, escáner, gestión categorías
    ├── producto-form/producto-form.* # Formulario crear/editar producto
    └── kardex/kardex.page.*          # Historial de movimientos + ajustes de stock
```

---

## Rutas

| Ruta                    | Página           | Descripción                              |
| ----------------------- | ---------------- | ---------------------------------------- |
| `/inventario`           | InventarioPage   | Listado principal con filtros y escáner  |
| `/inventario/nuevo`     | ProductoFormPage | Crear producto (acepta `?codigo=` escaneado) |
| `/inventario/editar/:id`| ProductoFormPage | Editar producto existente                |
| `/inventario/kardex/:id`| KardexPage       | Historial + ajustes de stock             |

---

## Flujos principales

### Crear producto
1. Botón "Nuevo" o escanear código de barras
2. Si el código escaneado ya existe → alert con opciones (editar / ver kardex)
3. Si no existe → abre formulario con código pre-rellenado
4. Si no se ingresa código → `fn_generar_codigo_interno` genera EAN-13 automático (prefijo `20`)
5. Imagen opcional: cámara o galería (quality 80, 1200x1600, ~300KB)
6. Al guardar → emite evento `CREADO` que actualiza la lista sin recargar

### Desactivar / Reactivar producto
- **Desactivar:** Soft delete (`activo = false`). No se elimina de BD para mantener trazabilidad en ventas y kardex
- **Reactivar:** Desde el filtro "Productos desactivados" en el select, tocar el producto → confirmar reactivación
- La UI dice "Desactivar", nunca "Eliminar"

### Gestión de categorías
- **Crear/Renombrar:** Desde el menú `...` → abre `OptionsModalComponent` (bottom sheet)
- **Eliminar:** Solo si la categoría no tiene productos (ni activos ni inactivos). Mensajes diferenciados según el caso
- Las categorías desactivadas desaparecen del select

### Kardex (ajustes de stock)
- Tipos de movimiento: `COMPRA`, `AJUSTE_POSITIVO`, `AJUSTE_NEGATIVO`
- Todo ajuste pasa por `fn_ajustar_stock_inventario` (RPC atómica en BD)
- Las ventas POS generan movimientos `VENTA` automáticamente via trigger
- Observaciones obligatorias en cada ajuste

---

## Tablas de BD involucradas

| Tabla                  | Uso                                    |
| ---------------------- | -------------------------------------- |
| `productos`            | Catálogo de productos                  |
| `categorias_productos` | Categorías (Bebidas, Snacks, etc.)     |
| `kardex_inventario`    | Auditoría de movimientos de stock      |
| `ventas_detalles`      | Referenciado por FK (no eliminar productos) |

---

## Funciones PostgreSQL

| Función                        | Archivo                                          | Uso                                      |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| `fn_ajustar_stock_inventario`  | `docs/inventario/sql/functions/fn_ajustar_stock_inventario.sql` | Ajuste atómico de stock + registro kardex |
| `fn_generar_codigo_interno`    | `docs/inventario/sql/functions/fn_generar_codigo_interno.sql`   | Auto-genera EAN-13 (trigger BEFORE INSERT) |

---

## Componentes compartidos usados

| Componente             | Ubicación                              | Uso en inventario                        |
| ---------------------- | -------------------------------------- | ---------------------------------------- |
| `OptionsModalComponent`| `shared/components/options-modal/`     | Menú de opciones de categorías (bottom sheet con breakpoints) |
| `PaginatedListPage<T>` | `shared/pages/paginated-list.page.ts`  | Clase base para listado con infinite scroll |
| `CurrencyInputDirective`| `shared/directives/currency-input/`   | Campos de precio en formulario           |
| `NumbersOnlyDirective` | `shared/directives/numbers-only/`      | Campo de stock en formulario             |

---

## Decisiones de diseño

1. **Soft delete en productos:** Los productos nunca se eliminan de BD porque `ventas_detalles` y `kardex_inventario` los referencian por FK. Se usa `activo = false` y se ocultan de las listas
2. **Categorías no se eliminan con productos asociados:** Ni activos ni inactivos. Evita productos huérfanos sin trazabilidad de categoría
3. **Select nativo para categorías:** En vez de chips horizontales con scroll. Escala mejor con muchas categorías y siempre muestra la selección actual
4. **Código de barras auto-generado:** Productos sin código (a granel, caseros) reciben EAN-13 interno con prefijo `20` (estándar GS1 para uso interno)
5. **Stock atómico:** Todo cambio de stock pasa por función PostgreSQL para evitar race conditions y garantizar consistencia kardex ↔ stock

---

## Storage (imágenes)

- **Bucket:** `productos` (público)
- **Ruta:** `productos/{nombre_categoria}/{id}_{filename}`
- **Políticas RLS:** lectura pública, escritura solo autenticados
- **Compresión:** quality 80, max 1200x1600px (~300KB vs 5MB original)
