/** HTML 转义字符到实体的映射，覆盖 &、引号、反引号和尖括号；escapeHtml 按匹配字符查询。 */
const escapeHtmlReplaceMap = {
  '&': '&amp;',
  "'": '&#x27;',
  '`': '&#x60;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
}

/** 把输入字符串中的 HTML 特殊字符替换为对应实体；供 SSR 页面拼接动态文本与链接时使用。
 *
 * @param {string} string
 * @returns {string}
 */
export function escapeHtml(string) {
  return string.replace(/[&'`"<>]/g, (match) => escapeHtmlReplaceMap[match])
}
