export { A } from './a'

/** 返回 __B__ 标记，同时本文件转导出 A；与 a 的反向导入形成循环，但函数执行不读取 A。 */
export function getB() {
  return '__B__'
}
