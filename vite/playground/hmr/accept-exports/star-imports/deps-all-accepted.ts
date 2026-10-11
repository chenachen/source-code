/** 命名导出首项，命名空间消费者会读取它；本模块接受全部导出并可作为自身更新边界。 */
export const a = 'a0'

/** 命名导出第二项，命名空间消费者会读取它；本模块接受全部导出并可作为自身更新边界。 */
export const b = 'b0'

/** 内部变量以 c 名重导出，供接受列表与实际导出名称比较；本模块接受全部导出并可作为自身更新边界。 */
const aliased = 'c0'
export { aliased as c }

export default 'default0'

console.log(`all >>>>>> ${a}, ${b}, ${aliased}`)

if (import.meta.hot) {
  import.meta.hot.acceptExports(['a', 'b', 'c', 'default'])
}
