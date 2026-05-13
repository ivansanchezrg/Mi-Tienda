import { Injectable, inject } from '@angular/core';
import { RecargasVirtualesService } from '../../features/recargas-virtuales/services/recargas-virtuales.service';
import { ConfiguracionService } from '../../features/configuracion/services/configuracion.service';
import { GananciasService } from '../../features/recargas-virtuales/services/ganancias.service';
import { InventarioService } from '../../features/inventario/services/inventario.service';

export interface ProductoStockBajo {
  id: string;
  nombre: string;
  stock_actual: number;
}

export interface Notificacion {
  tipo: 'SALDO_BAJO_BUS' | 'FACTURACION_BUS_PENDIENTE' | 'FACTURACION_BUS_PROXIMA' | 'STOCK_BAJO';
  titulo: string;
  descripcion: string;
  subtitulo?: string;
  productos?: ProductoStockBajo[];
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private configuracionService     = inject(ConfiguracionService);
  private gananciasService         = inject(GananciasService);
  private inventarioService        = inject(InventarioService);

  async getNotificaciones(): Promise<Notificacion[]> {
    const notifs: Notificacion[] = [];

    const config = await this.configuracionService.get();
    const busActivo = config?.recargas_bus_habilitada ?? false;

    const [saldoBus, gananciaBusPendiente, productosStockBajo] = await Promise.all([
      busActivo ? this.recargasVirtualesService.getSaldoVirtualActual('BUS') : Promise.resolve(Infinity),
      busActivo ? this.gananciasService.calcularGananciaBusPendiente()       : Promise.resolve(null),
      this.inventarioService.obtenerProductosStockBajo()
    ]);

    const necesitaGananciaMesActual = busActivo && !gananciaBusPendiente && config &&
      (() => {
        const hoy = new Date();
        const dias = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() - hoy.getDate();
        return dias >= 0 && dias <= config.bus_dias_antes_facturacion;
      })();

    const gananciaMesActual = necesitaGananciaMesActual
      ? await this.gananciasService.calcularGananciaBusMesActual()
      : 0;

    // ── Saldo bajo en BUS ────────────────────────────────────────────────────
    if (busActivo && config && saldoBus !== Infinity && saldoBus <= config.bus_alerta_saldo_bajo) {
      notifs.push({
        tipo: 'SALDO_BAJO_BUS',
        titulo: 'Saldo bajo en BUS',
        descripcion: `Saldo virtual $${saldoBus.toFixed(2)} — umbral $${config.bus_alerta_saldo_bajo.toFixed(2)}`
      });
    }

    // ── Ganancia BUS pendiente de liquidar ──────────────────────────────────
    if (gananciaBusPendiente !== null) {
      notifs.push({
        tipo: 'FACTURACION_BUS_PENDIENTE',
        titulo: 'Ganancia BUS sin liquidar',
        descripcion: `Total pendiente: $${gananciaBusPendiente.toFixed(2)}`,
        subtitulo: 'Ir a Recargas Virtuales → BUS'
      });
    }

    // ── Recordatorio: fin de mes BUS próximo ─────────────────────────────────
    if (necesitaGananciaMesActual && gananciaMesActual > 0) {
      const hoy = new Date();
      const diasHastaFinMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() - hoy.getDate();
      notifs.push({
        tipo: 'FACTURACION_BUS_PROXIMA',
        titulo: 'Facturación BUS — fin de mes',
        descripcion: `Quedan ${diasHastaFinMes} día${diasHastaFinMes !== 1 ? 's' : ''} — Ganancia acumulada: $${gananciaMesActual.toFixed(2)}`
      });
    }

    // ── Stock bajo en inventario ─────────────────────────────────────────────
    if (productosStockBajo.length > 0) {
      notifs.push({
        tipo: 'STOCK_BAJO',
        titulo: `${productosStockBajo.length} producto${productosStockBajo.length > 1 ? 's' : ''} con stock bajo`,
        descripcion: 'Toca para ver y ajustar desde el Kárdex',
        productos: productosStockBajo
      });
    }

    return notifs;
  }
}
