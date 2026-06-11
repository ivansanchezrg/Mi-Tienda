# Cuadre de Caja — Referencia Técnica

## ¿Qué es?

Modal de **verificación de ventas de recargas** (CELULAR y BUS) en cualquier momento del día. El usuario ingresa el saldo que muestran las máquinas físicas; el sistema calcula cuánto se vendió comparándolo con el saldo virtual que el sistema espera tener.

**Es una calculadora visual pura — no escribe nada en BD.** Se usa para hacer cortes parciales sin esperar al cierre diario.

**Puntos de entrada:** FAB central del tab bar (`main-layout` → `irACuadre()`) y acción rápida "Cuadre" del sidebar (desktop) → abren `CuadreCajaPage` con `cssClass: 'bottom-sheet-modal'`.

**Visibilidad por módulos:** la opción **no se muestra** (ni en el FAB ni en el sidebar) si el negocio no tiene ningún módulo de recargas activo (`recargas_celular_habilitada` / `recargas_bus_habilitada` ambos en false) — no habría nada que cuadrar. Con al menos uno activo, el modal muestra solo los campos de los módulos habilitados.

---

## 1. Archivos involucrados

| Archivo | Rol |
|---|---|
| `caja/pages/cuadre-caja/cuadre-caja.page.ts` | Modal: carga flags de módulos + saldos del sistema, calcula ventas, nueva consulta |
| `caja/pages/cuadre-caja/cuadre-caja.page.html` | UI patrón `bs-*` (bottom-sheet): campos + resultado automático |
| `recargas-virtuales/services/recargas-virtuales.service.ts` | `getSaldoVirtualActual('CELULAR' \| 'BUS')` |
| `core/services/config.service.ts` | Flags de módulos para condicionar los campos |

---

## 2. Flujo del proceso

```
ngOnInit → cargarDatos()
  ├─ configService.get() → flags recargas_celular/bus_habilitada (condicionan los campos)
  └─ Promise.all (solo módulos habilitados):
       ├─ getSaldoVirtualActual('CELULAR') → saldoVirtualActualCelular
       └─ getSaldoVirtualActual('BUS')     → saldoVirtualActualBus
        ↓
Página muestra "Saldo según sistema: $X" como referencia bajo cada campo

Usuario ingresa saldos actuales leídos de las máquinas físicas:
  ├─ saldoCelularActual (campo 1)
  └─ saldoBusActual     (campo 2)
        ↓
Getters calculan en tiempo real:
  ├─ ventaCelular = saldoVirtualActualCelular - saldoCelularActual
  └─ ventaBus     = saldoVirtualActualBus     - saldoBusActual

mostrarResultadoCelular / mostrarResultadoBus → por campo, sin necesidad de llenar ambos
  └─ Resultado parcial aparece automáticamente
        ↓
Botón "Nueva consulta" → form.reset() + focus al primer campo, sin cerrar el modal
```

---

## 3. Fórmula de cálculo

```
saldoSegúnSistema = saldo_virtual_actual (último registro en `recargas`)
                  + recargas del proveedor POSTERIORES a ese snapshot (recargas_virtuales)

venta = saldoSegúnSistema - saldoActual (ingresado de la máquina)
```

`getSaldoVirtualActual()` suma el snapshot del último cierre/mini-cierre **más** las recargas
del proveedor registradas después. Sin ese agregado, una recarga del proveedor hecha hoy haría
que la máquina muestre más saldo del esperado → venta negativa falsa. Es la misma semántica
que usa el wizard de cierre para mostrar el "total actual" en la UI (ver
`3_PROCESO_CIERRE_CAJA.md` §Paso 1, "Por qué dos cálculos").

El método deduplica llamadas concurrentes en vuelo (cache `saldoInFlight` por servicio).

---

## 4. Validación: venta negativa

Si `ventaCelular < 0` o `ventaBus < 0` → el resultado de ese servicio **no se muestra** y aparece el error inline:
- Celular: *"Venta negativa — registra la recarga del proveedor"*
- Bus: *"Venta negativa — registra la compra de saldo virtual"*

**Causa típica:** el proveedor cargó saldo pero no se registró en Recargas Virtuales. El saldo ingresado por el usuario supera lo que el sistema esperaba → diferencia negativa → sin sentido.

---

## 5. Diferencias con Cierre Diario

| | Cuadre | Cierre Diario |
|---|---|---|
| Guarda en BD | ❌ No | ✅ Sí |
| Requiere efectivo contado | ❌ No | ✅ Sí |
| Veces por día | Ilimitado | 1 por turno |
| Cierra turno | ❌ No | ✅ Sí |
| Fuente del saldo | `getSaldoVirtualActual()` (cliente) | `fn_datos_cierre_diario` (RPC consolidada) — misma semántica snapshot + agregado |
| Resultado parcial | ✅ Por campo (sin llenar ambos) | N/A (campos según módulos habilitados) |
