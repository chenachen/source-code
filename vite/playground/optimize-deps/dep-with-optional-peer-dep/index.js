/** 返回当前包的成功标记，不读取可选 peer dependency。 */
export function callItself() {
  return '[success]'
}

/** 动态导入未安装可选 peer foobar，将失败交给调用方观察。 */
export async function callPeerDep() {
  return await import('foobar')
}
