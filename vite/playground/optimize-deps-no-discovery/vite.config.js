import { defineConfig } from 'vite'

// 覆盖 Vitest 设定的 NODE_ENV，构造本场景所需的环境输入。
process.env.NODE_ENV = ''

export default defineConfig({
  define: {
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  optimizeDeps: {
    noDiscovery: true,
    include: ['@vitejs/test-dep-no-discovery'],
  },

  build: {
    // 禁用压缩，减少构建测试耗时。
    minify: false,
  },
})
