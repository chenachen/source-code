import a10 from './a10'
import a11 from './a11'
import a12 from './a12'
import a13 from './a13'
import a14 from './a14'
import a15 from './a15'
import a16 from './a16'
import a17 from './a17'
import a18 from './a18'
import a19 from './a19'
import a20 from './a20'
import a21 from './a21'
import a22 from './a22'
import a23 from './a23'
import a24 from './a24'

/** 仅在调用时动态导入前一个入口 a8.js 并返回 Promise，与指向更高编号的静态边形成分包图。 */
export const that = () => import('./a8.js')

/** 调用更高编号 a10 至 a24 的默认函数并相加，制造 15 条静态依赖。 */
export function other() {
  return (
    a10() +
    a11() +
    a12() +
    a13() +
    a14() +
    a15() +
    a16() +
    a17() +
    a18() +
    a19() +
    a20() +
    a21() +
    a22() +
    a23() +
    a24()
  )
}

/** a9 的公开默认函数返回固定 123，供其他入口的求和函数消费并形成共享静态依赖。 */
export default function () {
  return 123
}
