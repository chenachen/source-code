import './d-scoped.css' // 未使用默认导出 d 时，其 scoped CSS 应被裁剪。

/** 返回未使用的默认导出类名，供 scoped CSS 裁剪和 barrel 场景检查。 */
export default function d() {
  return 'treeshake-scoped-d'
}
