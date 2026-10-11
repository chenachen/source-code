import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // 此夹具检查文件名和 manifest，关闭压缩以缩短构建。
    minify: false,
    target: 'esnext',
    assetsInlineLimit: 0,
    manifest: true,
  },
})
