// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.


/**
 * IMPORTANTE - SEGURIDAD:
 * Las credenciales están hardcodeadas aquí por simplicidad de desarrollo.
 * En producción, considera usar:
 * - Variables de entorno con @ngx-env/builder
 * - Secrets management (AWS Secrets Manager, Azure Key Vault, etc.)
 * - Las credenciales reales están en .env (NO subir al repositorio)
 */

export const environment = {
  production: false,

  // Supabase Configuration
  supabaseUrl: 'https://ygubggmnxxgmfhtbifyo.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndWJnZ21ueHhnbWZodGJpZnlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwODQ3NDMsImV4cCI6MjA4NDY2MDc0M30.ZBAVG8esfigDXNY9a829h90XQCvcuu7sAM161vC6hJ0'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
