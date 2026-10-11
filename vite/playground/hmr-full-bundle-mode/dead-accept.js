/** 由页面显示的初始导出；接受调用位于从未执行的分支，静态分析与运行时注册结果不同。 */
export const value = 'dead-accept'
document.querySelector('.dead-accept').textContent = value

// 静态分析能看见 accept，服务器因此发送补丁而非主动整页重载；
// 此分支在运行时不执行，客户端实际没有注册该接受边界。
if (globalThis.__NEVER_TRUE__) {
  import.meta.hot?.accept(() => {})
}
