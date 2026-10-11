/** 接受列表中的命名导出，上游并不读取它。 */
export const x = 'y'

/** 入口实际读取的默认导出，未在接受列表中，修改后传播到入口。 */
const def = 'def0'

export default def

log(`<<< default: ${def}`)

if (import.meta.hot) {
  import.meta.hot.acceptExports(['x'])
}
