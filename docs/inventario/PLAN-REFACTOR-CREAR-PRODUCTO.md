# Plan de Refactor — Flujo de Creación/Edición de Productos

**Estado:** Pendiente de aprobación  
**Fecha propuesta:** 2026-05-22  
**Afecta:** `features/inventario/` (pages, components, services, routes)  
**No afecta:** SQL, funciones RPC, schema, otros módulos

---

## Contexto y motivación

El flujo actual tiene dos problemas que se van a agravar con cualquier feature nueva:

**Problema 1 — Archivos demasiado grandes con múltiples responsabilidades**

| Archivo | Líneas | Responsabilidades mezcladas |
|---------|--------|-----------------------------|
| `producto-form.page.ts` | 759 | CREAR + EDITAR + presentaciones + imágenes + escáner + lógica de variante (solo lectura) |
| `producto-variantes.page.ts` | 590 | Datos del template + atributos + SKUs + imágenes + escáner |
| `inventario.service.ts` | 611 | Productos + categorías + presentaciones + atributos + templates (30+ métodos) |
| `producto-form.page.html` | 546 | Decenas de `@if (modo === 'CREAR')` / `@if (modo === 'EDITAR')` distribuidos |

**Problema 2 — Gap de funcionalidad: variante + presentación en creación**

El schema permite que un SKU de variante tenga presentaciones propias (`producto_presentaciones.producto_id` apunta al SKU, sin distinción de tipo). La UI solo expone esto en edición (bloque condicional `@if (templateSeleccionado && modo === 'EDITAR')` en `producto-form.page.html:328`). Al crear un producto con variantes, no hay forma de agregar presentaciones a cada SKU — el usuario tiene que entrar a editar cada variante por separado después. Ese flujo es completamente opaco.

---

## Arquitectura objetivo

### Estructura de carpetas resultante

```
features/inventario/
├── pages/
│   ├── main/                          ← sin cambio
│   ├── kardex/                        ← sin cambio
│   │
│   ├── producto-crear/                ← NEW: shell de creación (reemplaza selector-tipo + producto-form modo CREAR)
│   │   ├── producto-crear.page.ts     ← solo orquesta el flujo: paso actual, navegación, submit final
│   │   ├── producto-crear.page.html
│   │   └── producto-crear.page.scss
│   │
│   └── producto-editar/               ← NEW: shell de edición (extrae de producto-form modo EDITAR)
│       ├── producto-editar.page.ts    ← carga el producto, decide qué secciones mostrar
│       ├── producto-editar.page.html
│       └── producto-editar.page.scss
│
├── components/
│   │── (existentes sin cambio)
│   │   ├── ajuste-stock-modal/
│   │   ├── atributo-modal/
│   │   └── presentacion-modal/
│   │
│   ├── producto-info-form/            ← NEW: nombre, categoría, código de barras, imagen, tipo de venta
│   │   ├── producto-info-form.component.ts   (@Input formGroup, @Input modo, @Input categorias)
│   │   ├── producto-info-form.component.html
│   │   └── producto-info-form.component.scss
│   │
│   ├── producto-precios-form/         ← NEW: costo, venta, IVA, margen en tiempo real
│   │   ├── producto-precios-form.component.ts   (@Input formGroup)
│   │   ├── producto-precios-form.component.html
│   │   └── producto-precios-form.component.scss
│   │
│   ├── producto-inventario-form/      ← NEW: stock inicial, stock mínimo
│   │   ├── producto-inventario-form.component.ts   (@Input formGroup, @Input modo)
│   │   ├── producto-inventario-form.component.html
│   │   └── producto-inventario-form.component.scss
│   │
│   ├── producto-presentaciones/       ← NEW: lista + CRUD de presentaciones (reutilizable)
│   │   ├── producto-presentaciones.component.ts   (@Input productoId, @Input modo, @Input presentacionesNuevas)
│   │   ├── producto-presentaciones.component.html
│   │   └── producto-presentaciones.component.scss
│   │
│   ├── producto-atributos-wizard/     ← EXTRAER de producto-variantes.page (paso 2)
│   │   ├── producto-atributos-wizard.component.ts   (@Output atributosChange)
│   │   ├── producto-atributos-wizard.component.html
│   │   └── producto-atributos-wizard.component.scss
│   │
│   └── producto-skus-editor/          ← EXTRAER de producto-variantes.page (paso 3)
│       ├── producto-skus-editor.component.ts   (@Input skus, @Output skusChange)
│       ├── producto-skus-editor.component.html
│       └── producto-skus-editor.component.scss
│
└── services/
    ├── inventario.service.ts          ← REDUCIR: solo lista de productos, búsqueda, kardex, stock bajo
    │                                     (mantiene onProductoChange$ — otros servicios lo emiten)
    ├── producto.service.ts            ← NEW: crearProductoSimple, crearProductoConVariantes,
    │                                     actualizarProducto, desactivar, reactivar, obtenerPorId,
    │                                     obtenerTemplate, obtenerSKUsDelTemplate
    ├── presentacion.service.ts        ← NEW: obtener, crear, actualizar, desactivar, reactivar presentaciones
    └── atributo.service.ts            ← NEW: buscarAtributos, crearOObtener, buscarOpciones, crearOpcion,
                                          obtenerAtributosProducto, guardarAtributosProducto
```

### Rutas — sin cambio externo

Las URLs que expone el módulo **no cambian**. El cambio es solo interno.

```typescript
// inventario.routes.ts — antes y después
{ path: 'nuevo',         loadComponent: ... }  // antes → selector-tipo, después → producto-crear
{ path: 'nuevo-simple',  loadComponent: ... }  // ELIMINAR — absorbido por producto-crear
{ path: 'nuevo-variantes', loadComponent: ... }// ELIMINAR — absorbido por producto-crear
{ path: 'editar/:id',    loadComponent: ... }  // antes → producto-form, después → producto-editar
{ path: 'kardex/:id',    loadComponent: ... }  // sin cambio
```

---

## Diseño del flujo de creación (UX mejorada)

`ProductoCrearPage` reemplaza `selector-tipo` + el flujo de navegación actual. En lugar de una pantalla de elección abstracta que requiere conocimiento previo del modelo de datos, el flujo es progresivo:

```
┌─────────────────────────────────────────────┐
│  Paso 1: Datos básicos                      │
│  [ProductoInfoForm]                         │
│  Nombre · Categoría · Código · Imagen       │
│                                             │
│  "¿Este producto tiene versiones diferentes │
│   (sabor, color, talla)?"  [No] [Sí]       │
└─────────────────────────────────────────────┘
           │                    │
    No (simple)           Sí (variantes)
           │                    │
           ▼                    ▼
┌──────────────────┐   ┌──────────────────────┐
│ Paso 2: Precio   │   │ Paso 2: Atributos     │
│ y stock          │   │ [AtributosWizard]     │
│ [PreciosForm]    │   │ Tipo: SABOR, TALLA... │
│ [InventarioForm] │   │ Opciones: FRESA, XL.. │
└──────────────────┘   └──────────────────────┘
           │                    │
           ▼                    ▼
┌──────────────────┐   ┌──────────────────────┐
│ Paso 3:          │   │ Paso 3: SKUs          │
│ Presentaciones   │   │ [SkusEditor]          │
│ [Presentaciones] │   │ Precio/stock por SKU  │
│ Opcional         │   │ + [Presentaciones]    │ ← gap resuelto
└──────────────────┘   │   por cada SKU        │
           │           └──────────────────────┘
           ▼                    │
┌──────────────────┐            ▼
│ Confirmar y      │   ┌──────────────────────┐
│ Crear            │   │ Confirmar y Crear     │
└──────────────────┘   └──────────────────────┘
```

**Puntos clave del nuevo flujo:**
- El usuario nunca ve "selector de tipo" como pantalla separada — la pregunta de variantes está dentro del flujo, después de escribir el nombre.
- `ProductoCrearPage` es el único que llama a `ProductoService.crearProductoSimple()` o `crearProductoConVariantes()` — los componentes hijos solo emiten datos hacia arriba, nunca llaman a la BD directamente.
- El componente `ProductoPresentacionesComponent` se reutiliza en paso 3 de ambas rutas (simple y variantes). En variantes, se muestra una instancia por cada SKU seleccionado.

---

## Plan de implementación — fases

Las fases están ordenadas para que **el flujo actual nunca quede roto** durante la migración. Cada fase es mergeable por separado.

### Fase 1 — Dividir el servicio (sin tocar UI)

Crear los tres servicios nuevos extrayendo métodos de `inventario.service.ts`.  
`inventario.service.ts` sigue existiendo pero delega internamente o re-exporta para no romper imports existentes durante la transición.

**Archivos nuevos:**
- `services/producto.service.ts`
- `services/presentacion.service.ts`
- `services/atributo.service.ts`

**Archivos modificados:**
- `services/inventario.service.ts` — queda solo con: `obtenerProductos`, `buscarProductosPOS`, `obtenerProductosCatalogoPOS`, `obtenerProductosDesactivados`, `obtenerProductosStockBajo`, `obtenerKardexProducto`, `ajustarStock`, `onProductoChange$`

**Riesgo:** Bajo. Solo mueve métodos entre archivos. Los componentes que importaban `InventarioService` se actualizan para importar el servicio correcto.

**Verificación:** La app compila sin errores. Todas las páginas existentes funcionan igual.

---

### Fase 2 — Extraer componentes de sección

Crear los componentes de formulario reutilizables, probándolos primero dentro de las páginas actuales.

**Orden recomendado (menor a mayor complejidad):**

1. `producto-precios-form` — lógica de margen ya aislada, campos claros
2. `producto-inventario-form` — dos campos simples
3. `producto-info-form` — nombre, categoría, código, imagen, tipo de venta
4. `producto-presentaciones` — extraer la lógica duplicada de `producto-form.page.html:205` y `producto-form.page.html:328`
5. `producto-atributos-wizard` — extraer paso 2 de `producto-variantes.page`
6. `producto-skus-editor` — extraer paso 3 de `producto-variantes.page`

**Criterio de done por componente:** El componente existe como standalone, recibe sus `@Input()`, emite sus `@Output()`, y la página que lo consume funciona igual que antes.

**Riesgo:** Medio. Requiere cuidado con los `FormGroup` compartidos. Patrón: la página crea el `FormGroup` y se lo pasa al componente hijo via `@Input` — los hijos nunca crean sus propios grupos.

---

### Fase 3 — Crear `ProductoEditarPage`

Crear `pages/producto-editar/` usando los componentes extraídos en Fase 2.  
Esta página reemplaza a `producto-form` en modo `EDITAR`.

**Ventaja:** `producto-editar.page.html` no tendrá un solo `@if (modo === 'EDITAR')` — todo su contenido es edición por definición.

**Al terminar esta fase:** Cambiar la ruta `editar/:id` para apuntar a `ProductoEditarPage`. Dejar `ProductoFormPage` solo en modo `CREAR` temporalmente (ya sin código de edición, mucho más pequeña).

**Riesgo:** Medio. La lógica de carga del producto existente y el `@if (templateSeleccionado)` (editar variante vs. producto simple) debe replicarse limpiamente.

---

### Fase 4 — Crear `ProductoCrearPage` y eliminar páginas obsoletas

Crear `pages/producto-crear/` con el flujo progresivo nuevo (sin `selector-tipo` como pantalla separada).

Esta fase resuelve todos los gaps de UX identificados:
- Flujo progresivo (pregunta de variantes inline)
- `ProductoPresentacionesComponent` disponible en paso 3 de variantes
- Concepto de presentaciones con hint del modelo de stock explicado claramente

**Al terminar esta fase:** 
- Cambiar la ruta `nuevo` para apuntar a `ProductoCrearPage`
- Eliminar `pages/selector-tipo/` (ya no es una ruta)
- Eliminar `pages/producto-form/` (reemplazado completamente)
- Eliminar `pages/producto-variantes/` (absorbido por `ProductoCrearPage`)
- Actualizar `inventario.routes.ts`: quitar rutas `nuevo-simple` y `nuevo-variantes`

**Riesgo:** Alto (fase de mayor cambio visible). Requiere prueba completa del flujo en Android antes de mergear.

---

## Contratos de componentes (interfaces)

Definidos aquí para que la implementación sea predecible.

```typescript
// producto-info-form
@Input() formGroup: FormGroup         // { nombre, categoria_id, codigo_barras, imagen_url, tipo_venta, unidad_medida }
@Input() categorias: CategoriaProducto[]
@Input() modo: 'crear' | 'editar'
@Input() esVariante: boolean          // oculta tipo_venta si true (lo hereda del template)
@Output() fotoSeleccionada = new EventEmitter<{ previewUrl: SafeUrl; rawUrl: string }>()
@Output() codigoEscaneado  = new EventEmitter<string>()

// producto-precios-form
@Input() formGroup: FormGroup         // { precio_costo, precio_venta, tiene_iva }
// sin @Output: todo via formGroup

// producto-inventario-form
@Input() formGroup: FormGroup         // { stock_actual, stock_minimo }
@Input() modo: 'crear' | 'editar'    // editar → stock_actual readonly
@Input() tipoVenta: 'UNIDAD' | 'PESO'
// sin @Output

// producto-presentaciones
@Input() productoId?: string          // undefined en modo crear (antes del submit)
@Input() modo: 'crear' | 'editar'
@Input() presentacionesNuevas: PresentacionNueva[]  // binding two-way en modo crear
@Output() presentacionesNuevasChange = new EventEmitter<PresentacionNueva[]>()
// en modo editar: maneja su propio estado (llama directamente a PresentacionService)

// producto-atributos-wizard
@Output() atributosChange = new EventEmitter<AtributoEditor[]>()
@Output() totalCombinacionesChange = new EventEmitter<number>()

// producto-skus-editor
@Input() skus: SkuGenerado[]
@Input() nombreBase: string
@Input() tieneIva: boolean
@Output() skusChange = new EventEmitter<SkuGenerado[]>()
```

---

## Lo que NO cambia

- Funciones SQL: `fn_crear_producto_simple`, `fn_crear_producto_con_variantes`, `fn_ajustar_stock_inventario` — sin modificación.
- URLs públicas: `/inventario/nuevo` y `/inventario/editar/:id` — el usuario externo (deep links, notificaciones) no se ve afectado.
- Componentes existentes: `presentacion-modal`, `ajuste-stock-modal`, `atributo-modal` — se reusan sin cambio.
- Módulo `kardex` — sin cambio.
- `inventario.page.ts` (lista principal) — sin cambio.

---

## Estimación de complejidad por fase

| Fase | Cambio principal | Complejidad | Riesgo de regresión |
|------|-----------------|-------------|---------------------|
| 1 | Dividir servicios | Baja | Bajo (solo imports) |
| 2 | Extraer componentes de sección | Media | Medio (FormGroup compartido) |
| 3 | `ProductoEditarPage` | Media-Alta | Medio (reemplaza flujo activo) |
| 4 | `ProductoCrearPage` + eliminar obsoletos | Alta | Alto (requiere prueba en Android) |

Se recomienda mergear y probar cada fase por separado antes de avanzar a la siguiente.

---

## Pendiente de decisión antes de implementar

1. **¿El flujo de variantes mantiene el stepper visible (paso 1/2/3) o se integra como scroll vertical progresivo?**  
   El stepper actual funciona bien — la pregunta es si el nuevo `ProductoCrearPage` lo hereda o cambia el patrón visual para que la bifurcación simple/variantes sea más natural.

2. **¿Las presentaciones en creación de variantes se muestran por SKU (expandible) o en un paso 4 separado?**  
   Por SKU es más honesto con el modelo de datos, pero puede ser abrumador si hay muchas variantes. Un paso 4 con lista de SKUs + botón "agregar presentación" por cada uno puede ser más manejable.

3. **¿`PresentacionService` llama directamente a la BD en modo editar, o todo pasa por la página padre?**  
   La propuesta actual es: en modo editar el componente llama directo al servicio (igual que hoy en `producto-form`). Esto simplifica el componente padre pero implica que `ProductoPresentacionesComponent` tiene dependencia de servicio además de `@Input`/`@Output`. Es un tradeoff de simplicidad vs. pureza.
