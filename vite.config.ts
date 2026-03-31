import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        domChat: resolve(__dirname, 'src/content/dom-chat.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        log: resolve(__dirname, 'src/log/log.html'),
        onboarding: resolve(__dirname, 'src/onboarding/onboarding.html'),
        stats: resolve(__dirname, 'src/stats/stats.html'),
        speakerSelection: resolve(__dirname, 'src/speaker-selection/speaker-selection.html'),
        speakerConfig: resolve(__dirname, 'src/speaker-config/speaker-config.html'),
        testSpeak: resolve(__dirname, 'src/test-speak/test-speak.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
