import { Injectable, inject } from '@angular/core';
import { RecargasVirtualesService } from './recargas-virtuales.service';
import { ConfiguracionService } from '../../features/configuracion/services/configuracion.service';
import { GananciasService } from './ganancias.service';
import { InventarioService } from '../../features/inventario/services/inventario.service';

export interface ProductoStockBajo {
  id: string;
  nombre: string;
  stock_actual: number;
}

export interface Notificacion {
  tipo: 'DEUDA_CELULAR' | 'SALDO_BAJO_BUS' | 'FACTURACION_BUS_PENDIENTE' | 'FACTURACION_BUS_PROXIMA' | 'STOCK_BAJO';
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

    // Primera ronda: todo en paralelo
    const [deudasCelular, saldoBus, config, gananciasPendientes, productosStockBajo] = await Promise.all([
      this.recargasVirtualesService.obtenerDeudasPendientesCelular(),
      this.recargasVirtualesService.getSaldoVirtualActual('BUS'),
      this.configuracionService.get(),
      this.gananciasService.verificarGananciasPendientes(),
      this.inventarioService.obtenerProductosStockBajo()
    ]);

    // Segunda ronda: solo si necesitamos calcular ganancias del mes actual
    const necesitaGananciaMesActual = !gananciasPendientes && config &&
      (() => {
        const hoy = new Date();
        const dias = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() - hoy.getDate();
        return dias >= 0 && dias <= config.bus_dias_antes_facturacion;
      })();

    const gananciaMesActual = necesitaGananciaMesActual
      ? await this.gananciasService.calcularGananciaBusMesActual()
      : 0;

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
    if (gananciasPendientes) {
      notifs.push({
        tipo: 'FACTURACION_BUS_PENDIENTE',
        titulo: 'Ganancias BUS sin liquidar',
        descripcion: `Ganancias de ${gananciasPendientes.mesDisplay}: $${gananciasPendientes.total.toFixed(2)}`,
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
        descripcion: `Quedan ${diasHastaFinMes} día${diasHastaFinMes !== 1 ? 's' : ''} — Ganancias acumuladas: $${gananciaMesActual.toFixed(2)}`
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
