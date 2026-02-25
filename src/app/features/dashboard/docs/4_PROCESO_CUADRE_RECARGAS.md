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
| `services/recargas-virtuales.service.ts` | `getSaldoVirtualActual('CELULAR' \| 'BUS')` |

---

## 2. Flujo del proceso

```
ngOnInit
  └─ cargarDatos()
       ├─ getSaldoVirtualActual('CELULAR')  → saldoVirtualActualCelular
       └─ getSaldoVirtualActual('BUS')      → saldoVirtualActualBus
        ↓
Página muestra los saldos del sistema como referencia (helper text bajo los campos)

Usuario ingresa saldos actuales leídos de las máquinas físicas:
  ├─ saldoCelularActual (campo 1)
  └─ saldoBusActual     (campo 2)
        ↓
Getters calculan en tiempo real:
  ├─ ventaCelular = saldoVirtualActualCelular - saldoCelularActual
  └─ ventaBus     = saldoVirtualActualBus     - saldoBusActual

mostrarResultado = form.valid && ventaCelular >= 0 && ventaBus >= 0
  └─ Resultado aparece automáticamente (sin botón confirmar)
        ↓
Botón "Limpiar" → form.reset() → limpia los campos sin cerrar el modal
```

---

## 3. Fórmula de cálculo

```
venta = saldoVirtualActual (sistema) - saldoActual (ingresado de la máquina)
```

`getSaldoVirtualActual()` usa la misma fórmula que el cierre diario:

```
saldoVirtualActual = último saldo_virtual_actual (tabla recargas)
                   + SUM(monto_virtual de recargas_virtuales con created_at > último_cierre_at)
```

Esto significa que si el proveedor cargó saldo hoy (y aún no se cerró), ese monto ya está incluido — el resultado sigue siendo correcto.

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
| Fórmula de venta | Igual | Igual |
