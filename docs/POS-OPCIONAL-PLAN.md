# POS Opcional — Plan de Implementación

Feature para hacer el módulo POS (venta por producto con escáner/QR) opcional,
configurable por el administrador desde la app.

---

## Motivación

Algunas tiendas pequeñas no necesitan vender producto por producto:
- Solo quieren registrar el dinero recaudado al final del día como ingreso manual
- Hay negocios que solo venden recargas virtuales (celular/bus) sin catálogo de productos
- El POS agrega complejidad innecesaria para estos casos

---

## Viabilidad: LIMPIO Y VIABLE

La arquitectura actual lo permite sin hacks. Razón clave:
**`fn_ejecutar_cierre_diario` trabaja con `cajas.saldo_actual`, no con `ventas`.**

Si POS está apagado, CAJA_CHICA solo acumula ingresos/egresos manuales.
El cierre distribuye lo que haya en CAJA_CHICA exactamente igual.

---

## Qué cambia y qué no

### No cambia nada

| Componente | Por qué |
|------------|---------|
| Apertura de turno | No referencia ventas ni productos |
| Cierre SQL (`fn_ejecutar_cierre_diario`) | Opera sobre saldos de cajas, no sobre ventas |
| Recargas virtuales | Totalmente independiente de POS |
| Inventario | Puede seguir visible para control de stock interno |

### Cambia cosméticamente: Cierre Paso 2

**Con POS:**
```
+ Ventas POS efectivo       $45.00
+ Otros ingresos manuales   $10.00
- Egresos / gastos          $5.00
= Neto del turno            $50.00
```

**Sin POS:**
```
+ Ingresos manuales         $55.00
- Egresos / gastos          $5.00
= Neto del turno            $50.00
```

La distribución en cascada (VARIOS → fondo fijo → depósito CAJA) es **idéntica**.

---

## Plan por fases

### Fase 1 — BD + ConfigService

| Archivo | Cambio |
|---------|--------|
| `configuraciones` (tabla BD) | `ALTER TABLE configuraciones ADD COLUMN pos_habilitado BOOLEAN DEFAULT TRUE;` |
| `docs/schema.sql` | Agregar columna `pos_habilitado` en CREATE TABLE + INSERT |
| `src/app/core/services/config.service.ts` | Agregar `pos_habilitado: boolean` a interfaz `Configuraciones` + `DEFAULTS` |
| Modelo `Configuracion` + DTO | Agregar campo |

**Migración SQL:**
```sql
ALTER TABLE configuraciones ADD COLUMN IF NOT EXISTS pos_habilitado BOOLEAN DEFAULT TRUE;
NOTIFY pgrst, 'reload schema';
```

### Fase 2 — UI Admin (toggle)

| Archivo | Cambio |
|---------|--------|
| `parametros.page.html` | Agregar `ion-toggle` en sección General |
| `parametros.page.ts` | Binding al formulario + guardar |

**UX del toggle:**
```
[Toggle: POS (Venta por producto)]
Habilita el punto de venta con escáner, carrito y cobro por producto.
Al desactivar, las ventas se registran solo como ingresos manuales.
```

- Solo visible para usuarios con rol `ADMIN`
- Al guardar: actualizar BD + `ConfigService.invalidar()` para limpiar cache

### Fase 3 — Navegación condicional

| Archivo | Cambio | Por qué |
|---------|--------|---------|
| `main-layout.page.html/ts` | `@if (posHabilitado)` en tab POS | Ocultar tab de POS |
| `sidebar.component.ts` | Filtrar items según `pos_habilitado` | Ocultar: Ventas, Cuentas por Cobrar |
| Guard en rutas (opcional) | Prevenir acceso directo a `/pos`, `/ventas`, `/cuentas-cobrar` | Defensa en profundidad |

**Nota:** Las rutas siguen registradas (lazy-loaded). Solo se oculta la UI.
Al ser APK (no web con URLs compartibles), el guard es opcional pero recomendado.

### Fase 4 — Cierre diario

| Archivo | Cambio |
|---------|--------|
| `cierre-diario.page.ts` | Inyectar `ConfigService`. Si `!pos_habilitado`: skip query de `ventasPosEfectivo`, setear en `0` |
| `cierre-diario.page.html` | `@if (posHabilitado)` para ocultar línea "Ventas POS en efectivo" en Paso 2 |

**Importante:** Verificar `pos_habilitado` al momento del cierre, no al abrir turno.
Así si se desactiva mid-turno, el cierre refleja correctamente el estado actual.

### Fase 5 — Documentación

| Archivo | Cambio |
|---------|--------|
| `CLAUDE.md` | Actualizar tabla de módulos: POS → "Opcional (configurable)" |
| `docs/dashboard/DASHBOARD-README.md` | Documentar comportamiento del cierre sin POS |

---

## Módulos afectados cuando POS está desactivado

| Módulo | Impacto | Acción |
|--------|---------|--------|
| **POS** | No accesible | Tab oculta, rutas bloqueadas |
| **Ventas (historial)** | Sin datos | Ocultar en sidebar |
| **Cuentas por cobrar** | Sin ventas FIADO | Ocultar en sidebar (depende 100% de ventas) |
| **Inventario** | Independiente | **Mantener visible** — sirve para control de stock sin POS |
| **Recargas virtuales** | Sin cambio | Independiente de POS |
| **Dashboard** | Cierre simplificado | Ocultar línea de ventas POS en Paso 2 |

---

## Edge cases cubiertos

### 1. Desactivar POS con ventas existentes
**Sin problema.** Las ventas ya están en BD y reflejadas en `cajas.saldo_actual`.
El cierre procesa los saldos como están — no necesita saber de dónde vinieron.

### 2. Reactivar POS después de meses
**Sin problema.** POS carga catálogo fresco de `productos`.
No hay estado stale que cause problemas.

### 3. Desactivar mid-turno con ventas ya hechas
**Sin problema.** Las ventas del turno ya incrementaron `CAJA_CHICA.saldo_actual` via trigger.
El cierre distribuye ese saldo normalmente. La línea "Ventas POS" se oculta
pero la matemática del cierre es correcta porque opera sobre saldos, no sobre ventas.

### 4. Cache del ConfigService tras toggle
Tras guardar el toggle, llamar `ConfigService.invalidar()`.
La próxima llamada a `ConfigService.get()` fetch datos frescos de BD.
El cambio se refleja en tabs/sidebar en la siguiente navegación.

### 5. Acceso directo a rutas POS cuando está desactivado
Bajo riesgo (es APK, no web). Guard opcional en rutas como defensa en profundidad:
```typescript
// pos.guard.ts
const config = await inject(ConfigService).get();
if (!config.pos_habilitado) return inject(Router).createUrlTree(['/dashboard']);
return true;
```

---

## Flujo del usuario sin POS

```
1. Apertura de turno → igual que hoy
2. Durante el día:
   - Registrar ingresos manuales (OperacionModal → INGRESO en CAJA_CHICA)
   - Registrar egresos/gastos (OperacionModal → EGRESO en CAJA_CHICA)
   - Registrar recargas virtuales (celular/bus)
3. Cierre de turno:
   - Paso 1: Conteo físico del cajón + recargas (igual)
   - Paso 2: Conciliación simplificada (sin línea POS)
   - Distribución: CAJA_CHICA → VARIOS + fondo + CAJA (igual)
```

---

## Archivos clave para la implementación

```
src/app/core/services/config.service.ts          ← Fuente de verdad (cache)
src/app/features/configuracion/.../parametros.*   ← Toggle admin
src/app/features/layout/.../main-layout.*         ← Tab POS condicional
src/app/shared/components/sidebar/sidebar.*       ← Links condicionales
src/app/features/dashboard/.../cierre-diario.*    ← Paso 2 simplificado
docs/schema.sql                                   ← Nueva columna
```
