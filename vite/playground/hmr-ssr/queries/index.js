import query1 from './multi-query?query1'
import query2 from './multi-query?query2'

hmr('query1', query1)
hmr('query2', query2)

/** 把查询模块的默认值写成共享字符串，供测试分别观察两 query 实例。
 * @param key 查询实例的状态键。
 * @param value 插件转换出的值。 */
function hmr(key, value) {
  globalThis.__HMR__[key] = String(value)
}
