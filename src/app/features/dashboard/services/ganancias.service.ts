import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Información de ganancias pendientes de transferir
 */
export interface GananciasPendientes {
  mes: string;              // '2026-01' formato
  mesDisplay: string;       // 'Enero 2026' para mostrar
  ventasCelular: number;
  ventasBus: number;
  gananciaCelular: number;  // 5%
  gananciaBus: number;      // 1%
  total: number;
}

/**
 * Servicio para gestionar cálculo y transferencia de ganancias mensuales
 */
@Injectable({
  providedIn: 'root'
})
export class GananciasService {
  private supabase = inject(SupabaseService);

  /**
   * Verifica si hay ganancias del mes anterior pendientes de transferir
   * @returns Información de ganancias pendientes o null si ya se transfirieron
   */
  async verificarGananciasPendientes(): Promise<GananciasPendientes | null> {
    const mesAnterior = this.getMesAnterior();
    const mesAnteriorDisplay = this.getMesAnteriorDisplay();

    // 1. Verificar si ya existen transferencias de ganancias para ese mes
    const yaTransferido = await this.yaSeTransfirio(mesAnterior);
    if (yaTransferido) {
      return null; // Ya se transfirió
    }

    // 2. Calcular ventas del mes anterior
    const [ventasCelular, ventasBus] = await Promise.all([
      this.calcularVentasMes(3, mesAnterior), // CAJA_CELULAR
      this.calcularVentasMes(4, mesAnterior)  // CAJA_BUS
    ]);

    // Si no hay ventas, no hay ganancias
    if (ventasCelular === 0 && ventasBus === 0) {
      return null;
    }

    // 3. Calcular ganancias
    const gananciaCelular = ventasCelular * 0.05;
    const gananciaBus = ventasBus * 0.01;
    const total = gananciaCelular + gananciaBus;

    return {
      mes: mesAnterior,
      mesDisplay: mesAnteriorDisplay,
      ventasCelular,
      ventasBus,
      gananciaCelular,
      gananciaBus,
      total
    };
  }

  /**
   * Calcula el total de ventas (INGRESO) de una caja en un mes específico
   * @param cajaId ID de la caja (3=CELULAR, 4=BUS)
   * @param mes Mes en formato 'YYYY-MM'
   * @returns Total de ventas del mes
   */
  private async calcularVentasMes(cajaId: number, mes: string): Promise<number> {
    const inicioMes = `${mes}-01`;
    const finMes = this.getSiguienteMes(mes);

    const operaciones = await this.supabase.call<{ monto: number }[]>(
      this.supabase.client
        .from('operaciones_cajas')
        .select('monto')
        .eq('caja_id', cajaId)
        .eq('tipo_operacion', 'INGRESO')
        .gte('fecha', inicioMes)
        .lt('fecha', finMes)
    );

    if (!operaciones) return 0;

    return operaciones.reduce((sum, op) => sum + op.monto, 0);
  }

  /**
   * Verifica si ya existen transferencias de ganancias para un mes específico
   * @param mes Mes en formato 'YYYY-MM'
   * @returns true si ya se transfirió, false si no
   */
  private async yaSeTransfirio(mes: string): Promise<boolean> {
    // Buscar operaciones de transferencia con descripción que contenga el mes
    const transferencias = await this.supabase.call<any[]>(
      this.supabase.client
        .from('operaciones_cajas')
        .select('id')
        .eq('tipo_operacion', 'TRANSFERENCIA_SALIENTE')
        .or(`descripcion.ilike.%Ganancia 5% ${mes}%,descripcion.ilike.%Ganancia 1% ${mes}%`)
        .limit(1)
    );

    return transferencias ? transferencias.length > 0 : false;
  }

  /**
   * Obtiene el mes anterior en formato 'YYYY-MM'
   * @returns Mes anterior
   */
  private getMesAnterior(): string {
    const hoy = new Date();
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const year = mesAnterior.getFullYear();
    const month = String(mesAnterior.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /**
   * Obtiene el mes anterior en formato legible 'Enero 2026'
   * @returns Mes anterior para mostrar
   */
  private getMesAnteriorDisplay(): string {
    const hoy = new Date();
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const nombreMes = mesAnterior.toLocaleDateString('es-ES', { month: 'long' });
    const nombreMesCapitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
    const year = mesAnterior.getFullYear();
    return `${nombreMesCapitalizado} ${year}`;
  }

  /**
   * Obtiene el primer día del mes siguiente
   * @param mes Mes en formato 'YYYY-MM'
   * @returns Primer día del mes siguiente en formato 'YYYY-MM-DD'
   */
  private getSiguienteMes(mes: string): string {
    const [year, month] = mes.split('-').map(Number);
    const siguienteMes = new Date(year, month, 1);
    const yearSig = siguienteMes.getFullYear();
    const monthSig = String(siguienteMes.getMonth() + 1).padStart(2, '0');
    return `${yearSig}-${monthSig}-01`;
  }
}
