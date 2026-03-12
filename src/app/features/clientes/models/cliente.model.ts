export interface Cliente {
    id: string;
    identificacion: string | null;
    nombre: string;
    telefono: string | null;
    email: string | null;
    es_consumidor_final: boolean;
    created_at?: string;
}
