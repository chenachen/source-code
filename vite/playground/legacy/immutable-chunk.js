/** 不带 hash 的现代/legacy 候选文件名列表；只有 immutable chunk 在此配置中固定命名，其他路径可回退 HTML。 */
const chunks = [
  'index',
  'index-legacy',
  'chunk-async',
  'chunk-async-legacy',
  'immutable-chunk',
  'immutable-chunk-legacy',
  'polyfills-legacy',
]

/** 并行请求候选 chunk 路径并返回 Content-Type，用 JS/HTML MIME 区分真实产物命中与 SPA 回退。 */
export function fn() {
  return Promise.all(
    chunks.map(async (name) => {
      const response = await fetch(`/assets/${name}.js`)
      return `${name}: ${response.headers.get('Content-Type')}`
    }),
  )
}
