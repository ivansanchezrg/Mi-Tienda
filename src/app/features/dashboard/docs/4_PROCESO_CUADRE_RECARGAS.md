# Cuadre de Caja (Verificación de Efectivo)

**Versión:** 2.0 (Solo Verificación — v4.5 con agregado proveedor)
**Fecha:** 2026-02-11

## 1. Introducción

El **Cuadre de Caja** es una herramienta de **verificación visual** que te permite calcular cuánto efectivo físico deberías tener en tu caja en cualquier momento del día, basándose en los saldos virtuales de Celular y Bus.

### ⚠️ IMPORTANTE: Solo es una Calculadora

- ❌ **NO guarda nada en la base de datos**
- ❌ **NO actualiza cajas**
- ❌ **NO crea operaciones**
- ❌ **NO registra recargas**
- ✅ **Solo calcula y muestra el resultado**

Es como una **calculadora visual** que responde:
**"Con estos saldos virtuales, deberías tener $X en efectivo físico"**

---

## 2. Casos de Uso

### 2.1. Verificación Durante el Día

**Escenario:** Quieres saber cuánto efectivo físico deberías tener en este momento.

**Ejemplo:**
- Son las 14:00
- Tienes turno abierto
- Quieres verificar si tu efectivo cuadra
- Ingresas saldos actuales: Celular $75, Bus $250
- Sistema te dice: "Deberías tener $60 en efectivo"
- Cuentas tu efectivo físico y verificas

### 2.2. Antes del Cierre Diario

**Escenario:** Antes de hacer el cierre completo, quieres pre-verificar tus ventas.

**Ejemplo:**
- Vas a cerrar tu turno
- Primero usas Cuadre para calcular
- Luego cuentas el efectivo físico
- Si coincide, procedes con el Cierre Diario completo

---

## 3. Diferencias con Cierre Diario

| Aspecto | Cuadre de Caja | Cierre Diario |
|---------|----------------|---------------|
| **Propósito** | Solo verificar/calcular | Registrar cierre completo |
| **Guarda en BD** | ❌ No | ✅ Sí |
| **Actualiza Cajas** | ❌ No | ✅ Sí (4 cajas) |
| **Crea Operaciones** | ❌ No | ✅ Sí (4 operaciones) |
| **Registra Recargas** | ❌ No | ✅ Sí (2 registros) |
| **Cierra Turno** | ❌ No | ✅ Sí |
| **Requiere Efectivo** | ❌ No | ✅ Sí (efectivo_recaudado) |
| **Cuántas veces** | Ilimitado | 1 vez por turno |
| **Tiempo** | 10 segundos | 2-3 minutos |

---

## 4. Flujo del Proceso

### 4.1. Diagrama de Flujo

```
┌─────────────────────┐
│ Usuario: Ir a Cuadre│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Sistema carga       │
│ saldos anteriores   │
│ (Celular y Bus)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Usuario ingresa:    │
│ - Saldo Celular     │
│ - Saldo Bus         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Sistema calcula     │
│ EN MEMORIA:         │
│ Venta = Anterior -  │
│         Actual      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Sistema muestra:    │
│ - Venta Celular     │
│ - Venta Bus         │
│ - Total Efectivo    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ FIN                 │
│ (No guarda nada)    │
└─────────────────────┘
```

### 4.2. Paso a Paso

#### Paso 1: Cargar Saldos Anteriores
```typescript
// Sistema obtiene último saldo de cada servicio
const saldos = await recargasService.getSaldosAnteriores();
// Celular: $100, Bus: $285
```

#### Paso 2: Usuario Ingresa Saldos Actuales
- Saldo Celular Actual: `$75`
- Saldo Bus Actual: `$250`

#### Paso 3: Sistema Calcula (EN MEMORIA) — v4.5
```typescript
// Incluye el agregado del proveedor cargado HOY (recargas_virtuales)
ventaCelular = (saldoAnteriorCelular + agregadoCelularHoy) - saldoCelularActual
ventaCelular = (100 + 0) - 75 = 25   // Sin recarga del proveedor hoy

ventaBus = (saldoAnteriorBus + agregadoBusHoy) - saldoBusActual
ventaBus = (285 + 0) - 250 = 35

totalEfectivo = 25 + 35 = 60
```

#### Paso 4: Sistema Muestra Resultado
```
┌──────────────────────────────┐
│ Efectivo Físico Vendido      │
├──────────────────────────────┤
│ Celular:            $25.00   │
│ Bus:                $35.00   │
└──────────────────────────────┘

ℹ️ Deberías tener este monto en
   efectivo físico en tu caja
```

**¡Y ESO ES TODO!** No hay botón de "Confirmar" ni nada que guardar.

---

## 5. Fórmulas de Cálculo

### 5.1. Venta por Servicio (v4.5)

```
Venta = (Saldo Anterior + Agregado Proveedor Hoy) - Saldo Actual
```

**Ejemplo Celular sin recarga del proveedor:**
```
Saldo Anterior:           $100.00
Agregado Proveedor Hoy:  +$  0.00
Saldo Actual:            -$ 75.00
─────────────────────────────────
Venta:                    $ 25.00  ✅
```

**Ejemplo Celular CON recarga del proveedor ($210.53):**
```
Saldo Anterior:           $100.00
Agregado Proveedor Hoy:  +$210.53
Saldo Actual:            -$260.53
─────────────────────────────────
Venta:                    $ 50.00  ✅
```

### 5.2. Validación (v4.5)

```
Si (Saldo Anterior + Agregado Hoy) < Saldo Actual → ERROR ❌ (venta negativa)
```

⚠️ **Importante v4.5**: El saldo actual SÍ puede ser mayor al saldo anterior
si el proveedor cargó saldo ese día (`agregadoHoy > 0`). En ese caso NO es error.

Si la venta da negativa → el usuario debe ir a **Saldo Virtual** y registrar
la recarga del proveedor antes de usar el Cuadre.

---

## 6. UI Design

### 6.1. Pantalla Principal

```
┌─────────────────────────────────┐
│ ← Cuadre de Caja                │
├─────────────────────────────────┤
│                                  │
│  🧮                              │
│  Ingresa los saldos virtuales   │
│  actuales para verificar cuánto │
│  efectivo físico deberías tener │
│                                  │
├─────────────────────────────────┤
│                                  │
│  📱 Saldo Virtual Celular       │
│  ┌──────────────────────────┐  │
│  │ $ 75.00                  │  │
│  └──────────────────────────┘  │
│  Saldo anterior: $100.00        │
│                                  │
│  🚌 Saldo Virtual Bus           │
│  ┌──────────────────────────┐  │
│  │ $ 250.00                 │  │
│  └──────────────────────────┘  │
│  Saldo anterior: $285.00        │
│                                  │
└─────────────────────────────────┘
```

### 6.2. Resultado (Aparece Automáticamente)

```
┌─────────────────────────────────┐
│ 💵 Efectivo Físico Vendido      │
├─────────────────────────────────┤
│                                  │
│  📱 Celular        $25.00       │
│  🚌 Bus            $35.00       │
│                                  │
│  ℹ️ Deberías tener este monto   │
│     en efectivo físico          │
│                                  │
└─────────────────────────────────┘

┌──────────────┐
│   Limpiar    │
└──────────────┘
```

---

## 7. Código TypeScript

### 7.1. Componente Simplificado

```typescript
export class CuadreCajaPage {
  // Saldos anteriores del último cierre (cargados de BD)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

  // Agregado del proveedor HOY (cargado de recargas_virtuales — v4.5)
  agregadoCelularHoy = 0;
  agregadoBusHoy = 0;

  // Saldos actuales (ingresados por usuario)
  get saldoCelularActual(): number {
    return this.form.get('saldoCelularActual')?.value || 0;
  }

  get saldoBusActual(): number {
    return this.form.get('saldoBusActual')?.value || 0;
  }

  // Cálculos EN MEMORIA — v4.5 (incluye agregado del proveedor)
  get ventaCelular(): number {
    return (this.saldoAnteriorCelular + this.agregadoCelularHoy) - this.saldoCelularActual;
  }

  get ventaBus(): number {
    return (this.saldoAnteriorBus + this.agregadoBusHoy) - this.saldoBusActual;
  }

  // Validación: venta negativa = falta registrar recarga del proveedor
  get ventaCelularValida(): boolean {
    return this.ventaCelular >= 0;
  }

  get ventaBusValida(): boolean {
    return this.ventaBus >= 0;
  }
}
```

**¡NO hay método `confirmar()` ni `guardar()`!**

---

## 8. Ventajas del Cuadre

### 8.1. Para el Usuario

✅ **Rápido**: 10 segundos vs 2-3 minutos del cierre
✅ **Simple**: Solo 2 campos
✅ **Ilimitado**: Puedes usarlo las veces que quieras
✅ **Sin compromiso**: No guarda nada, solo muestra
✅ **Verificación previa**: Antes de hacer el cierre real

### 8.2. Para el Sistema

✅ **Sin carga a BD**: No hay inserts ni updates
✅ **Instantáneo**: Todo en memoria
✅ **Sin transacciones**: No hay rollback necesario
✅ **Sin bloqueos**: No afecta otras operaciones

---

## 9. Ejemplos Prácticos

### Ejemplo 1: Verificación Matutina

**Contexto:**
- Hora: 10:00 AM
- Turno abierto desde las 08:00
- Saldos de ayer: Celular $100, Bus $285

**Acciones:**
1. Ir a Cuadre de Caja
2. Ver saldos anteriores cargados automáticamente
3. Revisar sistema virtual → Celular: $90, Bus: $270
4. Ingresar: Celular $90, Bus $270
5. Ver resultado: Celular $10, Bus $15
6. Contar efectivo → Verificar que tengas $25 total

**Resultado:** Confirmaste que todo cuadra ✅

---

### Ejemplo 2: Antes del Cierre

**Contexto:**
- Hora: 18:00
- Vas a cerrar tu turno
- Saldos anteriores: Celular $100, Bus $285

**Acciones:**
1. Primero: Usar Cuadre
2. Ingresar saldos actuales: Celular $50, Bus $200
3. Sistema muestra: Celular $50, Bus $85
4. Contar efectivo físico → Tienes $135 total ✅
5. Ahora sí: Ir a Cierre Diario completo

**Resultado:** Pre-verificaste antes del cierre oficial ✅

---

### Ejemplo 3: Detectar Error

**Contexto:**
- Saldos anteriores: Celular $100, Bus $285

**Acciones:**
1. Ingresar: Celular $75, Bus $250
2. Sistema muestra: Celular $25, Bus $35
3. Cuentas físico → Tienes $45 total ⚠️

**Resultado:** Detectaste que faltan $15 antes del cierre oficial ✅

---

## 10. Comparación: Cuadre vs Cierre

### Tabla Resumen

| Característica | Cuadre | Cierre Diario |
|----------------|--------|---------------|
| Guarda en BD | No | Sí |
| Tiempo | 10 seg | 2-3 min |
| Veces por día | ∞ | 1 por turno |
| Campos | 2 | 3 |
| Cuentas efectivo | No necesario | Sí obligatorio |
| Cierra turno | No | Sí |
| Actualiza cajas | No | Sí (4 cajas) |
| Crea operaciones | No | Sí (4 ops) |
| Registra recargas | No | Sí (2 regs) |

### Flujo Ideal

```
08:00 → Abrir Turno

10:00 → Cuadre (verificar) ✓
        "Celular $15, Bus $10"

14:00 → Cuadre (verificar) ✓
        "Celular $30, Bus $30"

18:00 → Cuadre (verificar) ✓
        "Celular $50, Bus $85"

18:05 → Cierre Diario (registrar) ✓
        Guarda todo en BD
        Cierra turno
```

---

## 11. Archivos del Sistema

### Frontend
- 💻 **Page TS**: `pages/cuadre-caja/cuadre-caja.page.ts`
- 🎨 **Page HTML**: `pages/cuadre-caja/cuadre-caja.page.html`
- 🎨 **Page SCSS**: `pages/cuadre-caja/cuadre-caja.page.scss`
- 🔧 **Service**: `services/recargas.service.ts` → `getSaldosAnteriores()` + `getAgregadoVirtualHoy()` (v4.5)

### Backend
- ❌ **NO hay función PostgreSQL** (todo en frontend)
- ❌ **NO hay endpoints** (solo lectura de saldos)

---

## 12. Resumen

### Lo Que ES
✅ Calculadora visual
✅ Verificación rápida
✅ Herramienta de pre-chequeo
✅ Ilimitado uso
✅ Solo lectura

### Lo Que NO ES
❌ NO es un registro oficial
❌ NO guarda nada
❌ NO reemplaza el Cierre Diario
❌ NO actualiza cajas
❌ NO crea operaciones

---

**Autor:** Sistema Mi Tienda
**Versión:** 2.0 (Solo Verificación — v4.5 con agregado proveedor)
**Fecha:** 2026-02-11
