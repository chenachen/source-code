/** 计数页面的按钮节点，文本和点击状态用于区别局部更新与整页刷新。 */
const btn = document.querySelector('button')
let count = 0
/** 把当前闭包计数写到按钮文本，点击处理器复用此函数。 */
const update = () => {
  btn.textContent = `Counter ${count}`
}
/** 递增当前计数并更新按钮文本，测试在未加载依赖变动后检查该状态是否保留。 */
btn.onclick = () => {
  count++
  update()
}
/** 刻意保持不调用的动态导入分支，使依赖进入分析候选但未加载；测试修改该依赖时检查是否刷新。 */
function neverCalled() {
  import('./dep')
}
