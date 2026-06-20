/**
 * Constantes de rutas de la aplicacion.
 * Uso: ROUTES.inventario.root, ROUTES.inventario.editar(id)
 * Si una ruta raiz cambia, solo editar este archivo.
 */
export const ROUTES = {
  home: '/caja',

  // Panel del superadmin con tabs internas (negocios / planes / configuración).
  // La gestión de suscripciones (registrar pago, suspender negocio) vive dentro
  // del menú de cada negocio en la tab Negocios — no hay tab separada.
  admin: {
    root:          '/admin',
    planes:        '/admin/planes',
    configuracion: '/admin/configuracion',
  },

  auth: {
    login:              '/auth/login',
    callback:           '/auth/callback',
    pending:            '/auth/pending',
    seleccionarNegocio: '/auth/seleccionar-negocio',
  },

  onboarding: {
    root:     '/onboarding',
    negocio:  '/onboarding/negocio',
    contexto: '/onboarding/contexto',
    caja:     '/onboarding/caja',
  },

  /**
   * Wizard reutilizable para crear un negocio desde dentro del dashboard.
   * Acepta query param `?context=admin` (superadmin desde /admin) o `?context=sucursal` (admin/superadmin dentro de un negocio).
   * Reusa los mismos pasos del onboarding inicial pero con el contexto correcto para resolver
   * el email del admin/propietario y el destino post-creacion.
   */
  crearNegocio: {
    root:     '/crear-negocio',
    negocio:  '/crear-negocio/negocio',
    contexto: '/crear-negocio/contexto',
    caja:     '/crear-negocio/caja',
  },

  pos: '/pos',

  /** Pantalla de suscripción: bloqueo "Suscríbete" (vencida) + vista informativa "Mi Plan". */
  suscripcion: '/suscripcion',

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
