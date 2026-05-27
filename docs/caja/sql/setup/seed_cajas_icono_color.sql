-- Actualiza icono y color de las cajas base según su rol visual en el home.
-- Ejecutar una sola vez por negocio (o aplicar a todos via UPDATE sin filtro de negocio
-- si se hace desde el panel de Supabase con el superadmin).
--
-- Colores elegidos para coincidir con el diseño original de la app:
--   CAJA        → primary   (#1ba74a  — verde principal)
--   CAJA_CHICA  → success   (#2dd36f  — verde claro)
--   VARIOS      → tertiary  (#7044ff  — violeta)
--   CAJA_CELULAR → secondary (#3dc2ff  — azul)
--   CAJA_BUS    → warning   (#ffc409  — amarillo)
--
-- Nota: los hex pueden variar según el tema del proyecto.
-- Verificar en src/theme/variables.scss o en el inspector de Ionic.

UPDATE cajas SET icono = 'cash-outline',          color = '#1ba74a' WHERE codigo = 'CAJA';
UPDATE cajas SET icono = 'file-tray-outline',      color = '#2dd36f' WHERE codigo = 'CAJA_CHICA';
UPDATE cajas SET icono = 'archive-outline',        color = '#7044ff' WHERE codigo = 'VARIOS';
UPDATE cajas SET icono = 'phone-portrait-outline', color = '#3dc2ff' WHERE codigo = 'CAJA_CELULAR';
UPDATE cajas SET icono = 'bus-outline',            color = '#ffc409' WHERE codigo = 'CAJA_BUS';
