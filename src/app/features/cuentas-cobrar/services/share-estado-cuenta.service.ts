import { Injectable, inject } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Cliente } from '../../clientes/models/cliente.model';
import { VentaFiada, VentaFiadaItem } from '../models/cuenta-cobrar.model';
import { CurrencyService } from '../../../core/services/currency.service';
import { ConfigService } from '../../../core/services/config.service';
import { formatFechaEC } from '../../../core/utils/date.util';

const TEMP_FILE = 'estado-cuenta.jpg';

export interface ComprobantePagoItem {
    tipoComprobante: string;
    numeroComprobante: string | null;
    pago: number;
    completa: boolean;
    saldoVenta: number;
}

// Canvas nulo: acepta todas las llamadas pero no dibuja nada.
// Úsalo en la primera pasada para medir el y final sin crear una imagen real.
class NullCanvas {
    font = '';
    fillStyle = '';
    strokeStyle = '';
    textAlign: CanvasTextAlign = 'left';
    lineWidth = 1;

    fillRect() {}
    fillText() {}
    strokeRect() {}
    beginPath() {}
    moveTo() {}
    lineTo() {}
    stroke() {}
    setLineDash() {}
    measureText(text: string): TextMetrics {
        const sizeMatch = this.font.match(/(\d+)px/);
        const size = sizeMatch ? parseInt(sizeMatch[1]) : 13;
        const isBold = this.font.includes('bold') || /[6-9]00/.test(this.font);
        const factor = isBold ? 0.62 : 0.52;
        return { width: text.length * size * factor } as TextMetrics;
    }
    scale() {}
}

@Injectable({ providedIn: 'root' })
export class ShareEstadoCuentaService {

    private currency = inject(CurrencyService);
    private config   = inject(ConfigService);

    private readonly CANVAS_WIDTH = 400;
    private readonly PADDING = 28;
    private readonly CONTENT_WIDTH = this.CANVAS_WIDTH - (this.PADDING * 2);

    // ─────────────────────────────────────────────────────────────────────────
    // ESTADO DE CUENTA
    // ─────────────────────────────────────────────────────────────────────────

    async compartirEstadoCuenta(
        cliente: Cliente,
        ventas: VentaFiada[],
        itemsPorVenta: Map<string, VentaFiadaItem[]>
    ): Promise<void> {
        const nombreNegocio = await this.config.getNombreNegocio();

        // Pasada 1: medir altura real
        const measuredY = this.renderEstadoCuenta(new NullCanvas() as any, nombreNegocio, cliente, ventas, itemsPorVenta);
        const totalHeight = measuredY + 20;

        // Pasada 2: dibujar con altura exacta
        const base64 = await this.drawToCanvas(totalHeight, (ctx) => {
            this.renderEstadoCuenta(ctx, nombreNegocio, cliente, ventas, itemsPorVenta);
        });

        await this.saveAndShare(base64, `Estado de cuenta — ${cliente.nombre}`);
    }

    private renderEstadoCuenta(
        ctx: CanvasRenderingContext2D,
        nombreNegocio: string,
        cliente: Cliente,
        ventas: VentaFiada[],
        itemsPorVenta: Map<string, VentaFiadaItem[]>
    ): number {
        let y = 90;

        this.drawCenteredText(ctx, nombreNegocio, y, '22px', '800');
        y += 24;
        this.drawCenteredText(ctx, 'ESTADO DE CUENTA', y, '12px', '600', '#888');
        y += 24;
        y = this.drawDashedLine(ctx, y);
        y += 24;

        y = this.drawRow(ctx, 'Nombre', cliente.nombre, y, true);
        if (cliente.identificacion) {
            y = this.drawRow(ctx, 'Cédula/RUC', cliente.identificacion, y, true);
        }
        y += 10;
        y = this.drawDashedLine(ctx, y);
        y += 35;

        for (const v of ventas) {
            const label  = this.getLabelTipo(v.tipo_comprobante);
            const numero = v.numero_comprobante ? ` #${v.numero_comprobante}` : '';
            const fecha  = formatFechaEC(v.fecha);

            ctx.font = 'bold 15px Arial';
            ctx.fillStyle = '#1a1a1a';
            ctx.textAlign = 'left';
            ctx.fillText(`${label}${numero}`, this.PADDING, y);
            ctx.font = '12px Arial';
            ctx.textAlign = 'right';
            ctx.fillStyle = '#888';
            ctx.fillText(fecha, this.CANVAS_WIDTH - this.PADDING, y);
            y += 25;

            const items = itemsPorVenta.get(v.id) ?? [];
            if (items.length > 0) {
                y = this.drawItemsTable(ctx, items, y);
            } else {
                ctx.font = 'italic 12px Arial';
                ctx.textAlign = 'left';
                ctx.fillText('Sin detalle disponible', this.PADDING, y);
                y += 20;
            }

            y += 10;
            y = this.drawLine(ctx, y, '#ccc');
            y += 18;

            const esFactura = v.tipo_comprobante === 'FACTURA';
            if (esFactura && (v.base_iva_0 > 0 || v.base_iva_15 > 0 || v.iva_valor > 0)) {
                if (v.base_iva_0 > 0)  y = this.drawRow(ctx, 'Base 0%',  `$${this.currency.format(v.base_iva_0)}`,  y, false, '#888', '12px');
                if (v.base_iva_15 > 0) y = this.drawRow(ctx, 'Base 15%', `$${this.currency.format(v.base_iva_15)}`, y, false, '#888', '12px');
                if (v.iva_valor > 0)   y = this.drawRow(ctx, 'IVA 15%',  `$${this.currency.format(v.iva_valor)}`,   y, false, '#888', '12px');
                y += 5;
                y = this.drawLine(ctx, y, '#ccc');
                y += 15;
            }

            if (v.descuento > 0) {
                y = this.drawRow(ctx, 'Subtotal', `$${this.currency.format(v.subtotal)}`, y);
                y = this.drawRow(ctx, `Descuento (${v.descuento_pct}%)`, `-$${this.currency.format(v.descuento)}`, y, false, '#27ae60');
            }
            y = this.drawRow(ctx, 'Total venta', `$${this.currency.format(v.total)}`, y);
            if (v.monto_pagado > 0) {
                y = this.drawRow(ctx, 'Abonado', `-$${this.currency.format(v.monto_pagado)}`, y, false, '#27ae60');
            }
            y = this.drawRow(ctx, 'Pendiente', `$${this.currency.format(v.saldo_pendiente)}`, y, true, '#c0392b', '17px');

            y += 15;
            y = this.drawDashedLine(ctx, y);
            y += 30;
        }

        if (ventas.length > 1) {
            const totalPendiente = ventas.reduce((s, v) => s + v.saldo_pendiente, 0);
            y = this.drawRow(ctx, 'TOTAL PENDIENTE', `$${this.currency.format(totalPendiente)}`, y, true, '#c0392b', '20px');
            y += 20;
        }

        y = this.drawFooter(ctx, y);
        return y;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMPROBANTE DE PAGO
    // ─────────────────────────────────────────────────────────────────────────

    async compartirComprobantePago(
        cliente: Cliente,
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number,
        ventasPendientes: VentaFiada[]
    ): Promise<void> {
        const nombreNegocio = await this.config.getNombreNegocio();

        // Pasada 1: medir altura real
        const measuredY = this.renderComprobantePago(new NullCanvas() as any, nombreNegocio, cliente, items, montoTotal, saldoRestante, ventasPendientes);
        const totalHeight = measuredY + 20;

        // Pasada 2: dibujar con altura exacta
        const base64 = await this.drawToCanvas(totalHeight, (ctx) => {
            this.renderComprobantePago(ctx, nombreNegocio, cliente, items, montoTotal, saldoRestante, ventasPendientes);
        });

        await this.saveAndShare(base64, `Comprobante de pago — ${cliente.nombre}`);
    }

    private renderComprobantePago(
        ctx: CanvasRenderingContext2D,
        nombreNegocio: string,
        cliente: Cliente,
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number,
        ventasPendientes: VentaFiada[]
    ): number {
        let y = 40;

        this.drawCenteredText(ctx, nombreNegocio, y, '22px', '800');
        y += 24;
        this.drawCenteredText(ctx, 'COMPROBANTE DE PAGO', y, '12px', '600', '#888');
        y += 24;
        y = this.drawDashedLine(ctx, y);
        y += 24;

        y = this.drawRow(ctx, 'Nombre', cliente.nombre, y, true);
        if (cliente.identificacion) {
            y = this.drawRow(ctx, 'Cédula/RUC', cliente.identificacion, y, true);
        }
        y += 10;
        y = this.drawDashedLine(ctx, y);
        y += 35;

        // Bloque destacado de monto cobrado
        ctx.fillStyle = '#eafaf1';
        ctx.fillRect(this.PADDING, y - 20, this.CONTENT_WIDTH, 80);
        y += 15;
        this.drawCenteredText(ctx, 'MONTO COBRADO', y, '11px', '700', '#27ae60');
        y += 38;
        this.drawCenteredText(ctx, `$${this.currency.format(montoTotal)}`, y, '38px', '800', '#1a1a1a');
        y += 55;

        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'left';
        ctx.fillText('DETALLE DEL PAGO', this.PADDING, y);
        y += 18;

        for (const item of items) {
            const label  = this.getLabelTipo(item.tipoComprobante);
            const numero = item.numeroComprobante ? ` #${item.numeroComprobante}` : '';

            ctx.font = 'bold 13px Arial';
            ctx.fillStyle = '#1a1a1a';
            ctx.textAlign = 'left';
            ctx.fillText(`${label}${numero}`, this.PADDING, y);

            const badgeTxt   = item.completa ? 'SALDADO' : 'ABONO PARCIAL';
            const badgeColor = item.completa ? '#27ae60' : '#e67e22';
            ctx.font = 'bold 10px Arial';
            const badgeW = ctx.measureText(badgeTxt).width + 12;
            ctx.strokeStyle = badgeColor;
            ctx.strokeRect(this.CANVAS_WIDTH - this.PADDING - badgeW, y - 12, badgeW, 18);
            ctx.fillStyle = badgeColor;
            ctx.textAlign = 'center';
            ctx.fillText(badgeTxt, this.CANVAS_WIDTH - this.PADDING - (badgeW / 2), y + 1);

            const yMonto = y;
            y += 22;
            if (!item.completa) {
                ctx.font = '12px Arial';
                ctx.fillStyle = '#888';
                ctx.textAlign = 'left';
                ctx.fillText('Queda pendiente: ', this.PADDING, y);
                ctx.fillStyle = '#c0392b';
                ctx.font = 'bold 12px Arial';
                ctx.fillText(`$${this.currency.format(item.saldoVenta)}`, this.PADDING + 105, y);
                y += 18;
            }

            ctx.font = 'bold 16px Arial';
            ctx.fillStyle = '#1a1a1a';
            ctx.textAlign = 'right';
            ctx.fillText(`$${this.currency.format(item.pago)}`, this.CANVAS_WIDTH - this.PADDING, yMonto);

            y += 12;
            y = this.drawLine(ctx, y, '#f0f0f0');
            y += 25;
        }

        if (ventasPendientes.length > 0) {
            y += 10;
            y = this.drawDashedLine(ctx, y);
            y += 25;
            ctx.font = 'bold 11px Arial';
            ctx.fillStyle = '#888';
            ctx.textAlign = 'left';
            ctx.fillText('RESTANTE POR COBRAR', this.PADDING, y);
            y += 22;

            for (const v of ventasPendientes) {
                y = this.drawRow(ctx, `${this.getLabelTipo(v.tipo_comprobante)}${v.numero_comprobante ? ' #' + v.numero_comprobante : ''}`, `$${this.currency.format(v.saldo_pendiente)}`, y, true, '#c0392b');
                y = this.drawLine(ctx, y, '#f0f0f0');
                y += 20;
            }
            y += 10;
            y = this.drawRow(ctx, 'Total pendiente', `$${this.currency.format(saldoRestante)}`, y, true, '#c0392b', '19px');
        } else {
            y += 15;
            y = this.drawDashedLine(ctx, y);
            y += 35;
            this.drawCenteredText(ctx, '\u00A1Deuda saldada completamente!', y, '15px', '700', '#27ae60');
            y += 24;
        }

        y += 35;
        y = this.drawFooter(ctx, y, true);
        return y;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS DE DIBUJO (PRIVATE)
    // ─────────────────────────────────────────────────────────────────────────

    private drawCenteredText(ctx: CanvasRenderingContext2D, text: string, y: number, size: string, weight: string, color = '#1a1a1a') {
        ctx.font = `${weight} ${size} Arial, Helvetica, sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(text, this.CANVAS_WIDTH / 2, y);
    }

    private drawRow(ctx: CanvasRenderingContext2D, label: string, value: string, y: number, bold = false, color = '#1a1a1a', size = '13px'): number {
        ctx.font = `${bold ? 'bold' : 'normal'} ${size} Arial, Helvetica, sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(label, this.PADDING, y);
        ctx.textAlign = 'right';
        ctx.fillText(value, this.CANVAS_WIDTH - this.PADDING, y);
        return y + 24;
    }

    private drawItemsTable(ctx: CanvasRenderingContext2D, items: VentaFiadaItem[], y: number): number {
        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'left';
        ctx.fillText('Descripción', this.PADDING, y);
        ctx.textAlign = 'right';
        ctx.fillText('Cant.',    this.CANVAS_WIDTH - this.PADDING - 130, y);
        ctx.fillText('P.Unit.',  this.CANVAS_WIDTH - this.PADDING - 70,  y);
        ctx.fillText('Subtotal', this.CANVAS_WIDTH - this.PADDING,       y);
        y += 10;
        y = this.drawLine(ctx, y, '#eee');
        y += 18;

        for (const item of items) {
            ctx.font = 'bold 13px Arial';
            ctx.fillStyle = '#1a1a1a';
            ctx.textAlign = 'left';

            const maxWidth = 160;
            const words = item.producto_nombre.split(' ');
            let line = '';
            const lines: string[] = [];
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                if (ctx.measureText(testLine).width > maxWidth && n > 0) {
                    lines.push(line);
                    line = words[n] + ' ';
                } else {
                    line = testLine;
                }
            }
            lines.push(line);

            let itemY = y;
            for (const l of lines) {
                ctx.fillText(l.trim(), this.PADDING, itemY);
                itemY += 16;
            }

            ctx.textAlign = 'right';
            ctx.font = '13px Arial';
            ctx.fillText(item.cantidad.toString(), this.CANVAS_WIDTH - this.PADDING - 130, y);
            ctx.fillStyle = '#888';
            ctx.font = '12px Arial';
            ctx.fillText(`$${this.currency.format(item.precio_unitario)}`, this.CANVAS_WIDTH - this.PADDING - 70, y);
            ctx.fillStyle = '#1a1a1a';
            ctx.font = 'bold 13px Arial';
            ctx.fillText(`$${this.currency.format(item.subtotal)}`, this.CANVAS_WIDTH - this.PADDING, y);

            y = Math.max(itemY, y + 18) + 4;
        }
        return y;
    }

    private drawDashedLine(ctx: CanvasRenderingContext2D, y: number): number {
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1.5;
        ctx.moveTo(this.PADDING, y);
        ctx.lineTo(this.CANVAS_WIDTH - this.PADDING, y);
        ctx.stroke();
        ctx.setLineDash([]);
        return y + 1;
    }

    private drawLine(ctx: CanvasRenderingContext2D, y: number, color: string): number {
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.moveTo(this.PADDING, y);
        ctx.lineTo(this.CANVAS_WIDTH - this.PADDING, y);
        ctx.stroke();
        return y + 1;
    }

    private drawFooter(ctx: CanvasRenderingContext2D, y: number, incluirHora = false): number {
        y = this.drawDashedLine(ctx, y);
        y += 24;
        const hoy      = new Date();
        const fechaStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
        const horaStr  = incluirHora ? ` ${hoy.getHours().toString().padStart(2, '0')}:${hoy.getMinutes().toString().padStart(2, '0')}` : '';
        this.drawCenteredText(ctx, `Generado: ${fechaStr}${horaStr}`, y, '11px', '400', '#aaa');
        y += 18;
        this.drawCenteredText(ctx, 'Este documento no es un comprobante fiscal', y, '11px', '400', '#aaa');
        y += 18;
        return y;
    }

    private async drawToCanvas(height: number, drawFn: (ctx: CanvasRenderingContext2D) => void): Promise<string> {
        const canvas  = document.createElement('canvas');
        const scale   = 2;
        canvas.width  = this.CANVAS_WIDTH * scale;
        canvas.height = height * scale;

        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, this.CANVAS_WIDTH, height);

        drawFn(ctx);

        return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    }

    private async saveAndShare(base64: string, titulo: string): Promise<void> {
        await Filesystem.writeFile({ path: TEMP_FILE, data: base64, directory: Directory.Cache });
        const { uri } = await Filesystem.getUri({ path: TEMP_FILE, directory: Directory.Cache });
        await Share.share({ title: titulo, files: [uri], dialogTitle: titulo });
        Filesystem.deleteFile({ path: TEMP_FILE, directory: Directory.Cache }).catch(() => {});
    }

    private getLabelTipo(tipo: string): string {
        return tipo === 'FACTURA' ? 'Factura' : tipo === 'NOTA_VENTA' ? 'Nota de Venta' : 'Ticket';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FALLBACK WHATSAPP (TEXTO PLANO)
    // ─────────────────────────────────────────────────────────────────────────

    enviarResumenWhatsApp(cliente: Cliente, ventas: VentaFiada[], nombreNegocio: string): void {
        const totalPendiente = ventas.reduce((s, v) => s + v.saldo_pendiente, 0);
        const lineas: string[] = [`\uD83D\uDCC4 *ESTADO DE CUENTA*`, nombreNegocio, ``, `\uD83D\uDC64 *${cliente.nombre}*`, `------------------------`];

        for (const v of ventas) {
            lineas.push(``, `\uD83D\uDD39 *${this.getLabelTipo(v.tipo_comprobante)}${v.numero_comprobante ? ' #' + v.numero_comprobante : ''}*`);
            lineas.push(`   Fecha: ${formatFechaEC(v.fecha)}`, `   Total: $${this.currency.format(v.total)}`);
            if (v.monto_pagado > 0) lineas.push(`   \u2705 Abonado: $${this.currency.format(v.monto_pagado)}`);
            lineas.push(`   \uD83D\uDD34 *Pendiente: $${this.currency.format(v.saldo_pendiente)}*`);
        }

        if (ventas.length > 1) {
            lineas.push(``, `------------------------`, `\uD83D\uDD34 *TOTAL PENDIENTE: $${this.currency.format(totalPendiente)}*`);
        }
        this.openWhatsApp(cliente.telefono, lineas.join('\n'));
    }

    enviarComprobanteWhatsApp(cliente: Cliente, items: ComprobantePagoItem[], montoTotal: number, saldoRestante: number, ventasPendientes: VentaFiada[], nombreNegocio: string): void {
        const lineas: string[] = [`\u2705 *COMPROBANTE DE PAGO*`, nombreNegocio, ``, `\uD83D\uDC64 *${cliente.nombre}*`, `------------------------`, ``, `\uD83D\uDCB0 *Monto: $${this.currency.format(montoTotal)}*`, ``, `\uD83D\uDCC4 *Detalle:*`];

        for (const item of items) {
            lineas.push(`\uD83D\uDD39 ${this.getLabelTipo(item.tipoComprobante)}${item.numeroComprobante ? ' #' + item.numeroComprobante : ''}`);
            lineas.push(`   Pago: *$${this.currency.format(item.pago)}*`, `   ${item.completa ? '\u2705 Saldado' : '\u231B Abono'}`);
            if (!item.completa) lineas.push(`   Pendiente: *$${this.currency.format(item.saldoVenta)}*`);
            lineas.push(``);
        }

        if (ventasPendientes.length > 0) {
            lineas.push(`------------------------`, `\uD83D\uDCCC *Pendientes:*`);
            for (const v of ventasPendientes) lineas.push(`\uD83D\uDD38 ${this.getLabelTipo(v.tipo_comprobante)}${v.numero_comprobante ? ' #' + v.numero_comprobante : ''}: *$${this.currency.format(v.saldo_pendiente)}*`);
            lineas.push(``, `\uD83D\uDD34 *TOTAL: $${this.currency.format(saldoRestante)}*`);
        }
        this.openWhatsApp(cliente.telefono, lineas.join('\n'));
    }

    private openWhatsApp(tel: string | null | undefined, text: string) {
        let telefono = (tel ?? '').replace(/\D/g, '');
        if (telefono.startsWith('0')) telefono = '593' + telefono.slice(1);
        const url = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    }
}
