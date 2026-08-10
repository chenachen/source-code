import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: 'localhost',
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  build: {
    // 此用例只验证 CLI 构建与预览链路，不测试压缩和语法降级；关闭它们可缩短 E2E。
    minify: false,
    target: 'esnext',
  },
})
