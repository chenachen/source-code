await globalThis.__vite_ssr_hmr_reexport_race__?.wait?.()

/** 原样返回输入的工厂；模块先等待全局门闩，供 HMR 重导出竞态控制求值时序。 */
export function createThing(value) {
  return value
}
