import './c-scoped.css' // 未使用默认导出 c 时，其 scoped CSS 应被裁剪。

/** 返回未使用默认导出的 scoped 类名；同文件的 cUsed 被使用不应保留这份 CSS。 */
export default function c() {
  return 'treeshake-scoped-c'
}

/** 返回不依赖 scoped CSS 的普通类名，让测试检查模块被使用与默认导出被使用之间的区别。 */
export function cUsed() {
  // 页面使用此函数，但它不依赖 scoped CSS。
  return 'c-used'
}
