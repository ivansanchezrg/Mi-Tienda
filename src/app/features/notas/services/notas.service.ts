import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseService } from '../../../core/services/supabase.service';
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

    async crear(texto: string, creadaPor: number): Promise<Nota | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client.from('notas')
                .insert({ texto, creada_por: creadaPor })
                .select(SELECT_NOTA)
                .single(),
            'Nota creada'
        );
        const nota = raw ? mapNota(raw) : null;
        if (nota) this.notaCreada$.next(nota);
        return nota;
    }

    async marcarCompletada(id: string, completadaPor: number): Promise<Nota | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client.from('notas')
                .update({
                    completada: true,
                    completada_por: completadaPor,
                    completada_at: 'now()'
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

    async eliminar(id: string): Promise<boolean> {
        const result = await this.supabase.call(
            this.supabase.client.rpc('fn_eliminar_nota', { p_nota_id: id }),
            'Nota eliminada'
        );
        return result !== null;
    }
}
