/** 打印 syntax foo 标记，作为动态 import 多种读取语法的目标导出。 */
export const foo = () => {
  console.log('treeshaken syntax foo')
}
export default () => {
  console.log('treeshaken syntax default')
}
