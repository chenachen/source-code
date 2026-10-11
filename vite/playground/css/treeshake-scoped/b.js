import './b-scoped.css' // 未使用默认导出 b 时，其 scoped CSS 应被裁剪。

/** 返回未使用默认导出的类名，用于验证绑定到该导出的 scoped CSS 会随之裁剪。 */
export default function b() {
  return 'treeshake-scoped-b'
}
