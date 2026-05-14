# Cuadre de Caja — Referencia Técnica

## ¿Qué es?

Modal de **verificación de ventas de recargas** (CELULAR y BUS) en cualquier momento del día. El usuario ingresa el saldo que muestran las máquinas físicas; el sistema calcula cuánto se vendió comparándolo con el saldo virtual que registró.

**Es una calculadora visual pura — no escribe nada en BD.** Se usa para hacer cortes parciales sin esperar al cierre diario.

**Punto de entrada:** Home → `cuadreCaja()` → abre `CuadreCajaPage` como modal.

---

## 1. Archivos involucrados

| Archivo | Rol |
|---|---|
| `pages/cuadre-caja/cuadre-caja.page.ts` | Modal: carga saldos virtuales del sistema, calcula ventas, limpiar |
| `pages/cuadre-caja/cuadre-caja.page.html` | UI: campos de entrada + resultado automático |
| `services/recargas-virtuales.service.ts` | `getSaldoUltimoCierre('CELULAR' \| 'BUS')` |

---

## 2. Flujo del proceso

```
ngOnInit
  └─ cargarDatos()
       ├─ getSaldoUltimoCierre('CELULAR')  → saldoVirtualActualCelular
       └─ getSaldoUltimoCierre('BUS')      → saldoVirtualActualBus
        ↓
Página muestra los saldos del sistema como referencia (helper text bajo los campos)

Usuario ingresa saldos actuales leídos de las máquinas físicas:
  ├─ saldoCelularActual (campo 1)
  └─ saldoBusActual     (campo 2)
        ↓
Getters calculan en tiempo real:
  ├─ ventaCelular = saldoVirtualActualCelular - saldoCelularActual
  └─ ventaBus     = saldoVirtualActualBus     - saldoBusActual

mostrarResultadoCelular = saldoCelularActual tiene valor >= 0
mostrarResultadoBus     = saldoBusActual tiene valor >= 0
mostrarResultado        = al menos uno de los dos tiene valor
  └─ Resultado parcial aparece automáticamente (sin necesidad de llenar ambos campos)
        ↓
Botón "Limpiar" → form.reset() → limpia los campos sin cerrar el modal
```

---

## 3. Fórmula de cálculo

```
venta = saldoUltimoCierre (sistema) - saldoActual (ingresado de la máquina)
```

`getSaldoUltimoCierre()` lee únicamente el campo `saldo_virtual_actual` del último registro en la tabla `recargas` (cierre diario o mini cierre). **No suma recargas virtuales posteriores** — eso producía doble conteo cuando el proveedor cargaba saldo el mismo día antes del cierre.

---

## 4. Validación: venta negativa

Si `ventaCelular < 0` o `ventaBus < 0` → el resultado **no se muestra** y aparece el error inline:
- Celular: *"Registrá la recarga del proveedor en Recargas Virtuales"*
- Bus: *"Registrá la compra de saldo virtual en Recargas Virtuales"*

**Causa típica:** el proveedor cargó saldo pero no se registró en `recargas_virtuales`. El saldo ingresado por el usuario supera lo que el sistema esperaba → diferencia negativa → sin sentido.

---

## 5. Diferencias con Cierre Diario

| | Cuadre | Cierre Diario |
|---|---|---|
| Guarda en BD | ❌ No | ✅ Sí |
| Requiere efectivo contado | ❌ No | ✅ Sí |
| Veces por día | Ilimitado | 1 por turno |
| Cierra turno | ❌ No | ✅ Sí |
| Método de saldo | `getSaldoUltimoCierre()` | `getSaldoUltimoCierre()` |
| Resultado parcial | ✅ Muestra por campo (sin llenar ambos) | N/A (ambos campos requeridos) |
