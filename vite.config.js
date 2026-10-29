import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { imageryProxyPlugin } from './server/imageryProxy.js'
import { accessibilityPlugin } from './server/accessibility.js'
import { weatherPlugin } from './server/weather.js'

export default defineConfig({
  plugins: [vue(),imageryProxyPlugin(),accessibilityPlugin(),weatherPlugin()],
  worker: { format: 'es' },
  optimizeDeps: {
    entries: ['index.html']
  },

  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/tmp/**', '**/public/data/demo/**']
    }
  }
})
