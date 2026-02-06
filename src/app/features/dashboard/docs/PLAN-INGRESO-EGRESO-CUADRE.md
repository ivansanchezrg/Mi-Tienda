# Plan de Implementación: Ingreso, Egreso y Cuadre

## Resumen Ejecutivo

Implementar las operaciones básicas de caja que faltan en el dashboard:
- **Ingreso**: Registrar entrada de dinero a una caja
- **Egreso**: Registrar salida de dinero de una caja
- **Cuadre**: Verificar que el efectivo físico coincida con el sistema

---

## 1. Análisis del Sistema Actual

### Recursos Existentes

| Recurso | Estado | Uso |
|---------|--------|-----|
| `CajasService` | ✅ | Operaciones de cajas, transferencias |
| `OperacionesCajaService` | ✅ | Consulta de operaciones |
| `operacion-caja.model.ts` | ✅ | Tipos de operación |
| Tabla `operaciones_cajas` | ✅ | Almacena movimientos |
| Tabla `cajas` | ✅ | Saldos actuales |

### Tipos de Operación en BD

```typescript
type TipoOperacion =
  | 'INGRESO'              // ← Implementar
  | 'EGRESO'               // ← Implementar
  | 'TRANSFERENCIA_ENTRANTE'
  | 'TRANSFERENCIA_SALIENTE'
  | 'APERTURA'
  | 'CIERRE'
  | 'AJUSTE';              // ← Para cuadre
```

### Modelo de `operaciones_cajas`

```sql
id              UUID
fecha           TIMESTAMP
caja_id         INT (FK → cajas)
empleado_id     INT (FK → empleados)
tipo_operacion  VARCHAR
monto           DECIMAL
saldo_anterior  DECIMAL
saldo_actual    DECIMAL
descripcion     TEXT
```

---

## 2. Diseño de Solución

### 2.1 Opción de UI: Modal vs Página

| Aspecto | Modal | Página |
|---------|-------|--------|
| Experiencia | Rápida, sin salir del home | Más espacio, flujo separado |
| Complejidad | Menor | Mayor |
| Consistencia | Diferente a otras funciones | Similar a cierre/transferir |
| Recomendación | **✅ Para ingreso/egreso** | Para cuadre |

**Decisión:**
- **Ingreso/Egreso**: Modal (operación rápida)
- **Cuadre**: Página separada (requiere más información)

### 2.2 Flujo de Ingreso/Egreso

```
┌─────────────────────────────────────────────┐
│                   HOME                       │
│                                             │
│  [Ingreso]  [Egreso]  [...]                 │
│      │          │                           │
│      ▼          ▼                           │
│  ┌─────────────────────────┐                │
│  │   MODAL OPERACIÓN       │                │
│  │                         │                │
│  │  Tipo: Ingreso/Egreso   │                │
│  │  Caja: [Selector]       │                │
│  │  Monto: [$_____.00]     │                │
│  │  Descripción: [_____]   │                │
│  │                         │                │
│  │  [Cancelar] [Confirmar] │                │
│  └─────────────────────────┘                │
└─────────────────────────────────────────────┘
```

### 2.3 Flujo de Cuadre

```
HOME → Click "Cuadre" → CuadreCajaPage

┌─────────────────────────────────────────────┐
│              CUADRE DE CAJA                 │
├─────────────────────────────────────────────┤
│  Saldo según sistema:     $1,234.56         │
│                                             │
│  Efectivo contado:        [$_______]        │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Diferencia:            $0.00        │   │
│  │ Estado: ✅ Cuadrado                 │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Observaciones: [___________________]       │
│                                             │
│           [Cancelar]  [Confirmar]           │
└─────────────────────────────────────────────┘
```

---

## 3. Plan de Implementación

### Fase 1: Ingreso y Egreso (Modal)

#### 3.1.1 Crear Componente Modal

**Archivo:** `dashboard/components/operacion-modal/operacion-modal.component.ts`

```typescript
interface OperacionModalData {
  tipo: 'INGRESO' | 'EGRESO';
  cajas: Caja[];
}

interface OperacionModalResult {
  cajaId: number;
  monto: number;
  descripcion: string;
}
```

**Campos del formulario:**
- Selector de caja (solo las que aplican)
- Input de monto (con CurrencyInputDirective)
- Textarea de descripción (opcional para ingreso, requerido para egreso)

#### 3.1.2 Agregar Método en CajasService

```typescript
async registrarOperacion(params: {
  cajaId: number;
  empleadoId: number;
  tipo: 'INGRESO' | 'EGRESO';
  monto: number;
  descripcion: string;
}): Promise<void> {
  // 1. Obtener saldo actual
  // 2. Calcular nuevo saldo
  // 3. Insertar operación
  // 4. Actualizar saldo en tabla cajas
}
```

#### 3.1.3 Actualizar HomePage

```typescript
async onOperacion(tipo: string) {
  if (tipo === 'ingreso' || tipo === 'egreso') {
    const modal = await this.modalCtrl.create({
      component: OperacionModalComponent,
      componentProps: {
        tipo: tipo.toUpperCase(),
        cajas: this.cajas
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data) {
      await this.ejecutarOperacion(tipo, data);
    }
  }
}
```

#### 3.1.4 Archivos a Crear/Modificar

| Archivo | Acción |
|---------|--------|
| `components/operacion-modal/operacion-modal.component.ts` | Crear |
| `components/operacion-modal/operacion-modal.component.html` | Crear |
| `components/operacion-modal/operacion-modal.component.scss` | Crear |
| `services/cajas.service.ts` | Agregar método |
| `pages/home/home.page.ts` | Implementar onOperacion() |

---

### Fase 2: Cuadre de Caja (Página)

#### 3.2.1 Crear Página CuadreCaja

**Ruta:** `/home/cuadre-caja`

**Archivo:** `dashboard/pages/cuadre-caja/`

**Funcionalidad:**
1. Mostrar saldo del sistema (solo CAJA_PRINCIPAL por ahora)
2. Input para efectivo contado físicamente
3. Calcular diferencia automáticamente
4. Si hay diferencia → Crear operación de AJUSTE
5. Guardar registro de cuadre

#### 3.2.2 Modelo de Cuadre

```typescript
interface CuadreCaja {
  id?: string;
  fecha: string;
  caja_id: number;
  empleado_id: number;
  saldo_sistema: number;
  saldo_fisico: number;
  diferencia: number;
  observaciones?: string;
  ajuste_realizado: boolean;
}
```

#### 3.2.3 Tabla en Supabase (Opcional)

```sql
CREATE TABLE cuadres_caja (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha TIMESTAMP DEFAULT NOW(),
  caja_id INT REFERENCES cajas(id),
  empleado_id INT REFERENCES empleados(id),
  saldo_sistema DECIMAL(12,2),
  saldo_fisico DECIMAL(12,2),
  diferencia DECIMAL(12,2),
  observaciones TEXT,
  ajuste_realizado BOOLEAN DEFAULT FALSE
);
```

#### 3.2.4 Flujo de Cuadre

```
1. Usuario ingresa efectivo contado
2. Sistema calcula: diferencia = saldo_fisico - saldo_sistema
3. Si diferencia != 0:
   - Mostrar alerta con diferencia
   - Preguntar si desea hacer ajuste
   - Si acepta → Crear operación AJUSTE
4. Registrar cuadre en tabla cuadres_caja
5. Volver al home
```

#### 3.2.5 Archivos a Crear/Modificar

| Archivo | Acción |
|---------|--------|
| `pages/cuadre-caja/cuadre-caja.page.ts` | Crear |
| `pages/cuadre-caja/cuadre-caja.page.html` | Crear |
| `pages/cuadre-caja/cuadre-caja.page.scss` | Crear |
| `services/cajas.service.ts` | Agregar métodos cuadre |
| `dashboard.routes.ts` | Agregar ruta |
| `pages/home/home.page.ts` | Implementar onCuadre() |

---

## 4. Orden de Implementación

### Sprint 1: Ingreso/Egreso (Prioridad Alta)

| # | Tarea | Estimación |
|---|-------|------------|
| 1 | Crear estructura modal `operacion-modal/` | - |
| 2 | Diseñar UI del modal (formulario) | - |
| 3 | Implementar lógica del modal | - |
| 4 | Agregar `registrarOperacion()` en CajasService | - |
| 5 | Conectar modal con HomePage | - |
| 6 | Probar flujo completo | - |
| 7 | Verificar que operación aparece en historial | - |

### Sprint 2: Cuadre de Caja (Prioridad Media)

| # | Tarea | Estimación |
|---|-------|------------|
| 1 | Crear tabla `cuadres_caja` en Supabase | - |
| 2 | Crear página `cuadre-caja/` | - |
| 3 | Diseñar UI de cuadre | - |
| 4 | Implementar lógica de comparación | - |
| 5 | Implementar operación AJUSTE | - |
| 6 | Conectar con HomePage | - |
| 7 | Probar flujo completo | - |

---

## 5. Consideraciones Técnicas

### 5.1 Validaciones

**Ingreso:**
- Monto > 0
- Caja seleccionada
- Descripción opcional

**Egreso:**
- Monto > 0
- Monto <= saldo actual de la caja
- Caja seleccionada
- Descripción requerida (justificar salida)

**Cuadre:**
- Efectivo contado >= 0
- Observaciones requeridas si hay diferencia

### 5.2 Cajas Permitidas por Operación

| Operación | Cajas Permitidas |
|-----------|------------------|
| Ingreso | CAJA, CAJA_CHICA |
| Egreso | CAJA, CAJA_CHICA |
| Cuadre | CAJA (solo principal por ahora) |

### 5.3 Trazabilidad

Para ingreso/egreso manual, el `tipo_referencia_id` será NULL (no viene de cierre ni recarga).

---

## 6. UI/UX Guidelines

### 6.1 Modal de Operación

- Seguir patrón de diseño actual (Ionic)
- Usar `CurrencyInputDirective` para formato de monto
- Botón de confirmar:
  - Verde para Ingreso
  - Rojo para Egreso
- Mostrar saldo actual de la caja seleccionada

### 6.2 Página de Cuadre

- Seguir patrón de transferir-ganancias (mismo estilo)
- Mostrar diferencia en tiempo real
- Colores:
  - Verde: cuadrado (diferencia = 0)
  - Amarillo: diferencia pequeña (< $10)
  - Rojo: diferencia grande (>= $10)

---

## 7. Testing

### Casos de Prueba Ingreso

1. ✅ Ingreso normal a CAJA
2. ✅ Ingreso a CAJA_CHICA
3. ❌ Ingreso con monto 0 (debe fallar validación)
4. ❌ Ingreso sin seleccionar caja (debe fallar)

### Casos de Prueba Egreso

1. ✅ Egreso normal de CAJA
2. ❌ Egreso mayor al saldo (debe fallar)
3. ❌ Egreso sin descripción (debe fallar)

### Casos de Prueba Cuadre

1. ✅ Cuadre exacto (diferencia = 0)
2. ✅ Cuadre con sobrante (diferencia > 0 → INGRESO)
3. ✅ Cuadre con faltante (diferencia < 0 → EGRESO)

---

## 8. Documentación

Después de implementar, actualizar:
- [ ] `DASHBOARD-README.md` - Agregar sección de Ingreso/Egreso/Cuadre
- [ ] Crear `INGRESO-EGRESO.md` - Documentación detallada
- [ ] Crear `CUADRE-CAJA.md` - Documentación del cuadre

---

## 9. Estado de Implementación

### Fase 1: Ingreso/Egreso ✅ COMPLETADO

- [x] Crear componente modal `operacion-modal/`
- [x] Agregar método `registrarOperacion()` en CajasService
- [x] Conectar con HomePage
- [x] Probar compilación

**Archivos creados:**
- `components/operacion-modal/operacion-modal.component.ts`
- `components/operacion-modal/operacion-modal.component.html`
- `components/operacion-modal/operacion-modal.component.scss`

### Fase 2: Cuadre de Caja ✅ COMPLETADO

- [x] Crear página `cuadre-caja/`
- [x] Agregar ruta en `dashboard.routes.ts`
- [x] Conectar con HomePage
- [x] Probar compilación

**Archivos creados:**
- `pages/cuadre-caja/cuadre-caja.page.ts`
- `pages/cuadre-caja/cuadre-caja.page.html`
- `pages/cuadre-caja/cuadre-caja.page.scss`

**Nota:** No se creó tabla `cuadres_caja` ya que el ajuste se registra como operación normal en `operaciones_cajas`.

---

*Fecha de creación: Febrero 2026*
*Última actualización: Febrero 2026*
*Autor: Sistema Mi Tienda*
