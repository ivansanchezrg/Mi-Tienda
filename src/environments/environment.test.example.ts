// Plantilla para el entorno de TEST. Copia este archivo como environment.test.ts
// y completa con las credenciales reales del proyecto Supabase de test.
// NO subas environment.test.ts al repositorio (está en .gitignore).
//
// Cómo obtener las credenciales:
//   1. Ingresa a https://supabase.com/dashboard
//   2. Selecciona el proyecto "mi tienda test"
//   3. Ve a Settings → API Keys
//   4. Copia "Project URL" y "anon public"

export const environment = {
  production: false,
  test: true,

  supabaseUrl: 'https://TU_PROYECTO_TEST.supabase.co',
  supabaseKey: 'TU_ANON_KEY_TEST_AQUI'
};
