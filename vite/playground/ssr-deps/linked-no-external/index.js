/** 读取 import.meta.env.DEV 返回 development 或 production；该链接依赖需要经过 Vite 转换才能提供这项环境替换。 */
export const hello = function () {
  // 链接包需要经过 Vite 转换，才能替换 import.meta.env；TypeScript 处理也依赖这条路径。
  return `Hello World from ${
    import.meta.env.DEV ? 'development' : 'production'
  }!`
}
