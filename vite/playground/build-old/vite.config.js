import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // 用 Chrome 60 目标验证动态导入兼容转换。
    target: ['chrome60'],
  },
})
