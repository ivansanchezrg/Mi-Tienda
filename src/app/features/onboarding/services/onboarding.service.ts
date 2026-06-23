import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { LoggerService } from '@core/services/logger.service';

/**
 * Error de creacion de negocio con un mensaje ya listo para mostrar al usuario
 * (ej: limite de sucursales del plan alcanzado). La pagina lo distingue de un
 * error tecnico para mostrar el texto tal cual en un toast.
 */
export class OnboardingNegocioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingNegocioError';
  }
}

/**
 * Modos del wizard de creacion de negocio.
 *
 * - `inicial`        — Onboarding del primer negocio del usuario (no tiene ningun negocio aun).
 *                      El admin del nuevo negocio = el usuario logueado. Tras crear, activa el JWT y va a /home.
 * - `sucursal-admin` — Admin comun creando una sucursal adicional. El admin del nuevo negocio = el usuario logueado.
 *                      El propietario hereda al usuario logueado (porque el admin comun ES el dueño en su modelo).
 *                      Tras crear, vuelve al sidebar; el usuario activa la sucursal manualmente desde el selector.
 * - `sucursal-superadmin` — Superadmin creando un negocio para otro dueño desde dentro del dashboard.
 *                      Pide email + nombre del admin manualmente. El propietario_email puede coincidir con el admin
 *                      o ser distinto (ej: superadmin crea una sucursal para un dueño que ya tiene otros negocios).
 *                      Tras crear, vuelve a /admin con un toast de confirmacion.
 */
export type OnboardingMode = 'inicial' | 'sucursal-admin' | 'sucursal-superadmin';

export interface OnboardingData {
  // Paso 1
  nombre:              string;
  telefono:            string;
  direccion:           string;
  correoElectronico:   string;
  // Paso 2
  variosActiva:     boolean;
  montoVarios:      number;
  nominaSueldoBase: number;

  // Solo cuando mode = 'sucursal-superadmin' (el superadmin crea para otro)
  adminEmail?:       string;
  adminNombre?:      string;
  // Email del propietario/dueño. Si no se especifica, hereda del adminEmail.
  propietarioEmail?: string;
}

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private supabase    = inject(SupabaseService);
  private authService = inject(AuthService);
  private logger      = inject(LoggerService);

  private _draft: Partial<OnboardingData> = {};
  private _mode: OnboardingMode = 'inicial';

  get draft(): Readonly<Partial<OnboardingData>> { return this._draft; }
  get mode(): OnboardingMode { return this._mode; }

  /** Inicializa el modo del wizard. Solo limpia el draft si el modo cambia. */
  setMode(mode: OnboardingMode): void {
    if (this._mode !== mode) {
      this._draft = {};
    }
    this._mode = mode;
  }

  guardarPaso1(data: Pick<OnboardingData, 'nombre' | 'telefono' | 'direccion' | 'correoElectronico' | 'adminEmail' | 'adminNombre' | 'propietarioEmail'>): void {
    this._draft = { ...this._draft, ...data };
  }

  guardarPaso2(data: Pick<OnboardingData, 'variosActiva' | 'montoVarios' | 'nominaSueldoBase'>): void {
    this._draft = { ...this._draft, ...data };
  }

  /**
   * Llama fn_completar_onboarding con todos los datos acumulados.
   * Atómico: si falla, no queda nada en BD.
   * Retorna el negocio_id creado, o null si falla.
   */
  async completar(): Promise<string | null> {
    try {
      const user = await this.authService.getUser();
      if (!user?.email) return null;

      const d = this._draft;

      // Resolver admin email/nombre segun modo
      let adminEmail: string;
      let adminNombre: string | null;
      let propietarioEmail: string | null;

      if (this._mode === 'sucursal-superadmin') {
        adminEmail  = (d.adminEmail ?? '').trim().toLowerCase();
        adminNombre = (d.adminNombre ?? '').trim() || null;
        // Si no se especifico propietario, el propietario es el mismo admin
        propietarioEmail = ((d.propietarioEmail ?? '').trim().toLowerCase()) || adminEmail;
      } else {
        // 'inicial' | 'sucursal-admin' — el admin es el usuario logueado
        adminEmail  = user.email;
        adminNombre = user.user_metadata?.['full_name'] ?? user.user_metadata?.['name'] ?? null;
        // El propietario tambien es el usuario logueado
        propietarioEmail = user.email;
      }

      const { data: result, error } = await this.supabase.client.rpc('fn_completar_onboarding', {
        p_nombre_negocio:     (d.nombre ?? '').trim(),
        p_admin_email:        adminEmail,
        p_admin_nombre:       adminNombre,
        p_negocio_telefono:   (d.telefono  ?? '').trim(),
        p_negocio_direccion:  (d.direccion ?? '').trim(),
        p_negocio_correo:     (d.correoElectronico ?? '').trim(),
        p_varios_activa:      d.variosActiva     ?? false,
        p_caja_varios_monto:  d.montoVarios      ?? 0,
        p_nomina_sueldo_base: d.nominaSueldoBase ?? 0,
        p_propietario_email:  propietarioEmail
      });

      if (error) {
        this.logger.error('OnboardingService', 'Error en fn_completar_onboarding', error);
        // Errores de negocio con prefijo conocido: se muestran tal cual al usuario.
        // 'limite_negocios:' = plan sin cupo para mas sucursales.
        // 'onboarding_error:' = problema de configuracion de la plataforma (sin planes, etc).
        const m = error.message?.match(/(?:limite_negocios|onboarding_error):\s*(.+)/i);
        if (m) throw new OnboardingNegocioError(m[1].trim());
        return null;
      }

      return (result as any).negocio_id as string;
    } catch (err) {
      // Los errores de negocio (mensaje listo para el usuario) se propagan intactos.
      if (err instanceof OnboardingNegocioError) throw err;
      this.logger.error('OnboardingService', 'Error inesperado en completar', err);
      return null;
    }
  }

  /**
   * Activa el JWT con el negocio recién creado (solo para mode='inicial').
   * Para 'sucursal-*' NO se activa — el usuario decide cuando entrar.
   */
  async activarYFinalizar(negocioId: string): Promise<boolean> {
    try {
      const { error: activarError } = await this.supabase.client.rpc('fn_set_negocio_activo', {
        p_negocio_id: negocioId
      });
      if (activarError) {
        this.logger.error('OnboardingService', 'Error en fn_set_negocio_activo', activarError);
        return false;
      }

      const { error: refreshError } = await this.supabase.client.auth.refreshSession();
      if (refreshError) {
        this.logger.error('OnboardingService', 'Error al refrescar sesión', refreshError);
        return false;
      }

      this._draft = {};
      await this.authService.validarUsuario();
      return true;
    } catch (err) {
      this.logger.error('OnboardingService', 'Error inesperado en activarYFinalizar', err);
      return false;
    }
  }

  /** Limpia el draft (al cancelar o terminar). */
  reset(): void {
    this._draft = {};
    this._mode = 'inicial';
  }

  /**
   * Consulta si un email ya esta registrado en `usuarios`.
   * Solo invocable por superadmin (validado en la funcion SQL).
   * Usado en modo 'sucursal-superadmin' para decidir si se reusa un usuario
   * existente (mostrar su nombre + sus negocios) o se crea uno nuevo
   * (pedir nombre, habilitar el campo).
   *
   * Retorna:
   *   - { existe: true,  nombre: 'Pedro', negocios: [...] } → reusar usuario existente
   *   - { existe: false, nombre: null,    negocios: [] }    → crear usuario nuevo
   *   - null si falla la consulta
   */
  async verificarEmailAdmin(email: string): Promise<VerificacionEmailResultado | null> {
    try {
      const { data, error } = await this.supabase.client.rpc('fn_consultar_usuario_por_email', {
        p_email: email.trim().toLowerCase()
      });

      if (error) {
        this.logger.error('OnboardingService', 'Error verificando email', error);
        return null;
      }

      const r = data as any;
      return {
        existe:   r?.existe ?? false,
        nombre:   r?.nombre ?? null,
        negocios: (r?.negocios ?? []) as NegocioResumen[]
      };
    } catch (err) {
      this.logger.error('OnboardingService', 'Error inesperado verificando email', err);
      return null;
    }
  }
}

/**
 * Resumen de un negocio donde un usuario tiene membresia activa.
 * Devuelto por fn_consultar_usuario_por_email para confirmar identidad.
 */
export interface NegocioResumen {
  nombre: string;
  rol: 'ADMIN' | 'EMPLEADO';
  es_propietario: boolean;
}

/**
 * Resultado de verificar un email contra `usuarios`.
 * Si `existe = false`, `nombre` es null y `negocios` es [].
 */
export interface VerificacionEmailResultado {
  existe: boolean;
  nombre: string | null;
  negocios: NegocioResumen[];
}
