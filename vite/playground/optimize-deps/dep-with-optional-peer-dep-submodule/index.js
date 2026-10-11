/** 返回当前包的成功标记，不读取可选 peer dependency。 */
export function callItself() {
  return '[success]'
}

/** 动态导入未安装可选 peer 的 foobar/baz 子路径，将诊断交给调用方。 */
export async function callPeerDepSubmodule() {
  return await import('foobar/baz')
}
