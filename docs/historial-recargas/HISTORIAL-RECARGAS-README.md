# Historial Recargas

Feature de **solo lectura** para consultar los snapshots de saldo virtual que deja cada
cierre de turno: con cuánto saldo empezó el turno (CELULAR / BUS), cuánto se vendió y con
cuánto cerró.

## Estructura

```
features/historial-recargas/
├── historial-recargas.routes.ts
└── pages/
    └── historial-recargas/    # Listado paginado, agrupado por fecha, filtro por servicio
```

## Fuente de datos

**Tabla `recargas`** (no `recargas_virtuales`): 1 fila por servicio por turno, escrita por
`fn_ejecutar_cierre_diario` al cerrar (pasos 16-17 del cierre — ver
`docs/caja/3_PROCESO_CIERRE_CAJA.md`). Cada fila trae `saldo_virtual_anterior`, `venta_dia`
(ya descuenta las recargas del proveedor), `saldo_virtual_actual` y `saldo_caja`.

El servicio consumido es **`RecargasService.obtenerHistorialRecargas(page, pageSize, servicio?)`**
(vive en `features/caja/services/recargas.service.ts`) — query directa con RLS, paginada con
`.range()` y filtro server-side opcional por código de servicio (vía JOIN `tipos_servicio!inner`).

## Página (`HistorialRecargasPage`)

- Extiende **`PaginatedListPage<RecargaHistorial>`** — paginación + infinite scroll +
  pull-to-refresh + FAB scroll-to-top heredados. `pageSize` en
  `PAGINATION_CONFIG.historialRecargas`.
- **Agrupación por fecha** client-side (`itemsAgrupados`), re-agrupada tras cada página
  (overrides de `cargar()` y `cargarMas()`).
- **Filtro por servicio** con el shared **`PeriodFilterComponent`** (Todas / Celular / Bus) —
  solo visible si ambos módulos están activos; con uno solo, se preselecciona ese servicio.
  El filtro es **server-side**: con paginación, filtrar en cliente dejaría huecos.
- **Estado vacío** con el shared **`EmptyStateComponent`**.
- Cada fila muestra: saldo virtual, venta del día, saldo de la caja física del servicio y
  el **cuadre** (`saldo_virtual + saldo_caja`).
- Visible solo si `recargas_celular_habilitada` o `recargas_bus_habilitada` están activos.

## Notas

- Sin servicios propios ni SQL custom — los datos los produce el cierre diario.
- Los iconos del listado usan nombres estáticos en ramas `@if` (regla Android de CLAUDE.md).
