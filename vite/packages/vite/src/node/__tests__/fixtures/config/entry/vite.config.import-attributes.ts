// 导入外部包的 JSON，避免配置打包器将其内联，保留 import attributes 的加载路径。
import pkg from 'vite/package.json' with { type: 'json' }

export default {
  jsonValue: pkg.name,
}
