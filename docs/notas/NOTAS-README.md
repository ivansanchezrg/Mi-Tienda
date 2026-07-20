# Notas

Feature simple para registro y gestión de notas internas del negocio (recordatorios, pendientes, observaciones).

## Estructura

```
features/notas/
├── notas.routes.ts
├── models/
│   └── nota.model.ts
├── pages/
│   └── list/                # Listado paginado. Cada fila usa app-options-menu (⋮) —
│                             #   NO hay swipe-to-delete (eliminado 2026-07-16)
├── components/
│   └── nueva-nota-modal/    # Bottom sheet único para CREAR y EDITAR (max 500 chars,
│                             #   soporte listas). Modo edición vía @Input() textoInicial
└── services/
    └── notas.service.ts     # CRUD directo via Supabase (sin RPC custom)
```

Dependencia compartida: `app-options-menu` (`shared/components/options-menu/`) — mismo componente `⋮` que usa Inventario, ver `docs/shared/SHARED-README.md`.

## Modelo de datos

Tabla `notas` (Grupo A — multi-tenant):
- `id`, `negocio_id`, `texto`, `completada`, `creada_por`, `completada_por`, `completada_at`, `created_at`
- Constraint: `char_length(texto) BETWEEN 1 AND 500`

## Permisos

- **Lectura/crear/completar/editar:** todos los usuarios autenticados del negocio. Editar **no** está restringido al creador de la nota — cualquiera puede corregir el texto (política RLS `notas_update` sin filtro de `creada_por`).
- **Eliminar:** solo `ADMIN`. Política RLS: `notas_delete USING (negocio_id = get_negocio_id() AND get_rol() = 'ADMIN')`.

## Flujos principales

| Acción | Implementación | Feedback |
|---|---|---|
| Crear nota | `NotasService.crear()` → INSERT directo (incluye `negocio_id`) | Se queda en la lista viendo la nota aparecer arriba — sin overlay, toast `'Nota creada'` (via `supabase.call()`) |
| Editar nota | Menú ⋮ → Editar → reabre `NuevaNotaModalComponent` con `@Input() textoInicial` precargado → `NotasService.editar(id, texto)` → UPDATE directo, retorna `Nota \| null` | Éxito: sin aviso, el texto cambia en la card ante sus ojos. Fallo: `FeedbackOverlayService.error()` |
| Marcar completada / Reactivar | Tap en el ícono de estado → `toggleCompletada()` → `marcarCompletada()`/`reactivar()` → UPDATE, optimistic update con rollback si falla | Sin feedback — el ícono cambiando de estado (círculo ↔ check) ya es la señal. Altísima frecuencia (patrón checklist), un toast/overlay sería ruido |
| Eliminar | Menú ⋮ → Eliminar (solo visible si `esAdmin`) → **Alert de confirmación** ("¿Eliminar esta nota? — Esta acción no se puede deshacer") → `NotasService.eliminar(id)` | `eliminar()` **no** pasa por `supabase.call()` — retorna `{ ok: true } \| { ok: false, sinConexion, mensaje }` para que la página controle el feedback. Éxito: la nota se quita de la lista, sin aviso. Fallo: la nota **permanece** en la lista + `FeedbackOverlayService.error()` (mensaje real: "Sin conexión..." si es error de transporte, o el mensaje del backend) |

Criterio de feedback (toast vs overlay) documentado en detalle en `CLAUDE.md` § "Feedback de acciones — toast vs overlay".

### Editor de texto — auto-numerado de listas (`NuevaNotaModalComponent`)

El textarea detecta líneas que empiezan con `1.`, `1)`, `-`, `*` o `•` seguidas de espacio y continúa la numeración/viñeta automáticamente al presionar Enter (`onKeydown`, patrón `LIST_PATTERN`). **A propósito, un número sin puntuación (`"5 libras"`) NO dispara el auto-numerado** — evita que texto normal como "2 kilos de arroz" se convierta en lista sin que el usuario lo pida; la intención de lista solo es inequívoca con el punto/paréntesis.

Al guardar (`guardar()` → `limpiarTextoFinal()`), se eliminan las líneas finales que quedaron con **solo el prefijo de lista sin contenido** (ej. un `"5."` huérfano si el usuario presiona Enter una vez de más antes de guardar). `texto.trim()` por sí solo no detecta este caso porque el prefijo no es whitespace.

### Renderizado del texto (`notas-list.page.ts` → `lineasVisibles()`)

- El prefijo de lista (`1.`, `-`, `•`) se muestra en **peso normal y color tenue** (`--ion-color-medium`) — es un marcador, no contenido; el texto de la nota es lo que debe destacar visualmente (antes iba en negrita vía `<strong>`, invertía la jerarquía).
- Colapsada (default): solo la primera línea, truncada a 120 caracteres.
- Expandida (`"Ver más"`): todas las líneas, dentro de un contenedor con `max-height: 280px` y scroll interno (`.nota-texto-bloque--expandida`) — una nota muy larga no debe estirar la card sin límite y romper el ritmo de la lista.
- El ícono de estado y el menú ⋮ usan `ion-item::part(native) { align-items: flex-start }` para quedar anclados junto a la primera línea de texto en vez de centrarse respecto a la altura total de la card (relevante en notas expandidas de varias líneas — gotcha de shadow DOM de Ionic, `align-items` normal no penetra el componente).

## Histórico

- **2026-07-16:** Rediseño del listado — swipe-to-delete reemplazado por `app-options-menu` (⋮) con Editar/Eliminar. `NuevaNotaModalComponent` ahora sirve para crear y editar. Fix de bug: eliminar ya no era optimista (esperaba el resultado real antes de quitar la nota de la lista) y ahora pide confirmación previa (antes: un swipe + tap borraba directo, sin Alert). Fix de bug: línea huérfana con solo el prefijo de lista al guardar. Jerarquía tipográfica del prefijo de lista invertida (ya no negrita). Tope de altura en notas expandidas.
- **2026-05-07:** Eliminada `fn_eliminar_nota`. El DELETE va directo con RLS.
- **2026-05-07:** Carpeta `docs/notas/sql/` eliminada (sin SQL custom).
