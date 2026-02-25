# Dashboard Feature

Feature principal de la app. Contiene el panel de inicio y las operaciones diarias de caja.

---

## Páginas

### Home (`pages/home/`)

Panel principal con 4 secciones:

| Sección             | Descripción                                                        | Visible           |
| ------------------- | ------------------------------------------------------------------ | ----------------- |
| Estado Banner       | Indicador verde/rojo si la caja está abierta o cerrada             | Siempre           |
| Saldos              | Lista con saldos de Tienda, Varios, Celular, Bus + total efectivo  | Siempre           |
| Operaciones Rápidas | Botones de Ingreso, Egreso, Transferir, Gasto                 | Solo caja abierta |
| Cuadre de Caja      | Acceso rápido para iniciar un cuadre                          | Solo caja abierta |
| Cierre Diario       | Botón para cerrar o abrir el día                              | Siempre           |

**Datos:** Conectado a Supabase mediante servicios.

**Documentación completa:** Ver [8_PROCESO_ABRIR_CAJA.md](./8_PROCESO_ABRIR_CAJA.md)

---

### Cierre Diario (`pages/cierre-diario/`)

Wizard de 2 pasos para cerrar el día:

**Paso 1 - Ingresar Saldos:**

- Saldo virtual celular final
- Saldo virtual bus final
- Efectivo total recaudado
- Inputs con `CurrencyInputDirective` para formato automático

**Paso 2 - Verificación Final:**

- Ventas del día (calculadas automáticamente)
- Verificación de cajas (fórmula visible)
- Alertas informativas
- Observaciones opcionales
- Botón de confirmación

**Patrones utilizados:**

- `ScrollResetDirective` para scroll al top al cambiar de paso
- `PendingChangesGuard` para prevenir salida accidental con datos sin guardar
- `CurrencyService` para parseo inteligente de moneda
- `UiService` para loading y toasts

**Documentación completa:** Ver [3_PROCESO_CIERRE_CAJA.md](./3_PROCESO_CIERRE_CAJA.md)

---

### Recargas Virtuales (`pages/recargas-virtuales/`)

Sistema completo de gestión de saldo virtual con dos tabs (CELULAR y BUS).

**Características:**

- 📱 **Tabs CELULAR/BUS** con diferentes modelos de negocio
- 💰 **Saldo virtual en tiempo real** calculado desde BD
- ➕ **Registrar recargas** (compra de saldo) mediante modal
- 💳 **Pagar deudas pendientes** al proveedor (solo CELULAR)
- 🚌 **Liquidación de compras** de saldo (solo BUS)
- 📊 **Historial completo** de movimientos
- 🔄 **Pull-to-refresh** para actualizar datos

**Flujo:**

1. Seleccionar tab (CELULAR o BUS)
2. Ver saldo virtual actual
3. Opciones según servicio:
   - CELULAR: Registrar recarga, Pagar deudas, Ver historial
   - BUS: Registrar recarga, Liquidar compra, Ver historial

**Documentación completa:** Ver [7_PROCESO_SALDO_VIRTUAL.md](./7_PROCESO_SALDO_VIRTUAL.md)

---

### Pagar Deudas (`pages/pagar-deudas/`)

Wizard para gestionar el pago de deudas pendientes con proveedor de CELULAR.

**Características:**

- 📋 **Lista de deudas pendientes** (`pagado = false`)
- ✅ **Selección múltiple** de deudas a pagar
- 💰 **Cálculo automático** del monto total
- 🏦 **Verificación de saldo** disponible en CAJA_CELULAR
- 📸 **Comprobante obligatorio** de transferencia/pago
- 💸 **Operación de EGRESO** transaccional

**Flujo:**

1. Cargar deudas pendientes desde `recargas_virtuales`
2. Usuario selecciona deudas a pagar
3. Sistema calcula total y verifica saldo
4. Usuario sube comprobante de pago
5. Confirma → Sistema marca como pagadas y crea EGRESO

---

### Cuadre de Caja (`pages/cuadre-caja/`)

Calculadora visual para verificar efectivo físico esperado (NO guarda en BD).

**Características:**

- 🧮 **Solo calculadora** - NO guarda nada en base de datos
- 📱 **Saldos virtuales** Celular y Bus
- 💰 **Calcula efectivo esperado** basado en comisiones
- 🔄 **Usa saldos anteriores** del último cierre como base
- ⚡ **Verificación instantánea** sin afectar datos

**Flujo:**

1. Usuario ingresa saldos virtuales actuales (Celular y Bus)
2. Sistema calcula: `efectivo_esperado = ventas_celular + ventas_bus`
3. Muestra resultado visual
4. NO se guarda nada (solo vista informativa)

**Diferencia con Cierre Diario:**

- Cuadre: Solo calcula y muestra (ilimitado)
- Cierre: Guarda en BD, actualiza cajas, crea operaciones (1 vez por turno)

**Documentación completa:** Ver [4_PROCESO_CUADRE_RECARGAS.md](./4_PROCESO_CUADRE_RECARGAS.md)

---

### Historial Recargas (`pages/historial-recargas/`)

Historial completo de recargas registradas con filtros.

**Características:**

- 📜 **Lista agrupada por fecha** con scroll infinito
- 🔍 **Filtros por servicio** (Todas, Celular, Bus)
- 📊 **Información detallada** de cada recarga
- 🔄 **Pull-to-refresh** para actualizar datos
- 🎨 **Diseño adaptativo** dark/light mode

---

### Operaciones de Caja (`pages/operaciones-caja/`)

Historial de movimientos por caja con diseño híbrido (Home pattern + empresarial/bancario).

**Características:**

- 💰 **Balance card** con saldo disponible y resumen de entradas/salidas
- 🔍 **Filtros sticky** (Hoy, Semana, Mes, Todo) estilo bancario
- 📜 **Scroll infinito** con agrupación por fecha
- 📱 **Header dinámico** - saldo aparece al hacer scroll
- 🎨 **Diseño adaptativo** dark/light mode

**Documentación completa:** Ver [1_OPERACIONES-CAJA.md](./1_OPERACIONES-CAJA.md)

---

### Gastos Diarios (`pages/gastos-diarios/`)

Página de consulta y gestión del historial de gastos operativos.

**Características:**

- 📊 **Historial completo** de gastos registrados
- 🔍 **Filtros por fecha** (Hoy, Semana, Mes, Todo)
- 📸 **Ver comprobantes** de gastos con imágenes
- 🎨 **Diseño adaptativo** dark/light mode

**Documentación completa:** Ver [6_PROCESO_GASTOS_DIARIOS.md](./6_PROCESO_GASTOS_DIARIOS.md)

---

## Componentes Modales

### Gasto Modal (`components/gasto-modal/`)

Modal de registro de gastos operativos con acceso desde FAB.

**Características:**

- 💰 **Acceso rápido** desde FAB (Floating Action Button)
- 📝 **Formulario simplificado** con concepto y monto
- 📸 **Comprobante opcional** con optimización automática de imágenes
- ❌ **NO afecta saldos de cajas** (gastos operativos, no transacciones)
- 🔍 **Trazabilidad completa** con empleado, fecha y concepto

---

### Registrar Recarga Modal (`components/registrar-recarga-modal/`)

Modal para registrar compras de saldo virtual (CELULAR o BUS).

**Características:**

- 📱 **Contexto dinámico** según servicio (CELULAR/BUS)
- 💰 **Cálculo automático** de monto a pagar (solo CELULAR)
- 📸 **Comprobante obligatorio** de compra al proveedor
- 💸 **Operación de EGRESO** automática en caja correspondiente
- ✅ **Validación de saldo** disponible antes de confirmar

---

### Pagar Deudas Modal (`components/pagar-deudas-modal/`)

Modal alternativo para pago rápido de deudas (usado desde recargas-virtuales).

**Características:**

- 📋 **Vista compacta** de deudas pendientes
- ✅ **Selección rápida** de deudas a pagar
- 💰 **Resumen de totales** en tiempo real
- 📸 **Comprobante obligatorio** de pago

---

### Liquidación Bus Modal (`components/liquidacion-bus-modal/`)

Modal para registrar liquidación de compras de saldo BUS realizadas.

**Características:**

- 🚌 **Específico para BUS** (modelo de compra directa)
- 💰 **Monto exacto** sin comisión
- 📸 **Comprobante obligatorio** de depósito al proveedor
- 💸 **Operación de EGRESO** desde CAJA_BUS

---

### Historial Modal (`components/historial-modal/`)

Modal para visualizar historial de movimientos en formato compacto.

**Características:**

- 📜 **Vista rápida** de historial
- 🔍 **Filtros integrados**
- 📊 **Agrupación por fecha**
- 🎨 **Diseño adaptativo**

---

### Operación Modal (`components/operacion-modal/`)

Modal genérico para registrar operaciones de Ingreso/Egreso/Transferencia.

**Características:**

- 💰 **Tipo de operación** configurable
- 📋 **Categorías contables** según tipo
- 📸 **Comprobantes** opcionales u obligatorios según categoría
- 💸 **Actualización automática** de saldos de cajas

**Documentación completa:** Ver [2_PROCESO_INGRESO_EGRESO.md](./2_PROCESO_INGRESO_EGRESO.md)

---

## Rutas

```
/home                        → HomePage
/home/operaciones-caja       → OperacionesCajaPage
/home/cuadre-caja            → CuadreCajaPage
/home/cierre-diario          → CierreDiarioPage (con pendingChangesGuard)
/home/recargas-virtuales     → RecargasVirtualesPage
/home/pagar-deudas           → PagarDeudasPage
/home/historial-recargas     → HistorialRecargasPage
/home/gastos-diarios         → GastosDiariosPage
```

---

## Servicios

| Servicio                 | Archivo                                  | Descripción                                         |
| ------------------------ | ---------------------------------------- | --------------------------------------------------- |
| RecargasService          | `services/recargas.service.ts`           | Operaciones de cierre diario, historial de recargas |
| RecargasVirtualesService | `services/recargas-virtuales.service.ts` | Gestión de saldo virtual, deudas, liquidaciones     |
| CajasService             | `services/cajas.service.ts`              | Operaciones de cajas, transferencias, saldos        |
| OperacionesCajaService   | `services/operaciones-caja.service.ts`   | Consulta de operaciones con filtros y paginación    |
| GananciasService         | `services/ganancias.service.ts`          | Cálculo y verificación de ganancias mensuales       |
| GastosDiariosService     | `services/gastos-diarios.service.ts`     | Registro de gastos operativos (NO afecta saldos)    |
| TurnosCajaService        | `services/turnos-caja.service.ts`        | Gestión de turnos de caja (abrir/cerrar)            |

---

## Dependencias Core

| Archivo                                         | Uso                                           |
| ----------------------------------------------- | --------------------------------------------- |
| `core/services/ui.service.ts`                   | Loading, toasts y alertas en toda la app      |
| `core/services/currency.service.ts`             | Parseo y formato de montos                    |
| `core/services/storage.service.ts`              | Subida de imágenes a Supabase Storage         |
| `core/guards/pending-changes.guard.ts`          | Protege cierre-diario de salidas accidentales |
| `core/pages/scrollable.page.ts`                 | HomePage extiende para reset scroll           |
| `shared/directives/currency-input.directive.ts` | Formato automático en inputs de moneda        |
| `shared/directives/numbers-only.directive.ts`   | Solo permite números en inputs                |
| `shared/directives/scroll-reset.directive.ts`   | Scroll al top entre pasos de wizards          |

---

## Documentación Relacionada

### Procesos de Negocio (Orden recomendado)

1. **[1_OPERACIONES-CAJA.md](./1_OPERACIONES-CAJA.md)** - Historial de movimientos por caja, filtros, diseño híbrido y scroll infinito
2. **[2_PROCESO_INGRESO_EGRESO.md](./2_PROCESO_INGRESO_EGRESO.md)** - Sistema completo de operaciones con categorías contables y comprobantes fotográficos
3. **[3_PROCESO_CIERRE_CAJA.md](./3_PROCESO_CIERRE_CAJA.md)** - Flujo completo del cierre diario, arquitectura del sistema de 4 cajas, validaciones y trazabilidad
4. **[4_PROCESO_CUADRE_RECARGAS.md](./4_PROCESO_CUADRE_RECARGAS.md)** - Calculadora de verificación de efectivo (solo vista, no guarda)
5. **[5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md)** - Patrón de actualización de UI post-operación (cargarDatos) y gotcha de Supabase INSERT/UPDATE devuelve data:null
6. **[6_PROCESO_GASTOS_DIARIOS.md](./6_PROCESO_GASTOS_DIARIOS.md)** - Sistema de registro de gastos operativos con FAB y comprobantes
7. **[7_PROCESO_SALDO_VIRTUAL.md](./7_PROCESO_SALDO_VIRTUAL.md)** - Sistema completo de gestión de saldo virtual (CELULAR/BUS), deudas, liquidaciones y comisiones
8. **[8_PROCESO_ABRIR_CAJA.md](./8_PROCESO_ABRIR_CAJA.md)** - Flujo de apertura de turno, modal de verificación de fondo, estados del banner y tabla turnos_caja

### Otros Recursos

- **[Schema de Base de Datos](../../../../docs/schema_inicial_completo.sql)** - Estructura completa de tablas, índices y datos iniciales
- **[SQL Queries](./sql/)** - Funciones PostgreSQL y queries comunes

---

## Patrones de Diseño Utilizados

### Ultra-Simplified UX (v4.0)

- Reducir input del usuario al mínimo (1 campo cuando sea posible)
- Sistema calcula todo lo demás desde configuración
- Guías visuales para acciones físicas

### Configuration-Driven Design

- Constantes centralizadas en tabla `configuraciones`
- Fácil modificación sin redeploy
- Ejemplos: `fondo_fijo_diario`, `porcentaje_comision`

### Transactional PostgreSQL Functions

- Operaciones multi-tabla usando funciones PostgreSQL
- Atomicidad garantizada (all or nothing)
- Uso: `supabase.client.rpc('function_name', params)`

### Modales para Flujos Complejos

- Wizards paso a paso con navegación clara
- Verificación final antes de confirmar
- PendingChangesGuard en páginas críticas

### Optimización de Imágenes

- Capacitor Camera con `width/height` límites
- Quality 80%, max 1200x1600px
- Resultado: 200-500 KB vs 3-10 MB originales

---

## Notas Importantes

### Date Handling

- **NUNCA usar** `new Date().toISOString()` (da UTC, zona horaria incorrecta)
- **SIEMPRE usar** función personalizada `getFechaLocal()`:
  
  ```typescript
  getFechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
  }
  ```

### Gestión de Iconos

- Importar desde `ionicons/icons`
- Registrar con `addIcons()` en constructor
- **CRITICAL:** No eliminar iconos sin verificar uso en templates HTML
- Iconos en `[name]` bindings no se detectan en imports TypeScript

### PostgreSQL Functions

- Usar `SECURITY DEFINER` para permisos persistentes
- `SET search_path = public` para resolución explícita de schema
- `GRANT EXECUTE` explícito a roles `authenticated` y `anon`
- `NOTIFY pgrst, 'reload schema'` para refrescar cache de PostgREST
- Consultar MEMORY.md para más detalles sobre persistencia de funciones

---

## Estado del Proyecto

**Última actualización:** 2026-02-20

**Módulos completados:**

- ✅ Home con saldos en tiempo real
- ✅ Cierre Diario (v4.0 ultra-simplificado)
- ✅ Operaciones de Caja con historial
- ✅ Cuadre de Caja (calculadora)
- ✅ Recargas Virtuales (CELULAR/BUS)
- ✅ Pagar Deudas con comprobantes
- ✅ Gastos Diarios con FAB
- ✅ Ingreso/Egreso con categorías contables

**Pendientes:**

- 🔄 Testing completo de flujos end-to-end
- 🔄 Reportes y estadísticas avanzadas
- 🔄 Backup automático de datos
