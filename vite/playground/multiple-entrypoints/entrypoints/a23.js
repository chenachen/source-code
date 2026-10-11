import a24 from './a24'

/** 仅在调用时动态导入前一个入口 a22.js 并返回 Promise，与指向更高编号的静态边形成分包图。 */
export const that = () => import('./a22.js')

/** 调用更高编号 a24 至 a24 的默认函数并相加，制造 1 条静态依赖。 */
export function other() {
  return a24()
}

/** a23 的公开默认函数返回固定 123，供其他入口的求和函数消费并形成共享静态依赖。 */
export default function () {
  return 123
}
