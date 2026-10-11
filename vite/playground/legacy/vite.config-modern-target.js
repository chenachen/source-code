import path from 'node:path'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

export default defineConfig(({ isPreview }) => ({
  input: {
    index: path.resolve(import.meta.dirname, 'modern-target.html'),
  },
  base: !isPreview ? './' : '/modern-target/',
  plugins: [
    legacy({
      modernPolyfills: ['es.array.at'],
      // Chrome 64 不支持可选 catch 参数，现代输出仍需按该目标降级。
      modernTargets: ['chrome >= 64'],
      renderLegacyChunks: false,
    }),
  ],
  build: {
    outDir: 'dist/modern-target',
  },
}))
