# Clientes — Documentación de Feature

Módulo para gestionar los clientes de la tienda. Permite listar, buscar, crear y editar clientes.
El modal de selección de cliente (usado desde el POS) también vive aquí.

---

## Estructura de archivos

```
src/app/features/clientes/
├── clientes.routes.ts                        # Ruta: '' → listado
├── models/
│   └── cliente.model.ts                      # Interface Cliente
├── services/
│   └── clientes.service.ts                   # CRUD completo + búsqueda + listado paginado
├── components/
│   ├── seleccionar-cliente-modal/            # Modal de selección (usado desde POS)
│   └── editar-cliente-modal/                 # Modal de edición
└── pages/
    └── listado/                              # Lista paginada con búsqueda
        ├── clientes-listado.page.ts
        ├── clientes-listado.page.html
        └── clientes-listado.page.scss
```

---

## Modelo (`cliente.model.ts`)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | `string` | UUID |
| `identificacion` | `string \| null` | Cédula o RUC (única, usada para deduplicación) |
| `nombre` | `string` | Nombre completo |
| `telefono` | `string \| null` | Teléfono de contacto |
| `email` | `string \| null` | Correo electrónico |
| `es_consumidor_final` | `boolean` | `true` para el registro especial "Consumidor Final" |
| `created_at` | `string?` | Fecha de creación |

---

## Servicio (`clientes.service.ts`)

| Método | Descripción |
|--------|-------------|
| `listarClientes(page, busqueda?)` | Lista paginada. Excluye "Consumidor Final". Busca en nombre, identificación y teléfono |
| `buscarClientes(texto)` | Búsqueda rápida (límite 20). Usada por el modal de selección |
| `buscarPorIdentificacion(identificacion)` | Busca cliente exacto por cédula/RUC. Usada para deduplicación |
| `obtenerClientePorId(id)` | Obtiene un cliente por UUID |
| `obtenerConsumidorFinal()` | Retorna el registro especial "Consumidor Final" |
| `crearCliente(data)` | Crea un nuevo cliente. Toast de éxito automático |
| `actualizarCliente(id, data)` | Actualiza nombre, teléfono y/o email. Toast de éxito automático |

---

## Página listado (`pages/listado/`)

- Clase: `ClientesListadoPage` — extiende `PaginatedListPage<Cliente>`
- Búsqueda con debounce 500ms en header
- Cada item muestra: nombre, cédula/RUC, teléfono
- Tap en un cliente → abre modal de edición
- Botón "Nuevo" en header → abre el modal de selección/creación (reutiliza `SeleccionarClienteModalComponent`)

---

## Modal de edición (`editar-cliente-modal/`)

- Muestra la cédula/RUC como campo de solo lectura (no se cambia)
- Permite editar: nombre, teléfono, email
- Botón "Guardar" solo se habilita si hay cambios
- Retorna `{ cliente: Cliente }` al cerrar con éxito

---

## Modal de selección (`seleccionar-cliente-modal/`)

Componente reutilizable — se usa desde `PosPage` para seleccionar/crear cliente en una venta.

### Flujo de creación "cédula primero"

1. Usuario toca "Agregar nuevo cliente"
2. Ingresa cédula → se valida algorítmicamente (`validarCedulaEcuatoriana()`)
3. Si es válida → busca en BD por `identificacion`
4. **Si existe**: muestra card del cliente existente para seleccionarlo (evita duplicados)
5. **Si no existe**: habilita campos extras (nombre, teléfono, email) para crear

### Consumidores que usan este modal

| Módulo | Componente | Propósito |
|--------|-----------|-----------|
| POS | `PosPage` | Seleccionar cliente para la venta |
| Clientes | `ClientesListadoPage` | Crear nuevo cliente desde el listado |

---

## Tabla de BD

| Tabla | Rol |
|-------|-----|
| `clientes` | Registro de clientes con identificación única |

### Restricciones

- `identificacion` es UNIQUE (excepto NULL) — base de la deduplicación
- El registro con `es_consumidor_final = true` es especial y no aparece en el listado

---

## Quién consume este módulo

| Consumidor | Qué usa | Para qué |
|-----------|---------|----------|
| POS | `SeleccionarClienteModalComponent`, `ClientesService` | Asignar cliente a venta |
| Cuentas por Cobrar | `ClientesService.obtenerClientePorId()` | Mostrar datos del cliente en detalle de cuenta |
