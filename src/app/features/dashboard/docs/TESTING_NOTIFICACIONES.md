# 🧪 Testing del Sistema de Notificaciones de Ganancias

## 📋 Objetivo

Probar el flujo completo de notificaciones de ganancias mensuales sin esperar a fin de mes.

---

## 🚀 Pasos para Probar

### **1. Ejecutar el script de prueba**

En Supabase SQL Editor, ejecuta:

```sql
-- Copiar y pegar todo el contenido de:
doc/test_notificaciones_ganancias.sql
```

Este script creará:
- ✅ 10 operaciones de INGRESO en CAJA_CELULAR (Enero 2026)
- ✅ 15 operaciones de INGRESO en CAJA_BUS (Enero 2026)
- ✅ Ventas totales: ~$1,500 Celular + ~$2,000 Bus
- ✅ Ganancias calculadas: ~$75 Celular + ~$20 Bus = **~$95 total**

### **2. Verificar datos creados**

El script muestra un resumen automático:

```
┌─────────────────┬────────────────┬──────────────┬────────────────────┐
│ Caja            │ Operaciones    │ Total Ventas │ Ganancia Calculada │
├─────────────────┼────────────────┼──────────────┼────────────────────┤
│ Caja Celular    │ 10             │ $1,500.00    │ $75.00             │
│ Caja Bus        │ 15             │ $2,000.00    │ $20.00             │
└─────────────────┴────────────────┴──────────────┴────────────────────┘
```

### **3. Probar en la aplicación**

#### **A. Abrir el Home**
```bash
npm start
```

Deberías ver:
- 🔔 Ícono de campana en el header
- **Badge rojo con "1"** en la esquina superior derecha

#### **B. Abrir notificaciones**
1. Clic en el ícono de campana
2. Se abre modal con la notificación:

```
┌─────────────────────────────────────────┐
│ 💰 Transferir ganancias            >   │
│    Enero 2026                           │
│    Celular: $75.00 | Bus: $20.00...    │
└─────────────────────────────────────────┘
```

#### **C. Ver desglose**
1. Clic en la notificación
2. Navega a página de "Transferir Ganancias"
3. Verifica los datos:

```
Enero 2026
Ganancias del mes

┌─────────────────────────────────────────┐
│ 📱 Recargas Celular                    │
│    Ventas del mes     $1,500.00        │
│    Comisión 5%        $75.00           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🚌 Recargas Bus                        │
│    Ventas del mes     $2,000.00        │
│    Comisión 1%        $20.00           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💰 Total a transferir a Caja Chica     │
│         $95.00                          │
└─────────────────────────────────────────┘
```

#### **D. Confirmar transferencia**
1. Clic en "Confirmar Transferencia"
2. Aparece alerta: "¿Moviste físicamente $95.00...?"
3. Clic en "Sí, confirmar"
4. Loading "Registrando transferencia..."
5. Toast de éxito
6. Regresa al home
7. **Badge desaparece** (ya no hay notificaciones)

### **4. Verificar operaciones creadas**

En Supabase, verificar que se crearon las transferencias:

```sql
-- Ver transferencias de ganancias de enero
SELECT
  o.fecha,
  c.nombre AS caja,
  o.tipo_operacion,
  o.monto,
  o.descripcion
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
WHERE o.descripcion LIKE '%Ganancia%2026-01%'
ORDER BY o.fecha;
```

Deberías ver **4 operaciones**:
1. CAJA_CELULAR → TRANSFERENCIA_SALIENTE ($75)
2. CAJA_CHICA → TRANSFERENCIA_ENTRANTE ($75)
3. CAJA_BUS → TRANSFERENCIA_SALIENTE ($20)
4. CAJA_CHICA → TRANSFERENCIA_ENTRANTE ($20)

### **5. Verificar saldos actualizados**

```sql
SELECT
  id,
  codigo,
  nombre,
  saldo_actual
FROM cajas
WHERE id IN (2, 3, 4)  -- CAJA_CHICA, CAJA_CELULAR, CAJA_BUS
ORDER BY id;
```

Los saldos deberían reflejar las transferencias.

---

## 🔄 Probar de nuevo

Para volver a probar, necesitas:

### **Opción A: Eliminar solo las transferencias**
```sql
-- Eliminar transferencias de ganancias
DELETE FROM operaciones_cajas
WHERE descripcion LIKE '%Ganancia%2026-01%';

COMMIT;
```

Luego:
1. Recargar el home (pull-to-refresh)
2. El badge debería aparecer de nuevo

### **Opción B: Recrear todo desde cero**
```sql
-- Ejecutar sección de LIMPIEZA del script
DELETE FROM operaciones_cajas
WHERE descripcion LIKE '%TEST%'
  AND DATE_TRUNC('month', fecha) = '2026-01-01';

COMMIT;
```

Luego ejecutar el script completo de nuevo.

---

## ✅ Checklist de Pruebas

- [ ] Script ejecutado sin errores
- [ ] Badge "1" aparece en campana
- [ ] Modal muestra notificación correcta
- [ ] Navegación a página de transferencia funciona
- [ ] Datos mostrados son correctos ($75 + $20 = $95)
- [ ] Confirmación crea las 4 operaciones
- [ ] Saldos se actualizan correctamente
- [ ] Badge desaparece después de confirmar
- [ ] No hay errores en consola del navegador

---

## 🐛 Troubleshooting

### Badge no aparece
- Verificar que las operaciones se crearon en enero (mes anterior)
- Hacer pull-to-refresh en el home
- Verificar en consola: `gananciasService.verificarGananciasPendientes()`

### Error al confirmar transferencia
- Verificar que las cajas existen (id 2, 3, 4)
- Verificar que hay un empleado activo
- Ver consola del navegador para detalles del error

### Ganancias no se calculan bien
- Ejecutar el query de verificación del script
- Verificar que las operaciones son de tipo 'INGRESO'
- Verificar que la fecha es enero 2026

---

## 📊 Datos de Prueba Generados

| Concepto | Valor |
|----------|-------|
| Operaciones Celular | 10 |
| Operaciones Bus | 15 |
| Ventas Celular | ~$1,500 |
| Ventas Bus | ~$2,000 |
| Ganancia Celular (5%) | ~$75 |
| Ganancia Bus (1%) | ~$20 |
| **Total a Transferir** | **~$95** |

---

## 🧹 Limpiar después de probar

```sql
-- Eliminar TODAS las operaciones de prueba
DELETE FROM operaciones_cajas
WHERE descripcion LIKE '%TEST%'
   OR descripcion LIKE '%Ganancia%2026-01%';

COMMIT;
```

¡Listo para probar en producción real! 🚀
