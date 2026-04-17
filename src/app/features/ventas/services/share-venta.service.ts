import { Injectable, inject } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Venta } from '../models/venta.model';
import { CurrencyService } from '../../../core/services/currency.service';
import { ConfigService } from '../../../core/services/config.service';
import { formatFechaHoraEC } from '../../../core/utils/date.util';

const TEMP_FILE = 'comprobante-venta.jpg';

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
        // Estimación proporcional al font actual para que el wrap sea fiel
        const sizeMatch = this.font.match(/(\d+)px/);
        const size = sizeMatch ? parseInt(sizeMatch[1]) : 13;
        // Factores empíricos por peso: bold ~0.65, normal ~0.55
        const isBold = this.font.includes('bold') || this.font.includes('800') || this.font.includes('700') || this.font.includes('600');
        const factor = isBold ? 0.62 : 0.52;
        return { width: text.length * size * factor } as TextMetrics;
    }
    scale() {}
}

@Injectable({ providedIn: 'root' })
export class ShareVentaService {

    private currency = inject(CurrencyService);
    private config   = inject(ConfigService);

    private readonly CANVAS_WIDTH = 400;
    private readonly PADDING = 28;
    private readonly CONTENT_WIDTH = this.CANVAS_WIDTH - (this.PADDING * 2);

    async compartirVenta(venta: Venta): Promise<void> {
        const nombreNegocio = await this.config.getNombreNegocio();

        // Pasada 1: medir altura real con NullCanvas
        const measuredY = this.renderVenta(new NullCanvas() as any, venta, nombreNegocio);
        const totalHeight = measuredY + 20; // margen inferior de seguridad

        // Pasada 2: dibujar en canvas real con la altura exacta
        const base64 = await this.drawToCanvas(totalHeight, (ctx) => {
            this.renderVenta(ctx, venta, nombreNegocio);
        });

        const label = this.getLabelTipo(venta.tipo_comprobante);
        const num   = venta.numero_comprobante ? ` #${venta.numero_comprobante}` : '';
        await this.saveAndShare(base64, `${label}${num}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER ÚNICO — corre en NullCanvas (medición) y en canvas real (dibujo)
    // Retorna el y final para que la primera pasada calcule la altura exacta.
    // ─────────────────────────────────────────────────────────────────────────

    private renderVenta(ctx: CanvasRenderingContext2D, venta: Venta, nombreNegocio: string): number {
        const esFactura       = venta.tipo_comprobante === 'FACTURA';
        const tieneClienteReal = !!venta.cliente_nombre && venta.cliente_nombre !== 'Consumidor Final';
        const mostrarCliente  = esFactura || tieneClienteReal;
        const esFiado         = venta.metodo_pago === 'FIADO';
        const esAnulada       = venta.estado === 'ANULADA';
        const totalAbonado    = venta.total_abonado ?? 0;
        const totalPendiente  = venta.total - totalAbonado;
        const estadoPago      = venta.estado_pago ?? 'NO_APLICA';
        const detalles        = venta.ventas_detalles ?? [];

        let y = 40;

        // ─── Banner anulada ──────────────────────────────────────────────────
        if (esAnulada) {
            ctx.fillStyle = '#fdecea';
            ctx.fillRect(this.PADDING, y - 14, this.CONTENT_WIDTH, 36);
            ctx.font = 'bold 13px Arial';
            ctx.fillStyle = '#c0392b';
            ctx.textAlign = 'center';
            ctx.fillText('VENTA ANULADA', this.CANVAS_WIDTH / 2, y + 8);
            y += 42;
        }

        // ─── Cabecera ────────────────────────────────────────────────────────
        this.drawCenteredText(ctx, nombreNegocio, y, '22px', '800');
        y += 26;

        const labelTipo = this.getLabelTipo(venta.tipo_comprobante);
        const numStr    = venta.numero_comprobante ? ` #${venta.numero_comprobante}` : '';
        this.drawCenteredText(ctx, `${labelTipo}${numStr}`, y, '14px', '600', '#444');
        y += 20;

        this.drawCenteredText(ctx, formatFechaHoraEC(venta.fecha), y, '12px', 'normal', '#888');
        y += 18;

        if (venta.empleado_nombre) {
            this.drawCenteredText(ctx, `Cajero: ${venta.empleado_nombre}`, y, '12px', 'normal', '#888');
            y += 18;
        }

        y += 8;
        y = this.drawDashedLine(ctx, y);
        y += 24;

        // ─── Cliente ─────────────────────────────────────────────────────────
        if (mostrarCliente) {
            ctx.font = 'bold 11px Arial';
            ctx.fillStyle = '#888';
            ctx.textAlign = 'left';
            ctx.fillText(esFactura ? 'DATOS DEL COMPRADOR' : 'CLIENTE', this.PADDING, y);
            y += 20;

            y = this.drawRow(ctx, 'Nombre', venta.cliente_nombre ?? 'Consumidor Final', y);
            if (esFactura && venta.cliente_identificacion) {
                y = this.drawRow(ctx, 'RUC / Cédula', venta.cliente_identificacion, y);
            }
            y += 6;
            y = this.drawDashedLine(ctx, y);
            y += 24;
        }

        // ─── Ítems ───────────────────────────────────────────────────────────
        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'left';
        ctx.fillText('DETALLE', this.PADDING, y);
        y += 18;

        ctx.font = 'bold 11px Arial';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'left';
        ctx.fillText('Descripción', this.PADDING, y);
        ctx.textAlign = 'right';
        ctx.fillText('Cant.', this.CANVAS_WIDTH - this.PADDING - 130, y);
        ctx.fillText('P.Unit.', this.CANVAS_WIDTH - this.PADDING - 68, y);
        ctx.fillText('Subtotal', this.CANVAS_WIDTH - this.PADDING, y);
        y += 10;
        y = this.drawLine(ctx, y, '#eee');
        y += 18;

        for (const item of detalles) {
            const nombre   = item.presentacion_nombre
                ? `${item.producto_nombre ?? '—'} (${item.presentacion_nombre})`
                : (item.producto_nombre ?? '—');
            const maxWidth = 160;
            const words    = nombre.split(' ');
            let line       = '';
            const lines: string[] = [];

            ctx.font = 'bold 13px Arial';
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
            ctx.fillStyle = '#1a1a1a';
            ctx.textAlign = 'left';
            for (const l of lines) {
                ctx.fillText(l.trim(), this.PADDING, itemY);
                itemY += 16;
            }

            ctx.textAlign = 'right';
            ctx.font = '13px Arial';
            ctx.fillStyle = '#1a1a1a';
            const cantLabel = item.unidad_medida && item.unidad_medida !== 'und'
                ? `${item.cantidad} ${item.unidad_medida}` : item.cantidad.toString();
            ctx.fillText(cantLabel, this.CANVAS_WIDTH - this.PADDING - 130, y);
            ctx.fillStyle = '#888';
            ctx.font = '12px Arial';
            ctx.fillText(`$${this.currency.format(item.precio_unitario)}`, this.CANVAS_WIDTH - this.PADDING - 68, y);
            ctx.fillStyle = '#1a1a1a';
            ctx.font = 'bold 13px Arial';
            ctx.fillText(`$${this.currency.format(item.subtotal)}`, this.CANVAS_WIDTH - this.PADDING, y);

            y = Math.max(itemY, y + 18) + 6;
        }

        y += 8;
        y = this.drawLine(ctx, y, '#bbb');
        y += 18;

        // ─── Totales ─────────────────────────────────────────────────────────
        if (esFactura) {
            if (venta.base_iva_0 > 0) {
                y = this.drawRow(ctx, 'Base 0%', `$${this.currency.format(venta.base_iva_0)}`, y, false, '#888', '12px');
            }
            if (venta.base_iva_15 > 0) {
                y = this.drawRow(ctx, 'Base 15%', `$${this.currency.format(venta.base_iva_15)}`, y, false, '#888', '12px');
            }
            if (venta.iva_valor > 0) {
                y = this.drawRow(ctx, 'IVA 15%', `$${this.currency.format(venta.iva_valor)}`, y, false, '#888', '12px');
            }
            y += 4;
            y = this.drawLine(ctx, y, '#eee');
            y += 12;
        }

        if (venta.descuento > 0) {
            y = this.drawRow(ctx, `Descuento (${venta.descuento_pct}%)`, `-$${this.currency.format(venta.descuento)}`, y, false, '#27ae60', '13px');
            y += 4;
            y = this.drawLine(ctx, y, '#eee');
            y += 12;
        }

        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = esAnulada ? '#aaa' : '#1a1a1a';
        ctx.textAlign = 'left';
        ctx.fillText('TOTAL', this.PADDING, y);
        ctx.textAlign = 'right';
        ctx.fillText(`$${this.currency.format(venta.total)}`, this.CANVAS_WIDTH - this.PADDING, y);
        y += 32;

        if (esFiado && !esAnulada && totalAbonado > 0) {
            y = this.drawLine(ctx, y - 12, '#eee');
            y += 16;
            y = this.drawRow(ctx, 'Abonado', `$${this.currency.format(totalAbonado)}`, y, false, '#27ae60', '13px');
            if (estadoPago === 'PAGADO') {
                y = this.drawRow(ctx, 'Estado', 'Deuda cancelada', y, true, '#27ae60', '13px');
            } else {
                y = this.drawRow(ctx, 'Pendiente', `$${this.currency.format(totalPendiente)}`, y, true, '#c0392b', '13px');
            }
        }

        y += 8;
        y = this.drawDashedLine(ctx, y);
        y += 20;

        // ─── Pie ─────────────────────────────────────────────────────────────
        this.drawCenteredText(ctx, this.getLabelMetodo(venta.metodo_pago), y, '13px', '600', '#444');
        y += 20;

        if (esFiado && !esAnulada && estadoPago !== 'PAGADO') {
            this.drawCenteredText(ctx, 'Pendiente de cobro', y, '12px', 'normal', '#c0392b');
            y += 18;
        }

        if (esAnulada) {
            this.drawCenteredText(ctx, 'Venta anulada \u2014 stock repuesto', y, '12px', 'normal', '#c0392b');
        } else {
            this.drawCenteredText(ctx, '\u00A1Gracias por su compra!', y, '13px', '600', '#27ae60');
        }
        y += 22;

        // ─── Footer ──────────────────────────────────────────────────────────
        y = this.drawFooter(ctx, y);

        return y;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS DE DIBUJO
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

    private drawFooter(ctx: CanvasRenderingContext2D, y: number): number {
        y = this.drawDashedLine(ctx, y);
        y += 24;
        const hoy = new Date();
        const d   = hoy.getDate().toString().padStart(2, '0');
        const m   = (hoy.getMonth() + 1).toString().padStart(2, '0');
        const h   = hoy.getHours().toString().padStart(2, '0');
        const min = hoy.getMinutes().toString().padStart(2, '0');
        this.drawCenteredText(ctx, `Generado: ${d}/${m}/${hoy.getFullYear()} ${h}:${min}`, y, '11px', 'normal', '#aaa');
        y += 18;
        this.drawCenteredText(ctx, 'Este documento no es un comprobante fiscal', y, '11px', 'normal', '#aaa');
        y += 18;
        return y;
    }

    private async drawToCanvas(height: number, drawFn: (ctx: CanvasRenderingContext2D) => void): Promise<string> {
        const canvas = document.createElement('canvas');
        const scale  = 2;
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
        await Filesystem.writeFile({
            path: TEMP_FILE,
            data: base64,
            directory: Directory.Cache,
        });

        const { uri } = await Filesystem.getUri({
            path: TEMP_FILE,
            directory: Directory.Cache,
        });

        // Cerrar loading ANTES de abrir el share sheet nativo.
        // Share.share() resuelve cuando el usuario vuelve a la app, no al compartir.
        await Share.share({ title: titulo, files: [uri], dialogTitle: titulo });
        Filesystem.deleteFile({ path: TEMP_FILE, directory: Directory.Cache }).catch(() => {});
    }

    private getLabelTipo(tipo: string): string {
        if (tipo === 'FACTURA')    return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota de Venta';
        return 'Ticket';
    }

    private getLabelMetodo(metodo: string): string {
        if (metodo === 'DEUNA')         return 'Tarjeta / DeUna';
        if (metodo === 'TRANSFERENCIA') return 'Transferencia';
        if (metodo === 'FIADO')         return 'Fiado';
        return 'Efectivo';
    }
}
