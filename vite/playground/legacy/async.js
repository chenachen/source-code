/** 动态导入后使用 Map 写入 Hello，验证 legacy polyfill 与异步 chunk 一起执行。 */
export function fn() {
  const m = new Map()
  m.set('foo', 'Hello')
  document.querySelector('#app').textContent = m.get('foo')
}
