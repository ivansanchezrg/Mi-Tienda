import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Interfaz para la tabla cajas
 */
export interface Caja {
  id: number;
  codigo: string;
  nombre: string;
  saldo_actual: number;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Respuesta con los saldos de todas las cajas
 */
export interface SaldosCajas {
  cajaPrincipal: number;
  cajaChica: number;
  cajaCelular: number;
  cajaBus: number;
  total: number;
  cajas: Caja[];
}

/**
 * Servicio para gestionar operaciones de cajas
 */
@Injectable({
  providedIn: 'root'
})
export class CajasService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene todas las cajas activas ordenadas por ID
   */
  async obtenerCajas(): Promise<Caja[] | null> {
    const cajas = await this.supabase.call<Caja[]>(
      this.supabase.client
        .from('cajas')
        .select('id, codigo, nombre, saldo_actual, activo')
        .eq('activo', true)
        .order('id')
    );
    return cajas;
  }

  /**
   * Obtiene los saldos de todas las cajas con el total calculado
   */
  async obtenerSaldosCajas(): Promise<SaldosCajas | null> {
    const cajas = await this.obtenerCajas();

    if (!cajas) {
      return null;
    }

    const cajaPrincipal = cajas.find(c => c.codigo === 'CAJA')?.saldo_actual || 0;
    const cajaChica = cajas.find(c => c.codigo === 'CAJA_CHICA')?.saldo_actual || 0;
    const cajaCelular = cajas.find(c => c.codigo === 'CAJA_CELULAR')?.saldo_actual || 0;
    const cajaBus = cajas.find(c => c.codigo === 'CAJA_BUS')?.saldo_actual || 0;
    const total = cajaPrincipal + cajaChica + cajaCelular + cajaBus;

    return {
      cajaPrincipal,
      cajaChica,
      cajaCelular,
      cajaBus,
      total,
      cajas
    };
  }

  /**
   * Obtiene el saldo de una caja específica por código
   */
  async obtenerSaldoCaja(codigoCaja: string): Promise<number | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('saldo_actual')
        .eq('codigo', codigoCaja)
        .eq('activo', true)
        .single()
    );

    return caja ? caja.saldo_actual : null;
  }

  /**
   * Obtiene una caja por su código (ej: 'CAJA', 'CAJA_CHICA')
   */
  async obtenerCajaPorCodigo(codigoCaja: string): Promise<Caja | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('*')
        .eq('codigo', codigoCaja)
        .eq('activo', true)
        .single()
    );

    return caja;
  }

  /**
   * Obtiene una caja por su nombre display (ej: 'Caja Principal')
   */
  async obtenerCajaPorNombre(nombreCaja: string): Promise<Caja | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('*')
        .eq('nombre', nombreCaja)
        .eq('activo', true)
        .single()
    );

    return caja;
  }

  /**
   * Obtiene una caja por su ID
   */
  async obtenerCajaPorId(id: number): Promise<Caja | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('*')
        .eq('id', id)
        .single()
    );

    return caja;
  }
}
