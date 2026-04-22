# Plan de Implementacion — Variantes con Generacion Automatica de SKUs (v10.1)

> **Estado:** Pendiente de aprobacion
> **Fecha:** 2026-04-20
> **Reemplaza:** v10 (implementacion parcial incorrecta — atributos por SKU en vez de por template)
> **Prerequisito:** No hay datos en produccion — refactor es seguro

---

## El problema con la implementacion actual (v10)

Lo que se implemento: cada producto (SKU) tiene sus propios atributos asignados uno a uno.

Lo que debe ser: el **template** define los tipos de atributo con **todas sus opciones**, y el sistema **genera los SKUs automaticamente** por combinacion.

```
❌ Actual (incorrecto)
  producto-form → asignar SABOR=FRESA a este producto

✅ Correcto
  template TAPIOCA → SABOR: [FRESA, CHOCOLATE, VAINILLA]
                   → genera 3 SKUs automaticamente
```

---

## Modelo mental correcto

```
TAPIOCA (template)
  ├── SABOR: FRESA, CHOCOLATE, VAINILLA      ← atributos del TEMPLATE
  └── TAMAÑO: 500G, 1KG

  Sistema genera:
  ┌─────────────────────────┬────────┬────────┐
  │ SKU                     │ Precio │ Stock  │
  ├─────────────────────────┼────────┼────────┤
  │ TAPIOCA FRESA 500G      │ 1.50   │ 24     │
  │ TAPIOCA FRESA 1KG       │ 2.80   │ 10     │
  │ TAPIOCA CHOCOLATE 500G  │ 1.75   │ 18     │
  │ TAPIOCA CHOCOLATE 1KG   │ 3.00   │  8     │
  │ TAPIOCA VAINILLA 500G   │ 1.50   │  0     │
  │ TAPIOCA VAINILLA 1KG    │ 2.80   │  5     │
  └─────────────────────────┴────────┴────────┘

CAMISETA (template)
  ├── TALLA: XS, SM, MD, LG, XL
  └── COLOR: ROJO, AZUL, NEGRO

  Sistema genera 15 SKUs automaticamente.
```

---

## Arquitectura de BD (sin cambios al schema)

El schema de tablas v10 es correcto. Lo que cambia es **donde viven los atributos**:

```
producto_templates
  └── atributos del TEMPLATE (nuevo: template_atributos)
       └── con sus opciones

productos (SKU)
  └── producto_atributos → que combinacion tiene este SKU
```

### Nueva tabla requerida: `template_atributos`

Esta tabla define **qué atributos y opciones tiene un template**. Es la fuente de verdad para generar SKUs.

```sql
CREATE TABLE IF NOT EXISTS template_atributos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id     UUID NOT NULL REFERENCES producto_templates(id) ON DELETE CASCADE,
    atributo_id     UUID NOT NULL REFERENCES atributos(id) ON DELETE CASCADE,
    UNIQUE (template_id, atributo_id)
);

CREATE TABLE IF NOT EXISTS template_atributo_opciones (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_atributo_id  UUID NOT NULL REFERENCES template_atributos(id) ON DELETE CASCADE,
    atributo_opcion_id    UUID NOT NULL REFERENCES atributo_opciones(id) ON DELETE CASCADE,
    UNIQUE (template_atributo_id, atributo_opcion_id)
);
```

Estas 2 tablas son las que definen la "paleta" de opciones de cada template. La tabla `producto_atributos` existente sigue siendo la que registra qué combinacion tiene cada SKU generado.

---

## Flujo UX correcto — wizard en pagina separada

El formulario actual `producto-form` es para **productos simples**. Las variantes necesitan su propio wizard. Razon: el proceso es diferente, mas largo, y mezclarlos confunde al usuario.

### Ruta nueva: `/inventario/nuevo-template`

**Paso 1 — Datos base del template**
- Nombre (ej: TAPIOCA)
- Categoria, IVA, tipo de venta
- Imagen (opcional)
- Precio base (se copia a todos los SKUs como punto de partida)

**Paso 2 — Definir atributos y opciones**

```
┌────────────────────────────────┐
│ SABOR                      [×] │
│ [FRESA ×] [CHOCOLATE ×] [+]    │
├────────────────────────────────┤
│ TAMAÑO                     [×] │
│ [500G ×] [1KG ×] [+]           │
├────────────────────────────────┤
│ + Agregar tipo de atributo     │
└────────────────────────────────┘
```

- Cada tipo tiene sus chips de opciones (eliminables con ×)
- Botón [+] para agregar más opciones al tipo
- Botón [+ Agregar tipo] para agregar TALLA, COLOR, etc.

**Paso 3 — Previsualizar y ajustar SKUs generados**

Sistema muestra la matriz de combinaciones:

```
¿Generamos 4 variantes?

[✓] TAPIOCA FRESA 500G      Precio: [1.50]  Stock: [24]
[✓] TAPIOCA FRESA 1KG       Precio: [2.80]  Stock: [10]
[✓] TAPIOCA CHOCOLATE 500G  Precio: [1.75]  Stock: [18]
[✓] TAPIOCA CHOCOLATE 1KG   Precio: [3.00]  Stock: [ 8]
```

- Nombre auto-generado: `{template} {opcion1} {opcion2}...` (editable)
- Precio pre-rellenado con el precio base (ajustable por fila)
- Stock inicial por SKU
- Checkbox para excluir combinaciones que no existen

**Paso 4 — Confirmar**

Botón "Generar variantes y guardar". Crea:
1. El template
2. Los atributos/opciones (upsert)
3. Los registros en `template_atributos` y `template_atributo_opciones`
4. Los SKUs seleccionados en `productos`
5. Los registros en `producto_atributos` por SKU

---

## Flujo UX — agregar variantes a template existente

Desde la lista de inventario, en la tarjeta de cualquier SKU que tenga template:
- Botón "Ver variantes del template" → abre pagina `/inventario/template/:id`
- En esa pagina: ver todos los SKUs, agregar nuevos (se abre el mismo wizard desde paso 2)

---

## Impacto en codigo — que cambia vs. lo actual

### BD (schema.sql)
- Agregar tablas: `template_atributos`, `template_atributo_opciones`
- Las tablas `atributos`, `atributo_opciones`, `producto_atributos`, `producto_templates` ya existen y se mantienen

### Servicio (`inventario.service.ts`)
Agregar metodos:
- `obtenerAtributosTemplate(templateId)` → devuelve los tipos + opciones del template
- `guardarAtributosTemplate(templateId, atributos[])` → upsert completo
- `generarSKUs(templateId, combinaciones[])` → crea los productos + producto_atributos

Mantener sin cambios:
- `buscarTemplates`, `crearOObtenerTemplate`, `obtenerSKUsDelTemplate`
- Todos los metodos de `atributos` y `atributo_opciones`

### Componentes nuevos
- `pages/nuevo-template/nuevo-template.page.ts/.html/.scss` — wizard 3 pasos
- `components/template-atributos-editor/` — editor reutilizable de atributos+opciones (Paso 2)
- `components/skus-preview/` — tabla editable de SKUs a generar (Paso 3)

### `producto-form` — simplificar
Eliminar toda la seccion de "Variantes" del formulario actual. Reemplazar por:
```
┌─────────────────────────────────┐
│ Este producto tiene variantes?  │
│ [Crear con variantes →]         │
└─────────────────────────────────┘
```
El boton navega a `/inventario/nuevo-template`.

Si el producto YA tiene template (edicion), mostrar:
```
┌──────────────────────────────────┐
│ 🎨 TAPIOCA · 6 variantes         │
│ [Ver y gestionar variantes →]    │
└──────────────────────────────────┘
```

### Rutas nuevas
```typescript
{ path: 'nuevo-template', loadComponent: ... },
{ path: 'template/:id',   loadComponent: ... },  // gestionar variantes existentes
```

---

## Lo que NO cambia

| Modulo | Razon |
|--------|-------|
| POS | Opera por `productos.id` — cada SKU se vende igual |
| `producto_presentaciones` | Cuelga de `productos.id`, sin cambios |
| Ventas, kardex, cuentas_cobrar | FK a `productos.id` — sin cambios |
| Triggers y funciones SQL | Reciben `producto_id` (el SKU) |
| Productos simples | `producto_template_id = NULL`, flujo identico al actual |

---

## Orden de implementacion

### Fase 1 — BD
1. Agregar `template_atributos` y `template_atributo_opciones` a `schema.sql`
2. Agregar RLS para las 2 tablas nuevas
3. Agregar metodos al servicio

### Fase 2 — Wizard nuevo template
4. Crear `nuevo-template.page` con wizard 3 pasos
5. Crear `template-atributos-editor` component (Paso 2)
6. Crear `skus-preview` component (Paso 3)
7. Agregar rutas

### Fase 3 — Simplificar producto-form
8. Reemplazar seccion "Variantes" por el boton de navegacion
9. Limpiar estados/metodos de atributos inline que ya no se usan

### Fase 4 — Pagina de gestion de template
10. Crear `template-detail.page` para ver/agregar SKUs a un template existente

---

## Fuera de alcance (fase 2+)

- Selector visual de variantes en POS (buscar "TAPIOCA" y elegir sabor)
- Stock agregado del template (suma de todos sus SKUs)
- Imagen por variante (override de imagen del template)
- Reporte de ventas agrupado por template
- Filtros por atributo en lista de inventario
