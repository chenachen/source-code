import { valueA } from './circular-dep-init'

/** 循环初始化图中 B 模块的字符串，用作拼接的后半段。 */
export const valueB = 'circ-dep-init-b'
/** 读取 A 的 valueA 并拼接 valueB；在模块求值阶段形成用于核对循环初始化的结果。 */
export const valueAB = valueA.concat(` ${valueB}`)

/** 返回模块初始化时已计算的 valueAB，供页面入口读取循环依赖的最终结果。 */
export function getValueAB() {
  return valueAB
}
