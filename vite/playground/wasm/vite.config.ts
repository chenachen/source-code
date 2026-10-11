import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    // 80 字节阈值使 light.wasm 内联、add.wasm 输出为外部资产，覆盖两条初始化 URL 路径。
    assetsInlineLimit: 80,
  },
})
