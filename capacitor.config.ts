import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId: 'com.mitienda.app',
  appId: 'ec.mitienda.app',
  appName: 'mi-tienda',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false
    }
  }
};

export default config;
