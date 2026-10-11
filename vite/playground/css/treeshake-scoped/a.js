import './a-scoped.css' // 未使用默认导出 a 时，其 scoped CSS 应被裁剪。

/** 返回页面实际应用的类名；cssScopeTo 绑定此默认导出，使其 scoped CSS 保留。 */
export default function a() {
  return 'treeshake-scoped-a'
}
