# Proceso de Control de Recargas y Saldo Virtual

## 1. Conceptos que intervienen

### 1.1. Recargas (registro diario)

Cada recarga guarda:

- `id`
- `fecha`
- `tipo_servicio` (Bus / Celular)
- `empleado`
- `tipo_recarga`
- `venta_día`
- `saldo_virtual_anterior`
- `saldo_virtual_actual`

📌 **Regla clave:**  
El `saldo_virtual_actual` de hoy será el `saldo_virtual_anterior` del siguiente día.

### 1.2. Tipo de Recarga (reglas del negocio)

**Bus**

- Base: 500 (puede variar)
- Comisión: 1%
- Período de comisión: mensual
- Frecuencia de recarga: semanal

**Celular**

- Base: 200 (puede variar)
- Comisión: 5%
- Período de comisión: semanal
- Frecuencia de recarga: semanal

*(Esto afecta cálculos posteriores, pero el flujo del saldo es el mismo)*

## 2. Flujo diario del saldo virtual

### Día 1

- Saldo virtual anterior: 440,80
- Venta del día: 154,80

👉 **Cálculo:**

```
Saldo virtual actual = Saldo virtual anterior - Venta del día
```

```
Saldo virtual actual = 440,80 - 154,80 = 286,00
```

✅ **Resultado Día 1:**

- Saldo virtual actual: 286,00

### Día 2

- Saldo virtual anterior: 286,00
- Venta del día: 200,00

👉 **Cálculo:**

```
Saldo virtual actual = 286,00 - 200,00 = 86,00
```

✅ **Resultado Día 2:**

- Saldo virtual actual: 86,00

## 3. Validación interna diaria (control de consistencia)

Para validar que no hay errores en el registro diario, se usa esta regla:

**Regla de validación**

```
Venta del día + Saldo virtual actual = Saldo virtual anterior
```

**Ejemplo Día 2:**

```
200,00 + 86,00 = 286,00 ✅
```

📌 Esto confirma que:

- No faltó dinero
- No se duplicó venta
- El saldo está correcto

## 4. Cuadre de caja (visión acumulada)

Aquí se revisa todo el período, no día por día.

### Ventas acumuladas

- Día 1: 154,80

- Día 2: 200,00
  
  ```
  Total ventas = 354,80
  ```

### Verificación final

```
Total ventas + Saldo virtual actual = Saldo inicial
```

```
354,80 + 86,00 = 440,80 ✅
```

📌 El saldo inicial del sistema se mantiene consistente.

## 5. Control de exceso (regla operativa)

Cuando el saldo virtual supera la base definida:

- Base: 200

- Ejemplo:
  
  ```
  Saldo virtual = 440,80
  ```
  
  ```
  Exceso = 440,80 - 400,00 = 40,80
  ```

**Acción:**  
➡ Enviar notificación → Transferir exceso a caja chica