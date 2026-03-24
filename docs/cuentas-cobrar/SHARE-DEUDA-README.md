# Compartir Estado de Cuenta — Cuentas por Cobrar

Feature para generar y compartir una imagen profesional del estado de cuenta de un cliente fiado,
con detalle de productos por venta. Se abre desde `DetalleClientePage`.

---

## Flujo técnico

```
1. Usuario toca "Compartir"
2. Se cargan los items de cada venta (ventas_detalles → productos)
3. Se genera HTML/CSS en un div oculto fuera del viewport
4. html2canvas captura el div → Base64 PNG
5. @capacitor/filesystem guarda el PNG como archivo temporal
6. @capacitor/share abre el menú nativo del OS
7. Usuario elige WhatsApp / email / etc.
```

---

## Estado de cuenta — diseño del "ticket"

```
┌─────────────────────────────────────┐
│  🏪  MI TIENDA                      │
│  Estado de cuenta                   │
│  24/03/2026                         │
├─────────────────────────────────────┤
│  Cliente: Juan Pérez                │
│  RUC/Cédula: 1712345678             │
├─────────────────────────────────────┤
│  TICKET #5 · 15/03/2026             │
│  ─────────────────────────          │
│  Arroz 5kg          2 x $3.50       │
│  Aceite 1L          1 x $2.80       │
│  Azúcar 2kg         3 x $1.20       │
│                Total: $16.40        │
│                Abonado: -$5.00      │
│                Pendiente: $11.40    │
├─────────────────────────────────────┤
│  TICKET #8 · 20/03/2026             │
│  ─────────────────────────          │
│  Leche 1L           4 x $0.90       │
│                Total: $3.60         │
│                Pendiente: $3.60     │
├─────────────────────────────────────┤
│  TOTAL PENDIENTE         $15.00     │
│                                     │
│  Generado: 24/03/2026 14:32         │
└─────────────────────────────────────┘
```

---

## Datos necesarios

| Dato | Fuente | ¿Disponible? |
|------|--------|--------------|
| `cliente.nombre` | `clientes` | ✅ Ya cargado en DetalleClientePage |
| `cliente.identificacion` | `clientes` | ✅ Ya cargado |
| `ventasFiadas[]` (lista) | `VentaFiada[]` | ✅ Ya cargado |
| `venta.total`, `saldo_pendiente`, `monto_pagado` | `VentaFiada` | ✅ Ya disponible |
| `venta.tipo_comprobante`, `numero_comprobante` | `VentaFiada` | ✅ Ya disponible |
| **`ventas_detalles` (items de cada venta)** | `ventas_detalles JOIN productos` | ❌ Falta — requiere nueva query |

### Interface que falta — `VentaFiadaDetalle`

```typescript
// En cuenta-cobrar.model.ts
export interface VentaFiadaItem {
    id: string;
    producto_nombre: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
}
```

---

## Plan de implementación

### Fase 1 — Datos (backend/service)
- [ ] Agregar `VentaFiadaItem` a `cuenta-cobrar.model.ts`
- [ ] Agregar método `obtenerItemsVenta(ventaId)` en `CuentasCobrarService`
  - Query: `ventas_detalles` con join a `productos` filtrando por `venta_id`
  - Retorna `VentaFiadaItem[]`
- [ ] En `DetalleClientePage.cargarDatos()`: cargar items de todas las ventas en paralelo con `Promise.all`
  - Guardar en `itemsPorVenta: Map<string, VentaFiadaItem[]>`

### Fase 2 — Servicio de generación (`ShareEstadoCuentaService`)
- [ ] Crear `src/app/features/cuentas-cobrar/services/share-estado-cuenta.service.ts`
- [ ] Método `generarImagen(cliente, ventas, itemsPorVenta)`:
  1. Crear div `position: absolute; left: -9999px; top: 0` en el body
  2. Inyectar HTML del ticket (HTML/CSS vanilla, sin `ion-*`)
  3. Llamar `html2canvas(div, { scale: 2, useCORS: true })` → `canvas`
  4. Remover div del DOM
  5. `canvas.toDataURL('image/png')` → base64
- [ ] Método `compartir(base64, clienteNombre)`:
  1. Usar `@capacitor/filesystem` para escribir PNG temporal en `Directory.Cache`
  2. Usar `@capacitor/share` para abrir menú nativo con la URI del archivo
  3. Al terminar, eliminar el archivo temporal del cache

### Fase 3 — Template HTML del ticket
- [ ] Crear función `buildTicketHtml(cliente, ventas, itemsPorVenta, fecha)` en el servicio
  - HTML/CSS inline (no clases externas — html2canvas no accede a stylesheets separados)
  - Fuente: `font-family: 'Courier New', monospace` (estilo recibo)
  - Ancho fijo: `320px` (equivale a ticket térmico 80mm)
  - Secciones: header tienda → datos cliente → ventas con items → total final → fecha generación
- [ ] Estilo del ticket:
  - Fondo blanco, texto negro
  - Divisores con `border-top: 1px dashed #ccc`
  - Total pendiente en negrita/rojo
  - Header centrado con nombre de tienda

### Fase 4 — Integración en DetalleClientePage
- [ ] Instalar dependencias: `npm install html2canvas`
  - `@capacitor/filesystem` y `@capacitor/share` verificar si ya están instalados
- [ ] Reemplazar método `compartirDeuda()` actual para usar `ShareEstadoCuentaService`
- [ ] Mostrar loading mientras se genera la imagen (`ui.showLoading`)
- [ ] Manejo de error: si falla html2canvas, fallback al mensaje de texto actual

### Fase 5 — UX del botón compartir
- [ ] En `DetalleClientePage`: el botón "share" del header solo aparece cuando hay ventas (ya está así)
- [ ] Mientras genera: botón deshabilitado + spinner
- [ ] Si el cliente no tiene teléfono: el share nativo igual funciona (el usuario elige app)

---

## Dependencias a instalar

```bash
npm install html2canvas
# Verificar si ya están:
# @capacitor/filesystem
# @capacitor/share
```

Verificar en `package.json` antes de instalar.

---

## Notas técnicas importantes

### html2canvas y Shadow DOM
`html2canvas` no penetra Shadow DOM. Por eso el HTML del ticket debe ser **HTML vanilla puro**,
sin ningún componente `ion-*`. Solo `div`, `p`, `span`, `table`.

### CSS inline obligatorio
html2canvas no lee stylesheets externos. Todo el CSS debe ir en `style=""` inline
o en un `<style>` tag dentro del mismo elemento capturado.

### Scale 2 para nitidez
```typescript
html2canvas(div, { scale: 2 }) // Retina/HDPI — imagen más nítida en pantallas modernas
```

### Archivo temporal en Cache
```typescript
// Escribir
await Filesystem.writeFile({
    path: 'estado-cuenta-temp.png',
    data: base64,
    directory: Directory.Cache,
});
// Leer URI nativa para Share
const { uri } = await Filesystem.getUri({ path: 'estado-cuenta-temp.png', directory: Directory.Cache });
// Compartir
await Share.share({ files: [uri], title: `Estado de cuenta - ${clienteNombre}` });
// Limpiar
await Filesystem.deleteFile({ path: 'estado-cuenta-temp.png', directory: Directory.Cache });
```

### Fallback si Share no está disponible
```typescript
const canShare = await Share.canShare();
if (!canShare.value) {
    // Fallback: copiar texto al clipboard
}
```

---

## Archivos a crear / modificar

| Archivo | Acción |
|---------|--------|
| `cuentas-cobrar/models/cuenta-cobrar.model.ts` | Agregar `VentaFiadaItem` |
| `cuentas-cobrar/services/cuentas-cobrar.service.ts` | Agregar `obtenerItemsVenta()` |
| `cuentas-cobrar/services/share-estado-cuenta.service.ts` | **Crear** |
| `cuentas-cobrar/pages/detalle-cliente/detalle-cliente.page.ts` | Integrar servicio, cargar items |
| `package.json` | Agregar `html2canvas` |
