// 为 fixture 提供分隔符转小驼峰的最小实现。
/** 移除连字符、下划线或空白分隔符并提升后续字符，再把首个大写字母小写，作为测试包的最小 camelCase。 */
export default function camelCase(str) {
  return str
    .replace(/[-_\s]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))
    .replace(/^[A-Z]/, (chr) => chr.toLowerCase())
}
