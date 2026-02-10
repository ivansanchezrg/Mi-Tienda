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

### Operaciones de Caja (`pages/operaciones-caja/`)

Historial de movimientos por caja con diseño híbrido (Home pattern + empresarial/bancario).

**Características:**
- 💰 **Balance card** con saldo disponible y resumen de entradas/salidas
- 🔍 **Filtros sticky** (Hoy, Semana, Mes, Todo) estilo bancario
- 📜 **Scroll infinito** con agrupación por fecha
- 📱 **Header dinámico** - saldo aparece al hacer scroll
- 🎨 **Diseño adaptativo** dark/light mode

**Documentación completa:** Ver [OPERACIONES-CAJA.md](./OPERACIONES-CAJA.md)

### Cuadre de Caja (`pages/cuadre-caja/`)

Verificación del efectivo físico contra el saldo del sistema.

**Características:**
- 💰 **Muestra saldo del sistema** de Caja Principal
- 📝 **Input para efectivo contado** físicamente
- 🔄 **Cálculo automático** de diferencia en tiempo real
- ✅ **Estados visuales**: Cuadrado (verde), Sobrante (amarillo), Faltante (rojo)
- 📋 **Observaciones requeridas** cuando hay diferencia
- ⚡ **Ajuste automático** crea operación de INGRESO o EGRESO según corresponda

**Flujo:**
1. Usuario ve saldo según sistema
2. Ingresa efectivo contado
3. Sistema calcula diferencia
4. Si hay diferencia → requiere observaciones
5. Confirma → se crea ajuste automático si es necesario

### Ganancias Mensuales (`pages/transferir-ganancias/`)

Sistema automático de notificaciones y transferencia de ganancias mensuales de recargas.

**Características:**
- 🔔 **Notificación automática** en campana del header cuando hay ganancias pendientes
- 💰 **Cálculo automático** de comisiones (5% Celular, 1% Bus)
- 📊 **Vista detallada** con resumen de ventas y ganancias del mes
- ✅ **Transferencia transaccional** hacia CAJA_CHICA con trazabilidad

**Flujo:**
1. Sistema detecta ganancias del mes anterior sin transferir
2. Muestra badge "1" en ícono de campana del header
3. Usuario hace clic → Modal con detalle de ganancias
4. Usuario confirma → Navega a página de transferencia
5. Usuario revisa resumen y confirma
6. Sistema crea operaciones y actualiza saldos

**Documentación completa:** Ver [GANANCIAS-MENSUALES.md](./GANANCIAS-MENSUALES.md)

**Testing:** Ver [TESTING_NOTIFICACIONES.md](./TESTING_NOTIFICACIONES.md)

### Gastos Diarios (`components/gasto-modal/`)

Sistema de registro de gastos operativos de la tienda con acceso rápido desde FAB.

**Características:**
- 💰 **Acceso rápido** desde FAB (Floating Action Button) en cualquier página
- 📝 **Flujo simplificado** de 2 pasos: Modal → Guardar
- 📸 **Comprobantes opcionales** con optimización automática de imágenes
- ❌ **NO afecta saldos de cajas** (gastos operativos, no transacciones)
- 🔍 **Trazabilidad completa** con empleado, fecha y concepto

**Flujo:**
1. Usuario hace clic en FAB → selecciona "Gasto"
2. Se abre modal de gastos
3. Usuario ingresa concepto, monto, foto opcional y observaciones
4. Sistema sube foto a Storage (si hay) y registra en BD
5. ✅ Gasto registrado (NO afecta saldos)

**Documentación completa:** Ver [PROCESO_GASTOS_DIARIOS.md](./PROCESO_GASTOS_DIARIOS.md)

## Rutas

```
/home                        → HomePage
/home/operaciones-caja       → OperacionesCajaPage
/home/cuadre-caja            → CuadreCajaPage
/home/cierre-diario          → CierreDiarioPage (con pendingChangesGuard)
/home/transferir-ganancias   → TransferirGananciasPage
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
- 📖 [**Proceso de Cierre de Cajas**](./PROCESO_CIERRE_CAJA.md) - Flujo completo del cierre diario, arquitectura del sistema de 4 cajas, validaciones, trazabilidad y ejemplos practicos
- 💰 [**Ganancias Mensuales**](./GANANCIAS-MENSUALES.md) - Sistema automático de notificaciones y transferencia de ganancias mensuales (comisiones 5% Celular, 1% Bus)
- 📋 [**Operaciones de Caja**](./OPERACIONES-CAJA.md) - Historial de movimientos por caja, filtros, diseño híbrido y scroll infinito
- 📸 [**Proceso de Ingreso/Egreso**](./PROCESO_INGRESO_EGRESO.md) - Sistema completo de operaciones con categorías contables y comprobantes fotográficos (v2.0: categorías obligatorias + fotos opcionales/obligatorias según tipo)
- 💸 [**Proceso de Gastos Diarios**](./PROCESO_GASTOS_DIARIOS.md) - Sistema de registro de gastos operativos con acceso rápido desde FAB, comprobantes opcionales y trazabilidad completa (NO afecta saldos de cajas)
- 🗄️ [**Schema de Base de Datos**](../../../../docs/schema_inicial_completo.sql) - Estructura completa de tablas, indices y datos iniciales

### Para Desarrolladores
- 💻 **DASHBOARD-README.md** (este archivo) - Documentacion tecnica de componentes, rutas y patrones
- 📸 [**PROCESO_INGRESO_EGRESO.md**](./PROCESO_INGRESO_EGRESO.md) - Guía completa de implementación: Categorías contables (v2.0), Capacitor Camera, Supabase Storage, flujo step-by-step, función PostgreSQL y troubleshooting
- 💸 [**PROCESO_GASTOS_DIARIOS.md**](./PROCESO_GASTOS_DIARIOS.md) - Guía completa de implementación: Modal desde FAB, Capacitor Camera, optimización de imágenes, tabla gastos_diarios v4.3, diferencia con operaciones de caja
- 🔄 [**ACTUALIZACION-UI-SIN-RECARGA.md**](./ACTUALIZACION-UI-SIN-RECARGA.md) - Explicación detallada de cómo Angular actualiza la UI sin recargar la página: Change Detection, Data Binding, flujo completo con diagramas
- 🧪 [**TESTING_NOTIFICACIONES.md**](./TESTING_NOTIFICACIONES.md) - Guía de testing para el sistema de notificaciones de ganancias mensuales
- 🔧 **RecargasService** (`services/recargas.service.ts`) - Servicio principal para operaciones de cierre
- 💰 **GananciasService** (`services/ganancias.service.ts`) - Servicio para calculo y verificacion de ganancias mensuales
- 🏦 **CajasService** (`services/cajas.service.ts`) - Servicio para operaciones de cajas y transferencias
- 📋 **OperacionesCajaService** (`services/operaciones-caja.service.ts`) - Consulta de operaciones con filtros y paginacion
- 💸 **GastosDiariosService** (`services/gastos-diarios.service.ts`) - Servicio para registro de gastos operativos (NO afecta saldos)
- 🗄️ **StorageService** (`core/services/storage.service.ts`) - Servicio para subida de imágenes a Supabase Storage
- 🎨 **CierreDiarioPage** (`pages/cierre-diario/`) - Implementacion del wizard de cierre
- 💸 **TransferirGananciasPage** (`pages/transferir-ganancias/`) - Confirmacion y ejecucion de transferencias de ganancias
- 📜 **OperacionesCajaPage** (`pages/operaciones-caja/`) - Historial de movimientos con diseño híbrido
- 🧾 **GastoModalComponent** (`components/gasto-modal/`) - Modal de registro de gastos con foto opcional
