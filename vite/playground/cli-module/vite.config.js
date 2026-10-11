// eslint-disable-next-line n/prefer-node-protocol
import { URL } from 'url'
import { defineConfig } from 'vite'

// 使用无 node: 前缀的 url 导入，覆盖本地安装同名包时的配置打包场景。
globalThis.__test_url = URL

export default defineConfig({
  server: {
    host: 'localhost',
  },
  build: {
    // 此夹具只检查 CLI，关闭压缩以缩短构建。
    minify: false,
    target: 'esnext',
  },
})
