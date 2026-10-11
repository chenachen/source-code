import { data } from './data'

/** 读取相对 ./data 的导出，供真实入口和符号链接别名的路径语义对照。 */
export function sayHi() {
  return data
}
