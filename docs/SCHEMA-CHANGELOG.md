# Schema Changelog

## 2026-02-28 — Limpieza de campos redundantes / innecesarios

### `turnos_caja`
- ❌ Eliminado: `fecha DATE NOT NULL` (redundante con `hora_fecha_apertura`)
- ❌ Eliminado: `created_at TIMESTAMPTZ DEFAULT NOW()` (redundante)
- ✏️ Renombrado: `hora_apertura` → `hora_fecha_apertura TIMESTAMPTZ NOT NULL`
- ❌ Eliminado: constraint inline `UNIQUE(fecha, numero_turno)`
- ✅ Agregado: `CREATE UNIQUE INDEX idx_turnos_caja_fecha_turno ON turnos_caja ((CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)), numero_turno)`

### `tipos_servicio`
- ❌ Eliminado: `fondo_base DECIMAL(12,2)` (ya no aplica al modelo actual)
- ❌ Eliminado: `frecuencia_recarga VARCHAR(20)` (informativo sin uso real)

### `recargas`
- ❌ Eliminado: `validado BOOLEAN DEFAULT FALSE` (sin función en el flujo)

### `operaciones_cajas`
- ❌ Eliminado: `created_at TIMESTAMPTZ DEFAULT NOW()` (duplicaba `fecha`)

---

### Archivos TypeScript actualizados
| Archivo | Cambio |
|---|---|
| `models/turno-caja.model.ts` | Renombrado `hora_apertura` → `hora_fecha_apertura`, eliminados `fecha` y `created_at` |
| `models/operacion-caja.model.ts` | Eliminado `created_at` |
| `services/turnos-caja.service.ts` | Filtros por fecha usando rango en `hora_fecha_apertura`, INSERT actualizado |

### Archivos SQL doc actualizados
- `docs/dashboard/sql/functions/ejecutar_cierre_diario.sql`
- `docs/dashboard/sql/queries/insertar_datos_reales_recargas.sql`
