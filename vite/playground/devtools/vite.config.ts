// 此 DevTools 示例没有自动化用例，供手工检查。

import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  devtools: {
    enabled: false,
    port: 5173,
  },
})
