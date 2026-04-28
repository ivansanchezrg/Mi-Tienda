# Setup — Orden de ejecución en Supabase

Ejecutar en este orden cada vez que se re-ejecute `schema.sql` (el DROP TABLE CASCADE elimina triggers, políticas RLS y publicaciones Realtime).

## Orden

| # | Archivo | Qué hace |
|---|---------|----------|
| 0 | `../schema.sql` | Tablas, tipos, helpers JWT, constraints |
| 1 | `01_rls.sql` | Row Level Security de todas las tablas |
| 2 | `02_triggers.sql` | Triggers (proteger superadmin, códigos automáticos, stock, caja) |
| 3 | `03_functions.sql` | Todas las funciones RPC (negocio, dashboard, inventario, POS, recargas, ventas...) |
| 4 | `04_realtime.sql` | Publicaciones Realtime + REPLICA IDENTITY |
| 5 | `05_seed_dev.sql` | Superadmin para desarrollo (solo dev, no ejecutar en prod) |

## Notas

- Todos los archivos son **idempotentes** — se pueden re-ejecutar sin errores (usan `DROP IF EXISTS`, `CREATE OR REPLACE`, `DO $$ IF NOT EXISTS`).
- Después de ejecutar `04_realtime.sql`, **reiniciar la app** (o recargar en web) para que los servicios Angular abran canales Realtime nuevos.
- Los archivos en las subcarpetas de cada módulo (`docs/dashboard/sql/`, `docs/inventario/sql/`, etc.) son la **fuente de verdad** de cada función/trigger individualmente. Este directorio `setup/` los consolida para facilitar el reset completo.
- Si se modifica una función en su carpeta de módulo, copiar el cambio también en `03_functions.sql`.
