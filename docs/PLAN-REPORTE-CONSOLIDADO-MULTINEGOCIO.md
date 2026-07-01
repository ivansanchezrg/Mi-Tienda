# Plan — Reporte Consolidado Multi-Negocio (Plan MAX)

> **Estado:** PROPUESTA — pendiente de aprobación del dueño. No implementar hasta autorización explícita.
> **Origen:** 2026-07-01. Necesidad: un propietario con plan MAX (hasta 3 negocios) quiere ver ventas y resumen de **todos sus negocios en una sola pantalla**, sin entrar uno por uno.
> **Documentos relacionados:** [PLAN-PLANES-SUSCRIPCION.md](PLAN-PLANES-SUSCRIPCION.md) (§11 Multisucursal), [guides/ARQUITECTURA.md](guides/ARQUITECTURA.md), [ventas/VENTAS-README.md](ventas/VENTAS-README.md).

---

## 1. Resumen en una frase

Crear una pantalla nueva **"Vista de grupo"** (solo para el propietario con plan MAX y 2+ negocios) que muestre las ventas y el resumen consolidado de todos sus negocios juntos, con comparativa entre sucursales — **sin cambiar de negocio activo** y **sin tocar el aislamiento multi-tenant** que ya existe.

---

## 2. El problema hoy (confirmado en el código)

- Cada negocio es un **tenant aislado**. Toda query filtra por `negocio_id = get_negocio_id()` (leído del JWT). Ver `fn_reporte_ventas_periodo.sql`, `fn_listar_ventas.sql`, `fn_home_dashboard.sql` — todas single-tenant.
- Para ver los datos de otro negocio hay que **activarlo en el JWT** con `cambiarNegocio()` (que hace `window.location.href` — recarga completa de la app). Solo se ve **un negocio a la vez**.
- "Multisucursal" del plan MAX **hoy solo significa un tope de cantidad** (`planes.max_negocios`: PRO=1, MAX=3). No existe ninguna vista consolidada — ni implementada ni diseñada. Confirmado en `PLAN-PLANES-SUSCRIPCION.md §11.2` y `PENDIENTES.md` ("Reportes y estadísticas avanzadas — sin diseño aún").
- Lo único que "agrupa" negocios de un mismo dueño hoy es `negocios.propietario_usuario_id` (FK plana a `usuarios`), usado en `/admin` **solo para tareas de facturación del superadmin** (cobro, suspensión, purga) — nunca para reporting operativo.

**Conclusión:** no es que estés usando mal la app. Es una feature que no existe todavía.

---

## 3. ¿La solución propuesta es la correcta? (validación con SaaS reales)

Investigué cómo resuelven esto los SaaS multi-tenant y los POS multi-sucursal (Shopify, Square, Toast). Los hallazgos confirman que el enfoque propuesto es el estándar de la industria:

| Práctica del sector | Cómo aplica a tu caso |
|---|---|
| **Shared database + Row-Level Security** es el patrón multi-tenant más común y recomendado (2026). No se abandona la RLS para hacer reportes cross-tenant. | Tu app **ya usa este patrón** (RLS por `negocio_id`). El plan **no lo rompe** — agrega una función que agrega datos de forma controlada, sin exponer queries cross-tenant al cliente. |
| **La identidad/tenant viaja en el JWT**; la agregación cross-tenant se hace en el backend validando permisos, no aflojando RLS en el cliente. | Usamos una función `SECURITY DEFINER` que valida `propietario_usuario_id = auth.uid()` internamente. El cliente nunca puede pedir datos de negocios que no le pertenecen. |
| **Shopify POS**: un dueño ve "consolidated reporting across all locations" en una vista central; puede cambiar entre "todas las tiendas" y una tienda específica. **Square/Toast**: soportan multi-location con reporting central desde hace años. | Replicamos exactamente ese patrón: una vista "Todas las sucursales" + poder entrar a una específica (lo que ya haces con `cambiarNegocio()`). |
| La vista consolidada **vive fuera del contexto de una tienda individual** (es un "nivel superior" del propietario). | Ponemos la pantalla fuera del contexto de negocio activo, análogo a como `/admin` vive fuera del contexto de negocio para el superadmin. |

**Veredicto:** la solución propuesta (función `SECURITY DEFINER` de agregación por propietario + pantalla nueva de solo lectura + gate por plan MAX) es la forma **profesional, segura y estándar** de resolver esto. No hay un atajo mejor: aflojar la RLS para permitir queries cross-tenant desde el cliente sería más simple de escribir pero introduce riesgo real de fuga de datos entre negocios — exactamente el tipo de bug que el sector advierte como el más peligroso en multi-tenancy.

---

## 4. Principios de diseño (lo que NO se toca)

1. **La RLS por `negocio_id` no se afloja.** Sigue siendo la garantía de aislamiento. Ninguna tabla cambia su política.
2. **El cliente Angular NO hace queries cross-tenant.** Toda la agregación multi-negocio vive en funciones `SECURITY DEFINER` que validan la propiedad internamente.
3. **No se cambia el negocio activo** para ver la vista de grupo. Es solo lectura, no toca el JWT, no hace `cambiarNegocio()`.
4. **Solo el propietario** (no un ADMIN cualquiera, no un EMPLEADO) ve sus propios negocios agregados. La validación es `negocios.propietario_usuario_id = auth.uid()`.
5. **Gate por plan MAX.** Si el plan no incluye multisucursal (o el dueño tiene 1 solo negocio), la pantalla ni aparece.
6. **Empezar acotado.** Primero ventas + resumen consolidado. Expandir a otros módulos (inventario, caja) solo si hay demanda real — mismo criterio con que se eliminó el módulo `reportes` genérico en favor de paneles puntuales.

---

## 5. Arquitectura de la solución

### 5.1 Backend — nuevas funciones SQL (`SECURITY DEFINER`)

**Patrón común a todas:** reciben el rango de fechas, resuelven internamente la lista de negocios del propietario autenticado, y agregan. Nunca reciben `negocio_id` como parámetro del cliente.

```sql
-- Pseudo-estructura — el filtro de propiedad va DENTRO de la función
v_propietario_id := auth.uid();  -- o resuelto vía get_email() → usuarios.id

-- Lista blanca de negocios que este usuario posee:
--   SELECT id FROM negocios WHERE propietario_usuario_id = v_propietario_id
-- Todas las agregaciones filtran: WHERE negocio_id IN (esa lista)
```

**Funciones nuevas:**

| Función | Qué devuelve | Análoga a |
|---|---|---|
| `fn_grupo_negocios()` | Lista de negocios del propietario (id, nombre, slug) para poblar el selector y las columnas del comparativo | patrón `propietariosAgrupados` de `admin-negocios.page.ts` |
| `fn_grupo_resumen_ventas(p_fecha_inicio, p_fecha_fin)` | Totales consolidados (ventas, monto, ganancia, ticket promedio…) **+ desglose por negocio** (una fila por sucursal) | `fn_reporte_ventas_periodo` pero sumando todos los negocios del dueño |
| `fn_grupo_ventas_por_sucursal(p_fecha_inicio, p_fecha_fin)` | Ranking/comparativa: cuánto vendió cada sucursal en el período, con su participación % | (nuevo) |

> **Nota de seguridad crítica:** estas funciones NO llevan `PERFORM fn_assert_no_superadmin()` porque son de lectura, pero SÍ deben validar `propietario_usuario_id = <usuario autenticado>` en cada query. Es el mismo mecanismo que ya usa la RLS de `negocios` para el superadmin (`EXISTS ... WHERE es_superadmin`), pero aquí la condición es "ser el dueño". Un usuario que pase por esta función solo puede ver **sus propios** negocios — nunca los de otro propietario.

### 5.2 Frontend — nueva pantalla "Vista de grupo"

**Ubicación:** módulo nuevo `src/app/features/grupo/` (o `multinegocio/`), con su ruta propia fuera del layout de un negocio específico.

**Estructura (reusa patrones existentes):**
- Reutiliza el **filtro de período** (`period-filter.component`) que ya usa `ventas-resumen`.
- Reutiliza las **cards de métricas** y el estilo visual de `ventas-resumen.page` — para que se sienta familiar, "el mismo resumen que ya conoces, pero de todos los negocios".
- **Tabs internas** (patrón `ventas-tabs`): "Consolidado" (totales de todo el grupo) y "Por sucursal" (comparativa negocio por negocio).
- Cada fila/columna de sucursal lleva un **badge con el nombre del negocio** (patrón ya usado en `admin-negocios`).

**Acceso desde el sidebar:** una entrada nueva "Vista de grupo" que solo aparece si:
```typescript
suscripcionService.tieneFeature('multisucursal')  // gate del plan MAX
  && esPropietario                                  // es el dueño, no un admin invitado
  && cantidadNegociosPropios >= 2                   // tiene más de 1 negocio
```

### 5.3 El gate del plan MAX

Ya existe la infraestructura: `SuscripcionService.tieneFeature(codigo)` (`core/services/suscripcion.service.ts:148`). Solo falta:
- Agregar la feature key `multisucursal: true` (o reusar la ya planeada) al JSON de `planes.features` del plan MAX.
- La pantalla y la entrada del sidebar se condicionan a `tieneFeature('multisucursal')`.

### 5.4 Identificar al propietario en el frontend

**Falta un dato:** `UsuarioActual` (lo que expone `AuthService.usuarioActualValue`) hoy **no tiene** `es_propietario`. Opciones:
- **(A) Query puntual** al entrar a la pantalla: comparar `usuarioActualValue.id` contra los `propietario_usuario_id` de sus negocios (la propia función `fn_grupo_negocios()` puede devolver solo los negocios donde es dueño → si la lista tiene 2+, es propietario multi-negocio). **Recomendada** — no toca el JWT.
- (B) Agregar `es_propietario` al JWT vía `fn_set_negocio_activo`. Más invasivo (toca el flujo de auth). Se descarta salvo que se necesite en más lugares.

Con la opción A, la propia función de backend es la fuente de verdad: si `fn_grupo_negocios()` devuelve 2+ negocios, se muestra la vista; si devuelve 0 o 1, no. Cero lógica de permisos duplicada en el cliente.

---

## 6. Plan de implementación por fases

### Fase 1 — Backend de agregación (fundacional)
1. Crear `docs/grupo/sql/functions/fn_grupo_negocios.sql` — lista de negocios del propietario autenticado.
2. Crear `docs/grupo/sql/functions/fn_grupo_resumen_ventas.sql` — totales consolidados + desglose por negocio (basado en la lógica ya probada de `fn_reporte_ventas_periodo`, cambiando `negocio_id = X` por `negocio_id IN (negocios del dueño)`).
3. Ejecutar en Supabase y validar con datos reales (un dueño con 2-3 negocios de prueba).
4. **Entregable verificable:** llamar las funciones desde el SQL Editor y ver los totales sumados correctamente.

### Fase 2 — Pantalla "Vista de grupo" (consolidado)
1. Módulo nuevo `features/grupo/` con ruta protegida por `suscripcionGuard` + verificación de propietario.
2. Tab "Consolidado": cards de métricas totales (ventas, ganancia, ticket promedio) reusando el estilo de `ventas-resumen`.
3. Filtro de período reusado.
4. **Entregable verificable:** el dueño ve la suma de ventas de sus 3 negocios en una pantalla, con filtro Hoy/Semana/Mes.

### Fase 3 — Comparativa por sucursal
1. Tab "Por sucursal": tabla/cards con una fila por negocio (nombre, ventas, monto, % del total).
2. Opcional: mini-gráfico de barras comparando sucursales (reusa `ng-apexcharts` que ya está en `ventas-resumen`).
3. **Entregable verificable:** el dueño ve qué sucursal vende más y cuánto aporta cada una.

### Fase 4 — Integración de acceso y gate MAX
1. Entrada "Vista de grupo" en el sidebar, condicionada a `tieneFeature('multisucursal') && 2+ negocios propios`.
2. Agregar `multisucursal: true` a `planes.features` del MAX.
3. **Entregable verificable:** un dueño PRO (o con 1 negocio) no ve la opción; un dueño MAX con 2+ negocios sí.

### Fase 5 (opcional, futura) — Expansión
- Consolidado de caja, inventario o clientes entre negocios, **solo si se pide**. Cada uno es una función `fn_grupo_*` nueva siguiendo el mismo patrón. No se hace por adelantado.

---

## 7. Alcance de la primera versión (MVP)

**Incluye:** ventas consolidadas (totales + por sucursal), con filtro de período. Solo lectura. Gate MAX.

**NO incluye (deliberadamente, para no sobre-construir):**
- Consolidado de inventario/caja/clientes (Fase 5, bajo demanda).
- Exportar a Excel/PDF (feature separada si se necesita).
- Jerarquía formal "negocio padre/hijo" — no hace falta; `propietario_usuario_id` compartido es suficiente para agrupar.
- Cambiar cómo funciona `cambiarNegocio()` — sigue igual, para cuando el dueño sí quiere entrar a operar en una sucursal concreta.

---

## 8. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Fuga de datos entre propietarios (ver negocios ajenos) | La función valida `propietario_usuario_id = auth.uid()` en cada query. Nunca recibe `negocio_id` del cliente. Es el mismo mecanismo probado del superadmin en `/admin`. |
| Un ADMIN invitado (no dueño) intenta ver la vista | La función devuelve solo negocios donde ES propietario. Un admin invitado no es `propietario_usuario_id` → lista vacía → no ve nada. |
| Performance con muchos negocios | MAX tope 3 negocios. La agregación sobre 3 tenants es trivial. Los índices por `negocio_id` ya existen en `ventas`. |
| El dueño confunde saldos de distintas sucursales | Cada fila/columna lleva badge con nombre del negocio (patrón ya usado). El consolidado se etiqueta claramente como "Total del grupo". |
| Feature usada sin plan MAX | Doble gate: `tieneFeature('multisucursal')` en el cliente + la función de backend solo agrega negocios del dueño (si el gate del cliente fallara, el peor caso es ver tus propios datos que ya podés ver entrando a cada negocio). |

---

## 9. Estimación de esfuerzo (orientativa)

| Fase | Complejidad | Nota |
|---|---|---|
| 1 — Backend agregación | Media | Reusa lógica de `fn_reporte_ventas_periodo`; el cambio clave es `IN (lista)` en vez de `= X` |
| 2 — Pantalla consolidado | Media | Reusa componentes de `ventas-resumen` (period-filter, cards, estilos) |
| 3 — Comparativa sucursal | Baja-Media | Tabla + gráfico opcional con librería ya presente |
| 4 — Acceso + gate | Baja | `tieneFeature()` ya existe; solo condicionar sidebar |

---

## 10. Decisión pendiente del dueño

Antes de implementar, confirmar:

1. **¿MVP solo ventas, o desde el inicio también algún otro módulo** (caja / inventario)? — Recomendación: solo ventas primero.
2. **Nombre de la pantalla:** "Vista de grupo" / "Todas las sucursales" / "Resumen global" — ¿preferencia?
3. **¿La entrada va en el sidebar** (siempre visible para el dueño MAX) **o como un botón/toggle dentro del módulo Ventas actual** ("ver todas mis sucursales")? — Recomendación: sidebar, es un nivel superior conceptual.

---

## Fuentes de la investigación (SaaS multi-tenant / multi-location)

- [Multi-Tenant Analytics: How to Give Each Customer Their Own Dashboards (2026) — DataTako](https://datatako.com/blog/multi-tenant-analytics)
- [Multi-tenant analytics for SaaS applications — Tinybird](https://www.tinybird.co/blog/multi-tenant-saas-options)
- [Multi-Tenant Architecture: The Complete Guide for Modern SaaS — bix-tech](https://bix-tech.com/multi-tenant-architecture-the-complete-guide-for-modern-saas-and-analytics-platforms-2/)
- [Multi-Store Point of Sale System — Shopify](https://www.shopify.com/pos/multi-store-pos)
- [Multi-Tenant Deployment: 2026 Complete Guide — Qrvey](https://qrvey.com/blog/multi-tenant-deployment/)
