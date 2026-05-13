# Notas

Feature simple para registro y gestión de notas internas del negocio (recordatorios, pendientes, observaciones).

## Estructura

```
features/notas/
├── notas.routes.ts
├── models/
│   └── nota.model.ts
├── pages/
│   └── list/                # Listado paginado con swipe-to-delete
├── components/
│   └── nueva-nota-modal/    # Bottom sheet para crear nota (max 500 chars, soporte listas)
└── services/
    └── notas.service.ts     # CRUD directo via Supabase (sin RPC custom)
```

## Modelo de datos

Tabla `notas` (Grupo A — multi-tenant):
- `id`, `negocio_id`, `texto`, `completada`, `creada_por`, `completada_por`, `completada_at`, `created_at`
- Constraint: `char_length(texto) BETWEEN 1 AND 500`

## Permisos

- **Lectura/edición/completar:** todos los usuarios autenticados del negocio.
- **Eliminar:** solo `ADMIN`. Política RLS: `notas_delete USING (negocio_id = get_negocio_id() AND get_rol() = 'ADMIN')`.

## Flujos principales

| Acción | Implementación |
|---|---|
| Crear nota | `NotasService.crear()` → INSERT directo (incluye `negocio_id`) |
| Marcar completada | `marcarCompletada()` → UPDATE (`completada=true`, `completada_at=NOW()`, `completada_por`) |
| Reactivar | `reactivar()` → UPDATE (`completada=false`, limpia campos relacionados) |
| Eliminar | `eliminar()` → DELETE directo (RLS bloquea no-ADMIN) |

## Histórico

- **2026-05-07:** Eliminada `fn_eliminar_nota`. El DELETE va directo con RLS.
- **2026-05-07:** Carpeta `docs/notas/sql/` eliminada (sin SQL custom).
