# Plan: Completar Feature Inventario

> Fecha: 2026-03-23
> Estado: ✅ Completado

---

## Resumen

Llevar el módulo de inventario de "funcional básico" a **feature completa y profesional**.
Se priorizan los cambios por impacto al negocio y se agrupan en fases lógicas.

---

## Fase 1 — Limpieza y correcciones base

### 1.1 Eliminar campo `descripcion` (no se usa)

El campo existe en BD, modelo y schema pero **nunca se muestra en la UI** ni se usa en ningún formulario.

**Archivos a modificar:**

- [x] `src/app/features/inventario/models/producto.model.ts` — quitar `descripcion?: string`
- [x] `src/app/features/inventario/models/categoria-producto.model.ts` — quitar `descripcion?: string` (tampoco se usa)
- [x] `docs/schema.sql` — quitar `descripcion TEXT` de tablas `productos` y `categorias_productos` (el usuario re-ejecuta el schema completo en Supabase)

### 1.2 Eliminar código muerto: `kardex-modal`

El componente `kardex-modal` existe pero **no se usa en ningún lado**. Se reemplazó por `KardexPage` (ruta completa).

- [x] Eliminar carpeta `src/app/features/inventario/components/kardex-modal/` (3 archivos)

### 1.3 Filtrar productos inactivos en queries

Las queries actuales no filtran `activo = TRUE`, mostrando productos desactivados.

- [x] `src/app/features/inventario/services/inventario.service.ts` — agregar `.eq('activo', true)` en `obtenerProductos()`

---

## Fase 2 — Desactivar/Eliminar productos

### 2.1 Agregar método `desactivarProducto()` en servicio

Soft delete: pone `activo = false`. No elimina de BD (preserva integridad con kardex/ventas).

- [x] `src/app/features/inventario/services/inventario.service.ts` — nuevo método `desactivarProducto(id: string)`
- [x] Emitir evento nuevo en `ProductoChangeEvent` con tipo `'DESACTIVADO'`

### 2.2 Agregar botón "Desactivar" en formulario de edición

Solo visible en modo EDITAR. Confirmación con alert antes de ejecutar.

- [x] `src/app/features/inventario/pages/producto-form/producto-form.page.ts` — nuevo método `desactivarProducto()`
- [x] `src/app/features/inventario/pages/producto-form/producto-form.page.html` — botón al final del form (solo modo EDITAR)
- [x] `src/app/features/inventario/pages/producto-form/producto-form.page.scss` — estilo del botón danger

### 2.3 Reaccionar al evento DESACTIVADO en la lista

- [x] `src/app/features/inventario/pages/main/inventario.page.ts` — manejar `'DESACTIVADO'` en el subscriber de `onProductoChange$`, removiendo el producto del array `items`

---

## Fase 3 — Búsqueda + categoría simultánea

### 3.1 Mantener filtro de categoría al buscar por nombre

Actualmente buscar por nombre y filtrar por categoría funcionan independientemente pero la UX no los combina bien.

- [x] `src/app/features/inventario/pages/main/inventario.page.ts` — verificado: `aplicarFiltro()` no resetea `categoriaSeleccionada` y `seleccionarCategoria()` no resetea `buscarTexto`
- [x] Verificado: `fetchPage()` ya envía ambos parámetros al servicio

---

## Fase 4 — Gestión de categorías (inline con alerts, sin página/componente nuevo)

### 4.1 Métodos de servicio para categorías

- [x] `src/app/features/inventario/services/inventario.service.ts` — agregados:
  - `crearCategoria(nombre: string)` — INSERT + retorna la categoría creada
  - `renombrarCategoria(id: number, nombre: string)` — UPDATE nombre
  - `desactivarCategoria(id: number)` — UPDATE `activo = false`
- [x] `obtenerCategorias()` ahora filtra `.eq('activo', true)`

### 4.2 Crear categoría — botón "+" en los tabs

- [x] `src/app/features/inventario/pages/main/inventario.page.html` — botón "+" al final de los tabs de categoría
- [x] `src/app/features/inventario/pages/main/inventario.page.ts` — método `crearCategoria()`: abre `AlertController` con input de texto para el nombre, valida que no esté vacío, llama al servicio, recarga categorías

### 4.3 Editar/desactivar categoría — opciones en cada tab

Al hacer long-press sobre un tab de categoría, muestra alert con opciones:

- [x] `src/app/features/inventario/pages/main/inventario.page.ts` — métodos `opcionesCategoria(cat)`, `renombrarCategoria(cat)`, `confirmarDesactivarCategoria(cat)`
- [x] `src/app/features/inventario/pages/main/inventario.page.html` — evento `(press)` en cada tab de categoría

---

## Checklist general de calidad (validar al final)

- [x] Verificar que el POS (`pos.page.ts`) no se rompe con los cambios — POS usa `obtenerProductos()` que ahora filtra `activo = true`
- [x] Verificar que no quedan imports huérfanos tras eliminar `kardex-modal` — confirmado con grep
- [x] Build exitoso sin errores de compilación
- [ ] Probar en Android: flujo completo crear → editar → desactivar → verificar que desaparece de lista

---

## Archivos impactados (resumen)

| Archivo | Fases |
| ------- | ----- |
| `models/producto.model.ts` | 1.1 |
| `models/categoria-producto.model.ts` | 1.1 |
| `services/inventario.service.ts` | 1.3, 2.1, 4.1 |
| `pages/main/inventario.page.ts` | 2.3, 3.1, 4.2, 4.3 |
| `pages/main/inventario.page.html` | 4.2, 4.3 |
| `pages/producto-form/producto-form.page.ts` | 2.2 |
| `pages/producto-form/producto-form.page.html` | 2.2 |
| `pages/producto-form/producto-form.page.scss` | 2.2 |
| `docs/schema.sql` | 1.1 |
| `components/kardex-modal/` (eliminar) | 1.2 |
