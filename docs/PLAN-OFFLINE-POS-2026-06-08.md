# Análisis — Modo Offline en Mi Tienda

> Documento de decisión. Fecha: 2026-06-08. **Estado: PROPUESTA — pendiente de aprobación.**
> Objetivo: que el POS siga vendiendo cuando no hay internet o la conexión es lenta/intermitente,
> sincronizando contra Supabase cuando vuelve la red.

---

## 1. Conclusión ejecutiva (TL;DR)

- **SQLite NO es la herramienta correcta para este proyecto.** Es pesado, no funciona en web (la app es multiplataforma), y obligaría a reescribir la lógica financiera que hoy vive en funciones PostgreSQL atómicas. Lo descarto.
- **El modo offline debe limitarse a dos cosas: (a) cache de lectura del catálogo de productos y (b) cola de ventas POS en efectivo.** Es el único punto donde "no poder operar sin internet" tiene impacto real en el negocio. Todo lo demás (cierres de caja, inventario, nómina, reportes, transferencias) **debe seguir siendo online-only**.
- **Recomendación: cola local de ventas pendientes (outbox pattern) + cache del catálogo**, con almacenamiento ligero, no una réplica de base de datos. El POS ya está a un 70% de soportarlo gracias a la **idempotencia** que ya existe.
- **Contrastado contra el schema real (`docs/setup/schema.sql`) y `fn_registrar_venta_pos`** — la decisión no cambia, se confirma. Ver §9 para la evidencia técnica.

---

## 2. Por qué SQLite NO

| Razón | Detalle |
|-------|---------|
| **No funciona en web** | La app corre en Android (Capacitor), web (PWA/desktop) y iOS. SQLite (`@capacitor-community/sqlite`) requiere fallback `jeep-sqlite` + WASM en web — duplica complejidad y peso para un beneficio que en desktop (donde casi siempre hay internet) no se necesita. |
| **Duplica la lógica de negocio** | Toda la lógica financiera (descuento de stock, kardex, saldo de cajón, IVA, secuencias de comprobante, fiados) vive en funciones PostgreSQL atómicas (`fn_registrar_venta_pos`, triggers). Replicar eso en SQLite local = mantener dos motores de reglas en paralelo. Garantía de inconsistencias. |
| **Rompe el modelo multi-tenant + RLS** | El aislamiento por `negocio_id` y las políticas RLS son la columna vertebral de seguridad. SQLite local no tiene RLS — habría que reimplementar el aislamiento a mano. |
| **Conflictos de stock irresolubles** | Si dos cajeros venden offline el mismo producto con stock 1, SQLite local no puede saberlo. El servidor es la única fuente de verdad del stock. |
| **Sobre-ingeniería** | Estás a punto de cargar un motor de BD completo para resolver un problema que es, en esencia, "guardar 3-10 tickets mientras vuelve la señal". |

> **Regla:** el servidor (Supabase/PostgreSQL) es y debe seguir siendo la **única fuente de verdad**. El cliente offline solo encola intenciones, no calcula resultados financieros.

---

## 3. Qué SÍ y qué NO debe funcionar offline

Solo tiene sentido el offline donde el costo de "esperar a tener señal" es perder una venta frente al cliente.

| Flujo | ¿Offline? | Por qué |
|-------|-----------|---------|
| **Registrar venta POS (cobro efectivo/transferencia)** | ✅ **SÍ** | Es el único caso crítico. El cliente está enfrente con el dinero. No vender = perder la venta. |
| **Catálogo + categorías + códigos de barras en POS** | ✅ **SÍ (lectura cacheada)** | Necesario para armar el carrito sin red. Son datos de **solo lectura** en el POS — cero riesgo de integridad. El POS nunca los muta. Ver §4.5. |
| Venta **FIADO** | ❌ NO (online-only) | Requiere validar y mutar el saldo del cliente contra el servidor. Riesgo de fiar de más sin control. |
| Venta **FACTURA** | ⚠️ Discutible | Las secuencias de comprobante fiscal (SRI) se asignan en el servidor. Offline = numeración local provisional reconciliada al sincronizar. Recomiendo dejarla online-only en v1. |
| Cierre diario de caja | ❌ NO | Operación contable de alto riesgo, multi-caja, una vez al día. Siempre hay un momento con señal. |
| Apertura de turno | ❌ NO | Una vez al día, no urgente frente al cliente. |
| Inventario (crear/editar/ajustar stock) | ❌ NO | No es urgente; el admin puede esperar señal. |
| Recargas celular/bus | ❌ NO | Requieren saldo del proveedor en tiempo real. |
| Nómina, movimientos empleados, transferencias | ❌ NO | Operaciones administrativas, no frente al cliente. |

> **Decisión de diseño:** "Modo offline" en esta app = **"POS sigue cobrando efectivo y encola la venta"**. Nada más. Esto mantiene el alcance pequeño, seguro y mantenible.

---

## 4. Arquitectura propuesta — Outbox de ventas (cola local)

### 4.1 Lo que YA tenemos a favor

El POS ya implementa **idempotencia** (ver `docs/pos/POS-README.md` §Idempotencia):

- Cada venta genera un `crypto.randomUUID()` (`idempotency_key`) **antes** de llamar al RPC.
- `ventas.idempotency_key` tiene constraint `UNIQUE` en BD.
- `fn_registrar_venta_pos` detecta duplicados y retorna la venta previa sin re-ejecutar efectos.
- Ya existe `recuperarVentaPendiente()` en `ionViewWillEnter`.

> Esto significa que **reenviar una venta encolada es 100% seguro**: si ya se grabó, el servidor la ignora. La base del offline ya está puesta — solo falta generalizar "1 venta pendiente" a "N ventas pendientes en cola".

### 4.2 Almacenamiento

Usar **`@capacitor/preferences`** (ya en el stack vía Capacitor) o IndexedDB para una sola clave: una lista JSON de ventas pendientes (`pos_outbox`). No es una base de datos — es una cola serializada.

```
pos_outbox = [
  { idempotencyKey, carrito[], payload, turnoId, empleadoId, fechaLocal, intentos },
  ...
]
```

- Es pequeño (cada venta es un JSON de pocos KB).
- Sobrevive a cierres de app.
- No necesita esquema, migraciones ni motor SQL.

### 4.3 Flujo de cobro offline

```
Cobrar (efectivo/transferencia)
   │
   ▼
¿NetworkService.isConnected()?
   │
   ├── SÍ → intentar RPC fn_registrar_venta_pos
   │         ├── éxito → limpiar carrito + ticket OK
   │         └── falla de red a mitad → encolar en pos_outbox (la key ya protege)
   │
   └── NO → encolar venta en pos_outbox
             ├── descontar stock SOLO localmente (optimista, en el catálogo cacheado)
             ├── mostrar ticket "Venta registrada (pendiente de sincronizar)"
             └── badge visible: "N ventas por sincronizar"
```

### 4.4 Sincronización (al volver la red)

```
NetworkService.getNetworkStatus() emite true
   │
   ▼
SyncService procesa pos_outbox en orden (FIFO):
   para cada venta pendiente:
     llamar fn_registrar_venta_pos con su idempotencyKey
       ├── success → quitar de la cola
       ├── duplicado:true → quitar de la cola (ya estaba grabada)
       └── error de stock → marcar venta en conflicto + alertar al cajero
```

- La sincronización corre también en `ionViewWillEnter` del POS y al arrancar la app.
- Botón manual "Sincronizar ahora" para el cajero.

### 4.5 Cache del catálogo (productos + categorías + códigos de barras)

Para armar el carrito sin red hace falta tener el catálogo descargado. Esto es **independiente y de mucho menor riesgo** que la cola de ventas, porque en el POS estos datos son **solo lectura** — confirmado contra el schema: el POS los consume vía `fn_catalogo_productos_pos`, `fn_buscar_productos_pos` y el lookup de `codigos_barras`, pero **nunca los muta** (las mutaciones de inventario viven en el módulo `inventario`, que es online-only).

**Qué se cachea** (snapshot del último fetch exitoso, por `negocio_id`):
- `productos` (vista `v_productos_completos`: nombre, precio, stock, IVA, tipo_venta)
- `categorias_productos` (para el filtro de categorías del catálogo)
- `producto_presentaciones` (variantes/packs)
- `codigos_barras` (para que el escáner funcione offline)

**Dónde:** una clave por tipo en `@capacitor/preferences` (o IndexedDB si crece). Es un JSON de lectura, no una BD.

**Política de refresco:**
- Se reescribe el cache en cada carga online exitosa del catálogo (`refrescarCatalogo()` ya existe en `pos.page.ts`).
- Al entrar al POS sin red → se hidrata desde el cache.
- Se muestra un sello "Catálogo actualizado: <fecha/hora>" para que el cajero sepa qué tan fresco es.

**Imágenes:** las signed URLs de Storage expiran (~1h) y las imágenes no estarán disponibles offline salvo que el WebView las tenga en su cache HTTP. **Decisión v1: offline muestra placeholder/ícono cuando la imagen no cargó.** No vale la pena descargar y persistir blobs de todo el catálogo en v1.

> **Regla de oro del cache:** el stock cacheado es **optimista e informativo**, no la verdad. La verdad del stock la define el servidor al sincronizar la venta. El cache existe para *poder vender*, no para *garantizar disponibilidad exacta*.

---

## 5. El problema difícil: STOCK offline

Es el único punto que requiere una decisión de negocio explícita, porque el stock es un recurso compartido que el cliente offline no puede validar contra el servidor.

**Escenarios:**
- Un solo dispositivo offline vendiendo → el stock cacheado local alcanza para descontar de forma optimista. Riesgo bajo.
- Dos o más dispositivos offline (o uno offline + otro online) vendiendo el mismo producto → pueden vender más unidades de las que hay. El servidor lo detectará al sincronizar.

**Opciones para resolver el conflicto al sincronizar:**

| Estrategia | Comportamiento | Recomendación |
|-----------|----------------|---------------|
| **A. Permitir stock negativo** | El servidor acepta la venta aunque deje stock en negativo. El admin lo corrige luego con un ajuste de inventario. | ✅ **Recomendada para v1.** Simple. La venta YA ocurrió físicamente (el cliente se llevó el producto y pagó). Negar la venta a posteriori no tiene sentido. El negativo es información real: "vendiste lo que no tenías registrado". |
| B. Rechazar y alertar | El servidor rechaza la venta sincronizada por falta de stock; el cajero debe resolver. | ❌ Mala UX: la venta ya pasó, el dinero está en el cajón. Rechazarla descuadra la caja. |

> **Recomendación:** en modo offline, `fn_registrar_venta_pos` debe permitir que el stock quede negativo (agregando un parámetro `p_permitir_stock_negativo` activado solo para ventas que vienen de la cola offline). El negativo es una señal honesta para el admin, no un error.

> ⚠️ **Hallazgo del schema — esto NO es trivial:** hoy la BD **prohíbe físicamente** el stock negativo en dos capas:
> 1. `productos.stock_actual` tiene `CONSTRAINT chk_stock_no_negativo CHECK (stock_actual >= 0)` ([schema.sql:469](setup/schema.sql#L469)).
> 2. El trigger `fn_actualizar_stock_venta` ([schema.sql:1099](setup/schema.sql#L1099)) hace `RAISE EXCEPTION 'Stock insuficiente'` antes de descontar.
>
> Permitir negativo offline implica relajar **ambas** capas solo para la ruta offline (ej: bajar el CHECK a un mínimo razonable o quitarlo y dejar la validación solo al trigger en modo online). Es un cambio de modelo de datos que debe aprobarse explícitamente, no asumirse. Es justamente la pregunta #2 de §8.

---

## 6. Alcance de la implementación (v1)

**Incluye:**
1. `OutboxService` (core) — cola de ventas pendientes en `@capacitor/preferences`.
2. `SyncService` (core) — drena la cola cuando hay red (listener de `NetworkService` + manual).
3. Modificar `PosService.procesarVenta()` para encolar en vez de fallar cuando no hay red.
4. Cache del catálogo de productos para armar carrito sin señal.
5. Descuento de stock optimista local sobre el catálogo cacheado.
6. UI: badge "N ventas por sincronizar" + estado de cada venta + botón "Sincronizar ahora".
7. Ajuste en `fn_registrar_venta_pos` para tolerar stock negativo en ventas offline.

**NO incluye (online-only, sin cambios):**
- FIADO, FACTURA, cierres, aperturas, inventario, nómina, recargas, transferencias.

**Riesgos a aceptar conscientemente:**
- Stock puede quedar negativo (resuelto con ajuste manual — es correcto).
- El comprobante FACTURA no aplica offline en v1.
- Ventas offline no aparecen en otros dispositivos hasta sincronizar.

---

## 7. Comparativa de enfoques

| Enfoque | Esfuerzo | Riesgo | Web | Recomendación |
|---------|----------|--------|-----|---------------|
| SQLite réplica local | Muy alto | Alto (doble lógica, RLS, conflictos) | Requiere WASM | ❌ Descartado |
| **Outbox de ventas (cola)** | **Medio** | **Bajo (idempotencia ya existe)** | **Funciona igual** | ✅ **Recomendado** |
| Cache offline genérico (PWA service worker) | Alto | Medio | Solo web | ❌ No cubre Android nativo |
| Nada (online-only) | Cero | — | — | Status quo actual |

---

## 8. Preguntas para aprobar antes de implementar

1. ¿Confirmás que el alcance offline se limita a **ventas POS en efectivo/transferencia** (FIADO y FACTURA quedan online)?
2. ¿Aceptás la estrategia de **stock negativo** para ventas offline (corrección posterior con ajuste de inventario)?
3. ¿Cuántos dispositivos venden simultáneamente por negocio? (Define cuán probable es el conflicto de stock.)
4. ¿Querés que el cajero pueda forzar venta offline manualmente, o solo automático cuando se detecta sin red?

---

## 9. Evidencia técnica — contraste contra el schema real

Verificado en `docs/setup/schema.sql` y `docs/pos/sql/functions/fn_registrar_venta_pos.sql`. Esto es lo que confirma cada decisión:

| Hallazgo en el schema/función | Implicación para el offline |
|-------------------------------|------------------------------|
| `fn_registrar_venta_pos` asigna el **número de comprobante de forma atómica** (`UPDATE secuencias_comprobantes +1` por negocio) | La numeración **no puede generarse offline** sin colisiones → el servidor es la única fuente de verdad. Refuerza el outbox (encolar, no calcular). |
| `idempotency_key UUID UNIQUE` ([schema.sql:603](setup/schema.sql#L603)) + doble guarda en la función (chequeo previo + `EXCEPTION WHEN unique_violation`) | **Reenviar ventas encoladas es 100% seguro** a nivel de motor. Cimiento del outbox — ya está construido. |
| Venta dispara **3 triggers en cascada**: stock (`fn_actualizar_stock_venta`), kardex, saldo de cajón (`fn_actualizar_saldo_caja_venta`) | Replicar esto en SQLite = mantener 3 triggers + función + constraints en paralelo. **Confirma descartar SQLite.** |
| `chk_stock_no_negativo` + `RAISE EXCEPTION` en trigger | El stock negativo **está prohibido hoy**. La estrategia offline requiere relajarlo explícitamente (pregunta #2). |
| `productos`, `categorias_productos`, `producto_presentaciones`, `codigos_barras` son **solo lectura en el POS** (consumidos por `fn_catalogo_productos_pos` / `fn_buscar_productos_pos` / lookup barcode) | **Cachearlos es seguro** — el POS nunca los muta. Habilita el catálogo offline sin riesgo de integridad. |
| Toda tabla tiene `negocio_id` + RLS por JWT | El cache local **debe estar namespaced por `negocio_id`** y limpiarse en `cambiarNegocio()` (que ya hace hard reload). |

**Veredicto:** el schema no solo no contradice la propuesta — la valida en cada punto. SQLite descartado; outbox + cache de catálogo confirmados como el camino correcto, seguro y mantenible.

---

*Propuesta generada para revisión. No se ha modificado código (salvo este documento). Espera aprobación.*
