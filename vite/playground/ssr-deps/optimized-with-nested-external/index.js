import getMessage from 'nested-external'

/** 从嵌套外部依赖读取当前消息；SSR 优化父包后仍应观察非优化父包通过该依赖写入的值。 */
export function hello() {
  return getMessage()
}
