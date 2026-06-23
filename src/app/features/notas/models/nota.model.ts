export interface Nota {
    id: string;
    texto: string;
    completada: boolean;
    creada_por: string | null;
    creada_por_nombre: string | null;
    completada_por: string | null;
    completada_por_nombre: string | null;
    completada_at: string | null;
    created_at: string;
}
