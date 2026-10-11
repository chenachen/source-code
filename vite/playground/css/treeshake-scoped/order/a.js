import './before.css'
import './a-scoped.css'
import './after.css'

/** 返回顺序测试使用的类名；前后普通 CSS 与 scoped CSS 的导入顺序决定颜色和背景覆盖结果。 */
export default function a() {
  return 'treeshake-scoped-order-a'
}
