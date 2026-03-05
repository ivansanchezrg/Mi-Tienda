import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Información de ganancias BUS pendientes de transferir (liquidación mensual del proveedor)
 */
export interface GananciasPendientes {
  mes: string;              // '2026-01' formato
  mesDisplay: string;       // 'Enero 2026' para mostrar
  gananciaCelular: number;  // siempre 0 en este contexto (BUS only)
  gananciaBus: number;      // ROUND(SUM(monto_a_pagar) * comision% WHERE tipo=BUS AND pagado=false AND mes=anterior)
  total: number;
}

/**
 * Servicio para gestionar cálculo y transferencia de ganancias.
 *
 * - CELULAR: ganancia transferida automáticamente a Caja Chica al registrar cada recarga del proveedor
 *   (flujo en RegistrarRecargaModalComponent, no requiere notificación)
 * - BUS: ganancia = ROUND(SUM(monto_a_pagar) * porcentaje_comision%, 2) (liquidación mensual via LiquidacionBusModalComponent)
 */
@Injectable({
  providedIn: 'root'
})
export class GananciasService {
  private supabase = inject(SupabaseService);

  // ==========================================
  // BUS: Liquidación mensual del proveedor
  // ==========================================

  /**
   * Verifica si hay ganancias BUS del mes anterior pendientes de transferir.
   * @returns Información de ganancias BUS pendientes o null si ya se transfirió / no hay
   */
  async verificarGananciasPendientes(): Promise<GananciasPendientes | null> {
    const mesAnterior = this.getMesAnterior();
    const mesAnteriorDisplay = this.getMesAnteriorDisplay();

    // 1. Verificar si ya existen transferencias de ganancias BUS para ese mes
    const yaTransferido = await this.yaSeTransfirio(mesAnterior);
    if (yaTransferido) {
      return null;
    }

    // 2. Calcular ganancias BUS desde recargas_virtuales.ganancia
    const gananciaBus = await this.calcularGananciaMes('BUS', mesAnterior);

    if (gananciaBus === 0) {
      return null;
    }

    return {
      mes: mesAnterior,
      mesDisplay: mesAnteriorDisplay,
      gananciaCelular: 0,
      gananciaBus,
      total: gananciaBus
    };
  }

  /**
   * Calcula la ganancia BUS acumulada del mes anterior (para mostrar en modal de liquidación).
   * @returns Total de ganancias BUS del mes anterior
   */
  async calcularGananciaBusMesAnterior(): Promise<number> {
    return this.calcularGananciaMes('BUS', this.getMesAnterior());
  }

  // ==========================================
  // MÉTODOS COMPARTIDOS / PÚBLICOS
  // ==========================================

  /**
   * Obtiene el mes anterior en formato 'YYYY-MM'
   */
  getMesAnterior(): string {
    const hoy = new Date();
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const year = mesAnterior.getFullYear();
    const month = String(mesAnterior.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Obtiene el mes anterior en formato legible 'Enero 2026'
   */
  getMesAnteriorDisplay(): string {
    const hoy = new Date();
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const nombreMes = mesAnterior.toLocaleDateString('es-ES', { month: 'long' });
    const nombreMesCapitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
    const year = mesAnterior.getFullYear();
    return `${nombreMesCapitalizado} ${year}`;
  }

  /**
   * Obtiene el mes actual en formato 'YYYY-MM'
   */
  getMesActual(): string {
    const hoy = new Date();
    const year = hoy.getFullYear();
    const month = String(hoy.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Calcula la ganancia BUS acumulada del mes en curso.
   * Usada para el recordatorio de fin de mes en notificaciones.
   * @returns Total de ganancias BUS del mes actual
   */
  async calcularGananciaBusMesActual(): Promise<number> {
    return this.calcularGananciaMes('BUS', this.getMesActual());
  }

  // ==========================================
  // MÉTODOS PRIVADOS
  // ==========================================

  /**
   * Suma la ganancia de recargas_virtuales para un servicio y mes específico.
   *
   * - CELULAR: suma la columna `ganancia` (calculada y almacenada en el momento del registro)
   * - BUS: monto_a_pagar = monto completo de la compra (igual que monto_virtual).
   *   Ganancia = ROUND(SUM(monto_a_pagar) * comision%, 2) — sin redondeo por fila.
   *   Solo se suman filas con pagado=false (pendientes de liquidar).
   *
   * @param servicio 'CELULAR' | 'BUS'
   * @param mes Mes en formato 'YYYY-MM'
   * @returns Total de ganancias del mes para ese servicio
   */
  private async calcularGananciaMes(servicio: 'CELULAR' | 'BUS', mes: string): Promise<number> {
    const inicioMes = `${mes}-01`;
    const finMes = this.getSiguienteMes(mes);

    if (servicio === 'BUS') {
      // BUS: monto_a_pagar = monto completo de cada compra (igual que monto_virtual).
      // La ganancia del mes = ROUND(SUM(monto_a_pagar) * comision%, 2) — mismo cálculo que liquidar_ganancias_bus.
      // Se obtiene porcentaje_comision del join para no hacer una query extra.
      const result = await this.supabase.call<Array<{ monto_a_pagar: number; tipos_servicio: { porcentaje_comision: number } }>>(
        this.supabase.client
          .from('recargas_virtuales')
          .select('monto_a_pagar, tipos_servicio!inner(codigo, porcentaje_comision)')
          .eq('tipos_servicio.codigo', 'BUS')
          .eq('pagado', false)
          .gte('fecha', inicioMes)
          .lt('fecha', finMes)
      );

      if (!result || result.length === 0) return 0;
      const comision = (result[0] as any).tipos_servicio?.porcentaje_comision ?? 1;
      const totalCompras = result.reduce((sum, r) => sum + Number(r.monto_a_pagar), 0);
      return Math.round(totalCompras * (comision / 100) * 100) / 100;
    }

    // CELULAR: ganancia almacenada directamente en la columna `ganancia`
    const result = await this.supabase.call<{ ganancia: number }[]>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('ganancia, tipos_servicio!inner(codigo)')
        .eq('tipos_servicio.codigo', servicio)
        .gte('fecha', inicioMes)
        .lt('fecha', finMes)
    );

    if (!result) return 0;
    return result.reduce((sum, r) => sum + Number(r.ganancia), 0);
  }

  /**
   * Verifica si las ganancias BUS de un mes ya fueron liquidadas.
   * Consulta recargas_virtuales: si existe al menos una fila BUS con pagado=true
   * en ese mes, significa que la liquidación ya se realizó.
   *
   * @param mes Mes en formato 'YYYY-MM'
   * @returns true si ya se liquidó, false si no
   */
  private async yaSeTransfirio(mes: string): Promise<boolean> {
    const inicioMes = `${mes}-01`;
    const finMes = this.getSiguienteMes(mes);

    const result = await this.supabase.call<{ id: string }[]>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('id, tipos_servicio!inner(codigo)')
        .eq('tipos_servicio.codigo', 'BUS')
        .eq('pagado', true)
        .gte('fecha', inicioMes)
        .lt('fecha', finMes)
        .limit(1)
    );

    return result ? result.length > 0 : false;
  }

  /**
   * Obtiene el primer día del mes siguiente en formato 'YYYY-MM-DD'
   * @param mes Mes en formato 'YYYY-MM'
   */
  private getSiguienteMes(mes: string): string {
    const [year, month] = mes.split('-').map(Number);
    const siguienteMes = new Date(year, month, 1);
    const yearSig = siguienteMes.getFullYear();
    const monthSig = String(siguienteMes.getMonth() + 1).padStart(2, '0');
    return `${yearSig}-${monthSig}-01`;
  }
}
