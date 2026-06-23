# Layout

Feature contenedora del **shell de la aplicación autenticada**: tab bar inferior, drawer lateral (sidebar), FAB central, y `router-outlet` para todas las páginas internas.

## Estructura

```
features/layout/
├── layout.routes.ts
└── pages/
    └── main/
        ├── main-layout.page.ts/.html/.scss
        └── ...
```

## Responsabilidades

- **Tab bar** con accesos a Inicio, Inventario, POS, Ventas, Clientes.
- **FAB central** que abre el menú de acciones rápidas (Nueva nota, Cuadre, Calculadora).
- **Sidebar** (drawer en móvil, fijo en ≥992px) con menú secundario.
- **Coordina visibilidad de tabs** vía `UiService.tabsVisible` signal. Páginas de detalle pueden ocultarlas con `ui.hideTabs()`.
- **Banner offline** (`OfflineBannerComponent`) cuando el usuario pierde conexión o hay ventas en cola.

## Banner offline (`OfflineBannerComponent`)

Global en `app.component.html`, sobre el `ion-router-outlet`. Único punto visual del estado offline.

- **Dos estados:** "Sin conexión" (ámbar / `warning`) cuando no hay red; "Sincronizando N venta(s)" (azul /
  `primary`, clicable → `/ventas/pendientes`) cuando hay cola drenándose con red. Visible si `isOffline || pendientes > 0`.
- **Empuja el contenido, no lo tapa:** `ion-app` es flex column (`app.component.scss`); el banner ocupa su
  altura arriba y el router-outlet toma el resto. No usa `position: fixed`.
- **Safe area (celular):** el `:host` reserva el `safe-area-inset-top` **solo cuando el banner es visible**
  (`:host-context(body.offline-banner-visible)`) — online no ocupa espacio. Esa franja usa `--app-bg` (color de
  la app), así la status bar (hora/batería) conserva su color y el banner empieza debajo.
- **Coordinación global:** el componente togglea la clase `body.offline-banner-visible`. En `global.scss` esa
  clase anula `--ion-safe-area-top` en `ion-toolbar` y `.sidebar-header` (evita doble safe area / hueco), y lo
  **restaura** en `ion-toast` (para que los toasts no se peguen a la status bar).

> Detalle completo del rediseño en `PLAN-OFFLINE-POS-2026-06-08.md` §13.3.

## Notas técnicas

- No tiene servicios propios — solo orquesta UI.
- El sidebar es un componente compartido en `shared/components/sidebar/`.
- Aplica el guard `authGuard` desde `app.routes.ts` (no en este feature).
- Safe area de Android se compensa en `main-layout.page.scss`.
