import { Injectable, inject } from '@angular/core';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { ConfiguracionService } from '../../configuracion/services/configuracion.service';
import { GananciasService } from '@core/services/ganancias.service';

export interface Notificacion {
  tipo: 'DEUDA_CELULAR' | 'SALDO_BAJO_BUS' | 'FACTURACION_BUS_PENDIENTE' | 'FACTURACION_BUS_PROXIMA';
  titulo: string;
  descripcion: string;
  subtitulo?: string;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private configuracionService     = inject(ConfiguracionService);
  private gananciasService         = inject(GananciasService);

  async getNotificaciones(): Promise<Notificacion[]> {
    const notifs: Notificacion[] = [];

    const [deudasCelular, saldoBus, config, gananciasPendientes] = await Promise.all([
      this.recargasVirtualesService.obtenerDeudasPendientesCelular(),
      this.recargasVirtualesService.getSaldoVirtualActual('BUS'),
      this.configuracionService.get(),
      this.gananciasService.verificarGananciasPendientes()
    ]);

    // ── Deuda con proveedor CELULAR ──────────────────────────────────────────
    if (deudasCelular.length > 0) {
      const total = deudasCelular.reduce((sum, d) => sum + d.monto_a_pagar, 0);
      notifs.push({
        tipo: 'DEUDA_CELULAR',
        titulo: 'Deuda con proveedor CELULAR',
        descripcion: `${deudasCelular.length} recarga${deudasCelular.length > 1 ? 's' : ''} sin pagar`,
        subtitulo: `Total: $${total.toFixed(2)}`
      });
    }

    // ── Saldo bajo en BUS ────────────────────────────────────────────────────
    if (config && saldoBus <= config.bus_alerta_saldo_bajo) {
      notifs.push({
        tipo: 'SALDO_BAJO_BUS',
        titulo: 'Saldo bajo en BUS',
        descripcion: `Saldo virtual $${saldoBus.toFixed(2)} — umbral $${config.bus_alerta_saldo_bajo.toFixed(2)}`
      });
    }

    // ── Ganancias BUS del mes anterior sin liquidar ──────────────────────────
    // Desaparece automáticamente cuando se hace la liquidación:
    //   verificarGananciasPendientes() busca la TRANSFERENCIA_SALIENTE 'Ganancia 1% YYYY-MM'
    //   y retorna null cuando ya existe → la notificación no se genera más.
    if (gananciasPendientes) {
      notifs.push({
        tipo: 'FACTURACION_BUS_PENDIENTE',
        titulo: 'Ganancias BUS sin liquidar',
        descripcion: `Ganancias de ${gananciasPendientes.mesDisplay}: $${gananciasPendientes.total.toFixed(2)}`,
        subtitulo: 'Ir a Recargas Virtuales → BUS'
      });
    }

    // ── Recordatorio: fin de mes BUS próximo ─────────────────────────────────
    // Solo si NO hay ganancias pendientes del mes anterior (para no duplicar).
    // Aparece los últimos N días del mes si ya hay ganancias acumuladas.
    // Desaparece solo cuando el mes cambia (o cuando el usuario liquida y cae en el caso anterior).
    if (!gananciasPendientes && config) {
      const hoy            = new Date();
      const diasHastaFinMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() - hoy.getDate();

      if (diasHastaFinMes >= 0 && diasHastaFinMes <= config.bus_dias_antes_facturacion) {
        const gananciaMesActual = await this.gananciasService.calcularGananciaBusMesActual();
        if (gananciaMesActual > 0) {
          notifs.push({
            tipo: 'FACTURACION_BUS_PROXIMA',
            titulo: 'Facturación BUS — fin de mes',
            descripcion: `Quedan ${diasHastaFinMes} día${diasHastaFinMes !== 1 ? 's' : ''} — Ganancias acumuladas: $${gananciaMesActual.toFixed(2)}`
          });
        }
      }
    }

    return notifs;
  }
}
