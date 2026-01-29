/**
 * PRODUCCIÓN - CONFIGURACIÓN
 *
 * CRÍTICO - SEGURIDAD:
 * Antes de desplegar a producción:
 * 1. Usa variables de entorno del servidor/hosting
 * 2. Nunca subas este archivo con credenciales reales al repositorio
 * 3. Considera usar secrets management
 * 4. Habilita Row Level Security (RLS) en Supabase
 * 5. Configura Google OAuth en Supabase Dashboard
 * 6. Configura dominios autorizados en Supabase
 */

export const environment = {
  production: true,

  // Supabase Configuration
  supabaseUrl: 'https://ygubggmnxxgmfhtbifyo.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndWJnZ21ueHhnbWZodGJpZnlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwODQ3NDMsImV4cCI6MjA4NDY2MDc0M30.ZBAVG8esfigDXNY9a829h90XQCvcuu7sAM161vC6hJ0'
};