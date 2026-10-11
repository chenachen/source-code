let count = 0
/** 递增模块闭包中的计数，供 runner 计数 fixture 使用。 */
export function increment() {
  count++
}
/** 读取当前闭包计数。
 * @returns 当前计数数值。 */
export function getCount() {
  return count
}
/** 刻意保持不调用的动态导入分支，使依赖进入分析候选但未加载；测试修改该依赖时检查是否刷新。 */
// @ts-expect-error not used but this is to test that it works
function neverCalled() {
  import('./dep')
}
