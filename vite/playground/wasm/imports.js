let lastResult

/** 接收 Wasm 调回的数字并更新模块级 lastResult；直接导入样例通过 getResult 观察该副作用。 */
export function imported_func(result) {
  lastResult = result
}

/** 返回最近一次 Wasm 导入回调写入的值；没有自行触发 Wasm 执行。 */
export function getResult() {
  return lastResult
}
