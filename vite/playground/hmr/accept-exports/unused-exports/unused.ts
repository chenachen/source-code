/** 未被入口使用的命名导出；模块接受空列表，更新只依靠副作用输出观察。 */
export const x = 'x'

/** 未被入口使用的命名导出；模块接受空列表，更新只依靠副作用输出观察。 */
export const y = 'y'

export default 'z'

console.log('-- unused --')

if (import.meta.hot) {
  import.meta.hot.acceptExports([])
}
