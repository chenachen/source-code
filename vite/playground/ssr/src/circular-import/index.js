import { A } from './b'

/** 从 b 的转导出读取 A 并拼接展示字符串，验证循环图中最终指向 a 的绑定可访问。 */
export function logA() {
  return `A is: ${A}`
}
