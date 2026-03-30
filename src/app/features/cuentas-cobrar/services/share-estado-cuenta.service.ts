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

    /**
     * Genera la imagen del estado de cuenta y abre el menú de compartir nativo.
     * Retorna false si el share no está disponible en el dispositivo.
     */
    async compartirEstadoCuenta(
        cliente: Cliente,
        ventas: VentaFiada[],
        itemsPorVenta: Map<string, VentaFiadaItem[]>
    ): Promise<void> {
        // Importación dinámica para no aumentar el bundle inicial
        const html2canvas = (await import('html2canvas')).default;

        // 1. Crear div oculto fuera del viewport
        const nombreNegocio = await this.config.getNombreNegocio();
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;z-index:-1;';
        wrapper.innerHTML = this.buildTicketHtml(cliente, ventas, itemsPorVenta, nombreNegocio);
        document.body.appendChild(wrapper);

        try {
            // Dar un frame al browser para que pinte/anime el loading spinner
            // antes de que html2canvas bloquee el hilo principal
            await new Promise(r => setTimeout(r, 100));

            // 2. Capturar como imagen (scale:2 para nitidez en pantallas HDPI)
            const canvas = await html2canvas(wrapper, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
            });

            // 3. Obtener base64
            const base64 = canvas.toDataURL('image/png').split(',')[1];

            // 4. Guardar en cache del dispositivo
            await Filesystem.writeFile({
                path: TEMP_FILE,
                data: base64,
                directory: Directory.Cache,
            });

            const { uri } = await Filesystem.getUri({
                path: TEMP_FILE,
                directory: Directory.Cache,
            });

            // 5. Intentar Share nativo, fallback a clipboard
            const canShare = await Share.canShare();
            if (canShare.value) {
                await Share.share({
                    title: `Estado de cuenta — ${cliente.nombre}`,
                    files: [uri],
                    dialogTitle: 'Compartir estado de cuenta',
                });
            } else {
                // Fallback: copiar imagen como blob al clipboard (browser)
                const dataUrl = canvas.toDataURL('image/png');
                const blob = await (await fetch(dataUrl)).blob();
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                throw new Error('CLIPBOARD_FALLBACK');
            }

        } finally {
            // Limpiar div del DOM siempre
            document.body.removeChild(wrapper);
            // Limpiar archivo temporal (best-effort)
            Filesystem.deleteFile({ path: TEMP_FILE, directory: Directory.Cache }).catch(() => {});
        }
    }

    // ──────────────────────────────────────────────
    // HTML del ticket — CSS inline (obligatorio para html2canvas)
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
        <div style="
            width: 380px;
            background: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            color: #1a1a1a;
            padding: 28px 24px;
            box-sizing: border-box;
        ">
            <!-- HEADER -->
            <div style="text-align:center; padding-bottom:18px;">
                <div style="font-size:20px; font-weight:800; letter-spacing:-0.5px; color:#1a1a1a;">${this.esc(nombreNegocio)}</div>
                <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:#888; margin-top:4px;">Estado de cuenta</div>
            </div>

            <!-- DIVISOR -->
            <div style="border-top:1.5px dashed #ddd; margin-bottom:16px;"></div>

            <!-- DATOS CLIENTE -->
            <div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; gap:12px;">
                    <span style="font-size:13px; color:#888;">Nombre</span>
                    <span style="font-size:13px; font-weight:600; color:#1a1a1a; text-align:right;">${this.esc(cliente.nombre)}</span>
                </div>
                ${cliente.identificacion ? `
                <div style="display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; gap:12px;">
                    <span style="font-size:13px; color:#888;">Cédula/RUC</span>
                    <span style="font-size:13px; font-weight:600; color:#1a1a1a;">${this.esc(cliente.identificacion)}</span>
                </div>` : ''}
            </div>

            <!-- DIVISOR -->
            <div style="border-top:1.5px dashed #ddd; margin-bottom:16px;"></div>

            <!-- VENTAS -->
            ${ventasHtml}

            ${multipleVentas ? `
            <!-- TOTAL GENERAL — solo si hay >1 venta -->
            <div style="
                border-top: 2px solid #1a1a1a;
                margin-top: 4px;
                padding-top: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <span style="font-size:16px; font-weight:800; text-transform:uppercase; color:#1a1a1a;">TOTAL PENDIENTE</span>
                <span style="font-size:20px; font-weight:800; color:#c0392b; letter-spacing:-1px;">$${this.currency.format(totalPendiente)}</span>
            </div>` : ''}

            <!-- FOOTER -->
            <div style="
                margin-top: 20px;
                padding-top: 14px;
                border-top: 1.5px dashed #ddd;
                text-align: center;
            ">
                <div style="font-size:11px; color:#aaa;">Generado: ${fechaGen}</div>
                <div style="font-size:11px; color:#aaa; margin-top:3px;">Este documento no es un comprobante fiscal</div>
            </div>
        </div>`;
    }

    private buildVentaHtml(venta: VentaFiada, items: VentaFiadaItem[]): string {
        const label = venta.tipo_comprobante === 'FACTURA' ? 'Factura'
            : venta.tipo_comprobante === 'NOTA_VENTA' ? 'Nota de Venta' : 'Ticket';
        const numero = venta.numero_comprobante ? ` #${venta.numero_comprobante}` : '';
        const fecha = formatFechaEC(venta.fecha);

        // Tabla de items con grid 4 columnas igual al modal de detalle de venta
        const itemsHtml = items.length > 0 ? `
            <!-- Header tabla -->
            <div style="display:grid; grid-template-columns:1fr 42px 62px 66px; gap:4px; padding-bottom:6px; border-bottom:1px solid #eee; margin-bottom:4px;">
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:#888;">Descripción</span>
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:#888; text-align:right;">Cant.</span>
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:#888; text-align:right;">P.Unit.</span>
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:#888; text-align:right;">Subtotal</span>
            </div>
            ${items.map(item => `
            <div style="display:grid; grid-template-columns:1fr 42px 62px 66px; gap:4px; padding:4px 0; align-items:start;">
                <span style="font-size:13px; font-weight:500; color:#1a1a1a; line-height:1.3;">${this.esc(item.producto_nombre)}</span>
                <span style="font-size:13px; color:#1a1a1a; text-align:right;">${item.cantidad}</span>
                <span style="font-size:12px; color:#888; text-align:right;">$${this.currency.format(item.precio_unitario)}</span>
                <span style="font-size:13px; font-weight:600; color:#1a1a1a; text-align:right;">$${this.currency.format(item.subtotal)}</span>
            </div>`).join('')}`
            : '<div style="color:#999; font-size:12px; padding:4px 0;">Sin detalle disponible</div>';

        const esFactura = venta.tipo_comprobante === 'FACTURA';

        const ivaRows = esFactura ? [
            venta.base_iva_0 > 0 ? `<div style="display:flex; justify-content:space-between; padding:2px 0;">
                    <span style="font-size:12px; color:#888;">Base 0%</span>
                    <span style="font-size:12px; font-weight:600; color:#1a1a1a;">$${this.currency.format(venta.base_iva_0)}</span>
                </div>` : '',
            venta.base_iva_15 > 0 ? `<div style="display:flex; justify-content:space-between; padding:2px 0;">
                    <span style="font-size:12px; color:#888;">Base 15%</span>
                    <span style="font-size:12px; font-weight:600; color:#1a1a1a;">$${this.currency.format(venta.base_iva_15)}</span>
                </div>` : '',
            venta.iva_valor > 0 ? `<div style="display:flex; justify-content:space-between; padding:2px 0;">
                    <span style="font-size:12px; color:#888;">IVA 15%</span>
                    <span style="font-size:12px; font-weight:600; color:#1a1a1a;">$${this.currency.format(venta.iva_valor)}</span>
                </div>` : '',
        ].filter(Boolean) : [];

        const ivaHtml = ivaRows.length > 0 ? `
            <div style="padding:4px 0 2px;">
                ${ivaRows.join('')}
            </div>
            <div style="border-top:1.5px solid #ccc; margin:6px 0;"></div>` : '';

        const abonado = venta.monto_pagado > 0 ? `
            <div style="display:flex; justify-content:space-between; padding:3px 0;">
                <span style="font-size:13px; color:#27ae60;">Abonado</span>
                <span style="font-size:13px; font-weight:600; color:#27ae60;">-$${this.currency.format(venta.monto_pagado)}</span>
            </div>` : '';

        return `
        <div style="margin-bottom:20px;">
            <!-- Encabezado venta -->
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
                <span style="font-size:14px; font-weight:700; color:#1a1a1a;">${label}${numero}</span>
                <span style="font-size:12px; color:#888;">${fecha}</span>
            </div>

            <!-- Items tabla -->
            ${itemsHtml}

            <!-- Divisor fino -->
            <div style="border-top:1.5px solid #ccc; margin:10px 0;"></div>

            <!-- Desglose IVA (solo factura) -->
            ${ivaHtml}

            <!-- Totales -->
            <div>
                ${venta.descuento > 0 ? `
                <div style="display:flex; justify-content:space-between; padding:3px 0;">
                    <span style="font-size:13px; color:#888;">Subtotal</span>
                    <span style="font-size:13px; font-weight:600; color:#1a1a1a;">$${this.currency.format(venta.subtotal)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; padding:3px 0;">
                    <span style="font-size:13px; color:#27ae60;">Descuento (${venta.descuento_pct}%)</span>
                    <span style="font-size:13px; font-weight:600; color:#27ae60;">-$${this.currency.format(venta.descuento)}</span>
                </div>` : ''}
                <div style="display:flex; justify-content:space-between; padding:3px 0;">
                    <span style="font-size:13px; color:#888;">Total venta</span>
                    <span style="font-size:13px; font-weight:600; color:#1a1a1a;">$${this.currency.format(venta.total)}</span>
                </div>
                ${abonado}
                <div style="display:flex; justify-content:space-between; padding:6px 0 0;">
                    <span style="font-size:15px; font-weight:800; color:#1a1a1a;">Pendiente</span>
                    <span style="font-size:17px; font-weight:800; color:#c0392b; letter-spacing:-0.5px;">$${this.currency.format(venta.saldo_pendiente)}</span>
                </div>
            </div>
        </div>
        <div style="border-top:1.5px dashed #ddd; margin-bottom:18px;"></div>`;
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
        const html2canvas = (await import('html2canvas')).default;
        const nombreNegocio = await this.config.getNombreNegocio();

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;z-index:-1;';
        wrapper.innerHTML = this.buildComprobanteHtml(cliente, items, montoTotal, saldoRestante, ventasPendientes, nombreNegocio);
        document.body.appendChild(wrapper);

        try {
            await new Promise(r => setTimeout(r, 100));

            const canvas = await html2canvas(wrapper, {
                scale: 2,
                useCORS: true,
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

            const canShare = await Share.canShare();
            if (canShare.value) {
                await Share.share({
                    title: `Comprobante de pago — ${cliente.nombre}`,
                    files: [uri],
                    dialogTitle: 'Compartir comprobante de pago',
                });
            } else {
                const dataUrl = canvas.toDataURL('image/png');
                const blob = await (await fetch(dataUrl)).blob();
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                throw new Error('CLIPBOARD_FALLBACK');
            }
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
                ? `<span style="font-size:11px;font-weight:700;color:#27ae60;background:#eafaf1;padding:2px 8px;border-radius:10px;white-space:nowrap;">SALDADO</span>`
                : `<span style="font-size:11px;font-weight:700;color:#e67e22;background:#fef5ec;padding:2px 8px;border-radius:10px;white-space:nowrap;">ABONO PARCIAL</span>`;
            const quedaHtml = !item.completa
                ? `<div style="font-size:12px;color:#888;margin-top:3px;">Queda: <strong style="color:#c0392b;">$${this.currency.format(item.saldoVenta)}</strong></div>`
                : '';
            return `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f0f0f0;">
                <div style="flex:1;padding-right:12px;">
                    <div style="font-size:13px;font-weight:700;color:#1a1a1a;">${label}${numero}</div>
                    ${quedaHtml}
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                    ${badge}
                    <span style="font-size:14px;font-weight:800;color:#1a1a1a;">$${this.currency.format(item.pago)}</span>
                </div>
            </div>`;
        }).join('');

        // ── Sección: lo que sigue pendiente ──
        const pendientesHtml = ventasPendientes.length > 0 ? `
            <div style="border-top:1.5px dashed #ddd;margin:16px 0 12px;"></div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#888;margin-bottom:6px;">Pendiente por cobrar</div>
            ${ventasPendientes.map(v => {
                const label = labelTipo(v.tipo_comprobante);
                const numero = v.numero_comprobante ? ` #${v.numero_comprobante}` : '';
                return `
                <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                    <span style="font-size:13px;font-weight:600;color:#1a1a1a;">${label}${numero}</span>
                    <span style="font-size:14px;font-weight:800;color:#c0392b;">$${this.currency.format(v.saldo_pendiente)}</span>
                </div>`;
            }).join('')}
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 0;">
                <span style="font-size:15px;font-weight:800;text-transform:uppercase;color:#1a1a1a;">Total pendiente</span>
                <span style="font-size:18px;font-weight:800;color:#c0392b;letter-spacing:-0.5px;">$${this.currency.format(saldoRestante)}</span>
            </div>` : `
            <div style="border-top:1.5px dashed #ddd;margin:16px 0 0;"></div>
            <div style="text-align:center;padding:12px 0 0;">
                <span style="font-size:13px;font-weight:700;color:#27ae60;">Deuda saldada completamente</span>
            </div>`;

        return `
        <div style="
            width: 380px;
            background: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            color: #1a1a1a;
            padding: 28px 24px;
            box-sizing: border-box;
        ">
            <!-- HEADER -->
            <div style="text-align:center;padding-bottom:18px;">
                <div style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">${this.esc(nombreNegocio)}</div>
                <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#888;margin-top:4px;">Comprobante de pago</div>
            </div>

            <div style="border-top:1.5px dashed #ddd;margin-bottom:14px;"></div>

            <!-- DATOS CLIENTE -->
            <div style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;">
                    <span style="color:#888;font-size:13px;">Nombre</span>
                    <span style="font-size:13px;font-weight:600;">${this.esc(cliente.nombre)}</span>
                </div>
                ${cliente.identificacion ? `
                <div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;">
                    <span style="color:#888;font-size:13px;">Cédula/RUC</span>
                    <span style="font-size:13px;font-weight:600;">${this.esc(cliente.identificacion)}</span>
                </div>` : ''}
            </div>

            <div style="border-top:1.5px dashed #ddd;margin-bottom:14px;"></div>

            <!-- MONTO COBRADO -->
            <div style="text-align:center;padding:14px;background:#eafaf1;border-radius:10px;margin-bottom:16px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#27ae60;margin-bottom:6px;">Monto cobrado</div>
                <div style="font-size:34px;font-weight:800;color:#1a1a1a;letter-spacing:-1px;">$${this.currency.format(montoTotal)}</div>
            </div>

            <!-- DETALLE DEL PAGO -->
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#888;margin-bottom:6px;">Detalle del pago</div>
            ${pagadosHtml}

            <!-- PENDIENTE POR COBRAR -->
            ${pendientesHtml}

            <!-- FOOTER -->
            <div style="margin-top:20px;padding-top:14px;border-top:1.5px dashed #ddd;text-align:center;">
                <div style="font-size:11px;color:#aaa;">Generado: ${fecha} ${hora}</div>
                <div style="font-size:11px;color:#aaa;margin-top:3px;">Este documento no es un comprobante fiscal</div>
            </div>
        </div>`;
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
