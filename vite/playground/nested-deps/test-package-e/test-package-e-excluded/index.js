/** 窗口上的依赖实例计数键；模块每次实际求值递增一次，用于核对 excluded 依赖没有重复实例。 */
const key = '$$excludedDependencyInstanceCount'

if (!(key in window)) {
  window[key] = 0
}

++window[key]

/** 读取全局实例计数，供被排除依赖的唯一实例断言。 */
export function testExcluded() {
  return window[key]
}
