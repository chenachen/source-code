/** 仅在调用时动态导入前一个入口 a23.js 并返回 Promise，与指向更高编号的静态边形成分包图。 */
export const that = () => import('./a23.js')

/** 末端入口没有更高编号依赖，other 返回 undefined，作为密集入口图的边界。 */
export function other() {
  return
}

/** a24 的公开默认函数返回固定 123，供其他入口的求和函数消费并形成共享静态依赖。 */
export default function () {
  return 123
}
