// https://github.com/vitejs/vite/issues/20705
// 导航 /test 时应返回对应 HTML，不应把此 JS 当作页面响应。
/** 与 /test.html 同 basename 的 JS 模块值；导航 /test 应命中 HTML，而不是此脚本（#20705）。 */
export const message =
  'This is test.js - should not be served for /test navigation'
