import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { ProductoPresentacion, Producto } from '../models/producto.model';
import { Subject } from 'rxjs';
import { ProductoChangeEvent } from './inventario.service';

@Injectable({ providedIn: 'root' })
export class PresentacionService {
    private supabase = inject(SupabaseService);
    private auth    = inject(AuthService);

    // Usa el mismo Subject que InventarioService para emitir cambios al grid.
    // Se inyecta desde fuera via setChangeEmitter() para evitar dependencia circular.
    private changeEmitter?: (event: ProductoChangeEvent) => void;

    setChangeEmitter(fn: (event: ProductoChangeEvent) => void): void {
        this.changeEmitter = fn;
    }

    async obtenerPresentaciones(productoId: string): Promise<ProductoPresentacion[]> {
        const { data } = await this.supabase.client
            .from('producto_presentaciones')
            .select('*')
            .eq('producto_id', productoId)
            .eq('activo', true)
            .order('factor_conversion');
        return data || [];
    }

    async obtenerPresentacionesInactivas(productoId: string): Promise<ProductoPresentacion[]> {
        const { data } = await this.supabase.client
            .from('producto_presentaciones')
            .select('*')
            .eq('producto_id', productoId)
            .eq('activo', false)
            .order('factor_conversion');
        return data || [];
    }

    async crearPresentacion(presentacion: Partial<ProductoPresentacion>, silencioso = false): Promise<ProductoPresentacion> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client
                .from('producto_presentaciones')
                .insert([{ ...presentacion, negocio_id: this.auth.usuarioActualValue?.negocio_id }])
                .select(),
            silencioso ? undefined : 'Presentación creada',
            silencioso ? undefined : { showLoading: true }
        );
        const creada = res ? res[0] : ({} as ProductoPresentacion);
        if (creada?.producto_id) await this.emitirCambioPorPresentacion(creada.producto_id);
        return creada;
    }

    async actualizarPresentacion(id: string, presentacion: Partial<ProductoPresentacion>): Promise<void> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').update(presentacion).eq('id', id).select(),
            'Presentación actualizada',
            { showLoading: true }
        );
        const productoId = res?.[0]?.producto_id;
        if (productoId) await this.emitirCambioPorPresentacion(productoId);
    }

    async desactivarPresentacion(id: string): Promise<void> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').update({ activo: false }).eq('id', id).select(),
            'Presentación quitada',
            { showLoading: true }
        );
        const productoId = res?.[0]?.producto_id;
        if (productoId) await this.emitirCambioPorPresentacion(productoId);
    }

    async reactivarPresentacion(id: string): Promise<void> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').update({ activo: true }).eq('id', id).select(),
            'Presentación reactivada',
            { showLoading: true }
        );
        const productoId = res?.[0]?.producto_id;
        if (productoId) await this.emitirCambioPorPresentacion(productoId);
    }

    private async emitirCambioPorPresentacion(productoId: string): Promise<void> {
        if (!this.changeEmitter) return;
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*), producto_template:producto_templates(id, nombre, categoria_id, tipo_venta, unidad_medida, imagen_url, activo), presentaciones:producto_presentaciones(id)')
            .eq('id', productoId)
            .eq('producto_presentaciones.activo', true)
            .maybeSingle();
        if (data) this.changeEmitter({ tipo: 'ACTUALIZADO', producto: data as Producto });
    }
}
