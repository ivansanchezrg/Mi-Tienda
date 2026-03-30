import { Injectable, inject } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Cliente } from '../../clientes/models/cliente.model';
import { VentaFiada, VentaFiadaItem } from '../models/cuenta-cobrar.model';
import { CurrencyService } from '../../../core/services/currency.service';
import { ConfigService } from '../../../core/services/config.service';
import { formatFechaEC } from '../../../core/utils/date.util';

const TEMP_FILE = 'estado-cuenta-temp.png';

export interface ComprobantePagoItem {
    tipoComprobante: string;
    numeroComprobante: string | null;
    pago: number;
    completa: boolean;
    saldoVenta: number;
}

@Injectable({ providedIn: 'root' })
export class ShareEstadoCuentaService {

    private currency = inject(CurrencyService);
    private config   = inject(ConfigService);

    // Lazy-cached: se resuelve una sola vez en la primera llamada
    private h2cFn: any = null;

    private async getHtml2Canvas(): Promise<any> {
        if (!this.h2cFn) {
            this.h2cFn = (await import('html2canvas-pro')).default;
        }
        return this.h2cFn;
    }

    /**
     * Captura un wrapper HTML como imagen, la guarda en cache y retorna el URI.
     * Centralizado para evitar duplicar la lógica de render + write + share.
     */
    private async capturarYCompartir(wrapper: HTMLElement, titulo: string): Promise<void> {
        const html2canvas = await this.getHtml2Canvas();

        // Un frame para que el spinner se muestre antes del render bloqueante
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await html2canvas(wrapper, {
            scale: 1.5,
            backgroundColor: '#ffffff',
            logging: false,
        });

        const base64 = canvas.toDataURL('image/png').split(',')[1];

        await Filesystem.writeFile({
            path: TEMP_FILE,
            data: base64,
            directory: Directory.Cache,
        });

        const { uri } = await Filesystem.getUri({
            path: TEMP_FILE,
            directory: Directory.Cache,
        });

        await Share.share({
            title: titulo,
            files: [uri],
            dialogTitle: titulo,
        });
    }

    /**
     * Genera la imagen del estado de cuenta y abre el menú de compartir nativo.
     */
    async compartirEstadoCuenta(
        cliente: Cliente,
        ventas: VentaFiada[],
        itemsPorVenta: Map<string, VentaFiadaItem[]>
    ): Promise<void> {
        const nombreNegocio = await this.config.getNombreNegocio();

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;z-index:-1;';
        wrapper.innerHTML = this.buildTicketHtml(cliente, ventas, itemsPorVenta, nombreNegocio);
        document.body.appendChild(wrapper);

        try {
            await this.capturarYCompartir(wrapper, `Estado de cuenta — ${cliente.nombre}`);
        } finally {
            document.body.removeChild(wrapper);
            Filesystem.deleteFile({ path: TEMP_FILE, directory: Directory.Cache }).catch(() => {});
        }
    }

    // ──────────────────────────────────────────────
    // HTML del ticket — CSS inline (obligatorio para html2canvas-pro)
    // Diseño inspirado en VentaDetalleModal (tabla con grid)
    // ──────────────────────────────────────────────

    private buildTicketHtml(
        cliente: Cliente,
        ventas: VentaFiada[],
        itemsPorVenta: Map<string, VentaFiadaItem[]>,
        nombreNegocio: string
    ): string {
        const totalPendiente = ventas.reduce((s, v) => s + v.saldo_pendiente, 0);
        const hoy = new Date();
        const fechaGen = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()} ${hoy.getHours().toString().padStart(2, '0')}:${hoy.getMinutes().toString().padStart(2, '0')}`;
        const ventasHtml = ventas.map(v => this.buildVentaHtml(v, itemsPorVenta.get(v.id) ?? [])).join('');
        const multipleVentas = ventas.length > 1;

        return `
        <div style="width:380px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;padding:28px 24px;">
            <div style="text-align:center;padding-bottom:18px;">
                <div style="font-size:20px;font-weight:800;color:#1a1a1a;">${this.esc(nombreNegocio)}</div>
                <div style="font-size:12px;font-weight:600;color:#888;margin-top:4px;">ESTADO DE CUENTA</div>
            </div>
            <hr style="border:none;border-top:1.5px dashed #ddd;margin:0 0 16px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <tr>
                    <td style="font-size:13px;color:#888;padding:3px 0;">Nombre</td>
                    <td style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;padding:3px 0;">${this.esc(cliente.nombre)}</td>
                </tr>
                ${cliente.identificacion ? `
                <tr>
                    <td style="font-size:13px;color:#888;padding:3px 0;">Cédula/RUC</td>
                    <td style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;padding:3px 0;">${this.esc(cliente.identificacion)}</td>
                </tr>` : ''}
            </table>
            <hr style="border:none;border-top:1.5px dashed #ddd;margin:0 0 16px;">
            ${ventasHtml}
            ${multipleVentas ? `
            <table style="width:100%;border-collapse:collapse;border-top:2px solid #1a1a1a;margin-top:4px;padding-top:12px;">
                <tr>
                    <td style="font-size:16px;font-weight:800;color:#1a1a1a;padding-top:12px;">TOTAL PENDIENTE</td>
                    <td style="font-size:20px;font-weight:800;color:#c0392b;text-align:right;padding-top:12px;">$${this.currency.format(totalPendiente)}</td>
                </tr>
            </table>` : ''}
            <hr style="border:none;border-top:1.5px dashed #ddd;margin:20px 0 0;">
            <div style="text-align:center;padding-top:14px;">
                <div style="font-size:11px;color:#aaa;">Generado: ${fechaGen}</div>
                <div style="font-size:11px;color:#aaa;margin-top:3px;">Este documento no es un comprobante fiscal</div>
            </div>
        </div>`;
    }

    private buildVentaHtml(venta: VentaFiada, items: VentaFiadaItem[]): string {
        const label = venta.tipo_comprobante === 'FACTURA' ? 'Factura'
            : venta.tipo_comprobante === 'NOTA_VENTA' ? 'Nota de Venta' : 'Ticket';
        const numero = venta.numero_comprobante ? ` #${venta.numero_comprobante}` : '';
        const fecha = formatFechaEC(venta.fecha);

        const itemsHtml = items.length > 0 ? `
            <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
                <tr style="border-bottom:1px solid #eee;">
                    <td style="font-size:11px;font-weight:700;color:#888;padding-bottom:6px;">Descripción</td>
                    <td style="font-size:11px;font-weight:700;color:#888;text-align:right;padding-bottom:6px;width:42px;">Cant.</td>
                    <td style="font-size:11px;font-weight:700;color:#888;text-align:right;padding-bottom:6px;width:62px;">P.Unit.</td>
                    <td style="font-size:11px;font-weight:700;color:#888;text-align:right;padding-bottom:6px;width:66px;">Subtotal</td>
                </tr>
                ${items.map(item => `
                <tr>
                    <td style="font-size:13px;font-weight:500;color:#1a1a1a;padding:4px 0;">${this.esc(item.producto_nombre)}</td>
                    <td style="font-size:13px;color:#1a1a1a;text-align:right;padding:4px 0;">${item.cantidad}</td>
                    <td style="font-size:12px;color:#888;text-align:right;padding:4px 0;">$${this.currency.format(item.precio_unitario)}</td>
                    <td style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;padding:4px 0;">$${this.currency.format(item.subtotal)}</td>
                </tr>`).join('')}
            </table>`
            : '<div style="color:#999;font-size:12px;padding:4px 0;">Sin detalle disponible</div>';

        const esFactura = venta.tipo_comprobante === 'FACTURA';

        const ivaHtml = esFactura && (venta.base_iva_0 > 0 || venta.base_iva_15 > 0 || venta.iva_valor > 0) ? `
            <table style="width:100%;border-collapse:collapse;padding:4px 0 2px;">
                ${venta.base_iva_0 > 0 ? `<tr><td style="font-size:12px;color:#888;padding:2px 0;">Base 0%</td><td style="font-size:12px;font-weight:600;color:#1a1a1a;text-align:right;">$${this.currency.format(venta.base_iva_0)}</td></tr>` : ''}
                ${venta.base_iva_15 > 0 ? `<tr><td style="font-size:12px;color:#888;padding:2px 0;">Base 15%</td><td style="font-size:12px;font-weight:600;color:#1a1a1a;text-align:right;">$${this.currency.format(venta.base_iva_15)}</td></tr>` : ''}
                ${venta.iva_valor > 0 ? `<tr><td style="font-size:12px;color:#888;padding:2px 0;">IVA 15%</td><td style="font-size:12px;font-weight:600;color:#1a1a1a;text-align:right;">$${this.currency.format(venta.iva_valor)}</td></tr>` : ''}
            </table>
            <hr style="border:none;border-top:1.5px solid #ccc;margin:6px 0;">` : '';

        return `
        <div style="margin-bottom:20px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
                <tr>
                    <td style="font-size:14px;font-weight:700;color:#1a1a1a;">${label}${numero}</td>
                    <td style="font-size:12px;color:#888;text-align:right;">${fecha}</td>
                </tr>
            </table>
            ${itemsHtml}
            <hr style="border:none;border-top:1.5px solid #ccc;margin:10px 0;">
            ${ivaHtml}
            <table style="width:100%;border-collapse:collapse;">
                ${venta.descuento > 0 ? `
                <tr><td style="font-size:13px;color:#888;padding:3px 0;">Subtotal</td><td style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;padding:3px 0;">$${this.currency.format(venta.subtotal)}</td></tr>
                <tr><td style="font-size:13px;color:#27ae60;padding:3px 0;">Descuento (${venta.descuento_pct}%)</td><td style="font-size:13px;font-weight:600;color:#27ae60;text-align:right;padding:3px 0;">-$${this.currency.format(venta.descuento)}</td></tr>` : ''}
                <tr><td style="font-size:13px;color:#888;padding:3px 0;">Total venta</td><td style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;padding:3px 0;">$${this.currency.format(venta.total)}</td></tr>
                ${venta.monto_pagado > 0 ? `<tr><td style="font-size:13px;color:#27ae60;padding:3px 0;">Abonado</td><td style="font-size:13px;font-weight:600;color:#27ae60;text-align:right;padding:3px 0;">-$${this.currency.format(venta.monto_pagado)}</td></tr>` : ''}
                <tr><td style="font-size:15px;font-weight:800;color:#1a1a1a;padding:6px 0 0;">Pendiente</td><td style="font-size:17px;font-weight:800;color:#c0392b;text-align:right;padding:6px 0 0;">$${this.currency.format(venta.saldo_pendiente)}</td></tr>
            </table>
        </div>
        <hr style="border:none;border-top:1.5px dashed #ddd;margin-bottom:18px;">`;
    }

    // ──────────────────────────────────────────────
    // COMPROBANTE DE PAGO
    // ──────────────────────────────────────────────

    async compartirComprobantePago(
        cliente: Cliente,
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number,
        ventasPendientes: VentaFiada[]
    ): Promise<void> {
        const nombreNegocio = await this.config.getNombreNegocio();

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;z-index:-1;';
        wrapper.innerHTML = this.buildComprobanteHtml(cliente, items, montoTotal, saldoRestante, ventasPendientes, nombreNegocio);
        document.body.appendChild(wrapper);

        try {
            await this.capturarYCompartir(wrapper, `Comprobante de pago — ${cliente.nombre}`);
        } finally {
            document.body.removeChild(wrapper);
            Filesystem.deleteFile({ path: TEMP_FILE, directory: Directory.Cache }).catch(() => {});
        }
    }

    private buildComprobanteHtml(
        cliente: Cliente,
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number,
        ventasPendientes: VentaFiada[],
        nombreNegocio: string
    ): string {
        const hoy = new Date();
        const fecha = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
        const hora = `${hoy.getHours().toString().padStart(2, '0')}:${hoy.getMinutes().toString().padStart(2, '0')}`;

        const labelTipo = (tipo: string) => tipo === 'FACTURA' ? 'Factura'
            : tipo === 'NOTA_VENTA' ? 'Nota de Venta' : 'Ticket';

        // ── Sección: lo que se pagó ahora ──
        const pagadosHtml = items.map(item => {
            const label = labelTipo(item.tipoComprobante);
            const numero = item.numeroComprobante ? ` #${item.numeroComprobante}` : '';
            const badge = item.completa
                ? `<span style="font-size:11px;font-weight:700;color:#27ae60;padding:2px 6px;border:1px solid #27ae60;">SALDADO</span>`
                : `<span style="font-size:11px;font-weight:700;color:#e67e22;padding:2px 6px;border:1px solid #e67e22;">ABONO PARCIAL</span>`;
            const quedaHtml = !item.completa
                ? `<div style="font-size:12px;color:#888;margin-top:3px;">Queda: <strong style="color:#c0392b;">$${this.currency.format(item.saldoVenta)}</strong></div>`
                : '';
            return `
            <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #f0f0f0;">
                <tr>
                    <td style="font-size:13px;font-weight:700;color:#1a1a1a;padding:8px 8px 8px 0;">
                        ${label}${numero}
                        ${quedaHtml}
                    </td>
                    <td style="text-align:right;padding:8px 0;vertical-align:top;">
                        ${badge}<br>
                        <span style="font-size:14px;font-weight:800;color:#1a1a1a;">$${this.currency.format(item.pago)}</span>
                    </td>
                </tr>
            </table>`;
        }).join('');

        const pendientesHtml = ventasPendientes.length > 0 ? `
            <hr style="border:none;border-top:1.5px dashed #ddd;margin:16px 0 12px;">
            <div style="font-size:11px;font-weight:700;color:#888;margin-bottom:6px;">PENDIENTE POR COBRAR</div>
            <table style="width:100%;border-collapse:collapse;">
                ${ventasPendientes.map(v => {
                    const label = labelTipo(v.tipo_comprobante);
                    const numero = v.numero_comprobante ? ` #${v.numero_comprobante}` : '';
                    return `<tr style="border-bottom:1px solid #f0f0f0;">
                        <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;">${label}${numero}</td>
                        <td style="font-size:14px;font-weight:800;color:#c0392b;text-align:right;padding:6px 0;">$${this.currency.format(v.saldo_pendiente)}</td>
                    </tr>`;
                }).join('')}
                <tr>
                    <td style="font-size:15px;font-weight:800;color:#1a1a1a;padding-top:10px;">Total pendiente</td>
                    <td style="font-size:18px;font-weight:800;color:#c0392b;text-align:right;padding-top:10px;">$${this.currency.format(saldoRestante)}</td>
                </tr>
            </table>` : `
            <hr style="border:none;border-top:1.5px dashed #ddd;margin:16px 0 0;">
            <div style="text-align:center;padding-top:12px;font-size:13px;font-weight:700;color:#27ae60;">Deuda saldada completamente</div>`;

        return `
        <div style="width:380px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;padding:28px 24px;">
            <div style="text-align:center;padding-bottom:18px;">
                <div style="font-size:20px;font-weight:800;color:#1a1a1a;">${this.esc(nombreNegocio)}</div>
                <div style="font-size:12px;font-weight:600;color:#888;margin-top:4px;">COMPROBANTE DE PAGO</div>
            </div>
            <hr style="border:none;border-top:1.5px dashed #ddd;margin-bottom:14px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
                <tr>
                    <td style="color:#888;font-size:13px;padding:3px 0;">Nombre</td>
                    <td style="font-size:13px;font-weight:600;text-align:right;padding:3px 0;">${this.esc(cliente.nombre)}</td>
                </tr>
                ${cliente.identificacion ? `
                <tr>
                    <td style="color:#888;font-size:13px;padding:3px 0;">Cédula/RUC</td>
                    <td style="font-size:13px;font-weight:600;text-align:right;padding:3px 0;">${this.esc(cliente.identificacion)}</td>
                </tr>` : ''}
            </table>
            <hr style="border:none;border-top:1.5px dashed #ddd;margin-bottom:14px;">
            <div style="text-align:center;padding:14px;background:#eafaf1;margin-bottom:16px;">
                <div style="font-size:11px;font-weight:700;color:#27ae60;margin-bottom:6px;">MONTO COBRADO</div>
                <div style="font-size:34px;font-weight:800;color:#1a1a1a;">$${this.currency.format(montoTotal)}</div>
            </div>
            <div style="font-size:11px;font-weight:700;color:#888;margin-bottom:6px;">DETALLE DEL PAGO</div>
            ${pagadosHtml}
            ${pendientesHtml}
            <hr style="border:none;border-top:1.5px dashed #ddd;margin-top:20px;">
            <div style="text-align:center;padding-top:14px;">
                <div style="font-size:11px;color:#aaa;">Generado: ${fecha} ${hora}</div>
                <div style="font-size:11px;color:#aaa;margin-top:3px;">Este documento no es un comprobante fiscal</div>
            </div>
        </div>`;
    }

    // ──────────────────────────────────────────────
    // WHATSAPP WEB — resumen en texto plano
    // ──────────────────────────────────────────────

    /**
     * Genera un resumen en texto plano y abre WhatsApp con el número del cliente.
     * Usado como fallback en web donde Share nativo no está disponible.
     */
    enviarResumenWhatsApp(
        cliente: Cliente,
        ventas: VentaFiada[],
        nombreNegocio: string
    ): void {
        const totalPendiente = ventas.reduce((s, v) => s + v.saldo_pendiente, 0);
        const labelTipo = (tipo: string) =>
            tipo === 'FACTURA' ? 'Factura' : tipo === 'NOTA_VENTA' ? 'Nota de Venta' : 'Ticket';

        // Emojis via Unicode escape — evita problemas de encoding del archivo
        const E = {
            doc: '\uD83D\uDCC4',     // 📄
            person: '\uD83D\uDC64',  // 👤
            diamond: '\uD83D\uDD39', // 🔹
            red: '\uD83D\uDD34',     // 🔴
            check: '\u2705',         // ✅
            party: '\uD83C\uDF89',   // 🎉
        };

        const lineas: string[] = [];
        lineas.push(`${E.doc} *ESTADO DE CUENTA*`);
        lineas.push(`${nombreNegocio}`);
        lineas.push(``);
        lineas.push(`${E.person} *${cliente.nombre}*`);
        lineas.push(`------------------------`);

        for (const v of ventas) {
            const label = labelTipo(v.tipo_comprobante);
            const numero = v.numero_comprobante ? ` #${v.numero_comprobante}` : '';
            const fecha = formatFechaEC(v.fecha);
            lineas.push(``);
            lineas.push(`${E.diamond} *${label}${numero}*`);
            lineas.push(`   Fecha: ${fecha}`);
            lineas.push(`   Total: $${this.currency.format(v.total)}`);
            if (v.monto_pagado > 0) {
                lineas.push(`   ${E.check} Abonado: $${this.currency.format(v.monto_pagado)}`);
            }
            lineas.push(`   ${E.red} *Pendiente: $${this.currency.format(v.saldo_pendiente)}*`);
        }

        if (ventas.length > 1) {
            lineas.push(``);
            lineas.push(`------------------------`);
            lineas.push(`${E.red} *TOTAL PENDIENTE: $${this.currency.format(totalPendiente)}*`);
        }

        lineas.push(``);
        lineas.push(`_Resumen informativo. Para comprobante con imagen usa la app._`);

        let telefono = (cliente.telefono ?? '').replace(/\D/g, '');
        if (telefono.startsWith('0')) telefono = '593' + telefono.slice(1);
        const url = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(lineas.join('\n'))}`;
        window.open(url, '_blank');
    }

    enviarComprobanteWhatsApp(
        cliente: Cliente,
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number,
        ventasPendientes: VentaFiada[],
        nombreNegocio: string
    ): void {
        const labelTipo = (tipo: string) =>
            tipo === 'FACTURA' ? 'Factura' : tipo === 'NOTA_VENTA' ? 'Nota de Venta' : 'Ticket';

        const E = {
            check: '\u2705',         // ✅
            person: '\uD83D\uDC64',  // 👤
            money: '\uD83D\uDCB0',   // 💰
            doc: '\uD83D\uDCC4',     // 📄
            diamond: '\uD83D\uDD39', // 🔹
            small: '\uD83D\uDD38',   // 🔸
            pin: '\uD83D\uDCCC',     // 📌
            red: '\uD83D\uDD34',     // 🔴
            hourglass: '\u231B',     // ⌛
            party: '\uD83C\uDF89',   // 🎉
        };

        const lineas: string[] = [];
        lineas.push(`${E.check} *COMPROBANTE DE PAGO*`);
        lineas.push(`${nombreNegocio}`);
        lineas.push(``);
        lineas.push(`${E.person} *${cliente.nombre}*`);
        lineas.push(`------------------------`);
        lineas.push(``);
        lineas.push(`${E.money} *Monto: $${this.currency.format(montoTotal)}*`);
        lineas.push(``);

        lineas.push(`${E.doc} *Detalle:*`);
        for (const item of items) {
            const label = labelTipo(item.tipoComprobante);
            const numero = item.numeroComprobante ? ` #${item.numeroComprobante}` : '';
            const estado = item.completa ? `${E.check} Saldado` : `${E.hourglass} Abono`;
            lineas.push(`${E.diamond} ${label}${numero}`);
            lineas.push(`   Pago: *$${this.currency.format(item.pago)}*`);
            lineas.push(`   ${estado}`);
            if (!item.completa) {
                lineas.push(`   Pendiente: *$${this.currency.format(item.saldoVenta)}*`);
            }
            lineas.push(``);
        }

        if (ventasPendientes.length > 0) {
            lineas.push(`------------------------`);
            lineas.push(`${E.pin} *Pendientes:*`);
            for (const v of ventasPendientes) {
                const label = labelTipo(v.tipo_comprobante);
                const numero = v.numero_comprobante ? ` #${v.numero_comprobante}` : '';
                lineas.push(`${E.small} ${label}${numero}: *$${this.currency.format(v.saldo_pendiente)}*`);
            }
            lineas.push(``);
            lineas.push(`${E.red} *TOTAL: $${this.currency.format(saldoRestante)}*`);
        } else {
            lineas.push(``);
            lineas.push(`${E.party} *Todo pagado*`);
        }

        lineas.push(``);
        lineas.push(`_Resumen informativo_`);

        let telefono = (cliente.telefono ?? '').replace(/\D/g, '');
        if (telefono.startsWith('0')) telefono = '593' + telefono.slice(1);
        const url = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(lineas.join('\n'))}`;
        window.open(url, '_blank');
    }

    /** Escapa caracteres HTML para evitar XSS en el ticket */
    private esc(str: string | null | undefined): string {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
