# PLAN — Inventario como Panel Operativo (lista de items, patrón Ventas)

> **Estado:** Propuesta para revisión y aprobación.
> **Fecha:** 2026-07-08.
> **Alcance:** Solo la sección **Inventario** (`features/inventario`). No toca POS, ventas ni caja.
> **Enfoque:** Reemplazar el grid de tarjetas tipo catálogo por una **lista de items (`ion-list`) al estilo de la página de Ventas**: cada producto es una fila con su info y sus acciones directas. Búsqueda y filtros arriba. Todas las funciones actuales se conservan.
> **Regla de oro:** cero pérdida de funciones. Lo que existe hoy sigue existiendo — cambia la presentación (tarjetas → lista de items) y se acerca la acción.

---

## 1. Por qué lista de items y NO una tabla (análisis contra el schema)

Antes de decidir el formato, evalué **todos** los campos reales de la tabla `productos` en `schema.sql` (líneas 576-608) para ver qué vale la pena mostrar en un listado:

| Campo del schema | ¿Vale en el listado? | Destino |
|---|---|---|
| `nombre` | Sí — identifica la fila | **Visible** (título) |
| `stock_actual` | Sí — dato operativo #1 | **Visible** (protagonista, con color) |
| `stock_minimo` | Como *umbral*, no como número | Define el color del stock (agotado/bajo/normal) |
| `precio_venta` | Sí | **Visible** |
| `precio_costo` | Sí (dueño), secundario | **Visible** (segunda línea) |
| `categoria_id` → nombre | Contexto | **Visible** (segunda línea) + chips de filtro |
| `tipo_venta` / `unidad_medida` | Como sufijo (`kg`, `und`) | Pegado al stock |
| `codigo_barras` | Solo para buscar | En la búsqueda, no en la fila |
| `tiene_iva` | Dato fiscal | No se muestra |
| `imagen_url` | Opcional (muchos sin foto) | Thumbnail chico |
| `activo` | Es un filtro | Chip "Desactivados" |
| `producto_template_id` | Agrupación | Item-grupo de variantes |
| `id`, `negocio_id`, `created_at`, `updated_at` | Metadatos | No se muestran |

**Conclusión:** de ~18 campos, solo **5-6 tienen valor operativo**: nombre, stock, precio, costo, categoría, unidad. Una **tabla de columnas** solo es legible en desktop; en el celular (plataforma principal, Android) esas 5-6 columnas no caben sin scroll horizontal —que rechazamos— y colapsan a filas apiladas ilegibles.

**Decisión:** en vez de forzar una tabla que solo sirve en desktop, se usa una **lista de items `ion-list`** (patrón que la página de **Ventas** ya usa con éxito en el proyecto). Cada item apila los 5-6 datos útiles de forma natural y responsiva, con acciones directas. Es el formato correcto para móvil **y** se ve limpio en desktop (la lista se centra con ancho máximo). Sin componentes nuevos, sin scroll horizontal, sin duplicar vistas.

---

## 2. El patrón base: `ion-list` estilo Ventas

La página de Ventas (`ventas-listado.page.html`) ya define el estándar que vamos a replicar:

```
<ion-list>
  <ion-item button (click)="editar")>       ← tap en el item = acción principal
    <div slot="start"> thumbnail/icono </div>
    <ion-label>
       fila 1: nombre + badges
       fila 2: categoría · tags
       fila 3: precio · costo
    </ion-label>
    <div slot="end">
       stock (protagonista)
       [ − ] [ + ]           ← ajuste rápido
       <app-options-menu>    ← menú ⋮ (kárdex, desactivar, variantes)
    </div>
  </ion-item>
</ion-list>
```

**Componentes reutilizados (cero nuevos):**
- `ion-list` / `ion-item` — mismo layout de 3 zonas que Ventas.
- `app-options-menu` (`shared/components/options-menu/`) — el popover ⋮ con `MenuOption[]`, idéntico al de Ventas.
- `AjusteStockModalComponent` — el modal de ajuste, sin cambios.

---

## 3. Inventario de funciones actuales (nada se pierde)

| # | Función actual | Dónde vive hoy | Destino en la lista |
|---|----------------|----------------|---------------------|
| 1 | Listar productos paginados (infinite scroll) | `InventarioPage` | Items de `ion-list`, misma paginación |
| 2 | Agrupar variantes por template | `agruparItems()` | Item-grupo (ver §5.3) |
| 3 | Buscar por nombre/EAN | barra de filtros | Buscador arriba (se conserva) |
| 4 | Filtrar por categoría (chips) | barra de chips | Se conserva + chip "Reponer" |
| 5 | Ver desactivados / reactivar | chip "Desactivados" | Chip + acción en item |
| 6 | Escanear → crear/editar/kárdex | `escanearYCrear()` | Se conserva idéntico |
| 7 | Crear producto (simple/present./variantes) | botón "Nuevo" | Se conserva idéntico |
| 8 | Editar producto | tap card → editar | Tap en el item = editar |
| 9 | Ajustar stock (+/-) | editar→kárdex→ajustar | **Botones − / + en el item (1 tap → modal)** |
| 10 | Ver kárdex/historial | editar→kárdex | **Menú ⋮ del item** |
| 11 | Badges agotado/bajo/normal | overlay imagen | Stock con color + item teñido |
| 12 | Tags peso/presentaciones/variante | `product-category` | Chips en la segunda línea |
| 13 | Precio y costo | card-footer | Tercera línea del item |

> **Ninguna fila se elimina.** Las funciones 9 y 10 solo se acercan.

---

## 4. Decisiones de diseño (tomadas como responsable senior)

### D1 — Vista = **lista de items `ion-list`** (patrón Ventas), no tabla
El formato correcto para móvil (plataforma principal) y limpio en desktop. Reemplaza el grid de tarjetas. Justificado en §1.

### D2 — Ajuste de stock: **botones − / + en el item → modal pre-cargado** (NO edición directa de celda)
El modal `AjusteStockModalComponent` ya obliga a **tipo + motivo** (compra, dañado, conteo físico…). Al tocar − o + se abre pre-cargado en esa dirección.
**Por qué no editar la cifra directo:** en un negocio real, *por qué* cambió el stock importa tanto como el número. La edición inline rompe la trazabilidad del kárdex. La velocidad se gana pre-cargando la dirección. El servicio `ajustarStock()` ya emite `onProductoChange$: ACTUALIZADO` → el item se refresca solo. **Cero backend, cero modal nuevo.**

### D3 — Acciones secundarias en **menú ⋮** (`app-options-menu`, igual que Ventas)
Item limpio con lo frecuente visible (**− / +** y tap=editar); el resto en ⋮: **Ver kárdex · Desactivar · (Ver variantes, si es template)**. Reutiliza el componente de Ventas.

### D4 — Filtro "Reponer" **server-side** en `fn_listar_productos`
Chip "Reponer" que aísla `stock_actual <= stock_minimo` con `p_solo_stock_bajo BOOLEAN DEFAULT FALSE`, para respetar la paginación. Único toque de backend, mínimo.

### D5 — Stock protagonista con color de estado
El stock va en `slot="end"`, grande, con color: rojo/pulse = agotado · ámbar = bajo · neutro = normal. El item entero se tiñe sutil cuando está agotado/bajo → escaneable de un vistazo. Costo se conserva (dato del dueño) en segunda línea.

### D6 — Tap en el item = **Editar**; − / + y ⋮ son targets separados con `stopPropagation`
No se cambia el gesto principal ya memorizado; los controles de acción no disparan la navegación (mismo mecanismo que el ⋮ de Ventas, envuelto en `(click)="$event.stopPropagation()"`).

### D7 — Templates/variantes intactos
El item-grupo (template) NO ajusta stock directo —el stock vive por variante—. Su acción principal es **ver/abrir las variantes**; cada variante individual sí tiene sus − / +.

### D8 — Thumbnail pequeño en `slot="start"`
Miniatura ~40px (placeholder de icono cuando no hay foto), igual que Ventas usa el icono de comprobante. Ayuda a reconocer productos sin ocupar el espacio de una imagen grande de catálogo.

---

## 5. Diseño del item

### 5.1 Item de producto (móvil y desktop, mismo componente)

```
┌────────────────────────────────────────────────────────┐
│ [img]  Coca-Cola 500ml                        ┌──────┐  │
│  40px  Bebidas · x10 present.                 │  24  │  │  ← stock (color)
│        $0.75  ·  costo $0.50                  └──────┘  │
│                                          [ − ] [ + ]  ⋮ │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐   item teñido rojo
│ [img]  Agua 1L                                ┌──────┐  │
│  40px  Bebidas                                │   0  │  │  ← agotado
│        $0.50  ·  costo $0.35                  └──────┘  │
│                                          [ − ] [ + ]  ⋮ │
└────────────────────────────────────────────────────────┘
```

- **slot="start":** thumbnail 40px o placeholder.
- **ion-label:** nombre (+ badges) · categoría·tags · precio·costo.
- **slot="end":** stock grande con color + botones − / + + `app-options-menu`.
- **Tap en el cuerpo** → editar. **− / +** → modal ajuste pre-cargado. **⋮** → kárdex/desactivar/variantes.
- **En desktop:** la lista se centra con ancho máximo (patrón habitual); los mismos slots se ven holgados. No hace falta una tabla.

### 5.2 Buscador y filtros (arriba, se conservan)
- Búsqueda por nombre/EAN (lupa expandible actual, que ya funciona).
- Chips: **Todas · Reponer · [categorías] · Desactivados**.
- Header con escáner + "Nuevo" (idénticos a hoy).

### 5.3 Item-grupo de variantes (template)
- Muestra: nombre del template, stock total, desglose (N agotadas / N bajas), rango de precios, "N variantes".
- Acción principal = **ver/abrir variantes** (como hoy).
- Cada variante individual tiene sus − / + y ⋮.
- ⋮ del grupo: Ver variantes · Editar template.

---

## 6. Fases de implementación

Cada fase es entregable y verificable en APK por separado.

### Fase 1 — Lista de items + ajuste de stock en el item ★ (máximo impacto)
- Reescribir el listado: grid de tarjetas → `ion-list` estilo Ventas.
- Buscador + chips arriba (reusa la lógica de filtros actual).
- Botones − / + por item → `AjusteStockModalComponent` pre-cargado (reusa `ajustarStock()`, auto-refresh vía `onProductoChange$`).
- Stock protagonista con color + item teñido.
- **Sin backend nuevo. Sin componente nuevo.** Elimina el viacrucis: 4-5 taps → 2 taps.
- *Verificable:* ajustar stock desde la lista y ver el item actualizarse solo.

### Fase 2 — Menú ⋮ por item (kárdex + acciones secundarias)
- `app-options-menu` en `slot="end"`: Ver kárdex · Desactivar · (Ver variantes).
- Saca el kárdex de estar enterrado en editar.

### Fase 3 — Filtro "Reponer"
- Chip "Reponer" → `p_solo_stock_bajo BOOLEAN` en `fn_listar_productos` (server-side, respeta paginación).
- *Verificable:* activar el chip y ver solo `stock <= mínimo`, paginado.

### Fase 4 — Item-grupo de variantes + pulido
- Item-grupo para templates (§5.3).
- Revisión dark-mode, safe-area, densidad táctil (targets ≥44px).
- Verificación final: las 13 funciones (§3) siguen operativas.

---

## 7. Impacto técnico

| Área | Cambio | Riesgo |
|------|--------|--------|
| `inventario.page.html` | Reescritura: grid de tarjetas → `ion-list` de items | Medio (grueso visual) |
| `inventario.page.scss` | Estilos de item/lista, estados, thumbnail | Medio |
| `inventario.page.ts` | + orquestación de ajuste desde item, menú ⋮, filtro reponer | Bajo — reusa métodos |
| `AjusteStockModalComponent` | **Sin cambios** — se reusa | Ninguno |
| `app-options-menu` | **Sin cambios** — se reusa (igual que Ventas) | Ninguno |
| `inventario.service.ts` | `obtenerProductos()` acepta flag `soloStockBajo` | Bajo |
| `fn_listar_productos` (SQL) | + `p_solo_stock_bajo BOOLEAN` (Fase 3) | Bajo — un `WHERE` |

**Backend tocado:** solo `fn_listar_productos` en Fase 3. El resto es frontend reutilizando lo existente.

---

## 8. Fuera de alcance
- No se toca el flujo de creación (simple/presentaciones/variantes).
- No se toca POS, ventas, caja ni el kárdex como página (solo se le agrega el atajo desde ⋮).
- No se cambia el modelo de datos (templates/variantes/presentaciones).
- No se ocultan costo/margen — se re-jerarquizan a segunda línea.
- No se permite edición directa del stock en celda (D2 — trazabilidad del kárdex).
- No se implementa una tabla de columnas (§1 — no aporta en móvil).

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Item con − / + y ⋮ se satura en pantalla chica | slot="end" apila stock arriba y controles abajo; targets ≥44px; ⋮ agrupa lo secundario (mismo layout que Ventas, ya probado) |
| Reescritura del listado toca mucho SCSS | Fases: F1 entrega la lista usable; el pulido va en F4 |
| Filtro server-side requiere re-ejecutar SQL | Fase 3 aislada; documentar ejecución como otras funciones del módulo |
| Ajuste de stock en templates confunde | Template no ofrece − / + directo (D7); su acción abre las variantes |

---

## 10. Resumen ejecutivo

El módulo pasa de **grid de tarjetas tipo catálogo** a **lista de items operativa (patrón Ventas)**:

1. **Búsqueda y filtros arriba** — nombre/EAN + chips de categoría y "Reponer".
2. **Items densos con el stock protagonista** — color de estado, escaneable de un vistazo, más productos por pantalla.
3. **Acción directa en el item** — − / + abren el modal de ajuste con trazabilidad (1 tap, hoy son 4-5); tap=editar; ⋮ (kárdex, desactivar, variantes) a un toque.

Todo reutilizando `ion-list`/`ion-item`, `app-options-menu`, `AjusteStockModalComponent` y los eventos reactivos existentes — el mismo stack que Ventas ya usa. Único toque de backend: un `WHERE` opcional en `fn_listar_productos`.

**Análisis de la duda planteada** (¿tabla en web y celular?): descartada. De los ~18 campos del schema, solo 5-6 valen en un listado; una tabla de columnas solo es legible en desktop y colapsa en móvil. La lista de items los presenta bien en ambos sin scroll horizontal ni vistas duplicadas.

**Recomendación de arranque:** Fase 1 — entrega la lista funcional con ajuste de stock en el item, sin backend, riesgo acotado. Validar en APK y seguir con 2→4.
