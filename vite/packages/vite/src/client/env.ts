/** define 插件在构建时替换的键值表；本文件运行时只负责写入目标 global。 */
declare const __DEFINES__: Record<string, any>

/**
 * 选择当前 JavaScript realm 的全局对象，兼容浏览器、Web Worker 与非标准宿主；
 * Function fallback 仅用于没有 globalThis/self/window 的旧环境。
 */
const context = (() => {
  if (typeof globalThis !== 'undefined') {
    return globalThis
  } else if (typeof self !== 'undefined') {
    return self
  } else if (typeof window !== 'undefined') {
    return window
  } else {
    return Function('return this')()
  }
})()

// 按 `process.env.NODE_ENV` 之类的点路径逐层创建对象，并把 define 值写到叶子节点。
const defines = __DEFINES__
Object.keys(defines).forEach((key) => {
  const segments = key.split('.')
  let target = context
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (i === segments.length - 1) {
      target[segment] = defines[key]
    } else {
      target = target[segment] || (target[segment] = {})
    }
  }
})
