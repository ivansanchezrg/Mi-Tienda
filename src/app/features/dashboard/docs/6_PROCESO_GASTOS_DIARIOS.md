# Proceso: Gastos Diarios

## ¿Qué es?

Registro de **gastos operativos de la tienda** (luz, agua, transporte, papelería, etc.).

**Diferencia crítica con Operaciones de Caja (EGRESO):**

| | Gastos Diarios | Egreso de Caja |
|---|---|---|
| Propósito | Gasto operativo de la tienda | Retiro/movimiento de efectivo de una caja |
| Afecta saldos de cajas | ❌ NO | ✅ SÍ |
| Comprobante | Opcional | Obligatorio |
| Categoría | 7 fijas (operativas) | 12 contables |
| Acceso | FAB flotante (siempre visible) | Menú de cada caja |

---

## Archivos

| Archivo | Rol |
|---|---|
| `layout/pages/main/main-layout.page.ts` | FAB → `irAGasto()` → abre `GastoModalComponent` |
| `components/gasto-modal/gasto-modal.component.ts` | Modal: formulario (categoría, monto, foto, observaciones) |
| `components/gasto-modal/gasto-modal.component.html` | Template del modal |
| `services/gastos-diarios.service.ts` | `registrarGasto()`, `getGastos()`, `getTotalGastos()`, `getCategorias()`, `getGastoById()` |
| `pages/gastos-diarios/gastos-diarios.page.ts` | Listado con filtros Hoy/Semana/Mes/Todo + `ComprobanteGastoModalComponent` (inline) |
| `pages/gastos-diarios/gastos-diarios.page.html` | UI del listado |

---

## Base de datos

### `categorias_gastos`

7 categorías fijas predefinidas (no editables desde la app):

| codigo | nombre |
|---|---|
| GS-001 | Servicios Públicos (luz, agua, internet, teléfono) |
| GS-002 | Transporte (combustible, taxi, estacionamiento) |
| GS-003 | Mantenimiento (reparaciones del local, equipos) |
| GS-004 | Limpieza (productos y servicios de limpieza) |
| GS-005 | Papelería (útiles de oficina, suministros) |
| GS-006 | Alimentación (comida y bebidas del personal) |
| GS-007 | Otros (gastos operativos no clasificados) |

### `gastos_diarios`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | Auto |
| `fecha` | DATE | Fecha local — usar `getFechaLocal()`, nunca `toISOString()` |
| `empleado_id` | INTEGER | FK empleados |
| `categoria_gasto_id` | INTEGER | FK categorias_gastos — obligatorio |
| `monto` | DECIMAL(10,2) | > 0 |
| `observaciones` | TEXT | Nullable — detalles adicionales del gasto |
| `comprobante_url` | TEXT | Nullable — **path** en Supabase Storage (no URL firmada) |
| `created_at` | TIMESTAMP WITH TIME ZONE | Auto |

> ⚠️ Este proceso **no usa funciones RPC**. INSERT directo en `gastos_diarios`. No afecta saldos de ninguna caja.

---

## Flujo completo

```
Usuario toca FAB → selecciona "Gasto"
  └─ main-layout.page.ts → irAGasto()
       └─ GastoModalComponent
            ├─ ngOnInit → getCategorias() → dropdown de 7 opciones
            ├─ seleccionarFoto() → ActionSheet (Cámara / Galería / Cancelar)
            │    └─ Camera.getPhoto(quality:80, width:1200, height:1600)
            │         → fotoComprobante = dataUrl (base64, ~200-500 KB)
            └─ confirmar() → modal.dismiss(result, 'confirm')
  └─ gastosService.registrarGasto(data)
       ├─ Si hay foto → storageService.uploadImage(dataUrl) → path en Storage
       │    └─ Si falla la subida → return false (NO continúa)
       ├─ authService.getEmpleadoActual() → empleado_id
       ├─ getFechaLocal() → fecha YYYY-MM-DD
       └─ supabase.from('gastos_diarios').insert({...})
            └─ Si INSERT falla y había foto → storageService.deleteFile(path)
                 (evita imágenes huérfanas en Storage)
```

---

## Cámara y Storage

### Optimización de imágenes

El plugin Capacitor Camera se configura con límites para evitar subir fotos de 3–10 MB:

```typescript
Camera.getPhoto({
  quality:            80,    // 80% calidad
  width:              1200,  // Máx 1200px ancho
  height:             1600,  // Máx 1600px alto
  correctOrientation: true,  // Corrige rotación EXIF en Android
  resultType:         CameraResultType.DataUrl
})
// Resultado: ~200-500 KB en vez de 3-10 MB
```

> Supabase Storage **no comprime automáticamente**. Sin estos límites, la app consumiría cuotas masivamente.

Cuando el usuario cancela la selección, el plugin lanza excepción — el `catch` la silencia (comportamiento correcto).

### Path vs URL firmada

En BD se guarda el **path** (ej: `comprobantes/2026/02/abc123.jpg`), no una URL.

Para ver la imagen → `storageService.getSignedUrl(path)` genera una URL temporal firmada. El bucket `comprobantes` es **privado** — no hay URLs públicas.

---

## Listado (gastos-diarios.page.ts)

- Filtros: **Hoy / Semana / Mes / Todo** — `cambiarFiltro()` recalcula el rango y recarga
- Carga `getGastos()` y `getTotalGastos()` en paralelo con `Promise.all`
- Los gastos se agrupan client-side por `fecha` → `gastosAgrupados[]` con subtotal por día
- Al tocar el ícono de comprobante → `verComprobante(path)`:
  1. `ui.showLoading()`
  2. `storageService.getSignedUrl(path)` → URL firmada
  3. Abre `ComprobanteGastoModalComponent` (componente inline en el mismo `.ts`)
  4. `ui.hideLoading()` en `finally` (nunca queda atascado)

> `ComprobanteGastoModalComponent` está declarado como clase privada al final de `gastos-diarios.page.ts`, no en un archivo separado.

---

## Notas de implementación

- `registrarGasto()` tiene `try/catch` completo con `ui.hideLoading()` en `finally`.
- `getCategorias()` muestra `ui.showError()` si falla (el modal quedaría sin categorías — error visible).
- `getGastos()` y `getTotalGastos()` fallan silenciosamente (retornan `[]`/`0`) — el error lo muestra `cargarGastos()` de la página con un único toast.
- El campo `observaciones` reemplaza al antiguo `concepto` (eliminado en v2.1) — la categoría actúa como título, las observaciones como detalle.
