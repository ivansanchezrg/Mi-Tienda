# Dashboard Feature

Feature principal de la app. Contiene el panel de inicio y las operaciones diarias de caja.

## Paginas

### Home (`pages/home/`)

Panel principal con 4 secciones:

| Seccion | Descripcion | Visible |
|---------|-------------|---------|
| Estado Banner | Indicador verde/rojo si la caja esta abierta o cerrada | Siempre |
| Saldos | Grid 2x2 con saldos de Caja, Caja Chica, Celular, Bus + total | Siempre |
| Operaciones Rapidas | Botones de Ingreso, Egreso, Transferir, Gasto | Solo caja abierta |
| Cuadre de Caja | Acceso rapido para iniciar un cuadre | Solo caja abierta |
| Cierre Diario | Boton para cerrar o abrir el dia | Siempre |

**Datos:** Actualmente usa datos placeholder estaticos. Se conectara a Supabase cuando los servicios esten listos.

### Cierre Diario (`pages/cierre-diario/`)

Wizard de 2 pasos para cerrar el dia:

**Paso 1 - Ingresar Saldos:**
- Saldo virtual celular final
- Saldo virtual bus final
- Efectivo total recaudado
- Inputs con `CurrencyInputDirective` para formato automatico

**Paso 2 - Verificacion Final:**
- Ventas del dia (calculadas automaticamente)
- Verificacion de cajas (formula visible)
- Alertas informativas
- Observaciones opcionales
- Boton de confirmacion

**Patrones utilizados:**
- `ScrollResetDirective` para scroll al top al cambiar de paso
- `PendingChangesGuard` para prevenir salida accidental con datos sin guardar
- `CurrencyService` para parseo inteligente de moneda
- `UiService` para loading y toasts

## Rutas

```
/home                → HomePage
/home/cierre-diario  → CierreDiarioPage (con pendingChangesGuard)
```

## Dependencias Core

| Archivo | Uso |
|---------|-----|
| `core/services/ui.service.ts` | Loading y toast en cierre |
| `core/services/currency.service.ts` | Parseo/formato de montos |
| `core/guards/pending-changes.guard.ts` | Protege cierre-diario |
| `core/pages/scrollable.page.ts` | HomePage extiende para reset scroll |
| `shared/directives/currency-input.directive.ts` | Formato en inputs de cierre |
| `shared/directives/scroll-reset.directive.ts` | Scroll al top entre pasos |

## Documentacion Relacionada

### Documentacion de Negocio
- 📖 [**Proceso de Cierre de Cajas**](./proceso_cierre_cajas.md) - Flujo completo del cierre diario, arquitectura del sistema de 4 cajas, validaciones, trazabilidad y ejemplos practicos
- ⚙️ [**Funcion PostgreSQL**](./funcion_cierre_diario.md) - Documentacion de la funcion transaccional `ejecutar_cierre_diario()`
- 🗄️ [**Schema de Base de Datos**](../../../../doc/schema_inicial_completo.sql) - Estructura completa de tablas, indices y datos iniciales

### Para Desarrolladores
- 💻 **DASHBOARD-README.md** (este archivo) - Documentacion tecnica de componentes, rutas y patrones
- 🔧 **RecargasService** (`services/recargas.service.ts`) - Servicio principal para operaciones de cierre
- 🎨 **CierreDiarioPage** (`pages/cierre-diario/`) - Implementacion del wizard de cierre
