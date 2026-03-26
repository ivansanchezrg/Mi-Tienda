import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ReporteVentasDia } from '../models/reporte.model';

@Injectable({ providedIn: 'root' })
export class ReportesService {
    private supabase = inject(SupabaseService);

    /**
     * Obtiene el resumen de ventas de un día específico.
     * Delega toda la lógica de fechas (Ecuador) y agrupación a reporte_ventas_dia.
     *
     * @param fecha Fecha en formato 'YYYY-MM-DD'. Si es null, usa hoy (Ecuador).
     */
    async obtenerReporteDia(fecha: string): Promise<ReporteVentasDia> {
        const resultado = await this.supabase.call<ReporteVentasDia>(
            this.supabase.client.rpc('reporte_ventas_dia', { p_fecha: fecha })
        );

        return resultado ?? {
            fecha,
            total_ventas: 0,
            total_monto: 0,
            total_anuladas: 0,
            monto_anulado: 0,
            por_metodo_pago: [],
            por_tipo_comprobante: []
        };
    }
}
