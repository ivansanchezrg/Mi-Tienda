/**
 * Constantes de rutas de la aplicacion.
 * Uso: ROUTES.inventario.root, ROUTES.inventario.editar(id)
 * Si una ruta raiz cambia, solo editar este archivo.
 */
export const ROUTES = {
  home: '/caja',

  admin: '/admin',

  auth: {
    login:              '/auth/login',
    callback:           '/auth/callback',
    pending:            '/auth/pending',
    seleccionarNegocio: '/auth/seleccionar-negocio',
  },

  onboarding: {
    root:    '/onboarding',
    negocio: '/onboarding/negocio',
    caja:    '/onboarding/caja',
  },

  /**
   * Wizard reutilizable para crear un negocio desde dentro del dashboard.
   * Acepta query param `?context=admin` (superadmin desde /admin) o `?context=sucursal` (admin/superadmin dentro de un negocio).
   * Reusa los mismos pasos del onboarding inicial pero con el contexto correcto para resolver
   * el email del admin/propietario y el destino post-creacion.
   */
  crearNegocio: {
    root:    '/crear-negocio',
    negocio: '/crear-negocio/negocio',
    caja:    '/crear-negocio/caja',
  },

  pos: '/pos',

  inventario: {
    root:   '/inventario',
    nuevo:  '/inventario/nuevo',
    editar: (id: string) => `/inventario/editar/${id}`,
    kardex: (id: string) => `/inventario/kardex/${id}`,
  },

  ventas: {
    root:    '/ventas',
    resumen: '/ventas/resumen',
  },

  configuracion: {
    root:                  '/configuracion',
    parametros:            '/configuracion/parametros',
    categoriasOperaciones: '/configuracion/categorias-operaciones',
    categoriasProductos:   '/configuracion/categorias-productos',
  },

  clientes: {
    root:    '/clientes',
    detalle: (clienteId: string) => `/clientes/${clienteId}`,
  },

  notas: '/notas',

  historialRecargas: '/historial-recargas',

  recargasVirtuales: '/caja/recargas-virtuales',

  movimientosEmpleados: {
    root:    '/movimientos-empleados',
    detalle: (empleadoId: string) => `/movimientos-empleados/${empleadoId}`,
  },

  usuarios: '/usuarios',

  caja: {
    operacionesCaja: '/caja/operaciones-caja',
    cierreDiario:    '/caja/cierre-diario',
    historialTurnos: '/caja/historial-turnos',
  },
} as const;
