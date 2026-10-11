import a22 from './a22'
import a23 from './a23'
import a24 from './a24'

/** 仅在调用时动态导入前一个入口 a20.js 并返回 Promise，与指向更高编号的静态边形成分包图。 */
export const that = () => import('./a20.js')

/** 调用更高编号 a22 至 a24 的默认函数并相加，制造 3 条静态依赖。 */
export function other() {
  return a22() + a23() + a24()
}

/** a21 的公开默认函数返回固定 123，供其他入口的求和函数消费并形成共享静态依赖。 */
export default function () {
  return 123
}
