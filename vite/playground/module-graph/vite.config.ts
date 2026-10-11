import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

export default defineConfig({
  plugins: [slowModulePlugin()],
})

/** 创建慢速虚拟依赖，让并行 import 分析的完成顺序不同于源码顺序。 */
function slowModulePlugin(): Plugin {
  return {
    name: 'slow-module',
    /** 把公开虚拟导入映射为零字节内部 ID，交由本插件 load。 */
    resolveId(id) {
      if (id === 'virtual:slow-module') {
        return '\0virtual:slow-module'
      }
    },
    /** 对内部虚拟模块等待半秒后返回成功消息；module graph 仍须按原 import 顺序记录依赖。 */
    async load(id) {
      if (id === '\0virtual:slow-module') {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return `export const msg = '[success]'`
      }
    },
  }
}
