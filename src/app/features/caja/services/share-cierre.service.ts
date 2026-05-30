import { Injectable, inject } from '@angular/core';
import { ConfigService } from '@core/services/config.service';
import { CurrencyService } from '@core/services/currency.service';
import { UiService } from '@core/services/ui.service';
import { formatFechaEC } from '@core/utils/date.util';

export interface DatosCierreParaCompartir {
  // Turno
  numeroTurno:      number;
  cajeroNombre:     string;
  horaApertura:     string;  // ISO
  // Cajón
  fondoApertura:    number;
  ventasPosEfectivo: number;
  otrosIngresos:    number;
  egresos:          number;
  efectivoFisico:   number;
  diferencia:       number;
  depositoTienda:   number;
  // Saldos antes → después
  saldoAnteriorCaja:    number;
  saldoFinalCaja:       number;
  variosActiva:         boolean;
  saldoAnteriorVarios:  number;
  saldoFinalVarios:     number;
  transferenciaVarios:  number;
  celularHabilitado:    boolean;
  saldoAnteriorCelular: number;
  saldoFinalCelular:    number;
  ventaCelular:         number;
  busHabilitado:        boolean;
  saldoAnteriorBus:     number;
  saldoFinalBus:        number;
  ventaBus:             number;
}

// Emojis en Unicode — evitar corrupción al compilar
const E = {
  reporte:   '📋', // 📋
  caja:      '💵', // 💵
  banco:     '🏦', // 🏦
  reloj:     '⏱',       // ⏱
  check:     '✅',       // ✅
  warning:   '⚠',       // ⚠
};

@Injectable({ providedIn: 'root' })
export class ShareCierreService {
  private configService  = inject(ConfigService);
  private currencyService = inject(CurrencyService);
  private ui             = inject(UiService);

  private fmt(n: number): string {
    return `$${this.currencyService.format(n)}`;
  }

  async enviarResumenWhatsApp(datos: DatosCierreParaCompartir): Promise<void> {
    const config = await this.configService.get();
    const telefono = this.normalizarTelefono(config.negocio_telefono);

    if (!telefono) {
      this.ui.showToast(
        'Configura el teléfono del negocio en Parámetros para enviar el resumen',
        'warning'
      );
      return;
    }

    const texto = this.construirTexto(datos, config.negocio_nombre);
    const url   = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  }

  private construirTexto(d: DatosCierreParaCompartir, negocioNombre: string): string {
    const lineas: string[] = [];

    // ── Encabezado ────────────────────────────────────────────────
    const fecha = formatFechaEC(d.horaApertura);
    const hora  = new Date(d.horaApertura).toLocaleTimeString('es-EC', {
      timeZone: 'America/Guayaquil',
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    lineas.push(`${E.reporte} *CIERRE DE TURNO*`);
    lineas.push(`*${negocioNombre}*`);
    lineas.push(`${fecha} · Turno #${d.numeroTurno}`);
    lineas.push(`Cajero: ${d.cajeroNombre} · Apertura: ${hora}`);
    lineas.push('');

    // ── Caja del día ──────────────────────────────────────────────
    lineas.push(`${E.caja} *CAJA DEL DÍA*`);
    lineas.push(`Apertura:        ${this.fmt(d.fondoApertura)}`);
    if (d.ventasPosEfectivo > 0) {
      lineas.push(`Ventas POS:      ${this.fmt(d.ventasPosEfectivo)}`);
    }
    if (d.otrosIngresos > 0) {
      lineas.push(`Ingresos:       +${this.fmt(d.otrosIngresos)}`);
    }
    if (d.egresos > 0) {
      lineas.push(`Gastos:         −${this.fmt(d.egresos)}`);
    }
    lineas.push(`Contado:         ${this.fmt(d.efectivoFisico)}`);
    if (Math.abs(d.diferencia) > 0.001) {
      if (d.diferencia < 0) {
        lineas.push(`${E.warning} Faltante:      ${this.fmt(d.diferencia)}`);
      } else {
        lineas.push(`Sobrante:       +${this.fmt(d.diferencia)}`);
      }
    } else {
      lineas.push(`${E.check} Cajón cuadrado`);
    }
    lineas.push('');

    // ── Saldos al cierre ──────────────────────────────────────────
    lineas.push(`${E.banco} *SALDOS AL CIERRE*`);

    // Tienda
    if (d.depositoTienda > 0) {
      lineas.push(`Tienda:  ${this.fmt(d.saldoAnteriorCaja)} + ${this.fmt(d.depositoTienda)} = *${this.fmt(d.saldoFinalCaja)}*`);
    } else {
      lineas.push(`Tienda:  ${this.fmt(d.saldoAnteriorCaja)} (sin cambio)`);
    }

    // Varios
    if (d.variosActiva) {
      if (d.transferenciaVarios > 0) {
        lineas.push(`Varios:  ${this.fmt(d.saldoAnteriorVarios)} + ${this.fmt(d.transferenciaVarios)} = *${this.fmt(d.saldoFinalVarios)}*`);
      } else {
        lineas.push(`Varios:  ${this.fmt(d.saldoAnteriorVarios)} (sin cambio)`);
      }
    }

    // Celular
    if (d.celularHabilitado) {
      if (d.ventaCelular > 0) {
        lineas.push(`Celular: ${this.fmt(d.saldoAnteriorCelular)} + ${this.fmt(d.ventaCelular)} = *${this.fmt(d.saldoFinalCelular)}*`);
      } else {
        lineas.push(`Celular: ${this.fmt(d.saldoAnteriorCelular)} (sin cambio)`);
      }
    }

    // Bus
    if (d.busHabilitado) {
      if (d.ventaBus > 0) {
        lineas.push(`Bus:     ${this.fmt(d.saldoAnteriorBus)} + ${this.fmt(d.ventaBus)} = *${this.fmt(d.saldoFinalBus)}*`);
      } else {
        lineas.push(`Bus:     ${this.fmt(d.saldoAnteriorBus)} (sin cambio)`);
      }
    }

    lineas.push('');

    // ── Pie ───────────────────────────────────────────────────────
    const ahora = new Date().toLocaleTimeString('es-EC', {
      timeZone: 'America/Guayaquil',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    lineas.push(`${E.reloj} Generado: ${ahora}`);

    return lineas.join('\n');
  }

  private normalizarTelefono(tel: string): string {
    if (!tel) return '';
    let t = tel.replace(/\D/g, '');
    if (t.startsWith('0')) t = '593' + t.slice(1);
    if (!t.startsWith('593')) t = '593' + t;
    return t;
  }
}
