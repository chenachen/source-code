import { defineConfig } from 'vite'

/** 让 require-external-cjs 父包进入 Vite SSR 转换和依赖优化；被它 require 的 external-cjs 另显式 external，以验证嵌套边界。 */
const noExternal = ['@vitejs/test-require-external-cjs']
export default defineConfig({
  ssr: {
    noExternal,
    external: ['@vitejs/test-external-cjs'],
    optimizeDeps: {
      include: noExternal,
    },
  },
  build: {
    target: 'esnext',
    minify: false,
    rolldownOptions: {
      external: ['@vitejs/test-external-cjs'],
    },
  },
})
