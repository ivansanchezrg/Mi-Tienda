# Plan de Implementación — 3 Puntos Prioritarios

Fecha: 2026-03-25
Estado: **PENDIENTE APROBACIÓN**

---

## Resumen

| # | Punto | Esfuerzo | Archivos nuevos | Archivos modificados |
|---|-------|----------|-----------------|---------------------|
| 1 | Anulación de venta | Medio | 1 (SQL) | 3 (service + page.ts + page.html) |
| 2 | Reporte ventas del día | Medio | 3 (SQL + service + model) | 2 (page.ts + page.html) |
| 3 | Actualizar schema.sql | Bajo | 0 | 1 |

---

## PUNTO 1: Anulación de Venta

### Contexto del schema actual

- `kardex_inventario.tipo_movimiento` ya tiene `'ANULACION_VENTA'` en su CHECK constraint (schema.sql línea 294). **No requiere cambio en BD.**
- `ventas.estado` ya tiene `CHECK (estado IN ('COMPLETADA', 'ANULADA'))`. **No requiere cambio en BD.**
- Ambos campos estaban preparados desde el diseño original.

### 1.1 — Función SQL: `fn_anular_venta`

**Archivo nuevo:** `docs/pos/sql/functions/fn_anular_venta.sql`

**Parámetros:**
```sql
CREATE OR REPLACE FUNCTION public.anular_venta(
    p_venta_id    UUID,
    p_empleado_id INTEGER,
    p_motivo      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

**Flujo interno (todo atómico en una transacción):**

```
1. Validaciones previas:
   → SELECT id, estado, metodo_pago, total, numero_comprobante
     FROM ventas WHERE id = p_venta_id
   → Si no existe: RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id
   → Si estado = 'ANULADA': RAISE EXCEPTION 'La venta #% ya fue anulada', numero_comprobante

2. Reponer stock por cada línea del detalle:
   FOR cada row en (SELECT producto_id, cantidad FROM ventas_detalles WHERE venta_id = p_venta_id)
   LOOP
     → Leer stock_actual de productos
     → UPDATE productos SET stock_actual = stock_actual + cantidad
     → INSERT kardex_inventario (
           producto_id, tipo_movimiento = 'ANULACION_VENTA',
           cantidad = detalle.cantidad,
           stock_anterior, stock_nuevo,
           referencia_id = p_venta_id,
           observaciones = 'Anulación Venta POS: ' || p_motivo
       )
   END LOOP

3. Revertir saldo de caja — SOLO si metodo_pago = 'EFECTIVO':
   → SELECT id, saldo_actual FROM cajas WHERE codigo = 'CAJA'
   → SELECT id FROM categorias_operaciones WHERE tipo = 'EGRESO' AND nombre ILIKE '%Ventas%' LIMIT 1
   → SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1
   → INSERT operaciones_cajas (
         caja_id, empleado_id = p_empleado_id,
         tipo_operacion = 'EGRESO', monto = venta.total,
         saldo_anterior, saldo_actual = saldo_anterior - venta.total,
         categoria_id, tipo_referencia_id, referencia_id = p_venta_id,
         descripcion = 'Anulación Venta POS #' || numero_comprobante
     )
   → UPDATE cajas SET saldo_actual = saldo_actual - venta.total WHERE codigo = 'CAJA'

4. Anular cuenta por cobrar — SOLO si metodo_pago = 'FIADO':
   → DELETE FROM cuentas_cobrar WHERE venta_id = p_venta_id
     (elimina todos los pagos parciales registrados — la deuda desaparece)
   → UPDATE ventas SET estado_pago = 'NO_APLICA' (se hace en el paso 5)

5. Marcar la venta como anulada:
   → UPDATE ventas
     SET estado = 'ANULADA',
         estado_pago = 'NO_APLICA',
         observaciones = COALESCE(observaciones || ' | ', '') || 'ANULADA: ' || p_motivo
     WHERE id = p_venta_id

6. Retornar:
   → RETURN json_build_object(
         'success', true,
         'venta_id', p_venta_id,
         'numero_comprobante', v_numero_comprobante,
         'monto_revertido', v_total
     )
```

**Permisos al final del archivo:**
```sql
REVOKE EXECUTE ON FUNCTION public.anular_venta(UUID, INTEGER, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.anular_venta(UUID, INTEGER, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
```

### 1.2 — Servicio: `VentasService`

**Archivo modificado:** `src/app/features/ventas/services/ventas.service.ts`

Agregar método `anularVenta()`:
```typescript
async anularVenta(ventaId: string, motivo: string): Promise<any> {
    // Obtener empleadoId desde la sesión activa
    // (mismo patrón que otros servicios del proyecto: this.supabase.client.auth.getUser())
    return this.supabase.call(
        this.supabase.client.rpc('anular_venta', {
            p_venta_id: ventaId,
            p_empleado_id: empleadoId,
            p_motivo: motivo
        }),
        'Venta anulada correctamente',
        { showLoading: true }
    );
}
```

### 1.3 — UI: `ventas.page.ts` + `ventas.page.html`

**Archivo modificado:** `src/app/features/ventas/pages/main/ventas.page.ts`

**Cambio 1 — Control de doble submit** (patrón obligatorio del proyecto):
```typescript
anulando = false;
```

**Cambio 2 — Reemplazar `onVentaMenuOption()`** (línea 175):
```typescript
async onVentaMenuOption(opcion: MenuOption, venta: Venta) {
    if (opcion.value === 'anular') {
        await this.confirmarAnulacion(venta);
    }
}

async confirmarAnulacion(venta: Venta) {
    if (this.anulando) return;

    const alert = await this.alertCtrl.create({
        header: `¿Anular venta #${venta.numero_comprobante}?`,
        message: 'Esta acción revertirá el stock y el saldo de caja. No se puede deshacer.',
        inputs: [{
            name: 'motivo',
            type: 'textarea',
            placeholder: 'Motivo de anulación (obligatorio)'
        }],
        buttons: [
            { text: 'Cancelar', role: 'cancel' },
            {
                text: 'Anular',
                cssClass: 'danger',
                handler: (data) => {
                    if (!data.motivo?.trim()) {
                        this.ui.showToast('Debes ingresar un motivo', 'warning');
                        return false; // mantiene el alert abierto
                    }
                    return true;
                }
            }
        ]
    });
    await alert.present();

    const { data, role } = await alert.onDidDismiss();
    if (role === 'cancel' || !data?.values?.motivo?.trim()) return;

    this.anulando = true;
    try {
        await this.ventasService.anularVenta(venta.id, data.values.motivo.trim());
        await this.cargar(); // recarga lista + totales
    } finally {
        this.anulando = false;
    }
}
```

**Cambio 3 — `ventaMenuOpciones` dinámico:** el menú solo muestra "Anular" si `venta.estado === 'COMPLETADA'`. Implementar como método que retorna opciones según la venta.

**Archivo modificado:** `ventas.page.html`

Cambios visuales:
- Badge `ANULADA` en rojo en tarjetas con `estado = 'ANULADA'`
- Tarjeta anulada con opacidad reducida (`opacity: 0.6`)
- Icono `ban-outline` ya registrado en `addIcons()` (línea 22 del .ts actual) ✅

**Modificar `fn_listar_ventas`** para incluir ventas ANULADAS (Opción A):
- Cambiar `WHERE v.estado = 'COMPLETADA'` por `WHERE v.estado IN ('COMPLETADA', 'ANULADA')`
- El resumen del footer (`fn_resumir_ventas`) sigue contando solo COMPLETADAS

---

## PUNTO 2: Reporte Ventas del Día

### 2.1 — Función SQL: `fn_reporte_ventas_dia`

**Archivo nuevo:** `docs/reportes/sql/functions/fn_reporte_ventas_dia.sql`

**Parámetros:**
```sql
CREATE OR REPLACE FUNCTION public.reporte_ventas_dia(
    p_fecha TEXT  -- 'YYYY-MM-DD'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

**Lógica de fechas** (patrón obligatorio del proyecto — nunca `toISOString()`):
```sql
-- Rango del día en zona Ecuador
v_inicio := (p_fecha || 'T00:00:00')::TIMESTAMPTZ AT TIME ZONE 'America/Guayaquil';
v_fin    := ((p_fecha::DATE + 1)::TEXT || 'T00:00:00')::TIMESTAMPTZ AT TIME ZONE 'America/Guayaquil';
-- Filtro: fecha >= v_inicio AND fecha < v_fin  (exclusivo, patrón del proyecto)
```

**Retorna JSON:**
```json
{
  "fecha": "2026-03-25",
  "total_ventas": 15,
  "total_monto": 523.50,
  "total_anuladas": 1,
  "monto_anulado": 12.00,
  "por_metodo_pago": [
    { "metodo": "EFECTIVO",      "cantidad": 10, "monto": 350.00 },
    { "metodo": "TRANSFERENCIA", "cantidad":  3, "monto": 120.50 },
    { "metodo": "DEUNA",         "cantidad":  1, "monto":  40.00 },
    { "metodo": "FIADO",         "cantidad":  1, "monto":  13.00 }
  ],
  "por_tipo_comprobante": [
    { "tipo": "TICKET",     "cantidad": 12, "monto": 410.00 },
    { "tipo": "NOTA_VENTA", "cantidad":  2, "monto":  85.50 },
    { "tipo": "FACTURA",    "cantidad":  1, "monto":  28.00 }
  ]
}
```

- `total_ventas` / `total_monto` → solo `estado = 'COMPLETADA'`
- `total_anuladas` / `monto_anulado` → solo `estado = 'ANULADA'`
- `por_metodo_pago` / `por_tipo_comprobante` → solo `estado = 'COMPLETADA'`

**Permisos al final:**
```sql
REVOKE EXECUTE ON FUNCTION public.reporte_ventas_dia(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reporte_ventas_dia(TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
```

### 2.2 — Modelo

**Archivo nuevo:** `src/app/features/reportes/models/reporte.model.ts`

```typescript
export interface ReporteVentasDia {
    fecha: string;
    total_ventas: number;
    total_monto: number;
    total_anuladas: number;
    monto_anulado: number;
    por_metodo_pago: ReporteMetodoPago[];
    por_tipo_comprobante: ReporteTipoComprobante[];
}

export interface ReporteMetodoPago {
    metodo: string;
    cantidad: number;
    monto: number;
}

export interface ReporteTipoComprobante {
    tipo: string;
    cantidad: number;
    monto: number;
}
```

### 2.3 — Servicio

**Archivo nuevo:** `src/app/features/reportes/services/reportes.service.ts`

Patrón estándar del proyecto (`inject()`, `supabase.call()`):
```typescript
@Injectable({ providedIn: 'root' })
export class ReportesService {
    private supabase = inject(SupabaseService);

    async obtenerReporteDia(fecha: string): Promise<ReporteVentasDia> {
        return this.supabase.call<ReporteVentasDia>(
            this.supabase.client.rpc('reporte_ventas_dia', { p_fecha: fecha })
        );
    }
}
```

### 2.4 — Página de Reportes

**Archivos modificados:** `reportes.page.ts` + `reportes.page.html`

Reemplazar `UnderConstructionComponent` completamente.

**Estado del componente:**
```typescript
// inject() — patrón obligatorio
private reportesService = inject(ReportesService);
private modalCtrl = inject(ModalController);
public currencyService = inject(CurrencyService);

fecha: string = getFechaLocal();       // Fecha seleccionada, default: hoy
reporte: ReporteVentasDia | null = null;
loading = false;
cargando = false;                      // Anti double-submit

get hoy(): string { return getFechaLocal(); }
```

**UI (wireframe):**
```
┌─────────────────────────────────────┐
│ ☰  Reportes                         │
├─────────────────────────────────────┤
│  [ion-refresher]                    │
│                                     │
│  📅 [25 mar 2026  ▼]               │ ← botón que abre IonDatetime en IonModal
│                                     │  (mismo patrón que ventas.page)
│  ┌─────────────────────────────┐   │
│  │ VENTAS DEL DÍA             │   │ ← ion-card destacado
│  │  15 ventas      $523.50    │   │
│  │  1 anulada     -$12.00     │   │ ← fila secundaria en rojo si > 0
│  └─────────────────────────────┘   │
│                                     │
│  POR MÉTODO DE PAGO                 │ ← sección con título
│  ┌──────────────┬──────┬────────┐  │
│  │ 💵 Efectivo  │  10  │ $350  │  │
│  │ 📱 Transfer. │   3  │ $120  │  │ ← lista simple de 4 ítems
│  │ 💳 Tarjeta   │   1  │  $40  │  │
│  │ 🤝 Fiado     │   1  │  $13  │  │
│  └──────────────┴──────┴────────┘  │
│                                     │
│  POR COMPROBANTE                    │
│  ┌──────────────┬──────┬────────┐  │
│  │ 🧾 Ticket    │  12  │ $410  │  │
│  │ 📄 Nota V.   │   2  │  $85  │  │
│  │ 📑 Factura   │   1  │  $28  │  │
│  └──────────────┴──────┴────────┘  │
│                                     │
│  [skeleton si loading]              │
│  [empty state si no hay ventas]     │
└─────────────────────────────────────┘
```

**Iconos a registrar en `addIcons()`:**
- `calendarOutline`, `cashOutline`, `cardOutline`, `phonePortraitOutline`, `handRightOutline`
- `receiptOutline`, `documentOutline`, `documentTextOutline`
- `banOutline` (anuladas)

**Comportamiento:**
- `ionViewWillEnter` → cargar reporte del día actual
- `ion-refresher` → recargar sin spinner de página (patrón `silencioso`)
- Selector de fecha → `IonDatetime` dentro de `IonModal` (NO sheet modal con breakpoints — patrón obligatorio del proyecto)
- Al cambiar fecha → recargar reporte

**Sin `PaginatedListPage`** — no es una lista paginada, es un resumen. Componente standalone normal.

---

## PUNTO 3: Actualizar schema.sql

**Archivo modificado:** `docs/schema.sql`

### 3.1 — Header: versión y descripción

```diff
- -- SCHEMA - MI TIENDA v5.2
- -- Sistema de Gestión de Cajas y Recargas
+ -- SCHEMA - MI TIENDA v5.3
+ -- Sistema de Gestión de Cajas, Ventas POS y Recargas
```

### 3.2 — RESUMEN: agregar funciones faltantes

Después de la línea de Cuentas por Cobrar, agregar:

```sql
--   Inventario:
--   • fn_ajustar_stock_inventario              → docs/inventario/sql/functions/fn_ajustar_stock_inventario.sql
--   • fn_generar_codigo_interno                → docs/inventario/sql/functions/fn_generar_codigo_interno.sql
--   Ventas (historial):
--   • fn_listar_ventas                         → docs/ventas/sql/functions/fn_listar_ventas.sql
--   • fn_resumir_ventas                        → docs/ventas/sql/functions/fn_resumir_ventas.sql
--   Reportes:
--   • fn_reporte_ventas_dia                    → docs/reportes/sql/functions/fn_reporte_ventas_dia.sql
--   POS — Anulación:
--   • fn_anular_venta                          → docs/pos/sql/functions/fn_anular_venta.sql
```

### 3.3 — Actualizar conteo total

```sql
-- ✅ 18 Tablas | 24 Funciones SQL
-- (6 dashboard + 4 recargas + 2 POS + 3 cuentas-cobrar + 2 inventario + 2 ventas + 1 reportes + 4 triggers/helpers)
```

---

## Orden de implementación

```
Paso 1: schema.sql                          → versión + RESUMEN (5 min)
Paso 2: fn_anular_venta.sql                 → función SQL completa
Paso 3: fn_listar_ventas.sql                → incluir ANULADAS (1 línea)
Paso 4: ventas.service.ts                   → método anularVenta()
Paso 5: ventas.page.ts + ventas.page.html   → UI anulación + badge
Paso 6: fn_reporte_ventas_dia.sql           → función SQL reporte
Paso 7: reportes.model.ts                   → interfaces TypeScript
Paso 8: reportes.service.ts                 → servicio
Paso 9: reportes.page.ts + reportes.page.html → página funcional
Paso 10: AUDITORIA-PROYECTO.md              → actualizar estado
```

---

## Decisiones confirmadas

| Decisión | Valor |
|----------|-------|
| Ventas anuladas en historial | **Opción A** — badge rojo, no desaparecen |
| ¿Quién puede anular? | **ADMIN y EMPLEADO** — ambos roles |
| Reporte inicial | **Solo resumen del día** — iterar después |
| Enum kardex `ANULACION_VENTA` | **Ya existe en schema.sql** (línea 294) — sin cambios |
| Enum ventas `ANULADA` | **Ya existe en schema.sql** (línea 272) — sin cambios |

---

## Qué NO haré (fuera de alcance)

- No toco `fn_registrar_venta_pos` ni los triggers existentes
- No agrego reportes de productos más vendidos ni ganancias
- No agrego cálculo de vuelto ni descuentos en POS
- No creo SQL en archivos separados para lo que ya está en el schema (los ENUMs/CHECKs ya están)
