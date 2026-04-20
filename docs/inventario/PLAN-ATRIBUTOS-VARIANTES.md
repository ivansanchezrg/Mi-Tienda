# Plan de Implementacion — Atributos de Variantes (v10)

> **Estado:** Pendiente de aprobacion
> **Fecha:** 2026-04-20
> **Reemplaza:** modelo `grupo_variante_opciones` (descartado) y plan anterior `PLAN-VARIANTES.md`
> **Complejidad:** Media-Alta (BD + frontend inventario, POS sin cambios de logica)

---

## Contexto y decision de arquitectura

### Por que el modelo actual es insuficiente

El schema v9 tiene:

```
grupos_variantes (id, nombre)
    └── productos.grupo_variante_id FK
```

El grupo TAPIOCA agrupa productos, pero no hay forma de saber que "Tapioca Fresa" es de sabor Fresa.
La etiqueta esta embebida en el nombre del producto — no estructurada, no filtrable, no reutilizable.

### Por que NO usamos `grupo_variante_opciones`

Una tabla `grupo_variante_opciones (id, grupo_id, nombre)` seria un paso intermedio:
- Solo soporta un tipo de atributo por grupo (el sabor o el color, no ambos)
- Luego necesitarias migrarlo al modelo de atributos igual
- Mas trabajo total

### El modelo correcto: Atributos dinamicos

```
atributos (id, nombre)              -- SABOR, COLOR, TAMAÑO
    └── atributo_opciones (id, atributo_id, valor)  -- Fresa, Rojo, XL
            └── producto_atributos (producto_id, atributo_opcion_id)  -- relacion
```

**Ventajas reales:**
- Un producto puede tener multiples atributos (SABOR=Fresa, TAMAÑO=500g)
- Las opciones son reutilizables entre productos del mismo grupo
- Filtros por atributo en inventario y POS en el futuro
- Escalable sin ALTER TABLE

### Frontera clara: Atributos vs Presentaciones

| | Atributos | Presentaciones |
|---|---|---|
| Ejemplo | Sabor=Fresa, Color=Rojo | Unidad, Pack x6, Caja x12 |
| Que describen | Lo que ES el producto | Como se VENDE/EMPACA |
| Afecta stock | No (stock independiente por producto) | Si (factor_conversion) |
| Afecta precio | No directamente | Si (precio propio por presentacion) |
| Afecta barcode | No (el producto tiene el suyo) | Si (codigo propio por presentacion) |
| Tabla | `producto_atributos` (nueva) | `producto_presentaciones` (sin cambios) |

**`producto_presentaciones` NO cambia.** Una variante "Tapioca Fresa" puede seguir teniendo sus presentaciones (Unidad, Pack x6).

---

## Modelo de datos final (v10)

```
grupos_variantes:               -- sin cambios de estructura
  id: uuid-A | nombre: "TAPIOCA"

atributos:
  id: uuid-S | nombre: "SABOR"
  id: uuid-T | nombre: "TAMAÑO"

atributo_opciones:
  id: uuid-F | atributo_id: uuid-S | valor: "FRESA"
  id: uuid-C | atributo_id: uuid-S | valor: "CHOCOLATE"
  id: uuid-5 | atributo_id: uuid-T | valor: "500G"

productos:
  id: uuid-001 | nombre: "Tapioca Fresa 500g" | grupo_variante_id: uuid-A
  id: uuid-002 | nombre: "Tapioca Chocolate"   | grupo_variante_id: uuid-A

producto_atributos:
  producto_id: uuid-001 | atributo_opcion_id: uuid-F  (SABOR=FRESA)
  producto_id: uuid-001 | atributo_opcion_id: uuid-5  (TAMAÑO=500G)
  producto_id: uuid-002 | atributo_opcion_id: uuid-C  (SABOR=CHOCOLATE)
```

**El nombre del producto lo sigue poniendo el usuario** — los atributos son metadata adicional, no reemplazan el nombre.

---

## Cambios requeridos

### 1. Base de datos — `docs/schema.sql`

#### 1a. Nueva tabla `atributos`

```sql
-- Tipos de atributo: SABOR, COLOR, TAMAÑO, MARCA, etc.
-- Siempre en MAYUSCULAS (constraint)
CREATE TABLE IF NOT EXISTS atributos (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT atributos_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre)))
);
```

#### 1b. Nueva tabla `atributo_opciones`

```sql
-- Valores de cada atributo: FRESA, ROJO, XL, 500G, etc.
-- Valor siempre en MAYUSCULAS. Unico por atributo.
CREATE TABLE IF NOT EXISTS atributo_opciones (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    atributo_id  UUID NOT NULL REFERENCES atributos(id) ON DELETE CASCADE,
    valor        VARCHAR(100) NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT atributo_opciones_valor_normalizado CHECK (valor = UPPER(TRIM(valor))),
    CONSTRAINT atributo_opciones_unique UNIQUE (atributo_id, valor)
);
```

#### 1c. Nueva tabla `producto_atributos`

```sql
-- Relacion producto <-> opcion de atributo
-- Un producto puede tener multiples atributos
-- Un atributo no se repite por producto (ej: no puede tener SABOR=Fresa y SABOR=Chocolate al mismo tiempo)
CREATE TABLE IF NOT EXISTS producto_atributos (
    producto_id         UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    atributo_opcion_id  UUID NOT NULL REFERENCES atributo_opciones(id) ON DELETE CASCADE,
    PRIMARY KEY (producto_id, atributo_opcion_id)
);
```

#### 1d. Indice para lookup por producto

```sql
CREATE INDEX IF NOT EXISTS idx_producto_atributos_producto
    ON producto_atributos(producto_id);

CREATE INDEX IF NOT EXISTS idx_atributo_opciones_atributo
    ON atributo_opciones(atributo_id);
```

#### 1e. DROP al inicio del schema (en orden correcto)

```sql
-- Agregar antes de DROP grupos_variantes:
DROP TABLE IF EXISTS producto_atributos CASCADE;
DROP TABLE IF EXISTS atributo_opciones CASCADE;
DROP TABLE IF EXISTS atributos CASCADE;
```

#### 1f. `grupos_variantes` — sin cambios de estructura

La tabla existe y funciona. Solo se le suma el contexto de atributos.

---

### 2. Modelo TypeScript — `producto.model.ts`

#### 2a. Nuevos interfaces

```typescript
export interface Atributo {
    id: string;
    nombre: string;              // "SABOR", "COLOR", "TAMAÑO"
    created_at?: string;
}

export interface AtributoOpcion {
    id: string;
    atributo_id: string;
    valor: string;               // "FRESA", "ROJO", "XL"
    atributo?: Atributo;         // JOIN opcional
    created_at?: string;
}

export interface ProductoAtributo {
    producto_id: string;
    atributo_opcion_id: string;
    atributo_opcion?: AtributoOpcion;  // JOIN opcional
}
```

#### 2b. Agregar a `Producto`

```typescript
// En interface Producto, dentro de seccion Variantes:
grupo_variante_id?: string;
grupo_variante?: GrupoVariante;
atributos?: ProductoAtributo[];  // cargados on-demand
```

---

### 3. Servicio — `inventario.service.ts`

#### 3a. Nuevos metodos para atributos

```typescript
// ==========================================
// ATRIBUTOS DE VARIANTES
// ==========================================

/** Busca atributos por nombre (para autocompletado al escribir "SABOR", "COLOR", etc.) */
async buscarAtributos(texto: string): Promise<Atributo[]> {
    const data = await this.supabase.call<Atributo[]>(
        this.supabase.client
            .from('atributos')
            .select('*')
            .ilike('nombre', `%${texto}%`)
            .order('nombre')
            .limit(5)
    );
    return data || [];
}

/** Crea el atributo si no existe, o devuelve el existente. Patron upsert silencioso. */
async crearOObtenerAtributo(nombre: string): Promise<Atributo | null> {
    const nombreNorm = nombre.toUpperCase().trim();
    await this.supabase.client
        .from('atributos')
        .upsert({ nombre: nombreNorm }, { onConflict: 'nombre', ignoreDuplicates: true });
    const data = await this.supabase.call<Atributo>(
        this.supabase.client.from('atributos').select('*').eq('nombre', nombreNorm).single()
    );
    return data;
}

/** Busca opciones de un atributo especifico (para autocompletado de valores) */
async buscarOpcionesAtributo(atributoId: string, texto?: string): Promise<AtributoOpcion[]> {
    let query = this.supabase.client
        .from('atributo_opciones')
        .select('*, atributo:atributos(*)')
        .eq('atributo_id', atributoId)
        .order('valor')
        .limit(10);
    if (texto) query = query.ilike('valor', `%${texto}%`);
    const data = await this.supabase.call<AtributoOpcion[]>(query);
    return data || [];
}

/** Crea la opcion si no existe, o devuelve la existente. */
async crearOObtenerOpcionAtributo(atributoId: string, valor: string): Promise<AtributoOpcion | null> {
    const valorNorm = valor.toUpperCase().trim();
    await this.supabase.client
        .from('atributo_opciones')
        .upsert({ atributo_id: atributoId, valor: valorNorm }, { onConflict: 'atributo_id,valor', ignoreDuplicates: true });
    const data = await this.supabase.call<AtributoOpcion>(
        this.supabase.client
            .from('atributo_opciones')
            .select('*, atributo:atributos(*)')
            .eq('atributo_id', atributoId)
            .eq('valor', valorNorm)
            .single()
    );
    return data;
}

/** Obtiene todos los atributos de un producto (para mostrar en el form y en la tarjeta) */
async obtenerAtributosProducto(productoId: string): Promise<ProductoAtributo[]> {
    const data = await this.supabase.call<ProductoAtributo[]>(
        this.supabase.client
            .from('producto_atributos')
            .select('*, atributo_opcion:atributo_opciones(*, atributo:atributos(*))')
            .eq('producto_id', productoId)
    );
    return data || [];
}

/** Reemplaza TODOS los atributos de un producto (delete + insert — atomico via funcion si se necesita) */
async guardarAtributosProducto(productoId: string, opcionIds: string[]): Promise<void> {
    // Borrar los existentes
    await this.supabase.client
        .from('producto_atributos')
        .delete()
        .eq('producto_id', productoId);
    // Insertar los nuevos (si hay)
    if (opcionIds.length === 0) return;
    const rows = opcionIds.map(id => ({ producto_id: productoId, atributo_opcion_id: id }));
    await this.supabase.call(
        this.supabase.client.from('producto_atributos').insert(rows)
    );
}
```

---

### 4. Formulario de producto — UI de atributos

#### 4a. Estado del componente (`producto-form.page.ts`)

```typescript
// Atributos seleccionados para este producto
atributosSeleccionados: { atributo: Atributo; opcion: AtributoOpcion }[] = [];
atributosSugeridos: Atributo[] = [];
opcionesSugeridas: AtributoOpcion[] = [];
textoAtributo = '';
textoOpcion = '';
atributoEnCurso: Atributo | null = null;  // atributo en edicion (paso 1 de 2)
```

#### 4b. Flujo UX — 2 pasos

El usuario define un atributo en 2 pasos dentro de la misma seccion:

**Paso 1:** Escribe el tipo → "SABOR" (busca en BD, o crea nuevo)
**Paso 2:** Escribe el valor → "FRESA" (busca opciones del atributo, o crea nueva)

Al confirmar el paso 2, se agrega la combinacion `SABOR=FRESA` a la lista local.
Al guardar el producto, se persisten todos los atributos en `producto_atributos`.

#### 4c. UI (seccion dentro de la card de Tipo de Venta, SOLO para tipo UNIDAD)

La seccion de atributos se muestra debajo de la seccion de grupo de variantes, o integrada en ella.

Comportamiento:
- Si el producto tiene grupo: mostrar seccion de atributos
- Si no tiene grupo: no mostrar (los atributos solo tienen sentido en el contexto de un grupo)

```html
<!-- Dentro del bloque @if (grupoVarianteSeleccionado) -->
<div class="atributos-section">
    <p class="field-label">Atributos de esta variante</p>

    <!-- Lista de atributos ya agregados -->
    @for (item of atributosSeleccionados; track item.opcion.id) {
    <div class="atributo-chip">
        <span class="atributo-tipo">{{ item.atributo.nombre }}</span>
        <span class="atributo-sep">=</span>
        <span class="atributo-valor">{{ item.opcion.valor }}</span>
        <button type="button" (click)="quitarAtributo(item.opcion.id)">
            <ion-icon name="close-outline"></ion-icon>
        </button>
    </div>
    }

    <!-- Agregar nuevo atributo -->
    @if (!atributoEnCurso) {
    <button type="button" class="pres-add-btn" (click)="iniciarAtributo()">
        <ion-icon name="add-outline"></ion-icon> Agregar atributo
    </button>
    } @else {
    <!-- Paso 1: tipo de atributo -->
    <!-- Paso 2: valor del atributo -->
    <!-- (inputs con autocompletado, botones Confirmar/Cancelar) -->
    }
</div>
```

#### 4d. Guardar — en `guardar()` modo CREAR

```typescript
// Despues de crear el producto:
if (this.atributosSeleccionados.length > 0) {
    await this.inventarioService.guardarAtributosProducto(
        productoCreado.id,
        this.atributosSeleccionados.map(a => a.opcion.id)
    );
}
```

#### 4e. Cargar en modo EDITAR

```typescript
// En ngOnInit, junto con las presentaciones:
if (producto) {
    this.atributosSeleccionados = (await this.inventarioService.obtenerAtributosProducto(producto.id))
        .map(pa => ({
            atributo: pa.atributo_opcion!.atributo!,
            opcion: pa.atributo_opcion!
        }));
}
```

---

### 5. Grid de inventario — `inventario.page.html`

Badge de atributos en la tarjeta de producto (solo si tiene grupo):

```html
@if (prod.grupo_variante) {
<span class="variante-badge">
    <ion-icon name="color-palette-outline"></ion-icon>
    {{ prod.grupo_variante.nombre }}
</span>
}
```

Los atributos individuales no se cargan en el listado (evitar N+1 queries).
Se ven al abrir el detalle del producto.

---

### 6. POS — sin cambios

El POS opera por `producto_id`. Los atributos son metadata visual — no afectan precio, stock ni logica de venta.

**Unica mejora futura (fase 2):** si en el POS el usuario busca "TAPIOCA", mostrar un selector de variantes con sus atributos antes de agregar al carrito. Esta mejora es independiente y no bloquea la fase 1.

---

### 7. Funciones SQL — sin cambios

Ninguna funcion existente necesita modificacion.

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `docs/schema.sql` | 3 tablas nuevas (`atributos`, `atributo_opciones`, `producto_atributos`) + 3 DROPs + 2 indices |
| `src/.../models/producto.model.ts` | 3 interfaces nuevos (`Atributo`, `AtributoOpcion`, `ProductoAtributo`) + campo en `Producto` |
| `src/.../services/inventario.service.ts` | 6 metodos nuevos para CRUD de atributos |
| `src/.../producto-form/producto-form.page.ts` | Estado + logica del flujo de 2 pasos |
| `src/.../producto-form/producto-form.page.html` | Seccion UI de atributos (dentro del bloque de grupo) |
| `src/.../producto-form/producto-form.page.scss` | Estilos chips de atributos |

**Total: 6 archivos, 3 tablas nuevas, 0 funciones SQL modificadas.**

`grupos_variantes`, `productos`, `producto_presentaciones`, POS y funciones SQL: **sin cambios**.

---

## Orden de implementacion

1. **BD:** Agregar 3 tablas nuevas a `schema.sql` + DROPs + indices
2. **Modelo:** 3 interfaces nuevos + campo `atributos?` en `Producto`
3. **Servicio:** 6 metodos de atributos
4. **Formulario:** Seccion UI (estado + logica + template + estilos)
5. **Grid:** Badge de grupo en tarjeta (ya existe, sin cambios adicionales)

---

## Fuera de alcance (fase 2)

- Filtro por atributo en el grid de inventario
- Selector de variantes en POS al buscar por grupo
- Gestion dedicada de atributos (admin separado)
- Reporte de ventas por atributo

---

## Notas

- `grupos_variantes` se mantiene como entidad de agrupacion. Los atributos son metadata adicional.
- El nombre del producto lo define el usuario libremente — los atributos no lo generan automaticamente.
- Si un producto no tiene grupo, no tiene atributos (no tiene sentido semantico).
- Los atributos se guardan en bloque al guardar el producto (no one-by-one).
