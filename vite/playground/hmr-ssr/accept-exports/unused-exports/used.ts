/** 入口读取的导出，空接受列表不能覆盖它，因此编辑后需继续传播。 */
export const foo = 'foo0'

/** 入口没有读取的第二导出；模块空接受列表仍无法接管入口使用的第一导出。 */
export const bar = 'bar0'

log('-- used --')

if (import.meta.hot) {
  import.meta.hot.acceptExports([])
}
