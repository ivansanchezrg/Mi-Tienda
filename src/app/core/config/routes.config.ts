/**
 * Constantes de rutas de la aplicacion.
 * Uso: ROUTES.inventario.root, ROUTES.inventario.editar(id)
 * Si una ruta raiz cambia, solo editar este archivo.
 */
export const ROUTES = {
  home: '/home',

  admin: '/admin',

  auth: {
    login:              '/auth/login',
    callback:           '/auth/callback',
    pending:            '/auth/pending',
    seleccionarNegocio: '/auth/seleccionar-negocio',
    crearNegocio:       '/auth/crear-negocio',
  },

  pos: '/pos',

  inventario: {
    root:          '/inventario',
    nuevo:         '/inventario/nuevo',
    nuevoSimple:   '/inventario/nuevo-simple',
    nuevoVariantes:'/inventario/nuevo-variantes',
    editar:  (id: string) => `/inventario/editar/${id}`,
    kardex:  (id: string) => `/inventario/kardex/${id}`,
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

  cuentasCobrar: {
    root:    '/cuentas-cobrar',
    detalle: (clienteId: string) => `/cuentas-cobrar/${clienteId}`,
  },

  clientes: '/clientes',

  notas: '/notas',

  historialRecargas: '/historial-recargas',

  recargasVirtuales: '/home/recargas-virtuales',

  cuentasCorrientes: '/cuentas-corrientes',

  movimientosEmpleados: {
    root:    '/movimientos-empleados',
    detalle: (empleadoId: string) => `/movimientos-empleados/${empleadoId}`,
  },

  usuarios: '/usuarios',

  dashboard: {
    operacionesCaja: '/home/operaciones-caja',
    cierreDiario:    '/home/cierre-diario',
  },
} as const;
