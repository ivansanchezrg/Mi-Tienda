import { Injectable, inject } from '@angular/core';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { ConfiguracionService } from '../../configuracion/services/configuracion.service';

export interface Notificacion {
  tipo: 'DEUDA_CELULAR' | 'SALDO_BAJO_BUS';
  titulo: string;
  descripcion: string;
  subtitulo?: string;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private configuracionService     = inject(ConfiguracionService);

  async getNotificaciones(): Promise<Notificacion[]> {
    const notifs: Notificacion[] = [];

    const [deudasCelular, saldoBus, config] = await Promise.all([
      this.recargasVirtualesService.obtenerDeudasPendientesCelular(),
      this.recargasVirtualesService.getSaldoVirtualActual('BUS'),
      this.configuracionService.get()
    ]);

    // Deuda con proveedor CELULAR
    if (deudasCelular.length > 0) {
      const total = deudasCelular.reduce((sum, d) => sum + d.monto_a_pagar, 0);
      notifs.push({
        tipo: 'DEUDA_CELULAR',
        titulo: 'Deuda con proveedor CELULAR',
        descripcion: `${deudasCelular.length} recarga${deudasCelular.length > 1 ? 's' : ''} sin pagar`,
        subtitulo: `Total: $${total.toFixed(2)}`
      });
    }

    // Saldo bajo en BUS
    if (config && saldoBus <= config.bus_alerta_saldo_bajo) {
      notifs.push({
        tipo: 'SALDO_BAJO_BUS',
        titulo: 'Saldo bajo en BUS',
        descripcion: `Saldo virtual $${saldoBus.toFixed(2)} — umbral $${config.bus_alerta_saldo_bajo.toFixed(2)}`
      });
    }

    return notifs;
  }
}
