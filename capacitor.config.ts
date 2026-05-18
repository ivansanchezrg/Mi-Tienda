import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId: 'com.mitienda.app',
  appId: 'ec.mitienda.app',
  appName: 'NexoPOS',
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
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0052CC'
    }
  }
};

export default config;
