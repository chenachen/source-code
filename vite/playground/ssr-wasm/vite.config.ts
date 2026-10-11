import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    // 用 80 字节阈值区分轻、重 Wasm 的内联与文件产出路径。
    assetsInlineLimit: 80,
    ssr: './src/app.js',
    ssrEmitAssets: true,
  },
})
