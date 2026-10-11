import dep from './dep'

/** 入口读取但没有被接受的命名导出，变化需继续传播。 */
export const a = 'A0'

/** 已被接受但入口没有读取的命名导出；它不能覆盖入口对另一导出的使用。 */
export const b = 'B0'

log(`<<< named: ${a} ; ${dep}`)

if (import.meta.hot) {
  import.meta.hot.acceptExports(['b'])
}
