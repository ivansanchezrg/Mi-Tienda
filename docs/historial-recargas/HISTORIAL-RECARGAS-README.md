# Historial Recargas

Feature de **solo lectura** para consultar el histórico de recargas virtuales (CELULAR / BUS) registradas con el proveedor.

## Estructura

```
features/historial-recargas/
├── historial-recargas.routes.ts
└── pages/
    └── historial-recargas/    # Listado paginado por filtros de fecha y tipo
```

## Responsabilidades

- Mostrar listado de recargas registradas (con paginación e infinite scroll vía `PaginatedListPage`).
- Filtros por servicio (CELULAR/BUS), estado (pagado/pendiente), rango de fechas.
- Reutiliza `RecargasVirtualesService` del feature `recargas-virtuales/services/`.

## Notas

- Sin servicios propios — consume datos de `recargas-virtuales`.
- Sin SQL custom — query directa a la tabla `recargas_virtuales` con filtros (RLS aplica `negocio_id`).
- Visible solo si los módulos `recargas_celular_habilitada` o `recargas_bus_habilitada` están activos en el negocio.
