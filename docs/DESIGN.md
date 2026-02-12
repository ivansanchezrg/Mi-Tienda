# 🎨 Guía de Diseño UI/UX - Flat Design Moderno v2.0

## Índice

1. [Principios del Patrón](#principios-del-patrón)
2. [Design Tokens](#design-tokens)
3. [Ejemplos de Código](#ejemplos-de-código)
4. [Componentes Ionic](#componentes-ionic)
5. [Checklist de Desarrollo](#checklist-de-desarrollo)
6. [Recursos](#recursos)

---

## Principios del Patrón

Este sistema de diseño implementa **Flat Design moderno** con los siguientes principios:

### 1. Superficies Planas con Profundidad Sutil
Utilizamos sombras suaves para crear jerarquía visual sin elementos tridimensionales excesivos. Los cards "flotan" sobre el fondo gris usando sombras sutiles (`--shadow-level-1` a `--shadow-level-4`).

### 2. Espaciado Consistente y Respirable
Escala de spacing basada en múltiplos de 4px para mantener armonía visual. Cada nivel de spacing tiene un propósito específico, desde gaps pequeños (4px) hasta secciones grandes (40px).

### 3. Bordes Redondeados Suaves
Radios progresivos (8px → 32px) que crean una experiencia amigable y moderna. Los elementos pequeños usan radios pequeños, los grandes usan radios amplios.

### 4. Compatibilidad Dark/Light Mode
Todo el sistema se adapta automáticamente usando variables CSS de Ionic. Los colores usan `--ion-color-*` y los fondos se adaptan entre `#f4f5f8` (light) y `#121212` (dark).

---

## Design Tokens

### 📏 Espaciado (Spacing)

Escala basada en múltiplos de 4px:

| Token | Valor | Uso Recomendado | Ejemplos |
|-------|-------|----------------|----------|
| `--spacing-xs` | 4px | Gaps pequeños entre elementos hermanos | Margen entre dot y texto en badge |
| `--spacing-sm` | 8px | Espaciado íconos-texto, gaps medianos | Gap entre ícono y label |
| `--spacing-md` | 12px | Márgenes entre items, padding botones | Margen entre cards en lista |
| `--spacing-lg` | 16px | Padding de items, márgenes de secciones | Padding horizontal de list item |
| `--spacing-xl` | 20px | Padding de cards, márgenes de páginas | Padding de secciones hero |
| `--spacing-2xl` | 24px | Padding de secciones grandes | Padding de section titles |
| `--spacing-3xl` | 32px | Hero sections, modales | Padding vertical de cards grandes |
| `--spacing-4xl` | 40px | Espaciado especial muy grande | Padding de páginas de bienvenida |

**Ejemplo de uso:**
```scss
.card {
  padding: var(--spacing-xl);
  margin-bottom: var(--spacing-md);
  gap: var(--spacing-sm);
}
```

---

### 🌑 Sombras (Elevation)

Escala de elevación para crear profundidad:

| Token | Valor | Uso Recomendado | Ejemplos |
|-------|-------|----------------|----------|
| `--shadow-none` | none | Elementos planos sin elevación | Flat items en modo lista |
| `--shadow-level-1` | 0 2px 8px rgba(0,0,0,0.04) | Elevación mínima | Chips, badges, pills |
| `--shadow-level-2` | 0 4px 16px rgba(0,0,0,0.06) | Elevación suave | Cards principales, items |
| `--shadow-level-3` | 0 8px 24px rgba(0,0,0,0.08) | Elevación media | Modales, popovers |
| `--shadow-level-4` | 0 12px 32px rgba(0,0,0,0.12) | Elevación alta | Dialogs, overlays importantes |

**Nota:** Las sombras se adaptan automáticamente en dark mode (más sutiles y oscuras).

**Ejemplo de uso:**
```scss
.summary-card {
  box-shadow: var(--shadow-level-2);
}

.modal {
  box-shadow: var(--shadow-level-4);
}
```

---

### 🔲 Border Radius

Escala progresiva de bordes redondeados:

| Token | Valor | Uso Recomendado | Ejemplos |
|-------|-------|----------------|----------|
| `--radius-xs` | 8px | Inputs, badges pequeños | Input fields, small badges |
| `--radius-sm` | 12px | Botones, icon wrappers | Botones medianos, icon containers |
| `--radius-md` | 16px | Cards pequeños, list items | Items de lista, cards pequeños |
| `--radius-lg` | 24px | Cards grandes, modales | Hero cards, modales principales |
| `--radius-xl` | 32px | Elementos especiales | Elementos destacados muy grandes |
| `--radius-pill` | 100px | Pills, chips, tags | Status chips, filter pills |
| `--radius-full` | 50% | Elementos circulares | Avatares, dots, badges circulares |

**Ejemplo de uso:**
```scss
.flat-item {
  border-radius: var(--radius-md);
}

.icon-wrapper {
  border-radius: var(--radius-sm);
}

.status-chip {
  border-radius: var(--radius-pill);
}

.avatar {
  border-radius: var(--radius-full);
}
```

---

### ✍️ Font Weights

Escala de pesos tipográficos:

| Token | Valor | Uso Recomendado | Ejemplos |
|-------|-------|----------------|----------|
| `--font-weight-regular` | 400 | Texto normal, párrafos | Descripciones, textos secundarios |
| `--font-weight-medium` | 500 | Subtítulos, labels | Labels de formulario, subtítulos |
| `--font-weight-semibold` | 600 | Títulos de sección | Section titles, card headers |
| `--font-weight-bold` | 700 | Títulos principales, montos | Títulos, amounts, valores importantes |
| `--font-weight-extrabold` | 800 | Hero titles, números destacados | Balance principal, hero numbers |

**Ejemplo de uso:**
```scss
h2 {
  font-weight: var(--font-weight-bold);
}

.balance-amount {
  font-weight: var(--font-weight-extrabold);
}

.subtitle {
  font-weight: var(--font-weight-medium);
}
```

---

### ⚡ Transitions

Tiempos de transición estándar:

| Token | Valor | Uso Recomendado | Ejemplos |
|-------|-------|----------------|----------|
| `--transition-fast` | 0.15s ease | Hover states, botones | Button hover, quick interactions |
| `--transition-normal` | 0.2s ease | Transiciones generales | General animations, slides |
| `--transition-slow` | 0.3s ease | Animaciones complejas | Modal entrance, complex animations |

**Ejemplo de uso:**
```scss
.button {
  transition: all var(--transition-fast);

  &:hover {
    transform: scale(1.02);
  }
}

.card {
  transition: transform var(--transition-normal);

  &:active {
    transform: scale(0.98);
  }
}
```

---

### 🎭 Opacities

Niveles de opacidad estándar:

| Token | Valor | Uso Recomendado | Ejemplos |
|-------|-------|----------------|----------|
| `--opacity-disabled` | 0.3 | Estados deshabilitados | Botones disabled, elementos inactivos |
| `--opacity-muted` | 0.6 | Elementos secundarios | Textos secundarios con background |
| `--opacity-subtle` | 0.08 | Backgrounds ligeros | Background de icon wrappers |
| `--opacity-medium` | 0.12 | Overlays moderados | Hover states, backgrounds suaves |
| `--opacity-strong` | 0.16 | Overlays prominentes | Active states, backgrounds destacados |

**Ejemplo de uso:**
```scss
.icon-wrapper {
  background: rgba(var(--ion-color-primary-rgb), var(--opacity-subtle));
}

.button:disabled {
  opacity: var(--opacity-disabled);
}

.overlay {
  background: rgba(0, 0, 0, var(--opacity-muted));
}
```

---

### 🎨 Step Colors (Escala de Grises)

**IMPORTANTE:** Las variables `--ion-color-step-*` **NO se generan automáticamente** en Ionic 8. Este proyecto las define manualmente en `variables.scss`.

#### Variables Disponibles

Escala de grises desde casi blanco hasta casi negro (invierte en dark mode):

| Token | Light Mode | Dark Mode | Uso Recomendado |
|-------|-----------|-----------|----------------|
| `--ion-color-step-50` | `#f2f2f2` (casi blanco) | `#0d0d0d` (casi negro) | Backgrounds muy sutiles, hover ligero |
| `--ion-color-step-100` | `#e6e6e6` | `#1a1a1a` | Borders suaves, dividers ligeros |
| `--ion-color-step-150` | `#d9d9d9` | `#262626` | Dividers, borders, separadores |
| `--ion-color-step-300` | `#b3b3b3` | `#4d4d4d` | Borders con más contraste |
| `--ion-color-step-400` | `#999999` | `#666666` | Textos secundarios apagados |
| `--ion-color-step-600` | `#666666` | `#999999` | Textos secundarios con contraste medio |
| `--ion-color-step-900` | `#1a1a1a` (muy oscuro) | `#e6e6e6` (muy claro) | Backgrounds invertidos (pills activos) |
| `--ion-color-step-950` | `#0d0d0d` (casi negro) | `#f2f2f2` (casi blanco) | Backgrounds con máximo contraste |

#### Características

✅ **Se invierten automáticamente** entre light/dark mode
✅ **Ya definidos en este proyecto** (`src/theme/variables.scss`)
✅ **Uso principal**: dividers, borders, backgrounds sutiles, estados hover

#### Ejemplos de Uso

```scss
// Dividers
.divider {
  height: 1px;
  background: var(--ion-color-step-150);
  margin: var(--spacing-lg) 0;
}

// Hover sutil
.button:hover {
  background: var(--ion-color-step-50);
}

// Border con contraste
.card {
  border: 1px solid var(--ion-color-step-100);
}

// Pill invertido activo (light: oscuro, dark: claro)
.filter-tab.active {
  background: var(--ion-color-step-900);
  color: var(--ion-color-step-50);
}
```

#### ⚠️ Nota Técnica

A diferencia de versiones anteriores, Ionic 8 con `dark.system.css` **no genera** los step colors automáticamente. Si necesitas valores adicionales (step-200, step-500, etc.), debes agregarlos manualmente en `variables.scss` siguiendo la misma escala.

---

## Ejemplos de Código

### ✅ DO - Usar Design Tokens

```scss
// ✅ CORRECTO: Usa variables del sistema
.my-card {
  padding: var(--spacing-xl);
  margin-bottom: var(--spacing-md);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-level-2);
  background: var(--ion-item-background);
  transition: all var(--transition-normal);
}

.my-button {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-sm);
  font-weight: var(--font-weight-semibold);

  &:hover {
    background: rgba(var(--ion-color-primary-rgb), var(--opacity-medium));
  }
}

.icon-container {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  background: rgba(var(--ion-color-primary-rgb), var(--opacity-subtle));
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### ❌ DON'T - Valores Hardcodeados

```scss
// ❌ INCORRECTO: Valores hardcodeados
.my-card {
  padding: 20px;
  margin-bottom: 12px;
  border-radius: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  background: #ffffff;
  transition: all 0.2s ease;
}

.my-button {
  padding: 8px 16px;
  border-radius: 12px;
  font-weight: 600;

  &:hover {
    background: rgba(59, 130, 246, 0.12);
  }
}

.icon-container {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(59, 130, 246, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### ✅ DO - Usar Variables Ionic para Colores

```scss
// ✅ CORRECTO: Usa variables Ionic nativas (adapta a dark mode)
.status-badge {
  background: rgba(var(--ion-color-success-rgb), var(--opacity-medium));
  color: var(--ion-color-success);
  border: 1px solid rgba(var(--ion-color-success-rgb), 0.2);
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--radius-pill);
}

.text-primary {
  color: var(--ion-text-color);
  font-weight: var(--font-weight-semibold);
}

.text-secondary {
  color: var(--ion-color-medium);
  font-weight: var(--font-weight-regular);
}

.divider {
  height: 1px;
  background: var(--ion-color-step-150);
  margin: var(--spacing-lg) 0;
}
```

### ❌ DON'T - Colores Hardcodeados

```scss
// ❌ INCORRECTO: Colores hardcodeados no adaptan a dark mode
.status-badge {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 4px 12px;
  border-radius: 100px;
}

.text-primary {
  color: #1f2937;
  font-weight: 600;
}

.text-secondary {
  color: #6b7280;
  font-weight: 400;
}

.divider {
  height: 1px;
  background: #e5e7eb;
  margin: 16px 0;
}
```

---

## Componentes Ionic

### ✅ Componentes Recomendados

Estos componentes se alinean bien con nuestro sistema de diseño:

| Componente | Por Qué | Cómo Personalizarlo |
|------------|---------|---------------------|
| `<ion-card>` | Se adapta bien al sistema | Aplicar `--border-radius: var(--radius-lg)` y agregar `box-shadow: var(--shadow-level-2)` |
| `<ion-button>` | Flexible y personalizable | Usar `--border-radius: var(--radius-sm)` para mantener consistencia |
| `<ion-list>` | Base perfecta para items | Envolver items en `.flat-item` con `border-radius: var(--radius-md)` |
| `<ion-chip>` | Perfecto para pills/badges | Ya sigue el patrón pill, personalizar colores con RGB variables |
| `<ion-modal>` | Overlay nativo adaptable | Personalizar con `--border-radius: var(--radius-lg)` en la parte superior |

**Ejemplo:**
```html
<ion-card class="custom-card">
  <ion-card-content>
    <!-- Contenido -->
  </ion-card-content>
</ion-card>
```

```scss
.custom-card {
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-level-2);
  padding: var(--spacing-xl);
  margin: var(--spacing-lg);
}
```

---

### ⚠️ Componentes que Requieren Personalización

Estos componentes funcionan pero necesitan ajustes:

| Componente | Problema | Solución |
|------------|----------|----------|
| `<ion-toolbar>` | Border por defecto visible | Agregar clase `.ion-no-border` al header |
| `<ion-item>` | Líneas divisorias muy marcadas | Personalizar `--border-color: transparent` o `--inner-border-width: 0` |
| `<ion-segment>` | Estilo de botones antiguo | Crear `.filter-tabs` custom con border-radius y hover states |
| `<ion-tab-bar>` | Estilo por defecto muy pesado | Personalizar con `--background: var(--ion-item-background)`, `border-top: 1px solid var(--ion-color-step-100)` y `box-shadow: var(--shadow-level-1)` |

**Ejemplo de personalización:**
```html
<ion-header class="ion-no-border">
  <ion-toolbar>
    <ion-title>Mi Título</ion-title>
  </ion-toolbar>
</ion-header>
```

```scss
ion-toolbar {
  --background: var(--ion-background-color);
  --border-width: 0;
  padding: 0 var(--spacing-sm);
}
```

---

### ❌ Componentes a Evitar

Estos componentes no se alinean con el patrón Flat:

| Componente | Por Qué | Alternativa |
|------------|---------|-------------|
| `<ion-fab>` sin personalizar | Sombra muy prominente y tridimensional por defecto | Ver patrón FAB Custom más abajo |
| `<ion-skeleton-text>` | Animación shimmer muy distractora | Usar spinner simple con `<ion-spinner>` centrado |
| `<ion-badge>` sin personalizar | Estilo antiguo con bordes duros | Crear `.flat-chip` custom con `border-radius: var(--radius-pill)` |

---

### 🔘 Patrón FAB Custom (usado en main-layout)

Cuando necesitas un FAB dentro del tab bar, usa el patrón customizado implementado en `main-layout.page.scss`. **No usar `<ion-fab>` nativo sin personalización.**

El patrón consiste en:

- **`.fab-overlay`**: fondo oscuro fijo con `--opacity-medium`
- **`.fab-options`**: pills posicionadas sobre el tab bar (`bottom: 80px`)
- **`.fab-option`**: card tipo pill con icono circular + label
- **`ion-fab-button`** con `--box-shadow: var(--shadow-level-1)` y rotación al abrirse

```scss
// Overlay de fondo
.fab-overlay {
  position: fixed;
  background: rgba(0, 0, 0, var(--opacity-medium));
  z-index: 999;
}

// Pill de opción
.fab-option {
  background: var(--ion-card-background, var(--ion-background-color));
  border-radius: var(--radius-pill);
  padding: var(--spacing-sm) var(--spacing-lg) var(--spacing-sm) var(--spacing-sm);
  gap: var(--spacing-md);
  box-shadow: var(--shadow-level-2);
  transition: all var(--transition-normal);
}

// Icono circular con color de marca
.fab-option-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);

  &.tertiary { background: var(--ion-color-tertiary); }
  &.warning  { background: var(--ion-color-warning); }
}
```

> **Nota**: `var(--ion-card-background)` es una variable Ionic válida para el fondo de tarjetas. Se usa con fallback: `var(--ion-card-background, var(--ion-background-color))`.

---

## Checklist de Desarrollo

### 🎯 Antes de Crear un Componente

Verifica los siguientes puntos:

#### Espaciado
- [ ] ¿Usa `var(--spacing-*)` en lugar de px hardcodeados?
- [ ] ¿Los paddings y margins siguen la escala de spacing?
- [ ] ¿Los gaps entre elementos usan la escala correcta?

#### Bordes y Sombras
- [ ] ¿Usa `var(--radius-*)` para border-radius?
- [ ] ¿El tamaño del radius corresponde al tamaño del elemento?
- [ ] ¿Usa `var(--shadow-level-*)` para sombras?
- [ ] ¿El nivel de sombra refleja la importancia del elemento?

#### Colores
- [ ] ¿Usa variables Ionic (`--ion-color-*`) para colores?
- [ ] ¿Usa `var(--ion-item-background)` para fondos de cards?
- [ ] ¿Usa `rgba(var(--ion-color-*-rgb), opacity)` para backgrounds con transparencia?
- [ ] ¿Los textos secundarios usan `var(--ion-color-medium)`?
- [ ] ¿Los dividers usan `var(--ion-color-step-*)`?

#### Adaptabilidad
- [ ] ¿Se adapta correctamente a dark mode sin estilos adicionales?
- [ ] ¿Sigue la jerarquía visual (fondo gris → cards blancos)?
- [ ] ¿Los contrastes de color son suficientes en ambos modos?

#### Tipografía
- [ ] ¿Usa `var(--font-weight-*)` para pesos de fuente?
- [ ] ¿Los tamaños de fuente siguen una escala lógica?
- [ ] ¿Los line-heights son apropiados para legibilidad?

#### Animaciones
- [ ] ¿Usa `var(--transition-*)` para animaciones?
- [ ] ¿Las transiciones son suaves y no distractoras?
- [ ] ¿Los tiempos de transición son apropiados para la acción?

#### Opacidad
- [ ] ¿Los valores de opacidad usan `var(--opacity-*)`?
- [ ] ¿Los estados disabled usan `--opacity-disabled`?
- [ ] ¿Los backgrounds con transparencia usan la opacidad correcta?

---

## Recursos

### 📁 Archivos del Sistema

| Archivo | Descripción |
|---------|-------------|
| `src/theme/variables.scss` | **Design Tokens principales** - Todas las variables del sistema |
| `src/global.scss` | Estilos globales e imports de Ionic |
| `src/theme/custom/index.scss` | Entry point de estilos custom compartidos (importa `overlays`, etc.) |
| `src/app/features/layout/pages/main/main-layout.page.scss` | **Patrón FAB Custom** + tab bar personalizado |
| `src/app/features/dashboard/pages/home/home.page.scss` | **Ejemplo de referencia** - Implementación completa del patrón |

### 📖 Documentación Ionic

- [Ionic Theming Guide](https://ionicframework.com/docs/theming/) - Guía oficial de theming
- [Ionic CSS Variables](https://ionicframework.com/docs/theming/css-variables) - Variables CSS disponibles
- [Ionic Dark Mode](https://ionicframework.com/docs/theming/dark-mode) - Implementación de modo oscuro
- [Ionic Color Generator](https://ionicframework.com/docs/theming/colors) - Generador de colores

### 🛠️ Herramientas

- [Color Contrast Checker](https://webaim.org/resources/contrastchecker/) - Verificar contraste de colores
- [Shadow Generator](https://shadows.brumm.af/) - Generar sombras CSS
- [CSS Variables Inspector](https://chrome.google.com/webstore/detail/css-variables-inspector/) - Inspeccionar variables en DevTools

---

## 🚀 Utility Classes

El sistema incluye clases de utilidad para prototipado rápido:

```html
<!-- Spacing -->
<div class="p-xl m-md">Card con padding XL y margin MD</div>

<!-- Border Radius -->
<div class="rounded-lg">Card con bordes redondeados grandes</div>
<div class="rounded-pill">Chip con bordes pill</div>
<div class="rounded-full">Avatar circular</div>

<!-- Shadows -->
<div class="shadow-2">Card con sombra nivel 2</div>
<div class="shadow-none">Elemento plano sin sombra</div>
```

**⚠️ Advertencia**: Usa estas clases con moderación durante prototipado. Para producción, prefiere componentes semánticos con estilos encapsulados.

---

## 📝 Notas de Implementación

### Variables Locales en Componentes (`:host`)

Puedes definir variables CSS locales en `:host` para encapsular valores específicos del componente. Úsalas para **alias semánticos** de tokens globales, no para hardcodear valores nuevos:

```scss
// ✅ CORRECTO: alias semántico de un token global
:host {
  --bg-soft: var(--ion-background-color, #f8f9fa);  // fallback para SSR/tests
  --shadow-soft: var(--shadow-level-1);
}

// ✅ Luego usar el alias local
ion-content {
  --background: var(--bg-soft);
}

// ❌ INCORRECTO: hardcodear valores nuevos en :host
:host {
  --shadow-soft: 0 10px 30px rgba(0, 0, 0, 0.04);  // ← valor nuevo fuera del sistema
}
```

> **Regla**: Las variables locales deben apuntar a tokens del sistema. Si necesitas un valor nuevo, agrégalo primero a `variables.scss`.

---

### Orden de Aplicación de Estilos

1. **Variables Ionic nativas** (no modificar)
2. **Design Tokens** (variables.scss)
3. **Estilos globales** (global.scss)
4. **Estilos de componente** (component.scss)

### Especificidad CSS

Mantén la especificidad baja para facilitar sobrescritura:

```scss
// ✅ BUENO: Especificidad baja
.card {
  padding: var(--spacing-xl);
}

// ❌ MALO: Especificidad innecesariamente alta
div.container > .card-wrapper .card {
  padding: var(--spacing-xl);
}
```

### Performance

- Usa `transform` y `opacity` para animaciones (hardware accelerated)
- Evita animar `width`, `height`, `margin`, `padding`
- Prefiere `transition` sobre `animation` para interacciones simples

---

**Última actualización:** 2026-02-11
**Versión:** 2.0
**Mantenido por:** Equipo Mi Tienda
