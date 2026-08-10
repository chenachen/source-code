/** 当前进程已输出过的警告，按完整文案去重。 */
const hasWarned: Record<string, boolean> = {}

/** 在非生产、非测试环境中最多输出一次指定警告。 */
export function warnOnce(msg: string): void {
  const isNodeProd =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
  if (!isNodeProd && !__TEST__ && !hasWarned[msg]) {
    hasWarned[msg] = true
    warn(msg)
  }
}

/** 以 compiler-sfc 前缀和黄色终端样式输出警告。 */
export function warn(msg: string): void {
  console.warn(
    `\x1b[1m\x1b[33m[@vue/compiler-sfc]\x1b[0m\x1b[33m ${msg}\x1b[0m\n`,
  )
}
