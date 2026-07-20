import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Nota } from '../models/nota.model';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';

const SELECT_NOTA = `
  id, texto, completada, creada_por, completada_por, completada_at, created_at,
  creada_por_usuario:usuarios!notas_creada_por_fkey(nombre),
  completada_por_usuario:usuarios!notas_completada_por_fkey(nombre)
`.trim();

function mapNota(raw: any): Nota {
    return {
        id: raw.id,
        texto: raw.texto,
        completada: raw.completada,
        creada_por: raw.creada_por,
        creada_por_nombre: raw.creada_por_usuario?.nombre ?? null,
        completada_por: raw.completada_por,
        completada_por_nombre: raw.completada_por_usuario?.nombre ?? null,
        completada_at: raw.completada_at,
        created_at: raw.created_at,
    };
}

@Injectable({ providedIn: 'root' })
export class NotasService {
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);

    readonly notaCreada$ = new Subject<Nota>();

    async listar(page: number): Promise<Nota[]> {
        const pageSize = PAGINATION_CONFIG.notas.pageSize;
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const raw = await this.supabase.call<any[]>(
            this.supabase.client.from('notas')
                .select(SELECT_NOTA)
                .order('completada', { ascending: true })
                .order('created_at', { ascending: false })
                .range(from, to)
        );

        return (raw ?? []).map(mapNota);
    }

    async crear(texto: string, creadaPor: string): Promise<Nota | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client.from('notas')
                .insert({ texto, creada_por: creadaPor, negocio_id: this.auth.usuarioActualValue?.negocio_id })
                .select(SELECT_NOTA)
                .single(),
            'Nota creada'
        );
        const nota = raw ? mapNota(raw) : null;
        if (nota) this.notaCreada$.next(nota);
        return nota;
    }

    async marcarCompletada(id: string, completadaPor: string): Promise<Nota | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client.from('notas')
                .update({
                    completada: true,
                    completada_por: completadaPor,
                    completada_at: new Date().toISOString()
                })
                .eq('id', id)
                .select(SELECT_NOTA)
                .single()
        );
        return raw ? mapNota(raw) : null;
    }

    async reactivar(id: string): Promise<Nota | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client.from('notas')
                .update({ completada: false, completada_por: null, completada_at: null })
                .eq('id', id)
                .select(SELECT_NOTA)
                .single()
        );
        return raw ? mapNota(raw) : null;
    }

    /** Cualquier usuario puede editar cualquier nota — sin restricción de creador. */
    async editar(id: string, texto: string): Promise<Nota | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client.from('notas')
                .update({ texto })
                .eq('id', id)
                .select(SELECT_NOTA)
                .single()
        );
        return raw ? mapNota(raw) : null;
    }

    /**
     * No pasa por supabase.call() a propósito: call() ya muestra su propio toast de
     * error, y la página necesita controlar el feedback ella misma (overlay de error,
     * no toast — es destructiva e irreversible, el usuario ya la confirmó en un Alert
     * antes de llegar aquí). En éxito no hay ningún aviso: la nota desaparece de la
     * lista ante sus ojos, feedback visual directo. Ver design_toast_vs_overlay_feedback.md.
     */
    async eliminar(id: string): Promise<{ ok: true } | { ok: false; sinConexion: boolean; mensaje?: string }> {
        const { error } = await this.supabase.client.from('notas').delete().eq('id', id);
        if (!error) return { ok: true };
        return { ok: false, sinConexion: this.supabase.esErrorDeTransporte(error), mensaje: error.message };
    }
}
