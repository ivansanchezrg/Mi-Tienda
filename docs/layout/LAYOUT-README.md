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
- **Banner offline** (`OfflineBannerComponent`) cuando el usuario pierde conexión.

## Notas técnicas

- No tiene servicios propios — solo orquesta UI.
- El sidebar es un componente compartido en `shared/components/sidebar/`.
- Aplica el guard `authGuard` desde `app.routes.ts` (no en este feature).
- Safe area de Android se compensa en `main-layout.page.scss`.
